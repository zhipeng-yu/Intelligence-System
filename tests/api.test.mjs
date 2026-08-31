import assert from 'node:assert/strict';
import test from 'node:test';

import { MACHINE_XHS_SCOPE } from '../functions/_shared.js';
import { onRequestGet, onRequestPost } from '../functions/api/documents/index.js';
import { onRequestDelete } from '../functions/api/documents/[id].js';
import { onRequestGet as onRequestFile } from '../functions/api/documents/[id]/file.js';

const ADMIN_KEY = '0123456789abcdef0123456789abcdef';
const INGEST_KEY = 'fedcba9876543210fedcba9876543210';
const PDF_MIME = 'application/pdf';

class FakeDB {
  constructor() {
    this.rows = new Map();
    this.history = [];
    this.sections = [];
    this.failInsert = false;
  }

  prepare(sql) {
    const database = this;
    return {
      sql,
      values: [],
      bind(...values) { this.values = values; return this; },
      async all() {
        const results = [...database.rows.values()]
          .filter(row => !row.deleted_at)
          .sort((left, right) => right.uploaded_at.localeCompare(left.uploaded_at))
          .map(({ object_key, network_hash, auto_analyzed, deleted_at, ...row }) => row);
        return { results };
      },
      async first() {
        if (/COUNT\(\*\)/.test(sql)) {
          const [hash, since] = this.values;
          return { count: [...database.rows.values()].filter(row => row.network_hash === hash && row.uploaded_at >= since).length };
        }
        const row = database.rows.get(this.values[0]);
        if (!row || row.deleted_at) return null;
        if (/AS has_changes/.test(sql)) {
          return {
            id: row.id,
            object_key: row.object_key,
            undone_at: row.undone_at,
            has_changes: database.history.some(history => history.change_document_id === row.id) ? 1 : 0,
            is_current_source: database.sections.some(section => section.source_document_id === row.id) ? 1 : 0
          };
        }
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
          const [id, title, note, scope, networkHash, uploadedAt, originalName, objectKey, mimeType, sizeBytes] = this.values;
          database.rows.set(id, {
            id, title, note, category: null, scope, ai_status: 'not_started', ai_error: null,
            analyzed_at: null, auto_analyzed: 0, network_hash: networkHash, uploaded_at: uploadedAt,
            original_name: originalName, object_key: objectKey, mime_type: mimeType,
            size_bytes: sizeBytes, deleted_at: null, undone_at: null
          });
          return { meta: { changes: 1 } };
        }
        if (/UPDATE profile_history/.test(sql) && /source_document_id = NULL/.test(sql)) {
          for (const history of database.history) {
            if (history.source_document_id === this.values[0]) history.source_document_id = null;
          }
          return { meta: { changes: 1 } };
        }
        if (/UPDATE profile_history/.test(sql) && /change_document_id = NULL/.test(sql)) {
          for (const history of database.history) {
            if (history.change_document_id === this.values[0]) history.change_document_id = null;
          }
          return { meta: { changes: 1 } };
        }
        if (/DELETE FROM documents/.test(sql)) {
          return { meta: { changes: database.rows.delete(this.values[0]) ? 1 : 0 } };
        }
        return { meta: { changes: 0 } };
      }
    };
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

class FakeBucket {
  constructor() { this.objects = new Map(); }
  async put(key, stream) {
    this.objects.set(key, new Uint8Array(await new Response(stream).arrayBuffer()));
    return { key };
  }
  async get(key) {
    const bytes = this.objects.get(key);
    return bytes ? { body: bytes } : null;
  }
  async delete(key) { this.objects.delete(key); }
}

function env() {
  return {
    ADMIN_KEY,
    INGEST_KEY,
    TURNSTILE_SECRET: 'test-secret',
    TURNSTILE_FETCH: async () => Response.json({ success: true }),
    DB: new FakeDB(),
    BUCKET: new FakeBucket()
  };
}

function request(path, options = {}, authorized = false) {
  const headers = new Headers(options.headers || {});
  if (authorized) headers.set('Authorization', `Bearer ${ADMIN_KEY}`);
  return new Request(`https://archive.test${path}`, { ...options, headers });
}

function pdf(name = '资料.pdf', extra = []) {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...extra])], name, { type: PDF_MIME });
}

