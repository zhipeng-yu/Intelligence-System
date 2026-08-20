const encoder = new TextEncoder();

export const CATEGORIES = ['学校信息', '教学进度', '试卷资料', '家长与情报', '活动与产品'];
export const UPLOADERS = ['人员1（我）', '人员2（上级）'];
export const STATUSES = ['待确认', '已确认'];
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

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

export function withAuth(handler) {
  return async context => {
    if (typeof context.env.ADMIN_KEY !== 'string' || encoder.encode(context.env.ADMIN_KEY).byteLength < 32) {
      return json({ error: '服务尚未配置管理密钥。' }, 503);
    }

    const authorization = context.request.headers.get('Authorization') || '';
    const expected = `Bearer ${context.env.ADMIN_KEY}`;
    if (!await sameSecret(authorization, expected)) {
      return json({ error: '管理密钥无效，请使用最新管理链接访问。' }, 401);
    }

    if (!context.env.DB || !context.env.BUCKET) {
      return json({ error: '服务存储尚未配置完成。' }, 503);
    }

    try {
      return await handler(context);
    } catch (error) {
      console.error(error);
      return json({ error: '服务暂时不可用，请稍后重试。' }, 500);
    }
  };
}

function textField(form, name, maxLength) {
  const value = form.get(name);
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : '';
}

export async function readUpload(form) {
  const title = textField(form, 'title', 200);
  const category = textField(form, 'category', 20);
  const scope = textField(form, 'scope', 100);
  const uploadedBy = textField(form, 'uploaded_by', 20);
  const file = form.get('file');

  if (!title || !scope) return { error: '请完整填写资料标题和年级 / 学科。', status: 400 };
  if (!CATEGORIES.includes(category)) return { error: '资料分类无效。', status: 400 };
  if (!UPLOADERS.includes(uploadedBy)) return { error: '上传者只能选择人员1（我）或人员2（上级）。', status: 400 };
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

  return {
    value: { title, category, scope, uploadedBy, file, originalName, mimeType: type.mime }
  };
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
