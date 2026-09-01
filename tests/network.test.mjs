import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { onRequestPost as login } from '../functions/api/auth/login.js';
import { onRequestPost as logout } from '../functions/api/auth/logout.js';
import { onRequestGet as me } from '../functions/api/auth/me.js';
import { onRequestGet as listUsers, onRequestPost as addUser } from '../functions/api/admin/users/index.js';
import { onRequestPatch as patchUser } from '../functions/api/admin/users/[id].js';
import { onRequestGet as listAccounts, onRequestPost as addAccount } from '../functions/api/network/accounts/index.js';
import { onRequestDelete as deleteAccount } from '../functions/api/network/accounts/[id].js';
import { onRequestGet as listSearches, onRequestPost as addSearch } from '../functions/api/network/searches/index.js';
import { onRequestGet as getSearch, onRequestDelete as deleteSearch } from '../functions/api/network/searches/[id].js';
import { onRequestPost as claimJob } from '../functions/api/network/worker/claim.js';
import { onRequestPost as finishJob } from '../functions/api/network/worker/jobs/[id].js';
import { phoneHmac, sha256Hex } from '../functions/_shared.js';

const ADMIN_KEY = '0123456789abcdef0123456789abcdef';
const INGEST_KEY = 'fedcba9876543210fedcba9876543210';
const WORKER_KEY = 'abcdef0123456789abcdef0123456789';
const PHONE_PEPPER = 'pepper-0123456789abcdef0123456789abcdef';
const PHONE = '13800138000';

class FakeDB {
  constructor() {
    this.users = new Map();
    this.sessions = new Map();
    this.accounts = new Map();
    this.jobs = new Map();
    this.results = new Map();
  }

  prepare(sql) {
    const db = this;
    return {
      values: [],
      bind(...values) { this.values = values; return this; },
      all() { return db.all(sql, this.values); },
      first() { return db.first(sql, this.values); },
      run() { return db.run(sql, this.values); }
    };
  }

  async batch(statements) {
    const output = [];
    for (const statement of statements) output.push(await statement.run());
    return output;
  }

