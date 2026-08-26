import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_SECTION_CONTENT, PROFILE_SECTIONS } from '../functions/_shared.js';
import { onRequestGet } from '../functions/api/profile/index.js';
import { onRequestPost as onRequestUndo } from '../functions/api/profile/undo.js';
import { onRequestPost as onRequestAnalyze, parseProfileUpdates } from '../functions/api/documents/[id]/analyze.js';

const ADMIN_KEY = '0123456789abcdef0123456789abcdef';

class ProfileDB {
  constructor() {
    this.documents = new Map();
    this.sections = new Map(PROFILE_SECTIONS.map(section => [section.key, {
      section_key: section.key,
      content: '',
      source_document_id: null,
      updated_at: null
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
      uploaded_at: `2026-08-26T00:00:${String(this.documents.size).padStart(2, '0')}.000Z`,
      deleted_at: null,
      undone_at: null,
      ...values
    });
  }

  latestUndo() {
    return [...this.documents.values()]
      .filter(document => !document.deleted_at && !document.undone_at
        && this.history.some(history => history.change_document_id === document.id))
      .map(document => ({
        document,
        changedAt: this.history
          .filter(history => history.change_document_id === document.id)
          .reduce((latest, history) => history.changed_at > latest ? history.changed_at : latest, '')
      }))
      .sort((left, right) => right.changedAt.localeCompare(left.changedAt)
        || right.document.uploaded_at.localeCompare(left.document.uploaded_at)
        || right.document.id.localeCompare(left.document.id))[0]?.document || null;
  }

  prepare(sql) {
    const database = this;
    return {
      sql,
      values: [],
      bind(...values) { this.values = values; return this; },
      async all() {
        if (/SELECT reference\.section_key/.test(sql)) {
          const references = new Map();
          const add = (sectionKey, documentId) => {
            const document = database.documents.get(documentId);
            if (!document || document.deleted_at || document.undone_at) return;
            references.set(`${sectionKey}\0${documentId}`, {
              section_key: sectionKey,
              id: documentId,
              original_name: document.original_name,
              uploaded_at: document.uploaded_at
            });
          };
          for (const section of database.sections.values()) add(section.section_key, section.source_document_id);
          for (const history of database.history) add(history.section_key, history.change_document_id);
          return { results: [...references.values()].sort((left, right) =>
            left.section_key.localeCompare(right.section_key)
            || left.uploaded_at.localeCompare(right.uploaded_at)
            || left.id.localeCompare(right.id)) };
        }
        if (/FROM profile_history/.test(sql) && /change_document_id = \?1/.test(sql)) {
          return { results: database.history
            .filter(history => history.change_document_id === this.values[0])
            .map(history => ({ ...history }))
            .sort((left, right) => left.section_key.localeCompare(right.section_key)) };
        }
        if (/FROM profile_sections/.test(sql)) {
          return { results: [...database.sections.values()].map(section => ({ ...section })) };
        }
        return { results: [] };
      },
      async first() {
        if (/JOIN profile_history AS history/.test(sql)) {
          const document = database.latestUndo();
          return document ? { id: document.id } : null;
        }
        if (/FROM documents/.test(sql)) {
          const document = database.documents.get(this.values[0]);
          return document && !document.deleted_at ? { ...document } : null;
        }
        return null;
      },
      async run() {
        if (/auto_analyzed = 1/.test(sql)) {
          const document = database.documents.get(this.values[0]);
          if (!document || document.deleted_at || document.undone_at || document.auto_analyzed) {
            return { meta: { changes: 0 } };
          }
          document.ai_status = 'processing';
          document.ai_error = null;
          document.auto_analyzed = 1;
          return { meta: { changes: 1 } };
        }
        if (/WHERE id = \?1 AND ai_status = 'failed'/.test(sql)) {
          const document = database.documents.get(this.values[0]);
          if (!document || document.deleted_at || document.undone_at || document.ai_status !== 'failed') {
            return { meta: { changes: 0 } };
          }
          document.ai_status = 'processing';
          document.ai_error = null;
          return { meta: { changes: 1 } };
        }
        if (/SET ai_status = 'failed'/.test(sql)) {
          const [message, analyzedAt, id] = this.values;
          const document = database.documents.get(id);
          if (!document || document.undone_at) return { meta: { changes: 0 } };
          Object.assign(document, { ai_status: 'failed', ai_error: message, analyzed_at: analyzedAt });
          return { meta: { changes: 1 } };
        }
        if (/INSERT INTO profile_history/.test(sql)) {
          const [id, sectionKey, content, sourceDocumentId, changedAt, changeDocumentId, previousUpdatedAt] = this.values;
          database.history.push({
            id,
            section_key: sectionKey,
            content,
            source_document_id: sourceDocumentId,
            changed_at: changedAt,
            changed_by: 'ai',
            change_document_id: changeDocumentId,
            previous_updated_at: previousUpdatedAt
          });
          return { meta: { changes: 1 } };
        }
        if (/SET undone_at = \?1/.test(sql)) {
          const [undoneAt, id] = this.values;
          const document = database.documents.get(id);
          if (!document || document.undone_at) return { meta: { changes: 0 } };
          document.undone_at = undoneAt;
          return { meta: { changes: 1 } };
        }
        if (/UPDATE profile_sections/.test(sql) && /AND EXISTS/.test(sql)) {
          const [content, sourceDocumentId, updatedAt, sectionKey, documentId, undoneAt] = this.values;
          const document = database.documents.get(documentId);
          const section = database.sections.get(sectionKey);
          if (!section || document?.undone_at !== undoneAt) return { meta: { changes: 0 } };
          Object.assign(section, { content, source_document_id: sourceDocumentId, updated_at: updatedAt });
          return { meta: { changes: 1 } };
        }
        if (/UPDATE profile_sections/.test(sql)) {
          const [content, documentId, updatedAt, sectionKey] = this.values;
          const section = database.sections.get(sectionKey);
          if (!section) return { meta: { changes: 0 } };
          Object.assign(section, { content, source_document_id: documentId, updated_at: updatedAt });
          return { meta: { changes: 1 } };
        }
        if (/SET category = COALESCE/.test(sql)) {
          const [category, scope, analyzedAt, id] = this.values;
          const document = database.documents.get(id);
          if (!document || document.undone_at) return { meta: { changes: 0 } };
          if (category) document.category = category;
          if (scope) document.scope = scope;
          Object.assign(document, { ai_status: 'completed', ai_error: null, analyzed_at: analyzedAt });
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
  return {
    ADMIN_KEY,
    ARK_API_KEY: 'test-api-key',
    TURNSTILE_SITE_KEY: 'test-site-key',
    DB: new ProfileDB(),
    BUCKET: new FakeBucket(),
    AI: { toMarkdown: async () => ({ format: 'markdown', data: '# 无敏感信息的测试资料' }) },
    ARK_FETCH: async () => arkResponse({ updates: [] })
  };
}

function request(path, options = {}, authorized = false) {
  const headers = new Headers(options.headers || {});
  if (authorized) headers.set('Authorization', `Bearer ${ADMIN_KEY}`);
  return new Request(`https://archive.test${path}`, { ...options, headers });
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

async function undo(bindings, authorized = true) {
  return onRequestUndo({
    request: request('/api/profile/undo', { method: 'POST' }, authorized),
    env: bindings
  });
}

function addAnalyzable(bindings, id, response) {
  bindings.DB.addDocument(id);
  bindings.BUCKET.add(`documents/${id}`);
  bindings.ARK_FETCH = async () => arkResponse(response);
}

test('profile is public, exposes active card sources, and only advertises undo to admins', async () => {
  const bindings = env();
  const empty = await profile(bindings);
  assert.equal(empty.profile.filled, 0);
  assert.equal(empty.profile.total, 8);
  assert.equal(empty.profile.percentage, 0);
  assert.equal(empty.can_undo, false);

  addAnalyzable(bindings, 'doc-a', {
    updates: [{ section_key: 'school_overview', items: ['测试学校'] }]
  });
  assert.equal((await analyze(bindings, 'doc-a')).status, 200);

  const teacher = await profile(bindings);
  const section = teacher.profile.sections.find(item => item.key === 'school_overview');
  assert.deepEqual(section.sources, [{ id: 'doc-a', original_name: 'doc-a.pdf' }]);
  assert.equal(teacher.can_undo, false);
  assert.equal((await profile(bindings, true)).can_undo, true);
  assert.equal((await undo(bindings, false)).status, 401);
});

test('AI receives the current profile and stores a deduplicated complete merged card', async () => {
  const bindings = env();
  Object.assign(bindings.DB.sections.get('school_overview'), {
    content: '旧校区\n保留项目',
    updated_at: '2026-08-25T00:00:00.000Z'
  });
  addAnalyzable(bindings, 'doc-merge', {
    category: '学校信息',
    updates: [{ section_key: 'school_overview', items: ['保留项目', '新校区', '新校区'] }]
  });
  let prompt = '';
  bindings.ARK_FETCH = async (_url, options) => {
    prompt = JSON.parse(options.body).input;
    return arkResponse({
      category: '学校信息',
      updates: [{ section_key: 'school_overview', items: ['保留项目', '新校区', '新校区'] }]
    });
  };

  const response = await analyze(bindings, 'doc-merge');
  assert.equal(response.status, 200);
  assert.match(prompt, /旧校区/);
  assert.match(prompt, /新资料优先替换冲突项/);
  assert.equal(bindings.DB.sections.get('school_overview').content, '保留项目\n新校区');
  assert.equal(bindings.DB.history[0].content, '旧校区\n保留项目');
  assert.equal(bindings.DB.history[0].previous_updated_at, '2026-08-25T00:00:00.000Z');
  assert.deepEqual((await response.json()).updated_sections, ['school_overview']);
});

test('an identical AI result creates no history, source, timestamp change, or undo step', async () => {
  const bindings = env();
  Object.assign(bindings.DB.sections.get('resources'), {
    content: '资源 A\n资源 B',
    updated_at: '2026-08-25T00:00:00.000Z'
  });
  addAnalyzable(bindings, 'doc-same', {
    updates: [{ section_key: 'resources', items: ['资源 A', '资源 B'] }]
  });

  const response = await analyze(bindings, 'doc-same');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).updated_sections, []);
  assert.equal(bindings.DB.history.length, 0);
  assert.equal(bindings.DB.sections.get('resources').updated_at, '2026-08-25T00:00:00.000Z');
  assert.equal((await profile(bindings, true)).can_undo, false);
  assert.deepEqual((await profile(bindings)).profile.sections.find(item => item.key === 'resources').sources, []);
});

test('one document changing multiple cards is undone as one step with content, time, and source restored', async () => {
  const bindings = env();
  bindings.DB.addDocument('baseline', { ai_status: 'completed' });
  Object.assign(bindings.DB.sections.get('school_overview'), {
    content: '旧概况', source_document_id: 'baseline', updated_at: '2026-08-20T01:00:00.000Z'
  });
  Object.assign(bindings.DB.sections.get('exams'), {
    content: '旧考试', source_document_id: 'baseline', updated_at: '2026-08-20T02:00:00.000Z'
  });
  addAnalyzable(bindings, 'doc-multi', {
    updates: [
      { section_key: 'school_overview', items: ['新概况'] },
      { section_key: 'exams', items: ['新考试'] }
    ]
  });
  assert.equal((await analyze(bindings, 'doc-multi')).status, 200);
  assert.equal(bindings.DB.history.filter(row => row.change_document_id === 'doc-multi').length, 2);

  const response = await undo(bindings);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).restored_sections, ['exams', 'school_overview']);
  assert.deepEqual(bindings.DB.sections.get('school_overview'), {
    section_key: 'school_overview', content: '旧概况', source_document_id: 'baseline', updated_at: '2026-08-20T01:00:00.000Z'
  });
  assert.deepEqual(bindings.DB.sections.get('exams'), {
    section_key: 'exams', content: '旧考试', source_document_id: 'baseline', updated_at: '2026-08-20T02:00:00.000Z'
  });
  assert.ok(bindings.DB.documents.get('doc-multi').undone_at);
  assert.equal((await analyze(bindings, 'doc-multi', true)).status, 409);
  assert.equal((await profile(bindings)).profile.sections.find(item => item.key === 'exams').sources.some(source => source.id === 'doc-multi'), false);
});

test('A, B, and C stay on one undo stack without redo or arbitrary restore', async () => {
  const bindings = env();
  for (const [id, value] of [['a', 'A'], ['b', 'B']]) {
    addAnalyzable(bindings, id, { updates: [{ section_key: 'resources', items: [value] }] });
    assert.equal((await analyze(bindings, id)).status, 200);
  }
  assert.equal(bindings.DB.sections.get('resources').content, 'B');
  assert.equal((await undo(bindings)).status, 200);
  assert.equal(bindings.DB.sections.get('resources').content, 'A');

  addAnalyzable(bindings, 'c', { updates: [{ section_key: 'resources', items: ['C'] }] });
  assert.equal((await analyze(bindings, 'c')).status, 200);
  assert.equal((await analyze(bindings, 'b', true)).status, 409);
  assert.equal((await undo(bindings)).status, 200);
  assert.equal(bindings.DB.sections.get('resources').content, 'A');
  assert.equal((await undo(bindings)).status, 200);
  assert.equal(bindings.DB.sections.get('resources').content, '');
  assert.equal((await undo(bindings)).status, 409);
});

test('failed analysis keeps the file, allows only an admin retry, and an undone result cannot retry', async () => {
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
    updates: [{ section_key: 'activities', items: ['测试活动'] }]
  });
  assert.equal((await analyze(bindings, 'doc-fail', true)).status, 200);
  assert.equal((await undo(bindings)).status, 200);
  assert.equal((await analyze(bindings, 'doc-fail', true)).status, 409);
});

test('AI output enforces section keys, 1-12 non-empty items, deduplication, and 4000 characters', () => {
  const response = value => ({
    output: [{ type: 'function_call', name: 'update_school_profile', arguments: JSON.stringify(value) }]
  });
  assert.throws(() => parseProfileUpdates(response({
    updates: [{ section_key: 'unknown', items: ['内容'] }]
  })), /未知或重复/);
  assert.throws(() => parseProfileUpdates(response({
    updates: [{ section_key: 'resources', items: [] }]
  })), /数量无效/);
  assert.throws(() => parseProfileUpdates(response({
    updates: [{ section_key: 'resources', items: Array.from({ length: 13 }, (_, index) => `资源 ${index}`) }]
  })), /数量无效/);
  assert.throws(() => parseProfileUpdates(response({
    updates: [{ section_key: 'resources', items: [' '] }]
  })), /无效的画像条目/);
  assert.throws(() => parseProfileUpdates(response({
    updates: [{ section_key: 'resources', items: ['资源 A\n资源 B'] }]
  })), /无效的画像条目/);
  assert.throws(() => parseProfileUpdates(response({
    updates: [{ section_key: 'resources', items: ['x'.repeat(MAX_SECTION_CONTENT + 1)] }]
  })), /长度无效/);

  const parsed = parseProfileUpdates(response({
    updates: [{ section_key: 'resources', items: ['资源 A', '资源 A', '资源 B'] }]
  }));
  assert.deepEqual(parsed.updates, [{
    section_key: 'resources', items: ['资源 A', '资源 B'], content: '资源 A\n资源 B'
  }]);
});
