import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { redId } from '../functions/api/network/_shared.js';
import { onRequestGet as list, onRequestPost as add } from '../functions/api/network/accounts/index.js';
import { onRequestDelete as remove } from '../functions/api/network/accounts/[id].js';
import { onRequestPost as search } from '../functions/api/network/searches/index.js';
import { onRequestPost as claim } from '../functions/api/network/worker/claim.js';
import { onRequestPost as finish } from '../functions/api/network/worker/accounts/[id].js';

import { fixture } from './network-fixture.mjs';

const ready = job => ({ claim_token: job.claim_token, status: 'ready', red_id: job.red_id, account_id: 'b'.repeat(24), nickname: '测试昵称' });

test('0007 preserves legacy accounts, history and foreign keys; exact inputs never become stable IDs', async t => {
  const { db, call } = await fixture(t, true);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM network_search_results').get().n, 1);
  assert.deepEqual(db.sql.prepare('PRAGMA foreign_key_check').all(), []);
  const account = db.sql.prepare('SELECT * FROM watched_accounts').get();
  assert.equal(account.account_id, 'a'.repeat(24)); assert.equal(account.status, 'ready'); assert.equal(account.red_id, null);
  assert.equal(redId(' Ab_12-34 '), 'Ab_12-34');
  for (const value of ['昵称', 'https://x.test', 'bad number', 'ａｂｃ', 'x'.repeat(65), 123]) assert.equal(redId(value), '');
  assert.equal((await call(add, { account_id: 'a'.repeat(24) })).status, 400);
  assert.equal((await call(add, { red_id: 'b'.repeat(24) }, { user: null })).status, 401);
  const added = await call(add, { red_id: 'b'.repeat(24), user_id: 'u1' });
  assert.equal(added.status, 202);
  const row = db.sql.prepare('SELECT * FROM watched_accounts WHERE id = ?').get(added.data.account.id);
  assert.equal(row.account_id, null); assert.equal(row.user_id, 'u0'); assert.equal(row.status, 'queued');
  assert.equal((await call(search, { keywords: ['课程'], days: 7 })).status, 409);
  assert.equal((await call(list, undefined, { user: 1, method: 'GET' })).data.accounts.length, 0);
  assert.equal((await call(remove, undefined, { user: 1, method: 'DELETE', id: row.id })).status, 404);
});

test('resolution uses the shared serial claim; validates lease, exact number, idempotency and stable ownership', async t => {
  const { db, call } = await fixture(t);
  const added = await call(add, { red_id: 'Exact_123' });
  assert.equal((await call(add, { red_id: 'another' })).status, 409);
  assert.equal((await call(claim, {}, { worker: true })).status, 409); // old worker
  assert.equal((await call(claim, { resolve_accounts: true }, { worker: 'wrong' })).status, 401);
  const job = (await call(claim, { resolve_accounts: true }, { worker: true })).data.job;
  assert.equal(job.kind, 'account_resolution'); assert.equal(job.id, added.data.account.id);
  assert.equal((await call(remove, undefined, { method: 'DELETE', id: job.id })).status, 409);
  assert.equal((await call(claim, { resolve_accounts: true }, { worker: true })).data.job, null);
  for (const body of [
    { ...ready(job), red_id: 'exact_123' }, { ...ready(job), account_id: 'unverified' },
    { ...ready(job), nickname: 'x'.repeat(101) }, { ...ready(job), status: 'failed', error_code: 'not_found' }
  ]) assert.equal((await call(finish, body, { worker: true, id: job.id })).status, 400);
  assert.equal((await call(finish, { ...ready(job), claim_token: 'wrong' }, { worker: true, id: job.id })).status, 409);
  assert.equal((await call(finish, ready(job), { worker: 'wrong', id: job.id })).status, 401);
  assert.equal((await call(finish, ready(job), { worker: true, id: job.id })).status, 200);
  assert.equal((await call(finish, ready(job), { worker: true, id: job.id })).data.idempotent, true);
  assert.equal((await call(finish, { ...ready(job), account_id: 'c'.repeat(24) }, { worker: true, id: job.id })).status, 409);
  const listed = (await call(list, undefined, { method: 'GET' })).data.accounts[0];
  assert.equal(listed.account_id, 'b'.repeat(24)); assert.equal(listed.nickname, '测试昵称');
  assert.equal('claim_token_hash' in listed, false);
  const created = await call(search, { keywords: ['课程'], days: 7 });
  assert.equal(created.status, 201); assert.deepEqual(created.data.search.accounts, ['b'.repeat(24)]);
  await call(add, { red_id: 'second_user' }, { user: 1 });
  const searchJob = (await call(claim, { resolve_accounts: true }, { worker: true })).data.job;
  assert.equal(searchJob.id, created.data.search.id);
  assert.equal((await call(claim, { resolve_accounts: true }, { worker: true })).data.job, null);
  assert.equal(db.sql.prepare("SELECT COUNT(*) n FROM watched_accounts WHERE status='running'").get().n, 0);
});

