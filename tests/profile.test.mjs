import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateProfile } from '../functions/_shared.js';
import { onRequestGet, onRequestPost } from '../functions/api/profile/index.js';
import { onRequestDelete, onRequestPatch } from '../functions/api/profile/[id].js';

const ADMIN_KEY = '0123456789abcdef0123456789abcdef';

class ProfileDB {
  constructor() {
    this.documents = new Map();
    this.values = new Map();
  }

  addDocument(id, status = '待确认') {
    this.documents.set(id, {
      id,
      title: `资料 ${id}`,
      original_name: `${id}.pdf`,
      status,
      deleted_at: null
    });
  }

  prepare(sql) {
    const database = this;
    return {
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      async all() {
        const results = [...database.values.values()]
          .filter(value => !value.deleted_at)
          .flatMap(value => {
            const document = database.documents.get(value.document_id);
            if (!document || document.deleted_at) return [];
            return [{
              ...value,
              document_title: document.title,
              document_original_name: document.original_name,
              document_status: document.status
            }];
          })
          .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
        return { results };
      },
      async first() {
        if (/FROM documents/.test(sql)) {
          const document = database.documents.get(this.values[0]);
          return document && !document.deleted_at ? { ...document } : null;
        }
        if (/SELECT id\s+FROM profile_values/.test(sql)) {
          const [fieldKey, value, documentId, locator, observedOn] = this.values;
          return [...database.values.values()].find(candidate =>
            !candidate.deleted_at && candidate.field_key === fieldKey &&
            candidate.value === value && candidate.document_id === documentId &&
            candidate.source_locator === locator && candidate.observed_on === observedOn
          ) || null;
        }
        if (/SELECT value\.id, document\.status/.test(sql)) {
          const value = database.values.get(this.values[0]);
          const document = value && database.documents.get(value.document_id);
          return value && !value.deleted_at && document && !document.deleted_at
            ? { id: value.id, document_status: document.status }
            : null;
        }
        return null;
      },
      async run() {
        if (/INSERT INTO profile_values/.test(sql)) {
          const [id, fieldKey, value, documentId, locator, observedOn, expiresOn, now] = this.values;
          database.values.set(id, {
            id,
            field_key: fieldKey,
            value,
            status: '待确认',
            document_id: documentId,
            source_locator: locator,
            observed_on: observedOn,
            expires_on: expiresOn,
            created_at: now,
            updated_at: now,
            deleted_at: null
          });
          return { meta: { changes: 1 } };
        }
        if (/SET status/.test(sql)) {
          const [status, updatedAt, id] = this.values;
          const value = database.values.get(id);
          if (!value || value.deleted_at) return { meta: { changes: 0 } };
          value.status = status;
          value.updated_at = updatedAt;
          return { meta: { changes: 1 } };
        }
        if (/SET deleted_at/.test(sql)) {
          const [deletedAt, id] = this.values;
          const value = database.values.get(id);
          if (!value || value.deleted_at) return { meta: { changes: 0 } };
          value.deleted_at = deletedAt;
          value.updated_at = deletedAt;
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      }
    };
  }
}

function env() {
  return { ADMIN_KEY, DB: new ProfileDB(), BUCKET: {} };
}

function request(path, options = {}, authorized = true) {
  const headers = new Headers(options.headers || {});
  if (authorized) headers.set('Authorization', `Bearer ${ADMIN_KEY}`);
  return new Request(`https://archive.test${path}`, { ...options, headers });
}

function jsonRequest(path, method, body, authorized = true) {
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, authorized);
}

async function createCandidate(bindings, documentId, value = '完成第三章') {
  const response = await onRequestPost({
    request: jsonRequest('/api/profile', 'POST', {
      field_key: 'teaching.progress',
      value,
      document_id: documentId,
      source_locator: '第 3 页',
      observed_on: new Date().toISOString().slice(0, 10)
    }),
    env: bindings
  });
  return { response, candidate: response.status === 201 ? (await response.clone().json()).candidate : null };
}

async function getProfile(bindings) {
  const response = await onRequestGet({ request: request('/api/profile'), env: bindings });
  assert.equal(response.status, 200);
  return (await response.json()).profile;
}