function uploadRequest(file, fields = {}, authorized = false) {
  const form = new FormData();
  form.set('file', file);
  if (fields.note !== undefined) form.set('note', fields.note);
  if (!fields.omitToken) form.set('cf-turnstile-response', fields.token || 'valid-test-token');
  const headers = { 'CF-Connecting-IP': fields.address || '203.0.113.10' };
  if (fields.ingestKey !== undefined) headers['X-Ingest-Key'] = fields.ingestKey;
  return request('/api/documents', {
    method: 'POST',
    headers,
    body: form
  }, authorized);
}

test('teachers can list documents but download and delete require the admin key', async () => {
  const bindings = env();
  const list = await onRequestGet({ request: request('/api/documents'), env: bindings });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).is_admin, false);

  const responses = await Promise.all([
    onRequestFile({ request: request('/api/documents/id/file'), env: bindings, params: { id: 'id' } }),
    onRequestDelete({ request: request('/api/documents/id', { method: 'DELETE' }), env: bindings, params: { id: 'id' } })
  ]);
  assert.deepEqual(responses.map(response => response.status), [401, 401]);

  const ingestHeaders = { 'X-Ingest-Key': INGEST_KEY };
  const ingestResponses = await Promise.all([
    onRequestFile({
      request: request('/api/documents/id/file', { headers: ingestHeaders }),
      env: bindings,
      params: { id: 'id' }
    }),
    onRequestDelete({
      request: request('/api/documents/id', { method: 'DELETE', headers: ingestHeaders }),
      env: bindings,
      params: { id: 'id' }
    })
  ]);
  assert.deepEqual(ingestResponses.map(response => response.status), [401, 401]);
});

