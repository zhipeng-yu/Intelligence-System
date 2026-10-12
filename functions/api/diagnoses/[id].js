import { json, withUser } from '../../_shared.js';
import { DIAGNOSIS_COLUMNS, parseDiagnosisAnswer, publicDiagnosis, runDiagnosisAI } from './_shared.js';
import { diagnosisImages, readDiagnosisRequest, imageInput, saveImages, discardImages } from './_images.js';

function parseMessages(value) {
  try {
    const messages = JSON.parse(value);
    return Array.isArray(messages) ? messages : [];
  } catch {
    return [];
  }
}

export const onRequestPatch = withUser(async ({ request, env, user, params }) => {
  const row = await env.DB.prepare(`
    SELECT ${DIAGNOSIS_COLUMNS}
    FROM teaching_diagnoses
    WHERE user_id = ?1 AND id = ?2
  `).bind(user.id, params.id).first();
  if (!row) return json({ error: '教学诊断不存在。' }, 404);
  const followup = row.status === 'completed';
  if (!followup && row.turn_count >= 12) return json({ error: '初次访谈已达到回答上限，请刷新查看分析。' }, 409);

  const existing = diagnosisImages(row);
  const history = parseMessages(row.messages_json);
  const answerTurn = history.filter(message => message.role === 'user').length + 1;
  const parsed = await readDiagnosisRequest(request, existing, answerTurn);
  if (parsed.error) return parsed.error;
  const { body, uploads } = parsed;
  const answer = parseDiagnosisAnswer(body) || (uploads.length &&
    (body?.answer == null || (typeof body.answer === 'string' && !body.answer.trim())) ? '（本轮提供图片）' : null);
  if (!answer) return json({ error: '请填写有效的回答。' }, 400);
  if ((existing.length || uploads.length) && !env.BUCKET) return json({ error: '图片存储尚未配置完成。' }, 503);

  const messages = [...history, { role: 'user', content: answer }];
  // Keep the existing storage bound; follow-ups do not restart or consume the initial interview's 12 turns.
  if (JSON.stringify(messages).length > 60000) return json({ error: '本案例已达到内容保存上限，请新建案例并概括相关事实。本次补充尚未保存。' }, 400);
  const turnCount = row.turn_count + (followup ? 0 : 1);
  let turn;
  try {
    turn = await runDiagnosisAI(env, row, messages, turnCount, await imageInput(env, existing, uploads));
  } catch (error) {
    console.error('Teaching diagnosis AI failed');
    if (error?.code === 'DIAGNOSIS_REPEATED_QUESTION') return json({ error: 'AI 的下一问重复了，本次回答尚未保存；内容已保留，请重试。' }, 502);
    return json({ error: 'AI 教学诊断暂时不可用，本次回答尚未保存，请稍后重试。' }, 502);
  }
  if (turn.status === 'question') messages.push({ role: 'assistant', content: turn.question });
  if (JSON.stringify(messages).length > 60000) return json({ error: '本案例已达到内容保存上限，本次回答尚未保存；请新建案例并概括相关事实。' }, 400);
  const now = new Date().toISOString();
  const completed = turn.status === 'complete';
  let result;
  try {
    await saveImages(env, uploads);
    result = await env.DB.prepare(`
      UPDATE teaching_diagnoses
      SET messages_json = ?1, turn_count = ?13, revision = revision + 1,
        status = ?2, problem = ?3, evidence_json = ?4, solution = ?5, verification = ?6,
        updated_at = ?7, completed_at = ?8, images_json = ?12
      WHERE user_id = ?9 AND id = ?10 AND revision = ?11
    `).bind(
      JSON.stringify(messages), completed ? 'completed' : 'active', completed ? turn.problem : '',
      JSON.stringify(completed ? turn.evidence : []), completed ? turn.solution : '',
      completed ? turn.verification : '', now, completed ? now : null, user.id, params.id, row.revision,
      JSON.stringify([...existing, ...uploads.map(upload => upload.image)]), turnCount
    ).run();
  } catch {
    await discardImages(env, uploads);
    return json({ error: '保存失败，本次回答和新图片尚未保存，请稍后重试。' }, 500);
  }
  if (!result.meta.changes) {
    await discardImages(env, uploads);
    return json({ error: '诊断内容已变化，本次回答和新图片尚未保存，请刷新后重试。' }, 409);
  }
  const saved = await env.DB.prepare(`
    SELECT ${DIAGNOSIS_COLUMNS} FROM teaching_diagnoses WHERE user_id = ?1 AND id = ?2
  `).bind(user.id, params.id).first();
  return json({ diagnosis: publicDiagnosis(saved) });
});
