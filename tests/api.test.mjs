import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet, onRequestPost } from '../functions/api/documents/index.js';
import { onRequestDelete, onRequestPatch } from '../functions/api/documents/[id].js';
import { onRequestGet as onRequestFile } from '../functions/api/documents/[id]/file.js';

const ADMIN_KEY = '0123456789abcdef0123456789abcdef';
const PDF_MIME = 'application/pdf';

class FakeDB {
  constructor() {
    this.rows = new Map();
    this.failInsert = false;
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
        const results = [...database.rows.values()]
          .filter(row => !row.deleted_at)
          .sort((left, right) => right.uploaded_at.localeCompare(left.uploaded_at))
          .map(({ object_key, deleted_at, ...row }) => row);
        return { results };
      },
      async first() {
        const row = database.rows.get(this.values[0]);
        if (!row || row.deleted_at) return null;
        return {
          original_name: row.original_name,
          object_key: row.object_key,
          mime_type: row.mime_type,
          size_bytes: row.size_bytes
        };
      },
      async run() {
        if (/INSERT INTO documents/.test(sql)) {
          if (database.failInsert) throw new Error('simulated D1 failure');
          const [id, title, category, scope, uploadedBy, uploadedAt, originalName, objectKey, mimeType, sizeBytes] = this.values;
          database.rows.set(id, {
            id, title, category, scope, status: '待确认', uploaded_by: uploadedBy,
            uploaded_at: uploadedAt, original_name: originalName, object_key: objectKey,
            mime_type: mimeType, size_bytes: sizeBytes, deleted_at: null
          });
          return { meta: { changes: 1 } };
        }

        const [value, id] = this.values;
        const row = database.rows.get(id);
        if (!row || row.deleted_at) return { meta: { changes: 0 } };
        if (/SET status/.test(sql)) row.status = value;
        if (/SET deleted_at/.test(sql)) row.deleted_at = value;
        return { meta: { changes: 1 } };
      }
    };
  }
}

class FakeBucket {
  constructor() {
    this.objects = new Map();
  }

  async put(key, stream) {
    this.objects.set(key, new Uint8Array(await new Response(stream).arrayBuffer()));
    return { key };
  }

  async get(key) {
    const bytes = this.objects.get(key);
    return bytes ? { body: bytes } : null;
  }

  async delete(key) {
    this.objects.delete(key);
  }
}

function env() {
  return { ADMIN_KEY, DB: new FakeDB(), BUCKET: new FakeBucket() };
}

function request(path, options = {}, authorized = true) {
  const headers = new Headers(options.headers || {});
  if (authorized) headers.set('Authorization', `Bearer ${ADMIN_KEY}`);
  return new Request(`https://archive.test${path}`, { ...options, headers });
}

function pdf(name = '资料.pdf', extra = []) {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...extra])], name, { type: PDF_MIME });
}

function uploadRequest(file, fields = {}) {
  const form = new FormData();
  form.set('title', fields.title || '<img src=x onerror=alert(1)>');
  form.set('category', fields.category || '试卷资料');
  form.set('scope', fields.scope || '八年级 / 物理');
  form.set('uploaded_by', fields.uploadedBy || '人员1（我）');
  form.set('file', file);
  return request('/api/documents', { method: 'POST', body: form });
}

test('all five document capabilities reject a missing key', async () => {
  const bindings = env();
  const calls = [
    onRequestGet({ request: request('/api/documents', {}, false), env: bindings }),
    onRequestPost({ request: request('/api/documents', { method: 'POST' }, false), env: bindings }),
    onRequestFile({ request: request('/api/documents/id/file', {}, false), env: bindings, params: { id: 'id' } }),
    onRequestPatch({ request: request('/api/documents/id', { method: 'PATCH' }, false), env: bindings, params: { id: 'id' } }),
    onRequestDelete({ request: request('/api/documents/id', { method: 'DELETE' }, false), env: bindings, params: { id: 'id' } })
  ];
  const responses = await Promise.all(calls);
  assert.deepEqual(responses.map(response => response.status), [401, 401, 401, 401, 401]);
});

test('a short configured key is rejected as a service misconfiguration', async () => {
  const bindings = env();
  bindings.ADMIN_KEY = 'too-short';
  const response = await onRequestGet({
    request: request('/api/documents', {}, false),
    env: bindings
  });
  assert.equal(response.status, 503);
});

test('upload, list, status, download and soft delete form a persistent lifecycle', async () => {
  const bindings = env();
  const createdResponse = await onRequestPost({ request: uploadRequest(pdf()), env: bindings });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).document;
  assert.equal(created.status, '待确认');
  assert.equal(created.uploaded_by, '人员1（我）');
  assert.equal(bindings.DB.rows.get(created.id).object_key.includes('资料.pdf'), false);
  assert.equal(bindings.BUCKET.objects.size, 1);

  const listResponse = await onRequestGet({ request: request('/api/documents'), env: bindings });
  const listed = (await listResponse.json()).documents;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, '<img src=x onerror=alert(1)>');
  assert.equal('object_key' in listed[0], false);

  const patchResponse = await onRequestPatch({
    request: request(`/api/documents/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: '已确认' })
    }),
    env: bindings,
    params: { id: created.id }
  });
  assert.equal(patchResponse.status, 200);
  assert.equal(bindings.DB.rows.get(created.id).status, '已确认');

  const fileResponse = await onRequestFile({
    request: request(`/api/documents/${created.id}/file`),
    env: bindings,
    params: { id: created.id }
  });
  assert.equal(fileResponse.status, 200);
  assert.match(fileResponse.headers.get('Content-Disposition'), /^attachment;/);
  assert.equal(fileResponse.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(new Uint8Array(await fileResponse.arrayBuffer()), new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));

  const deleteResponse = await onRequestDelete({
    request: request(`/api/documents/${created.id}`, { method: 'DELETE' }),
    env: bindings,
    params: { id: created.id }
  });
  assert.equal(deleteResponse.status, 200);
  assert.ok(bindings.DB.rows.get(created.id).deleted_at);
  assert.equal(bindings.BUCKET.objects.size, 1);
  const empty = await onRequestGet({ request: request('/api/documents'), env: bindings });
  assert.equal((await empty.json()).documents.length, 0);
});

test('server rejects extension, MIME, signature, uploader and size violations', async () => {
  const cases = [
    [new File(['text'], 'bad.txt', { type: 'text/plain' }), {}, 400],
    [new File(['%PDF-'], 'bad.pdf', { type: 'text/plain' }), {}, 400],
    [new File(['not-pdf'], 'bad.pdf', { type: PDF_MIME }), {}, 400],
    [pdf(), { uploadedBy: '其他人员' }, 400],
    [new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'large.pdf', { type: PDF_MIME }), {}, 413]
  ];

  for (const [file, fields, expectedStatus] of cases) {
    const response = await onRequestPost({ request: uploadRequest(file, fields), env: env() });
    assert.equal(response.status, expectedStatus);
    assert.ok((await response.json()).error);
  }
});

test('a failed D1 insert removes the just-written R2 object', async () => {
  const bindings = env();
  bindings.DB.failInsert = true;
  const originalConsoleError = console.error;
  console.error = () => {};
  let response;
  try {
    response = await onRequestPost({ request: uploadRequest(pdf()), env: bindings });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(response.status, 500);
  assert.equal(bindings.BUCKET.objects.size, 0);
});