  async all(sql, values) {
    if (/FROM users\s+ORDER BY/.test(sql)) {
      return { results: [...this.users.values()].map(({ phone_hmac, ...user }) => ({ ...user })) };
    }
    if (/FROM watched_accounts/.test(sql)) {
      return { results: [...this.accounts.values()].filter(item => item.user_id === values[0])
        .sort((a, b) => a.created_at.localeCompare(b.created_at)).map(item => ({ ...item })) };
    }
    if (/FROM network_search_results AS result/.test(sql)) {
      const userId = values[0];
      return { results: [...this.results.values()].filter(item => this.jobs.get(item.job_id)?.user_id === userId)
        .sort((a, b) => b.published_at.localeCompare(a.published_at)).map(item => ({ ...item })) };
    }
    if (/FROM network_search_results\s+WHERE job_id/.test(sql)) {
      return { results: [...this.results.values()].filter(item => item.job_id === values[0])
        .sort((a, b) => b.published_at.localeCompare(a.published_at)).map(item => ({ ...item })) };
    }
    if (/FROM network_search_jobs/.test(sql)) {
      const userId = values[0];
      const own = [...this.jobs.values()].filter(job => job.user_id === userId);
      const ended = own.filter(job => ['completed', 'partial', 'blocked', 'failed'].includes(job.status))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10);
      const allowed = new Set(ended.map(job => job.id));
      return { results: own.filter(job => ['queued', 'running'].includes(job.status) || allowed.has(job.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)).map(job => ({ ...job })) };
    }
    return { results: [] };
  }

  async first(sql, values) {
    if (/UPDATE network_search_jobs[\s\S]*RETURNING/.test(sql)) {
      const [now, expires, claimHash] = values;
      const job = [...this.jobs.values()].filter(item => item.status === 'queued'
        || (item.status === 'running' && item.lease_expires_at <= now))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      if (!job) return null;
      Object.assign(job, { status: 'running', claimed_at: now, lease_expires_at: expires,
        claim_token_hash: claimHash, attempt_count: job.attempt_count + 1 });
      return { ...job };
    }
    if (/FROM sessions AS session/.test(sql)) {
      const [hash, now] = values;
      const session = this.sessions.get(hash);
      const user = session && session.expires_at > now ? this.users.get(session.user_id) : null;
      return user?.enabled ? { id: user.id, phone_last4: user.phone_last4, note: user.note,
        expires_at: session.expires_at } : null;
    }
    if (/FROM users\s+WHERE phone_hmac/.test(sql)) {
      return [...this.users.values()].find(user => user.phone_hmac === values[0] && user.enabled) || null;
    }
    if (/FROM users WHERE id/.test(sql)) return this.users.get(values[0]) || null;
    if (/AS duplicate/.test(sql)) {
      const own = [...this.accounts.values()].filter(item => item.user_id === values[0]);
      return { count: own.length, duplicate: Number(own.some(item => item.account_id === values[1])) };
    }
    if (/AS active/.test(sql)) {
      const [userId, start, end] = values;
      const jobs = [...this.jobs.values()];
      return {
        active: jobs.filter(job => job.user_id === userId && ['queued', 'running'].includes(job.status)).length,
        user_today: jobs.filter(job => job.user_id === userId && job.created_at >= start && job.created_at < end).length,
        site_today: jobs.filter(job => job.created_at >= start && job.created_at < end).length
      };
    }
    if (/FROM network_search_jobs\s+WHERE id = \?1 AND user_id/.test(sql)) {
      const job = this.jobs.get(values[0]);
      return job?.user_id === values[1] ? { ...job } : null;
    }
    if (/FROM network_search_jobs WHERE id = \?1/.test(sql)) return this.jobs.get(values[0]) || null;
    return null;
  }

  async run(sql, values) {
    if (/INSERT INTO sessions/.test(sql)) {
      this.sessions.set(values[0], { token_hash: values[0], user_id: values[1], created_at: values[2], expires_at: values[3] });
      return { meta: { changes: 1 } };
    }
    if (/DELETE FROM sessions WHERE expires_at/.test(sql)) {
      for (const [hash, session] of this.sessions) if (session.expires_at <= values[0]) this.sessions.delete(hash);
      return { meta: { changes: 1 } };
    }
    if (/DELETE FROM sessions WHERE token_hash/.test(sql)) return { meta: { changes: Number(this.sessions.delete(values[0])) } };
    if (/DELETE FROM sessions WHERE user_id/.test(sql)) {
      for (const [hash, session] of this.sessions) if (session.user_id === values[0]) this.sessions.delete(hash);
      return { meta: { changes: 1 } };
    }
    if (/INSERT INTO users/.test(sql)) {
      if ([...this.users.values()].some(user => user.phone_hmac === values[1])) throw new Error('UNIQUE constraint');
      this.users.set(values[0], { id: values[0], phone_hmac: values[1], phone_last4: values[2], note: values[3],
        enabled: 1, created_at: values[4], updated_at: values[4] });
      return { meta: { changes: 1 } };
    }
    if (/UPDATE users SET note/.test(sql)) {
      const user = this.users.get(values[3]);
      if (!user) return { meta: { changes: 0 } };
      Object.assign(user, { note: values[0], enabled: values[1], updated_at: values[2] });
      return { meta: { changes: 1 } };
    }
    if (/INSERT INTO watched_accounts/.test(sql)) {
      const own = [...this.accounts.values()].filter(item => item.user_id === values[1]);
      if (own.length >= 3 || own.some(item => item.account_id === values[2])) return { meta: { changes: 0 } };
      this.accounts.set(values[0], { id: values[0], user_id: values[1], account_id: values[2], created_at: values[3] });
      return { meta: { changes: 1 } };
    }
    if (/DELETE FROM watched_accounts/.test(sql)) {
      const account = this.accounts.get(values[0]);
      if (!account || account.user_id !== values[1]) return { meta: { changes: 0 } };
      this.accounts.delete(values[0]);
      return { meta: { changes: 1 } };
    }
    if (/INSERT INTO network_search_jobs/.test(sql)) {
      const [id, userId, keywords, accounts, days, windowStart, createdAt, dayStart, dayEnd] = values;
      const jobs = [...this.jobs.values()];
      const allowed = jobs.filter(job => job.user_id === userId && job.created_at >= dayStart && job.created_at < dayEnd).length < 3
        && jobs.filter(job => job.created_at >= dayStart && job.created_at < dayEnd).length < 20
        && !jobs.some(job => job.user_id === userId && ['queued', 'running'].includes(job.status));
      if (!allowed) return { meta: { changes: 0 } };
      this.jobs.set(id, { id, user_id: userId, keywords_json: keywords, accounts_json: accounts, days,
        window_start_at: windowStart, created_at: createdAt, status: 'queued', claimed_at: null,
        lease_expires_at: null, claim_token_hash: null, attempt_count: 0, completed_at: null,
        error_detail: null, failures_json: null, result_payload_hash: null, result_payload_json: null });
      return { meta: { changes: 1 } };
    }
    if (/DELETE FROM network_search_jobs\s+WHERE id/.test(sql)) {
      const job = this.jobs.get(values[0]);
      if (!job || job.user_id !== values[1]) return { meta: { changes: 0 } };
      this.jobs.delete(values[0]);
      for (const [id, result] of this.results) if (result.job_id === values[0]) this.results.delete(id);
      return { meta: { changes: 1 } };
    }
    if (/SET status = \?1, completed_at/.test(sql)) {
      const [status, completed, detail, failures, payloadHash, payload, id, claimHash] = values;
      const job = this.jobs.get(id);
      if (!job || job.status !== 'running' || job.claim_token_hash !== claimHash
          || job.lease_expires_at <= completed || job.result_payload_hash) return { meta: { changes: 0 } };
      Object.assign(job, { status, completed_at: completed, error_detail: detail, failures_json: failures,
        result_payload_hash: payloadHash, result_payload_json: payload, lease_expires_at: null });
      return { meta: { changes: 1 } };
    }
    if (/INSERT OR IGNORE INTO network_search_results/.test(sql)) {
      if (![...this.results.values()].some(item => item.job_id === values[1] && item.url === values[6])) {
        this.results.set(values[0], { id: values[0], job_id: values[1], account_id: values[2], account_name: values[3],
          published_at: values[4], title: values[5], url: values[6], summary: values[7] });
      }
      return { meta: { changes: 1 } };
    }
    if (/DELETE FROM network_search_jobs[\s\S]*status IN/.test(sql)) {
      const ended = [...this.jobs.values()].filter(job => job.user_id === values[0]
        && ['completed', 'partial', 'blocked', 'failed'].includes(job.status))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      for (const job of ended.slice(10)) {
        this.jobs.delete(job.id);
        for (const [id, result] of this.results) if (result.job_id === job.id) this.results.delete(id);
      }
      return { meta: { changes: ended.length > 10 ? ended.length - 10 : 0 } };
    }
    return { meta: { changes: 0 } };
  }
}