test('stable duplicate fails without changing legacy data; max three slots and deletion-safe daily limit', async t => {
  const { db, call } = await fixture(t, true);
  await call(add, { red_id: 'same_account' });
  const job = (await call(claim, { resolve_accounts: true }, { worker: true })).data.job;
  const body = { ...ready(job), account_id: 'a'.repeat(24) };
  assert.equal((await call(finish, body, { worker: true, id: job.id })).data.status, 'failed');
  assert.equal((await call(finish, body, { worker: true, id: job.id })).data.idempotent, true);
  assert.equal(db.sql.prepare('SELECT error_code FROM watched_accounts WHERE id=?').get(job.id).error_code, 'duplicate');
  assert.equal(db.sql.prepare("SELECT account_id FROM watched_accounts WHERE id='legacy'").get().account_id, 'a'.repeat(24));
  await call(add, { red_id: 'third' });
  assert.equal((await call(add, { red_id: 'fourth' })).status, 409);
  for (const row of db.sql.prepare("SELECT id FROM watched_accounts WHERE id <> 'legacy'").all()) {
    assert.equal((await call(remove, undefined, { id: row.id, method: 'DELETE' })).status, 200);
  }
  const third = await call(add, { red_id: 'last_try' }); assert.equal(third.status, 202);
  await call(remove, undefined, { id: third.data.account.id, method: 'DELETE' });
  assert.equal((await call(add, { red_id: 'over_daily' })).status, 429);
});

test('account site cap is atomic and independent of detail budget; rejected inserts do not consume counts', async t => {
  const { db, call } = await fixture(t);
  for (let attempt = 0; attempt < 20; attempt++) {
    const user = Math.floor(attempt / 3);
    const result = await call(add, { red_id: `user_${attempt}` }, { user });
    assert.equal(result.status, 202);
    await call(remove, undefined, { id: result.data.account.id, user, method: 'DELETE' });
  }
  assert.equal((await call(add, { red_id: 'over_site' }, { user: 7 })).status, 429);
  assert.equal(db.sql.prepare('SELECT SUM(attempts) n FROM network_account_daily_usage').get().n, 20);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM network_search_jobs').get().n, 0);
});

test('expired resolution never replays; blocked halts all work until explicit repair', async t => {
  const { db, call } = await fixture(t);
  await call(add, { red_id: 'expired' });
  const job = (await call(claim, { resolve_accounts: true }, { worker: true })).data.job;
  db.sql.prepare('UPDATE watched_accounts SET lease_expires_at=? WHERE id=?').run('2000-01-01', job.id);
  assert.equal((await call(finish, ready(job), { worker: true, id: job.id })).status, 409);
  assert.equal((await call(claim, { resolve_accounts: true }, { worker: true })).data.job, null);
  assert.equal(db.sql.prepare('SELECT error_code FROM watched_accounts WHERE id=?').get(job.id).error_code, 'lease_expired');
  await call(add, { red_id: 'blocked' }, { user: 1 });
  const next = (await call(claim, { resolve_accounts: true }, { worker: true })).data.job;
  assert.equal((await call(finish, { status: 'blocked', error_code: 'security_blocked', claim_token: next.claim_token }, { worker: true, id: next.id })).status, 200);
  assert.equal(db.sql.prepare('SELECT halted FROM network_worker_control').get().halted, 1);
  await call(add, { red_id: 'waiting' }, { user: 2 });
  assert.equal((await call(claim, { resolve_accounts: true }, { worker: true })).data.halted, true);
  await call(claim, { resume: true }, { worker: true });
  assert.equal((await call(claim, { resolve_accounts: true }, { worker: true })).data.job.red_id, 'waiting');
  assert.equal(db.sql.prepare('SELECT status FROM watched_accounts WHERE id=?').get(next.id).status, 'blocked');
});

test('legacy standard IDs are hidden in rendered summaries and failures without changing stored history', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const source = html.match(/function publicAccountText\(value, ids\) \{([\s\S]*?)\n    \}/)[1];
  const display = new Function('value', 'ids', source);
  assert.equal(display('账号“' + 'a'.repeat(24) + '”发布。', ['a'.repeat(24)]), '账号“已保存账号”发布。');
  assert.equal(display('普通摘要', ['a'.repeat(24)]), '普通摘要');
  assert.match(html, /publicAccountText\(result.summary, \[result.account_id\]\)/);
  assert.match(html, /publicAccountText\(failure.reason, item.accounts\)/);
});
