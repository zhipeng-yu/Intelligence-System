const encoder = new TextEncoder();

export const CATEGORIES = ['学校信息', '教学进度', '试卷资料', '家长与情报', '活动与产品'];
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_SECTION_CONTENT = 4000;
export const MACHINE_XHS_SCOPE = '其他产品资料';
export const OTHER_PRODUCTS_SECTION_KEY = 'other_products';
export const PROFILE_SECTIONS = [
  ['school_overview', '学校概况'],
  ['calendar_schedule', '校历与作息'],
  ['grades_classes', '年级与班级概况'],
  ['teaching_progress', '教材与当前教学进度'],
  ['exams', '考试安排与范围'],
  ['teaching_focus', '教学重点、难点与常见失分'],
  ['activities', '近期活动与通知'],
  ['resources', '可用教学资源'],
  [OTHER_PRODUCTS_SECTION_KEY, '其他产品资料']
].map(([key, label]) => ({ key, label }));
export const PROFILE_SECTION_BY_KEY = new Map(PROFILE_SECTIONS.map(section => [section.key, section]));
export const SCHOOL_PROFILE_SECTION_KEYS = new Set(
  PROFILE_SECTIONS.map(section => section.key).filter(key => key !== OTHER_PRODUCTS_SECTION_KEY)
);

const FILE_TYPES = {
  pdf: {
    mime: 'application/pdf',
    signature: [0x25, 0x50, 0x44, 0x46, 0x2d]
  },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    signature: [0x50, 0x4b, 0x03, 0x04]
  },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    signature: [0x50, 0x4b, 0x03, 0x04]
  }
};

export function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    }
  });
}

async function sameSecret(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right))
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export async function isAdmin(request, env) {
  if (typeof env.ADMIN_KEY !== 'string' || encoder.encode(env.ADMIN_KEY).byteLength < 32) return false;
  const authorization = request.headers.get('Authorization') || '';
  return sameSecret(authorization, `Bearer ${env.ADMIN_KEY}`);
}

export async function isIngest(request, env) {
  if (typeof env.INGEST_KEY !== 'string' || encoder.encode(env.INGEST_KEY).byteLength < 32) return false;
  return sameSecret(request.headers.get('X-Ingest-Key') || '', env.INGEST_KEY);
}

function storageError(env) {
  return !env.DB || !env.BUCKET ? json({ error: '服务存储尚未配置完成。' }, 503) : null;
}

export function withPublic(handler) {
  return async context => {
    const error = storageError(context.env);
    if (error) return error;
    try {
      return await handler(context);
    } catch (caught) {
      console.error(caught);
      return json({ error: '服务暂时不可用，请稍后重试。' }, 500);
    }
  };
}

export function withAuth(handler) {
  return withPublic(async context => {
    if (typeof context.env.ADMIN_KEY !== 'string' || encoder.encode(context.env.ADMIN_KEY).byteLength < 32) {
      return json({ error: '服务尚未配置管理密钥。' }, 503);
    }
    if (!await isAdmin(context.request, context.env)) {
      return json({ error: '管理密钥无效，请使用最新管理链接访问。' }, 401);
    }
    return handler(context);
  });
}

function textField(form, name, maxLength) {
  const value = form.get(name);
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : '';
}

export async function readUpload(form) {
  const noteValue = form.get('note');
  const note = textField(form, 'note', 500);
  const file = form.get('file');

  if (typeof noteValue === 'string' && noteValue.trim().length > 500) {
    return { error: '备注不能超过 500 个字。', status: 400 };
  }
  if (typeof File === 'undefined' || !(file instanceof File) || !file.name) {
    return { error: '请选择要上传的文件。', status: 400 };
  }
  if (file.size === 0) return { error: '不能上传空文件。', status: 400 };
  if (file.size > MAX_FILE_SIZE) return { error: '单个文件不能超过 50MB。', status: 413 };

  const originalName = file.name.normalize('NFC');
  if (originalName.length > 255 || /[\u0000-\u001f\u007f]/.test(originalName)) {
    return { error: '文件名无效或过长。', status: 400 };
  }

  const extension = originalName.toLowerCase().split('.').pop();
  const type = FILE_TYPES[extension];
  if (!type) return { error: '仅支持 PDF、DOCX、XLSX 文件。', status: 400 };
  if (file.type.toLowerCase() !== type.mime) {
    return { error: `文件 MIME 类型与 .${extension} 扩展名不匹配。`, status: 400 };
  }

  const header = new Uint8Array(await file.slice(0, type.signature.length).arrayBuffer());
  if (!type.signature.every((byte, index) => header[index] === byte)) {
    return { error: '文件内容与扩展名不匹配。', status: 400 };
  }

  return { value: { title: originalName, note: note || null, file, originalName, mimeType: type.mime } };
}

export async function networkHash(address, secret) {
  if (!address || !secret) return '';
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${secret}\u0000${address}`));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function validateTurnstile(token, address, secret, fetcher = fetch) {
  if (!token || token.length > 2048 || !secret) return false;
  try {
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: address })
    });
    if (!response.ok) return false;
    return Boolean((await response.json()).success);
  } catch {
    return false;
  }
}

export function attachmentDisposition(filename) {
  const fallback = filename
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .slice(0, 150) || 'download';
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