function bindings(db, turnstile = true) {
  return {
    DB: db,
    ADMIN_KEY,
    INGEST_KEY,
    NETWORK_WORKER_KEY: WORKER_KEY,
    PHONE_PEPPER,
    TURNSTILE_SECRET: 'turnstile-secret',
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_FETCH: async () => Response.json({ success: turnstile })
  };
}

function request(path, { method = 'GET', body, cookie, admin = false, worker } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', `ledu_session=${cookie}`);
  if (admin) headers.set('Authorization', `Bearer ${ADMIN_KEY}`);
  if (worker !== undefined) headers.set('X-Network-Worker-Key', worker);
  headers.set('CF-Connecting-IP', '203.0.113.8');
  return new Request(`https://archive.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function seedUser(db, phone = PHONE, id = 'user-a', enabled = 1) {
  db.users.set(id, { id, phone_hmac: await phoneHmac(phone, PHONE_PEPPER), phone_last4: phone.slice(-4),
    note: id, enabled, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z' });
}

async function seedSession(db, userId, token) {
  db.sessions.set(await sha256Hex(token), { token_hash: await sha256Hex(token), user_id: userId,
    created_at: new Date().toISOString(), expires_at: '2099-01-01T00:00:00.000Z' });
}

test('phone login is non-enumerating, Turnstile-protected, hashed, and uses a secure 12-hour cookie', async () => {
  const db = new FakeDB();
  await seedUser(db);
  const valid = await login({ request: request('/api/auth/login', { method: 'POST',
    body: { phone: PHONE, turnstile_token: 'valid' } }), env: bindings(db) });
  assert.equal(valid.status, 200);
  const cookie = valid.headers.get('Set-Cookie');
  assert.match(cookie, /Max-Age=43200/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  const token = cookie.match(/^ledu_session=([^;]+)/)[1];
  assert.equal(db.sessions.has(token), false);
  assert.equal(db.sessions.has(await sha256Hex(token)), true);
  const storedSession = db.sessions.get(await sha256Hex(token));
  assert.equal(Math.round((Date.parse(storedSession.expires_at) - Date.parse(storedSession.created_at)) / 1000), 43200);

  const cases = [
    [bindings(db), { phone: '13900139000', turnstile_token: 'valid' }],
    [bindings(db), { phone: '123', turnstile_token: 'valid' }],
    [bindings(db, false), { phone: PHONE, turnstile_token: 'bad' }]
  ];
  db.users.get('user-a').enabled = 0;
  cases.push([bindings(db), { phone: PHONE, turnstile_token: 'valid' }]);
  const failures = [];
  for (const [env, body] of cases) {
    const response = await login({ request: request('/api/auth/login', { method: 'POST', body }), env });
    failures.push([response.status, await response.json()]);
  }
  assert.ok(failures.every(value => value[0] === 401));
  assert.equal(new Set(failures.map(value => JSON.stringify(value[1]))).size, 1);
});

test('admin whitelist requires both a session and ADMIN_KEY; logout and disable invalidate sessions', async () => {
  const db = new FakeDB();
  await seedUser(db);
  await seedSession(db, 'user-a', 'session-a');
  const env = bindings(db);
  assert.equal((await listUsers({ request: request('/api/admin/users', { admin: true }), env })).status, 401);
  assert.equal((await listUsers({ request: request('/api/admin/users', { cookie: 'session-a' }), env })).status, 401);

  const created = await addUser({ request: request('/api/admin/users', { method: 'POST', cookie: 'session-a', admin: true,
    body: { phone: '13900139000', note: '第二位' } }), env });
  assert.equal(created.status, 201);
  const user = (await created.json()).user;
  assert.deepEqual(Object.keys(user).includes('phone'), false);
  await seedSession(db, user.id, 'session-b');
  const disabled = await patchUser({ request: request(`/api/admin/users/${user.id}`, { method: 'PATCH', cookie: 'session-a', admin: true,
    body: { enabled: false } }), env, params: { id: user.id } });
  assert.equal(disabled.status, 200);
  assert.equal((await me({ request: request('/api/auth/me', { cookie: 'session-b' }), env })).status, 200);
  assert.equal((await (await me({ request: request('/api/auth/me', { cookie: 'session-b' }), env })).json()).authenticated, false);

  const loggedOut = await logout({ request: request('/api/auth/logout', { method: 'POST', cookie: 'session-a' }), env });
  assert.match(loggedOut.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal((await (await me({ request: request('/api/auth/me', { cookie: 'session-a' }), env })).json()).authenticated, false);
  const serialized = JSON.stringify({ users: [...db.users.values()], sessions: [...db.sessions.values()] });
  assert.equal(serialized.includes(PHONE), false);
  assert.equal(serialized.includes('session-a'), false);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /localStorage\.setItem\([^\n]*(?:phone|session)/i);
});

test('accounts and searches enforce ownership, shapes, active work and daily limits', async () => {
  const db = new FakeDB();
  await seedUser(db, PHONE, 'user-a');
  await seedUser(db, '13900139000', 'user-b');
  await seedSession(db, 'user-a', 'session-a');
  await seedSession(db, 'user-b', 'session-b');
  const env = bindings(db);
  const ids = ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccc'];
  for (const id of ids) assert.equal((await addAccount({ request: request('/api/network/accounts', {
    method: 'POST', cookie: 'session-a', body: { account_id: id }
  }), env })).status, 201);
  assert.equal((await addAccount({ request: request('/api/network/accounts', {
    method: 'POST', cookie: 'session-a', body: { account_id: 'dddddddddddddddddddddddd' }
  }), env })).status, 409);
  assert.equal((await addAccount({ request: request('/api/network/accounts', {
    method: 'POST', cookie: 'session-b', body: { account_id: 'https://example.com/user' }
  }), env })).status, 400);
  const own = (await (await listAccounts({ request: request('/api/network/accounts', { cookie: 'session-a' }), env })).json()).accounts;
  assert.equal(own.length, 3);
  assert.equal((await deleteAccount({ request: request(`/api/network/accounts/${own[0].id}`, {
    method: 'DELETE', cookie: 'session-b' }), env, params: { id: own[0].id } })).status, 404);

  for (const body of [
    { keywords: [], days: 7 }, { keywords: ['a', 'b', 'c'], days: 7 }, { keywords: ['a'], days: 2 }
  ]) assert.equal((await addSearch({ request: request('/api/network/searches', {
    method: 'POST', cookie: 'session-a', body
  }), env })).status, 400);
  const created = await addSearch({ request: request('/api/network/searches', {
    method: 'POST', cookie: 'session-a', body: { keywords: [' 课程 ', '阅读'], days: 7 }
  }), env });
  assert.equal(created.status, 201);
  const job = (await created.json()).search;
  assert.deepEqual(job.keywords, ['课程', '阅读']);
  assert.equal((await addSearch({ request: request('/api/network/searches', {
    method: 'POST', cookie: 'session-a', body: { keywords: ['数学'], days: 1 }
  }), env })).status, 429);
  assert.equal((await getSearch({ request: request(`/api/network/searches/${job.id}`, { cookie: 'session-b' }),
    env, params: { id: job.id } })).status, 404);
  assert.equal((await deleteSearch({ request: request(`/api/network/searches/${job.id}`, {
    method: 'DELETE', cookie: 'session-b'
  }), env, params: { id: job.id } })).status, 404);
  assert.equal((await deleteSearch({ request: request(`/api/network/searches/${job.id}`, { method: 'DELETE', cookie: 'session-a' }),
    env, params: { id: job.id } })).status, 409);

  db.jobs.get(job.id).status = 'completed';
  for (let index = 0; index < 2; index += 1) db.jobs.set(`ended-${index}`, { ...db.jobs.get(job.id), id: `ended-${index}`,
    status: 'completed', created_at: new Date(Date.now() - index * 1000).toISOString() });
  const limited = await addSearch({ request: request('/api/network/searches', {
    method: 'POST', cookie: 'session-a', body: { keywords: ['数学'], days: 1 }
  }), env });
  assert.equal(limited.status, 429);

  const globalDb = new FakeDB();
  await seedUser(globalDb);
  await seedSession(globalDb, 'user-a', 'session-a');
  globalDb.accounts.set('global-account', { id: 'global-account', user_id: 'user-a',
    account_id: ids[0], created_at: new Date().toISOString() });
  for (let index = 0; index < 20; index += 1) globalDb.jobs.set(`global-${index}`, {
    ...db.jobs.get(job.id), id: `global-${index}`, user_id: `other-${index}`, status: 'completed',
    created_at: new Date().toISOString()
  });
  assert.equal((await addSearch({ request: request('/api/network/searches', {
    method: 'POST', cookie: 'session-a', body: { keywords: ['数学'], days: 1 }
  }), env: bindings(globalDb) })).status, 429);
});

test('worker key isolation, atomic leases, clean result validation, idempotence and retention hold', async () => {
  const db = new FakeDB();
  await seedUser(db);
  const created = new Date();
  const job = {
    id: 'job-a', user_id: 'user-a', keywords_json: '["课程"]',
    accounts_json: '["aaaaaaaaaaaaaaaaaaaaaaaa","bbbbbbbbbbbbbbbbbbbbbbbb"]', days: 7,
    window_start_at: new Date(created.getTime() - 7 * 86400000).toISOString(), created_at: created.toISOString(),
    status: 'queued', claimed_at: null, lease_expires_at: null, claim_token_hash: null, attempt_count: 0,
    completed_at: null, error_detail: null, failures_json: null, result_payload_hash: null, result_payload_json: null
  };
  db.jobs.set(job.id, job);
  const env = bindings(db);
  for (const key of [ADMIN_KEY, INGEST_KEY, 'wrong']) {
    assert.equal((await claimJob({ request: request('/api/network/worker/claim', { method: 'POST', worker: key, body: {} }), env })).status, 401);
  }
  const first = await claimJob({ request: request('/api/network/worker/claim', { method: 'POST', worker: WORKER_KEY, body: {} }), env });
  const firstJob = (await first.json()).job;
  assert.ok(firstJob.claim_token);
  assert.equal((await (await claimJob({ request: request('/api/network/worker/claim', {
    method: 'POST', worker: WORKER_KEY, body: {}
  }), env })).json()).job, null);
  db.jobs.get(job.id).lease_expires_at = '2000-01-01T00:00:00.000Z';
  const secondJob = (await (await claimJob({ request: request('/api/network/worker/claim', {
    method: 'POST', worker: WORKER_KEY, body: {}
  }), env })).json()).job;
  assert.notEqual(firstJob.claim_token, secondJob.claim_token);

  const result = {
    account_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', account_name: '公开账号',
    published_at: new Date(created.getTime() - 3600000).toISOString(), title: '课程公开笔记',
    url: 'https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa', summary: '摘'.repeat(100)
  };
  const payload = { claim_token: secondJob.claim_token, status: 'partial', results: [result],
    failures: [{ account_id: 'bbbbbbbbbbbbbbbbbbbbbbbb', reason: '主页暂时不可用' }],
    error_detail: '部分账号读取失败，已保留其他账号结果。' };
  assert.equal((await finishJob({ request: request(`/api/network/worker/jobs/${job.id}`, {
    method: 'POST', worker: WORKER_KEY, body: { ...payload, claim_token: firstJob.claim_token }
  }), env, params: { id: job.id } })).status, 409);
  assert.equal((await finishJob({ request: request(`/api/network/worker/jobs/${job.id}`, {
    method: 'POST', worker: WORKER_KEY, body: { ...payload, results: [{ ...result, url: `${result.url}?xsec_token=secret` }] }
  }), env, params: { id: job.id } })).status, 400);
  const tooMany = Array.from({ length: 31 }, (_, index) => ({ ...result,
    url: `https://www.xiaohongshu.com/explore/${index.toString(16).padStart(24, '0')}` }));
  assert.equal((await finishJob({ request: request(`/api/network/worker/jobs/${job.id}`, {
    method: 'POST', worker: WORKER_KEY, body: {
      claim_token: secondJob.claim_token, status: 'completed', results: tooMany, failures: [], error_detail: null
    }
  }), env, params: { id: job.id } })).status, 400);
  const finished = await finishJob({ request: request(`/api/network/worker/jobs/${job.id}`, {
    method: 'POST', worker: WORKER_KEY, body: payload
  }), env, params: { id: job.id } });
  assert.equal(finished.status, 200);
  assert.equal(db.results.size, 1);
  assert.equal((await (await finishJob({ request: request(`/api/network/worker/jobs/${job.id}`, {
    method: 'POST', worker: WORKER_KEY, body: payload
  }), env, params: { id: job.id } })).json()).idempotent, true);
  assert.equal(db.results.size, 1);
  assert.equal((await finishJob({ request: request(`/api/network/worker/jobs/${job.id}`, {
    method: 'POST', worker: WORKER_KEY, body: { ...payload, status: 'completed', failures: [], error_detail: null }
  }), env, params: { id: job.id } })).status, 409);

  for (let index = 0; index < 11; index += 1) db.jobs.set(`old-${index}`, { ...job, id: `old-${index}`,
    status: 'completed', created_at: new Date(created.getTime() - (index + 1) * 1000).toISOString() });
  db.jobs.set('still-queued', { ...job, id: 'still-queued', status: 'queued' });
  db.jobs.set('still-running', { ...job, id: 'still-running', status: 'running' });
  await db.run(`DELETE FROM network_search_jobs WHERE user_id = ?1 AND status IN ('completed')`, ['user-a']);
  assert.equal([...db.jobs.values()].filter(item => item.user_id === 'user-a'
    && ['completed', 'partial', 'blocked', 'failed'].includes(item.status)).length, 10);
  assert.equal(db.jobs.has('still-queued'), true);
  assert.equal(db.jobs.has('still-running'), true);
});
