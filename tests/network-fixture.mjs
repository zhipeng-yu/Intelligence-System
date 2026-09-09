import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sha256Hex } from '../functions/_shared.js';

// Execute the production SQL and transactions, including admission triggers.
export class LocalDB {
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
export async function fixture(t, legacy = false, bound = true) {
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
  db.sql.exec(readFileSync(new URL('../migrations/0008_user_browser_bindings.sql', import.meta.url), 'utf8'));
  if (bound) for (let index = 0; index < 8; index++) db.sql.prepare(`INSERT INTO network_bindings
    (user_id,profile_id,request_id,status,created_at) VALUES (?,?,?,'ready','2026-01-01')`)
    .run(`u${index}`, `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, `request-${index}`);
  const env = { DB: db, NETWORK_WORKER_KEY: key };
  async function call(handler, body, { user = 0, worker = false, id = '', method = 'POST' } = {}) {
    if (worker && body && (body.resolve_accounts || body.resume)) body = { ...body, user_sessions: true, profile_id: body.profile_id || '00000000-0000-4000-8000-000000000001' };
    const headers = { 'Content-Type': 'application/json' };
    if (user !== null) headers.Cookie = `ledu_session=session-${user}`;
    if (worker) headers['X-Network-Worker-Key'] = worker === true ? key : worker;
    const response = await handler({ env, params: { id }, request: new Request('https://test.invalid/api', {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    }) });
    return { status: response.status, data: await response.json() };
  }
  return { db, call, env };
}
