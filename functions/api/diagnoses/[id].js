import { json, withUser } from '../../_shared.js';
import { DIAGNOSIS_COLUMNS, parseDiagnosisAnswer, publicDiagnosis, runDiagnosisAI } from './_shared.js';

function parseMessages(value) {
  try {
    const messages = JSON.parse(value);
    return Array.isArray(messages) ? messages : [];
  } catch {
    return [];
  }
}

export const onRequestPatch = withUser(async ({ request, env, user, params }) => {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式无效。' }, 400); }
  const answer = parseDiagnosisAnswer(body);
  if (!answer) return json({ error: '请填写有效的回答。' }, 400);
  const row = await env.DB.prepare(`
    SELECT ${DIAGNOSIS_COLUMNS}
    FROM teaching_diagnoses
    WHERE user_id = ?1 AND id = ?2
  `).bind(user.id, params.id).first();
  if (!row) return json({ error: '教学诊断不存在。' }, 404);
  if (row.status === 'completed') return json({ error: '这次教学诊断已经结束。' }, 409);
  if (row.turn_count >= 12) return json({ error: '这次教学诊断已达到回答上限，请重新开始。' }, 409);

  const messages = [...parseMessages(row.messages_json), { role: 'user', content: answer }];
  let turn;
  try { turn = await runDiagnosisAI(env, row, messages, row.turn_count + 1); } catch (error) {
    console.error('Teaching diagnosis AI failed', error);
    return json({ error: 'AI 教学诊断暂时不可用，本次回答尚未保存，请稍后重试。' }, 502);
  }
  if (turn.status === 'question') messages.push({ role: 'assistant', content: turn.question });
  const now = new Date().toISOString();
  const completed = turn.status === 'complete';
  const result = await env.DB.prepare(`
    UPDATE teaching_diagnoses
    SET messages_json = ?1, turn_count = turn_count + 1, revision = revision + 1,
      status = ?2, problem = ?3, evidence_json = ?4, judgment = ?5, uncertainty = ?6,
      updated_at = ?7, completed_at = ?8
    WHERE user_id = ?9 AND id = ?10 AND status = 'active' AND revision = ?11
  `).bind(
    JSON.stringify(messages), completed ? 'completed' : 'active', completed ? turn.problem : '',
    JSON.stringify(completed ? turn.evidence : []), completed ? turn.judgment : '',
    completed ? turn.uncertainty : '', now, completed ? now : null, user.id, params.id, row.revision
  ).run();
  if (!result.meta.changes) return json({ error: '诊断内容已变化，请刷新后重试。' }, 409);
  const saved = await env.DB.prepare(`
    SELECT ${DIAGNOSIS_COLUMNS} FROM teaching_diagnoses WHERE user_id = ?1 AND id = ?2
  `).bind(user.id, params.id).first();
  return json({ diagnosis: publicDiagnosis(saved) });
});