test('profile endpoints reject a missing key', async () => {
  const bindings = env();
  const responses = await Promise.all([
    onRequestGet({ request: request('/api/profile', {}, false), env: bindings }),
    onRequestPost({ request: jsonRequest('/api/profile', 'POST', {}, false), env: bindings }),
    onRequestPatch({ request: jsonRequest('/api/profile/id', 'PATCH', { status: '已确认' }, false), env: bindings, params: { id: 'id' } }),
    onRequestDelete({ request: request('/api/profile/id', { method: 'DELETE' }, false), env: bindings, params: { id: 'id' } })
  ]);
  assert.deepEqual(responses.map(response => response.status), [401, 401, 401, 401]);
});

test('zero evidence is zero percent and lists every field as missing', async () => {
  const profile = await getProfile(env());
  assert.equal(profile.percentage, 0);
  assert.equal(profile.totalWeight, 100);
  assert.equal(profile.fields.length, 36);
  assert.equal(profile.statusCounts['缺失'], 36);
});

test('candidate confirmation, conflict, expiration and deletion recalculate fixed field weight', async () => {
  const bindings = env();
  bindings.DB.addDocument('doc-1');
  const first = await createCandidate(bindings, 'doc-1');
  assert.equal(first.response.status, 201);
  assert.equal((await getProfile(bindings)).percentage, 1.5);

  const blocked = await onRequestPatch({
    request: jsonRequest(`/api/profile/${first.candidate.id}`, 'PATCH', { status: '已确认' }),
    env: bindings,
    params: { id: first.candidate.id }
  });
  assert.equal(blocked.status, 409);

  bindings.DB.documents.get('doc-1').status = '已确认';
  const confirmed = await onRequestPatch({
    request: jsonRequest(`/api/profile/${first.candidate.id}`, 'PATCH', { status: '已确认' }),
    env: bindings,
    params: { id: first.candidate.id }
  });
  assert.equal(confirmed.status, 200);
  assert.equal((await getProfile(bindings)).percentage, 6);

  const duplicate = await createCandidate(bindings, 'doc-1');
  assert.equal(duplicate.response.status, 409);

  const second = await createCandidate(bindings, 'doc-1', '完成第四章');
  await onRequestPatch({
    request: jsonRequest(`/api/profile/${second.candidate.id}`, 'PATCH', { status: '已确认' }),
    env: bindings,
    params: { id: second.candidate.id }
  });
  let profile = await getProfile(bindings);
  assert.equal(profile.percentage, 0);
  assert.equal(profile.fields.find(field => field.key === 'teaching.progress').status, '有冲突');

  await onRequestPatch({
    request: jsonRequest(`/api/profile/${second.candidate.id}`, 'PATCH', { status: '已过期' }),
    env: bindings,
    params: { id: second.candidate.id }
  });
  assert.equal((await getProfile(bindings)).percentage, 6);

  await onRequestDelete({
    request: request(`/api/profile/${first.candidate.id}`, { method: 'DELETE' }),
    env: bindings,
    params: { id: first.candidate.id }
  });
  profile = await getProfile(bindings);
  assert.equal(profile.percentage, 0);
  assert.equal(profile.fields.find(field => field.key === 'teaching.progress').status, '已过期');
});

test('duplicate evidence never exceeds a field weight and source changes roll progress back', async () => {
  const bindings = env();
  bindings.DB.addDocument('doc-1', '已确认');
  bindings.DB.addDocument('doc-2', '已确认');
  const first = await createCandidate(bindings, 'doc-1');
  const second = await createCandidate(bindings, 'doc-2');
  for (const candidate of [first.candidate, second.candidate]) {
    await onRequestPatch({
      request: jsonRequest(`/api/profile/${candidate.id}`, 'PATCH', { status: '已确认' }),
      env: bindings,
      params: { id: candidate.id }
    });
  }
  assert.equal((await getProfile(bindings)).percentage, 6);

  bindings.DB.documents.get('doc-1').deleted_at = new Date().toISOString();
  assert.equal((await getProfile(bindings)).percentage, 6);
  bindings.DB.documents.get('doc-2').status = '待确认';
  assert.equal((await getProfile(bindings)).percentage, 1.5);
  bindings.DB.documents.get('doc-2').deleted_at = new Date().toISOString();
  assert.equal((await getProfile(bindings)).percentage, 0);
});

test('expired evidence contributes zero in the pure progress calculation', () => {
  const profile = calculateProfile([{
    id: 'old',
    field_key: 'school.schedule',
    value: '7:30 到校',
    status: '已确认',
    document_status: '已确认',
    expires_on: '2026-01-01'
  }], '2026-08-24');
  assert.equal(profile.percentage, 0);
  assert.equal(profile.fields.find(field => field.key === 'school.schedule').status, '已过期');
});
