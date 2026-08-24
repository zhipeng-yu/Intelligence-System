import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_SECTION_CONTENT, PROFILE_SECTIONS } from '../functions/_shared.js';
import { onRequestGet } from '../functions/api/profile/index.js';
import { onRequestPatch } from '../functions/api/profile/[id].js';
import { onRequestPost as onRequestAnalyze, parseProfileUpdates } from '../functions/api/documents/[id]/analyze.js';

const ADMIN_KEY = '0123456789abcdef0123456789abcdef';

class ProfileDB {
  constructor() {
    this.documents = new Map();
    this.sections = new Map(PROFILE_SECTIONS.map(section => [section.key, {
      section_key: section.key,
      content: '',
      source_document_id: null,
      updated_at: null,
      locked: 0
    }]));
    this.history = [];
  }

  addDocument(id, values = {}) {
    this.documents.set(id, {
      id,
      note: null,
      category: null,
      scope: null,
      ai_status: 'not_started',
      ai_error: null,
      analyzed_at: null,
      auto_analyzed: 0,
      original_name: `${id}.pdf`,
      object_key: `documents/${id}`,
      mime_type: 'application/pdf',
      deleted_at: null,
      ...values
    });
  }

  prepare(sql) {
    const database = this;
    return {
      sql,
      values: [],
      bind(...values) { this.values = values; return this; },
      async all() {
        if (/FROM profile_sections AS section/.test(sql)) {
          return { results: [...database.sections.values()].map(section => {
            const document = database.documents.get(section.source_document_id);
            return {
              ...section,
              source_document_id: document?.id || null,
              source_original_name: document?.original_name || null
            };
          }) };
        }
        return { results: [] };
      },
      async first() {
        if (/FROM documents/.test(sql)) {
          const document = database.documents.get(this.values[0]);
          return document && !document.deleted_at ? { ...document } : null;
        }
        if (/FROM profile_sections/.test(sql)) {
          const section = database.sections.get(this.values[0]);
          return section ? { ...section } : null;
        }
        return null;
      },
      async run() {
        if (/SET locked = 0/.test(sql)) {
          const section = database.sections.get(this.values[0]);
          if (!section) return { meta: { changes: 0 } };
          section.locked = 0;
          return { meta: { changes: 1 } };
        }
        if (/auto_analyzed = 1/.test(sql)) {
          const document = database.documents.get(this.values[0]);
          if (!document || document.deleted_at || document.auto_analyzed) return { meta: { changes: 0 } };
          document.ai_status = 'processing';
          document.ai_error = null;
          document.auto_analyzed = 1;
          return { meta: { changes: 1 } };
        }
        if (/WHERE id = \?1 AND ai_status = 'failed'/.test(sql)) {
          const document = database.documents.get(this.values[0]);
          if (!document || document.deleted_at || document.ai_status !== 'failed') return { meta: { changes: 0 } };
          document.ai_status = 'processing';
          document.ai_error = null;
          return { meta: { changes: 1 } };
        }
        if (/SET ai_status = 'failed'/.test(sql)) {
          const [message, analyzedAt, id] = this.values;
          const document = database.documents.get(id);
          if (!document) return { meta: { changes: 0 } };
          document.ai_status = 'failed';
          document.ai_error = message;
          document.analyzed_at = analyzedAt;
          return { meta: { changes: 1 } };
        }
        if (/INSERT INTO profile_history/.test(sql)) {
          const [id, sectionKey, content, sourceDocumentId, changedAt] = this.values;
          database.history.push({
            id, section_key: sectionKey, content, source_document_id: sourceDocumentId,
            changed_at: changedAt, changed_by: /'manual'/.test(sql) ? 'manual' : 'ai'
          });
          return { meta: { changes: 1 } };
        }
        if (/UPDATE profile_sections/.test(sql) && /source_document_id = \?2/.test(sql)) {
          const [content, documentId, updatedAt, key] = this.values;
          const section = database.sections.get(key);
          if (!section || section.locked) return { meta: { changes: 0 } };
          Object.assign(section, { content, source_document_id: documentId, updated_at: updatedAt });
          return { meta: { changes: 1 } };
        }
        if (/UPDATE profile_sections/.test(sql) && /locked = 1/.test(sql)) {
          const [content, updatedAt, key] = this.values;
          const section = database.sections.get(key);
          if (!section) return { meta: { changes: 0 } };
          Object.assign(section, { content, updated_at: updatedAt, locked: 1 });
          return { meta: { changes: 1 } };
        }
        if (/SET category = COALESCE/.test(sql)) {
          const [category, scope, analyzedAt, id] = this.values;
          const document = database.documents.get(id);
          if (!document) return { meta: { changes: 0 } };
          if (category) document.category = category;
          if (scope) document.scope = scope;
          document.ai_status = 'completed';
          document.ai_error = null;
          document.analyzed_at = analyzedAt;
          return { meta: { changes: 1 } };
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
  add(key, bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])) { this.objects.set(key, bytes); }
  async get(key) {
    const bytes = this.objects.get(key);
    return bytes ? { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } : null;
  }
}

function arkResponse(value) {
  return Response.json({
    output: [{ type: 'function_call', name: 'update_school_profile', arguments: JSON.stringify(value) }]
  });
}

function env() {
  const bindings = {
    ADMIN_KEY,
    ARK_API_KEY: 'test-api-key',
    TURNSTILE_SITE_KEY: 'test-site-key',
    DB: new ProfileDB(),
    BUCKET: new FakeBucket(),
    AI: { toMarkdown: async () => ({ format: 'markdown', data: '# 无敏感信息的测试资料' }) },
    ARK_FETCH: async () => arkResponse({ updates: [] })
  };
  return bindings;
}

function request(path, options = {}, authorized = false) {
  const headers = new Headers(options.headers || {});
  if (authorized) headers.set('Authorization', `Bearer ${ADMIN_KEY}`);
  return new Request(`https://archive.test${path}`, { ...options, headers });
}

function jsonRequest(path, body, authorized = false) {
  return request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, authorized);
}

async function profile(bindings, authorized = false) {
  const response = await onRequestGet({ request: request('/api/profile', {}, authorized), env: bindings });
  assert.equal(response.status, 200);
  return response.json();
}

async function analyze(bindings, id, authorized = false) {
  return onRequestAnalyze({
    request: request(`/api/documents/${id}/analyze`, { method: 'POST' }, authorized),
    env: bindings,
    params: { id }
  });
}

test('zero data is public and reports 0/8', async () => {
  const data = await profile(env());
  assert.equal(data.profile.filled, 0);
  assert.equal(data.profile.total, 8);
  assert.equal(data.profile.percentage, 0);
  assert.equal(data.profile.sections.length, 8);
  assert.equal(data.is_admin, false);
});

test('admin editing locks a card and unlock is separately authorized', async () => {
  const bindings = env();
  const denied = await onRequestPatch({
    request: jsonRequest('/api/profile/school_overview', { content: '一所测试学校' }),
    env: bindings,
    params: { id: 'school_overview' }
  });
  assert.equal(denied.status, 401);

  const edited = await onRequestPatch({
    request: jsonRequest('/api/profile/school_overview', { content: '一所测试学校' }, true),
    env: bindings,
    params: { id: 'school_overview' }
  });
  assert.equal(edited.status, 200);
  assert.equal(bindings.DB.sections.get('school_overview').locked, 1);
  assert.equal((await profile(bindings, true)).profile.percentage, 13);

  const unlocked = await onRequestPatch({
    request: jsonRequest('/api/profile/school_overview', { unlock: true }, true),
    env: bindings,
    params: { id: 'school_overview' }
  });
  assert.equal(unlocked.status, 200);
  assert.equal(bindings.DB.sections.get('school_overview').locked, 0);
});

test('AI updates only returned unlocked cards, keeps history and runs automatically once', async () => {
  const bindings = env();
  bindings.DB.addDocument('doc-1');
  bindings.BUCKET.add('documents/doc-1');
  Object.assign(bindings.DB.sections.get('school_overview'), {
    content: '旧学校概况', source_document_id: 'old-doc', updated_at: '2026-01-01T00:00:00.000Z'
  });
  Object.assign(bindings.DB.sections.get('calendar_schedule'), {
    content: '旧校历', updated_at: '2026-01-01T00:00:00.000Z'
  });
  Object.assign(bindings.DB.sections.get('exams'), {
    content: '人工考试安排', locked: 1, updated_at: '2026-01-01T00:00:00.000Z'
  });
  bindings.ARK_FETCH = async () => arkResponse({
    category: '学校信息',
    scope: '八年级 / 物理',
    updates: [
      { section_key: 'school_overview', content: '新的学校概况' },
      { section_key: 'exams', content: '不应覆盖的考试安排' }
    ]
  });

  const response = await analyze(bindings, 'doc-1');
  assert.equal(response.status, 200);
  assert.equal(bindings.DB.sections.get('school_overview').content, '新的学校概况');
  assert.equal(bindings.DB.sections.get('calendar_schedule').content, '旧校历');
  assert.equal(bindings.DB.sections.get('exams').content, '人工考试安排');
  assert.equal(bindings.DB.history.length, 1);
  assert.equal(bindings.DB.history[0].content, '旧学校概况');
  assert.equal(bindings.DB.documents.get('doc-1').ai_status, 'completed');
  assert.equal(bindings.DB.documents.get('doc-1').category, '学校信息');

  const repeated = await analyze(bindings, 'doc-1');
  assert.equal(repeated.status, 409);
});

test('AI failure keeps the file and only an admin can retry', async () => {
  const bindings = env();
  bindings.DB.addDocument('doc-fail');
  bindings.BUCKET.add('documents/doc-fail');
  bindings.ARK_FETCH = async () => new Response('upstream failed', { status: 503 });
  const originalConsoleError = console.error;
  console.error = () => {};
  let failed;
  try { failed = await analyze(bindings, 'doc-fail'); } finally { console.error = originalConsoleError; }
  assert.equal(failed.status, 502);
  assert.equal(bindings.DB.documents.get('doc-fail').ai_status, 'failed');
  assert.equal(bindings.BUCKET.objects.size, 1);

  assert.equal((await analyze(bindings, 'doc-fail')).status, 409);
  bindings.ARK_FETCH = async () => arkResponse({
    updates: [{ section_key: 'resources', content: '测试资源包' }]
  });
  const retried = await analyze(bindings, 'doc-fail', true);
  assert.equal(retried.status, 200);
  assert.equal(bindings.DB.documents.get('doc-fail').ai_status, 'completed');
  assert.equal(bindings.DB.sections.get('resources').content, '测试资源包');
});

test('AI output is rejected unless keys and content pass the server whitelist', () => {
  assert.throws(() => parseProfileUpdates({
    output: [{ type: 'function_call', name: 'update_school_profile', arguments: JSON.stringify({
      updates: [{ section_key: 'unknown', content: '内容' }]
    }) }]
  }), /未知或重复/);
  assert.throws(() => parseProfileUpdates({
    output: [{ type: 'function_call', name: 'update_school_profile', arguments: JSON.stringify({
      updates: [{ section_key: 'resources', content: 'x'.repeat(MAX_SECTION_CONTENT + 1) }]
    }) }]
  }), /长度无效/);

  const parsed = parseProfileUpdates({
    output: [{ type: 'function_call', name: 'update_school_profile', arguments: JSON.stringify({
      updates: [{ section_key: 'resources', content: '可用教学资源' }]
    }) }]
  });
  assert.deepEqual(parsed.updates, [{ section_key: 'resources', content: '可用教学资源' }]);
});
