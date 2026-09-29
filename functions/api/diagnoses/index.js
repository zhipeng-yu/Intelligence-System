import { json, withUser } from '../../_shared.js';
import { DIAGNOSIS_COLUMNS, parseDiagnosisInput, publicDiagnosis, runDiagnosisAI } from './_shared.js';
import { readDiagnosisRequest, imageInput, saveImages, discardImages } from './_images.js';

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
  const parsed = await readDiagnosisRequest(request);
  if (parsed.error) return parsed.error;
  const { body, uploads } = parsed;
  if (uploads.length && !env.BUCKET) return json({ error: '图片存储尚未配置完成。' }, 503);
  const input = parseDiagnosisInput(body);
  if (!input) return json({ error: '请填写有效的案例名称和已发现的现象。' }, 400);

  let turn;
  try {
    turn = await runDiagnosisAI(env, {
      name: input.name, phenomenon: input.phenomenon
    }, [], 0, await imageInput(env, [], uploads));
  } catch {
    console.error('Teaching diagnosis AI failed');
    return json({ error: 'AI 教学诊断暂时不可用，请稍后重试。' }, 502);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const completed = turn.status === 'complete';
  const messages = completed ? [] : [{ role: 'assistant', content: turn.question }];
  try {
    await saveImages(env, uploads);
    await env.DB.prepare(`
      INSERT INTO teaching_diagnoses (
        id, user_id, name, phenomenon, status, messages_json,
        problem, evidence_json, solution, verification, created_at, updated_at, completed_at, images_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12, ?13)
    `).bind(
      id, user.id, input.name, input.phenomenon,
      completed ? 'completed' : 'active', JSON.stringify(messages),
      completed ? turn.problem : '', JSON.stringify(completed ? turn.evidence : []),
      completed ? turn.solution : '', completed ? turn.verification : '', now, completed ? now : null,
      JSON.stringify(uploads.map(upload => upload.image))
    ).run();
  } catch {
    await discardImages(env, uploads);
    return json({ error: '诊断保存失败，本次内容尚未保存，请稍后重试。' }, 500);
  }
  const row = await env.DB.prepare(`
    SELECT ${DIAGNOSIS_COLUMNS} FROM teaching_diagnoses WHERE user_id = ?1 AND id = ?2
  `).bind(user.id, id).first();
  return json({ diagnosis: publicDiagnosis(row) }, 201);
});
