import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet, onRequestPost } from '../functions/api/diagnoses/index.js';
import { onRequestPatch } from '../functions/api/diagnoses/[id].js';
import { parseDiagnosisTurn } from '../functions/api/diagnoses/_shared.js';
import { fixture } from './network-fixture.mjs';

const question = text => ({ status: 'question', question: text, problem: '', evidence: [], judgment: '', uncertainty: '' });
const complete = {
  status: 'complete', question: '', problem: '作业提醒只发群消息，未触达固定未交学生',
  evidence: ['未交集中在固定学生', '作业难度和同期出勤没有变化', '老师未逐一联系'],
  judgment: '其他条件稳定，异常与提醒触达方式一致，问题位于主讲老师的作业跟进环节。',
  uncertainty: '尚未观察调整提醒方式后的结果。'
};

function arkResponse(value, status = 200) {
  return new Response(JSON.stringify({
    output: [{ type: 'function_call', name: 'continue_teaching_diagnosis', arguments: JSON.stringify(value) }]
  }), { status, headers: { 'Content-Type': 'application/json' } });
}

function useAI(env, turns, requests = []) {
  env.ARK_API_KEY = 'test-key';
  env.ARK_FETCH = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return arkResponse(turns.shift());
  };
}

async function create(call, user = 0, overrides = {}) {
  return call(onRequestPost, {
    name: '王老师作业异常',
    anomaly_type: 'homework',
    anomaly_fact: '连续三周未提交人数由 2 人增加到 8 人',
    ...overrides
  }, { user });
}

test('diagnoses use the cookie user and never accept client ownership', async t => {
  const { call, env } = await fixture(t, false, false);
  useAI(env, [question('未交学生是否集中在固定班级或学生？'), question('缺勤是否也集中在这些学生？')]);
  const mine = await create(call, 0, { user_id: 'u1' });
  const theirs = await create(call, 1, { name: '李老师出勤异常', anomaly_type: 'attendance' });
  assert.equal(mine.status, 201);
  assert.equal(theirs.status, 201);

  const userZero = await call(onRequestGet, undefined, { user: 0, method: 'GET' });
  const userOne = await call(onRequestGet, undefined, { user: 1, method: 'GET' });
  assert.deepEqual(userZero.data.diagnoses.map(item => item.name), ['王老师作业异常']);
  assert.deepEqual(userOne.data.diagnoses.map(item => item.name), ['李老师出勤异常']);
  assert.equal('user_id' in userZero.data.diagnoses[0], false);
  assert.equal((await call(onRequestGet, undefined, { user: null, method: 'GET' })).status, 401);
});

test('AI interviews teaching staff one question at a time and ends with an evidence-based diagnosis', async t => {
  const { call, env } = await fixture(t, false, false);
  const requests = [];
  useAI(env, [
    question('未提交学生是否集中在固定学生？'),
    question('老师对这些未交学生采取了哪些提醒方式？'),
    complete
  ], requests);
  const created = await create(call);
  const id = created.data.diagnosis.id;
  assert.equal(created.data.diagnosis.status, 'active');
  assert.deepEqual(created.data.diagnosis.messages, [
    { role: 'assistant', content: '未提交学生是否集中在固定学生？' }
  ]);

  let response = await call(onRequestPatch, { answer: '集中在固定 6 名学生。' }, { user: 0, method: 'PATCH', id });
  assert.equal(response.data.diagnosis.turn_count, 1);
  assert.equal(response.data.diagnosis.messages.at(-1).content, '老师对这些未交学生采取了哪些提醒方式？');

  const hidden = await call(onRequestPatch, { answer: '只发了班级群提醒。' }, { user: 1, method: 'PATCH', id });
  assert.equal(hidden.status, 404);
  response = await call(onRequestPatch, { answer: '只发了班级群提醒，没有逐一联系。' }, { user: 0, method: 'PATCH', id });
  assert.equal(response.data.diagnosis.status, 'completed');
  assert.equal(response.data.diagnosis.problem, complete.problem);
  assert.deepEqual(response.data.diagnosis.evidence, complete.evidence);
  assert.ok(response.data.diagnosis.completed_at);
  assert.match(requests[0].body.input, /作业难度.*未提交学生分布.*家长反馈/s);
  assert.match(requests[2].body.input, /集中在固定 6 名学生/);
  assert.equal(requests[2].body.tools[0].name, 'continue_teaching_diagnosis');

  const locked = await call(onRequestPatch, { answer: '继续' }, { user: 0, method: 'PATCH', id });
  assert.equal(locked.status, 409);
});

test('diagnosis validates user and AI data and leaves failed answers unsaved', async t => {
  const errorLog = t.mock.method(console, 'error', () => {});
  const { call, env } = await fixture(t, false, false);
  useAI(env, [question('请补充事实。')]);
  for (const overrides of [
    { name: '' }, { name: 'x'.repeat(121) }, { anomaly_type: 'score' },
    { anomaly_fact: '' }, { anomaly_fact: 'x'.repeat(4001) }
  ]) assert.equal((await create(call, 0, overrides)).status, 400);

  const created = await create(call);
  const id = created.data.diagnosis.id;
  assert.equal((await call(onRequestPatch, { answer: '' }, { user: 0, method: 'PATCH', id })).status, 400);
  env.ARK_FETCH = async () => new Response('bad gateway', { status: 503 });
  const failed = await call(onRequestPatch, { answer: '这是一条不会保存的回答' }, { user: 0, method: 'PATCH', id });
  assert.equal(failed.status, 502);
  assert.equal(errorLog.mock.callCount(), 1);
  const listed = await call(onRequestGet, undefined, { user: 0, method: 'GET' });
  assert.equal(listed.data.diagnoses[0].turn_count, 0);
  assert.equal(listed.data.diagnoses[0].messages.length, 1);
});

test('AI output and 0009 migration reject invalid diagnosis state', async t => {
  assert.throws(() => parseDiagnosisTurn({ output: [] }));
  assert.throws(() => parseDiagnosisTurn({ output: [{
    type: 'function_call', name: 'continue_teaching_diagnosis', arguments: JSON.stringify({ ...complete, evidence: [] })
  }] }));

  const { db } = await fixture(t, false, false);
  assert.ok(db.sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'teaching_diagnoses'").get());
  assert.throws(() => db.sql.prepare(`
    INSERT INTO teaching_diagnoses (
      id, user_id, name, anomaly_type, anomaly_fact, status, created_at, updated_at
    ) VALUES (?, 'u0', '案例', 'homework', '事实', 'completed', '2026-01-01', '2026-01-01')
  `).run('00000000-0000-4000-8000-000000000099'));
});
