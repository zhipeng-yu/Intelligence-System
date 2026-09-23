import { json, withUser } from '../../_shared.js';
import { DIAGNOSIS_COLUMNS, parseDiagnosisInput, publicDiagnosis, runDiagnosisAI } from './_shared.js';

export const onRequestGet = withUser(async ({ env, user }) => {
  const { results } = await env.DB.prepare(`
    SELECT ${DIAGNOSIS_COLUMNS}
    FROM teaching_diagnoses
    WHERE user_id = ?1
    ORDER BY CASE status WHEN 'active' THEN 1 ELSE 2 END, updated_at DESC, id DESC
    LIMIT 20
  `).bind(user.id).all();
  return json({ diagnoses: (results || []).map(publicDiagnosis) });
});

export const onRequestPost = withUser(async ({ request, env, user }) => {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式无效。' }, 400); }
  const input = parseDiagnosisInput(body);
  if (!input) return json({ error: '请填写有效的名称、异常类型、异常指标和证据。' }, 400);

  let turn;
  try {
    turn = await runDiagnosisAI(env, {
      name: input.name, anomaly_type: input.anomalyType, anomaly_fact: input.anomalyFact
    }, [], 0);
  } catch (error) {
    console.error('Teaching diagnosis AI failed', error);
    return json({ error: 'AI 教学诊断暂时不可用，请稍后重试。' }, 502);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const completed = turn.status === 'complete';
  const messages = completed ? [] : [{ role: 'assistant', content: turn.question }];
  await env.DB.prepare(`
    INSERT INTO teaching_diagnoses (
      id, user_id, name, anomaly_type, anomaly_fact, status, messages_json,
      problem, evidence_json, judgment, uncertainty, created_at, updated_at, completed_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13)
  `).bind(
    id, user.id, input.name, input.anomalyType, input.anomalyFact,
    completed ? 'completed' : 'active', JSON.stringify(messages),
    completed ? turn.problem : '', JSON.stringify(completed ? turn.evidence : []),
    completed ? turn.judgment : '', completed ? turn.uncertainty : '', now, completed ? now : null
  ).run();
  const row = await env.DB.prepare(`
    SELECT ${DIAGNOSIS_COLUMNS} FROM teaching_diagnoses WHERE user_id = ?1 AND id = ?2
  `).bind(user.id, id).first();
  return json({ diagnosis: publicDiagnosis(row) }, 201);
});