test('public upload, list, private download and permanent delete form a persistent lifecycle', async () => {
  const bindings = env();
  const createdResponse = await onRequestPost({
    request: uploadRequest(pdf(), { note: '八年级物理' }),
    env: bindings
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).document;
  assert.equal(created.title, '资料.pdf');
  assert.equal(created.note, '八年级物理');
  assert.equal(created.ai_status, 'not_started');
  assert.equal(bindings.DB.rows.get(created.id).object_key.includes('资料.pdf'), false);
  assert.equal(bindings.BUCKET.objects.size, 1);

  const listResponse = await onRequestGet({ request: request('/api/documents'), env: bindings });
  const listed = (await listResponse.json()).documents;
  assert.equal(listed.length, 1);
  assert.equal('object_key' in listed[0], false);
  assert.equal('network_hash' in listed[0], false);

  const fileResponse = await onRequestFile({
    request: request(`/api/documents/${created.id}/file`, {}, true),
    env: bindings,
    params: { id: created.id }
  });
  assert.equal(fileResponse.status, 200);
  assert.match(fileResponse.headers.get('Content-Disposition'), /^attachment;/);
  assert.equal(fileResponse.headers.get('X-Content-Type-Options'), 'nosniff');

  const deleteResponse = await onRequestDelete({
    request: request(`/api/documents/${created.id}`, { method: 'DELETE' }, true),
    env: bindings,
    params: { id: created.id }
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal(bindings.DB.rows.has(created.id), false);
  assert.equal(bindings.BUCKET.objects.size, 0);
});

test('an effective profile document must be undone before permanent delete', async () => {
  const bindings = env();
  const createdResponse = await onRequestPost({ request: uploadRequest(pdf()), env: bindings });
  const created = (await createdResponse.json()).document;
  bindings.DB.history.push({
    content: '保留的匿名画像版本',
    change_document_id: created.id,
    source_document_id: created.id
  });

  const blocked = await onRequestDelete({
    request: request(`/api/documents/${created.id}`, { method: 'DELETE' }, true),
    env: bindings,
    params: { id: created.id }
  });
  assert.equal(blocked.status, 409);
  assert.equal(bindings.DB.rows.has(created.id), true);
  assert.equal(bindings.BUCKET.objects.size, 1);

  bindings.DB.rows.get(created.id).undone_at = new Date().toISOString();
  const deleted = await onRequestDelete({
    request: request(`/api/documents/${created.id}`, { method: 'DELETE' }, true),
    env: bindings,
    params: { id: created.id }
  });
  assert.equal(deleted.status, 200);
  assert.equal(bindings.DB.rows.has(created.id), false);
  assert.equal(bindings.DB.history[0].content, '保留的匿名画像版本');
  assert.equal(bindings.DB.history[0].change_document_id, null);
  assert.equal(bindings.DB.history[0].source_document_id, null);
});

test('Turnstile and five uploads per network per hour protect public upload', async () => {
  const bindings = env();
  bindings.TURNSTILE_FETCH = async () => Response.json({ success: false });
  const rejected = await onRequestPost({ request: uploadRequest(pdf()), env: bindings });
  assert.equal(rejected.status, 400);
  assert.equal(bindings.BUCKET.objects.size, 0);

  bindings.TURNSTILE_FETCH = async () => Response.json({ success: true });
  for (let index = 0; index < 5; index += 1) {
    const response = await onRequestPost({ request: uploadRequest(pdf(`资料-${index}.pdf`)), env: bindings });
    assert.equal(response.status, 201);
  }
  const limited = await onRequestPost({ request: uploadRequest(pdf('第六份.pdf')), env: bindings });
  assert.equal(limited.status, 429);
});

test('INGEST_KEY only bypasses Turnstile while public upload still requires it', async () => {
  const bindings = env();
  let turnstileCalls = 0;
  bindings.TURNSTILE_FETCH = async () => {
    turnstileCalls += 1;
    return Response.json({ success: false });
  };

  const accepted = await onRequestPost({
    request: uploadRequest(pdf('machine.pdf'), { ingestKey: INGEST_KEY, omitToken: true }),
    env: bindings
  });
  assert.equal(accepted.status, 201);
  const machineDocument = (await accepted.json()).document;
  assert.equal(machineDocument.scope, MACHINE_XHS_SCOPE);
  assert.equal(turnstileCalls, 0);

  const wrongKey = await onRequestPost({
    request: uploadRequest(pdf('wrong.pdf'), { ingestKey: 'wrong-key', omitToken: true }),
    env: bindings
  });
  assert.equal(wrongKey.status, 400);
  assert.equal(turnstileCalls, 0);

  const publicUpload = await onRequestPost({
    request: uploadRequest(pdf('public.pdf')),
    env: bindings
  });
  assert.equal(publicUpload.status, 400);
  assert.equal(turnstileCalls, 1);
});

test('only a correct INGEST_KEY marks a document as Xiaohongshu material', async () => {
  const bindings = env();
  const publicUpload = await onRequestPost({
    request: uploadRequest(pdf('public.pdf')),
    env: bindings
  });
  assert.equal(publicUpload.status, 201);
  assert.equal((await publicUpload.json()).document.scope, null);

  const machineUpload = await onRequestPost({
    request: uploadRequest(pdf('machine.pdf'), { ingestKey: INGEST_KEY, omitToken: true }),
    env: bindings
  });
  assert.equal(machineUpload.status, 201);
  assert.equal((await machineUpload.json()).document.scope, MACHINE_XHS_SCOPE);
});

test('server still rejects extension, MIME, signature, note and size violations', async () => {
  const cases = [
    [new File(['text'], 'bad.txt', { type: 'text/plain' }), {}, 400],
    [new File(['%PDF-'], 'bad.pdf', { type: 'text/plain' }), {}, 400],
    [new File(['not-pdf'], 'bad.pdf', { type: PDF_MIME }), {}, 400],
    [pdf(), { note: 'x'.repeat(501) }, 400],
    [new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'large.pdf', { type: PDF_MIME }), {}, 413]
  ];
  for (const [file, fields, status] of cases) {
    const response = await onRequestPost({ request: uploadRequest(file, fields), env: env() });
    assert.equal(response.status, status);
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
