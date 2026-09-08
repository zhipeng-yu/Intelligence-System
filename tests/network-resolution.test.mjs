import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { sha256Hex } from '../functions/_shared.js';
import { redId } from '../functions/api/network/_shared.js';
import { onRequestGet as list, onRequestPost as add } from '../functions/api/network/accounts/index.js';
import { onRequestDelete as remove } from '../functions/api/network/accounts/[id].js';
import { onRequestPost as search } from '../functions/api/network/searches/index.js';
import { onRequestPost as claim } from '../functions/api/network/worker/claim.js';
import { onRequestPost as finish } from '../functions/api/network/worker/accounts/[id].js';

// Execute the production SQL and transactions, including admission triggers.
class LocalDB {
  constructor() { this.sql = new DatabaseSync(':memory:'); this.sql.exec('PRAGMA foreign_keys = ON'); }
  prepare(source) {
    const db = this.sql;
    return {
      values: [],
      bind(...values) { this.values = values; return this; },
      execute(method) {
        const args = [];
        const sql = source.replace(/\?(\d+)/g, (_, index) => { args.push(this.values[index - 1]); return '?'; });
        return db.prepare(sql)[method](...args);
      },
      async first() { return this.execute('get') || null; },
      async all() { return { results: this.execute('all') }; },
      async run() { return { meta: { changes: this.execute('run').changes } }; }
    };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sql.exec('COMMIT');
      return results;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
const key = 'test-worker-key-12345678901234567890';
async function fixture(t, legacy = false) {
  const db = new LocalDB();
  t.after(() => db.sql.close());
  const files = readdirSync(new URL('../migrations/', import.meta.url)).sort();
  for (const file of files.filter(file => file < '0007')) db.sql.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  for (let index = 0; index < 8; index++) {
    db.sql.prepare('INSERT INTO users VALUES (?, ?, ?, ?, 1, ?, ?)').run(`u${index}`, String(index).repeat(64), '1234', '', '2026-01-01', '2026-01-01');
    db.sql.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(await sha256Hex(`session-${index}`), `u${index}`, '2026-01-01', '2099-01-01');
  }
  if (legacy) {
    db.sql.prepare('INSERT INTO watched_accounts VALUES (?, ?, ?, ?)').run('legacy', 'u0', 'a'.repeat(24), '2026-01-01');
    db.sql.prepare(`INSERT INTO network_search_jobs (id,user_id,keywords_json,accounts_json,days,window_start_at,created_at,status)
      VALUES ('old-job','u0','["课程"]',?,7,'2026-01-01','2026-01-02','completed')`).run(JSON.stringify(['a'.repeat(24)]));
    db.sql.prepare('INSERT INTO network_search_results VALUES (?,?,?,?,?,?,?,?)').run('old-result','old-job','a'.repeat(24),'旧昵称','2026-01-01','旧标题','https://www.xiaohongshu.com/explore/'+'b'.repeat(24),'摘'.repeat(100));
  }
  db.sql.exec(readFileSync(new URL('../migrations/0007_resolve_red_ids.sql', import.meta.url), 'utf8'));
  const env = { DB: db, NETWORK_WORKER_KEY: key };
  async function call(handler, body, { user = 0, worker = false, id = '', method = 'POST' } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (user !== null) headers.Cookie = `ledu_session=session-${user}`;
    if (worker) headers['X-Network-Worker-Key'] = worker === true ? key : worker;
    const response = await handler({ env, params: { id }, request: new Request('https://test.invalid/api', {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    }) });
    return { status: response.status, data: await response.json() };
  }
  return { db, call };
}
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
  assert.equal((await call(claim, {}, { worker: true })).data.job, null); // old worker
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
