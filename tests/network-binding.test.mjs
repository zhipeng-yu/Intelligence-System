import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './network-fixture.mjs';
import { onRequestGet as status, onRequestPost as bind } from '../functions/api/network/binding.js';
import { onRequestPost as claim } from '../functions/api/network/worker/claim.js';
import { onRequestPost as report } from '../functions/api/network/worker/binding.js';
import { onRequestPost as add } from '../functions/api/network/accounts/index.js';

async function requestBinding(call, user = 0) {
  const keys = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048,
    publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, false, ['encrypt','decrypt']);
  const public_key = Buffer.from(await crypto.subtle.exportKey('spki', keys.publicKey)).toString('base64');
  const result = await call(bind, { action: 'bind', public_key }, { user });
  assert.equal(result.status, 202);
  return { keys, public_key, result };
}
const take = call => call(claim, { user_sessions: true }, { worker: true });
const update = (call, job, body) => call(report, {
  profile_id: job.profile_id, claim_token: job.claim_token, ...body
}, { worker: true });

test('two users have separate profiles and encrypted, owner-only, expiring QR challenges', async t => {
  const { db, call } = await fixture(t, false, false);
  assert.equal((await call(add, { red_id: 'test' })).status, 409);
  const first = await requestBinding(call);
  await requestBinding(call, 1);
  const job = (await take(call)).data.job;
  assert.equal(job.kind, 'binding'); assert.equal(job.user_id, 'u0');
  assert.equal((await take(call)).data.job, null);
  const png = Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]);
  assert.equal((await update(call, job, { status: 'waiting', png: png.toString('base64') })).status, 200);
  const own = (await call(status, undefined, { method: 'GET' })).data.binding;
  assert.equal((await call(status, undefined, { user: 1, method: 'GET' })).data.binding.challenge, null);
  assert.equal((await call(status, undefined, { user: null, method: 'GET' })).status, 401);
  const keyBytes = await crypto.subtle.decrypt('RSA-OAEP', first.keys.privateKey, Buffer.from(own.challenge.key, 'base64'));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(own.challenge.iv, 'base64') }, key, Buffer.from(own.challenge.data, 'base64'));
  assert.deepEqual(Buffer.from(clear), png);
  assert.ok(!db.sql.prepare('SELECT challenge_json FROM network_bindings WHERE user_id=?').get('u0').challenge_json.includes(png.toString('base64')));
  assert.equal((await update(call, job, { status: 'ready' })).status, 200);
  assert.equal((await call(status, undefined, { method: 'GET' })).data.binding.challenge, null);
  const next = (await take(call)).data.job;
  assert.equal(next.user_id, 'u1'); assert.notEqual(next.profile_id, job.profile_id);
  assert.equal((await update(call, next, { status: 'waiting', png: png.toString('base64') })).status, 200);
  db.sql.prepare("UPDATE network_bindings SET expires_at='2000-01-01' WHERE user_id='u1'").run();
  assert.equal((await call(status, undefined, { user: 1, method: 'GET' })).data.binding.status, 'expired');
  assert.equal(db.sql.prepare("SELECT challenge_json FROM network_bindings WHERE user_id='u1'").get().challenge_json, null);
});

test('refresh invalidates old callbacks, unbind retains history, disabled users are never claimed', async t => {
  const { db, call } = await fixture(t, true, false);
  const first = await requestBinding(call);
  const job = (await take(call)).data.job;
  db.sql.prepare("UPDATE network_bindings SET created_at='2000-01-01' WHERE user_id='u0'").run();
  const refreshed = await call(bind, { action: 'bind', public_key: first.public_key });
  assert.equal(refreshed.status, 202);
  assert.equal((await update(call, job, { heartbeat: true })).data.current, false);
  assert.equal((await take(call)).data.job, null);
  assert.equal((await update(call, job, { status: 'ready' })).data.current, false);
  const next = (await take(call)).data.job;
  assert.equal(next.profile_id, job.profile_id); assert.notEqual(next.request_id, job.request_id);
  await update(call, next, { status: 'ready' });
  db.sql.prepare("UPDATE network_bindings SET created_at='2000-01-01' WHERE user_id='u0'").run();
  assert.equal((await call(bind, { action: 'unbind' })).status, 202);
  const removing = (await take(call)).data.job;
  await update(call, removing, { status: 'unbound' });
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM network_search_results').get().n, 1);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM watched_accounts').get().n, 1);
  await requestBinding(call, 1);
  db.sql.prepare("UPDATE users SET enabled=0 WHERE id='u1'").run();
  assert.equal((await take(call)).data.job, null);
  assert.equal((await call(status, undefined, { user: 1, method: 'GET' })).status, 401);
  assert.deepEqual(db.sql.prepare('PRAGMA foreign_key_check').all(), []);
});

test('binding security blocks all work; legacy workers cannot claim any task', async t => {
  const { db, call } = await fixture(t, false, false);
  await requestBinding(call);
  await requestBinding(call, 1);
  assert.equal((await call(claim, {}, { worker: true })).status, 409);
  const job = (await take(call)).data.job;
  await update(call, job, { status: 'blocked' });
  assert.equal((await take(call)).data.halted, true);
  assert.equal(db.sql.prepare("SELECT status FROM network_bindings WHERE user_id='u1'").get().status, 'queued');
  assert.equal((await call(claim, { user_sessions: true, resume: true, profile_id: job.profile_id }, { worker: true })).status, 200);
  assert.equal((await take(call)).data.job.user_id, 'u1');
});

test('queued account work waits for rebinding and never uses a disabled user profile', async t => {
  const { db, call } = await fixture(t);
  await call(add, { red_id: 'first' });
  await call(add, { red_id: 'second' }, { user: 1 });
  const original = db.sql.prepare("SELECT profile_id FROM network_bindings WHERE user_id='u0'").get().profile_id;
  await requestBinding(call);
  const binding = (await take(call)).data.job;
  assert.equal(binding.kind, 'binding');
  assert.equal((await take(call)).data.job, null);
  await update(call, binding, { status: 'ready' });
  db.sql.prepare("UPDATE users SET enabled=0 WHERE id='u1'").run();
  const account = (await take(call)).data.job;
  assert.equal(account.kind, 'account_resolution');
  assert.equal(account.user_id, 'u0'); assert.equal(account.profile_id, original);
  db.sql.prepare("UPDATE watched_accounts SET status='failed',error_code='lease_expired',lease_expires_at=NULL WHERE id=?").run(account.id);
  assert.equal((await take(call)).data.job, null);
  assert.equal(db.sql.prepare("SELECT status FROM watched_accounts WHERE user_id='u1'").get().status, 'queued');
});
