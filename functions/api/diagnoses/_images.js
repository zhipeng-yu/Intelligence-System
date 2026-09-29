import { json } from '../../_shared.js';

export const MAX_DIAGNOSIS_IMAGES = 3;
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function diagnosisImages(row) {
  return JSON.parse(row.images_json || '[]');
}

// Keep images in the same request as the answer: no unowned uploads or draft objects.
export async function readDiagnosisRequest(request, existing = [], turn = 0) {
  const maxRequestSize = MAX_DIAGNOSIS_IMAGES * MAX_IMAGE_SIZE + 65536;
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > maxRequestSize) {
    return { error: json({ error: '图片总大小超出限制。' }, 413) };
  }
  let body, files = [];
  let received = 0;
  try {
    const bounded = new Response(request.body?.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxRequestSize) throw new Error('Request too large');
        controller.enqueue(chunk);
      }
    })), { headers: request.headers });
    if (request.headers.get('Content-Type')?.startsWith('multipart/form-data')) {
      const form = await bounded.formData();
      body = Object.fromEntries(['name', 'phenomenon', 'answer'].map(key => [key, form.get(key)]));
      files = form.getAll('images').filter(file => !(file instanceof File && !file.name && !file.size));
    } else {
      body = await bounded.json();
      if (body?.images !== undefined || body?.images_json !== undefined) {
        return { error: json({ error: '图片请通过文件选择上传。' }, 400) };
      }
    }
  } catch {
    return { error: received > maxRequestSize
      ? json({ error: '图片总大小超出限制。' }, 413)
      : json({ error: '请求格式无效。' }, 400) };
  }
  if (files.length + existing.length > MAX_DIAGNOSIS_IMAGES) {
    return { error: json({ error: '每次诊断累计最多添加 3 张图片。' }, 400) };
  }
  const uploads = [];
  for (const file of files) {
    if (!(file instanceof File) || !file.name || !file.size) {
      return { error: json({ error: '请选择非空图片文件。' }, 400) };
    }
    if (file.size > MAX_IMAGE_SIZE) return { error: json({ error: '每张图片不能超过 5MB。' }, 413) };
    const name = file.name.normalize('NFC');
    const mime = MIME[name.toLowerCase().split('.').pop()];
    if (name.length > 255 || /[\u0000-\u001f\u007f]/.test(name) || !mime || mime !== file.type.toLowerCase()) {
      return { error: json({ error: '仅支持扩展名和 MIME 类型一致的 JPG、PNG、WebP 图片，文件名不能超过 255 字。' }, 400) };
    }
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const tail = new Uint8Array(await file.slice(-12).arrayBuffer());
    const matches = (bytes, signature, offset = 0) => signature.every((value, i) => bytes[offset + i] === value);
    const valid = mime === 'image/jpeg'
      ? file.size >= 4 && matches(head, [255, 216, 255]) && matches(tail, [255, 217], tail.length - 2)
      : mime === 'image/png'
        ? file.size >= 45 && matches(head, [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]) &&
          matches(tail, [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])
        : head.length === 16 && file.size >= 20 && matches(head, [82, 73, 70, 70]) &&
          matches(head, [87, 69, 66, 80, 86, 80, 56], 8) && [32, 76, 88].includes(head[15]) &&
          new DataView(head.buffer).getUint32(4, true) + 8 === file.size;
    if (!valid) return { error: json({ error: '图片内容与格式不匹配或文件已损坏，请重新选择。' }, 400) };
    uploads.push({ file, image: {
      id: crypto.randomUUID(), turn, name, mime_type: mime, size_bytes: file.size,
      object_key: `diagnoses/${crypto.randomUUID()}`
    } });
  }
  return { body, uploads };
}

export async function imageInput(env, existing, uploads) {
  const content = [];
  for (const image of [...existing, ...uploads.map(upload => upload.image)]) {
    const file = uploads.find(upload => upload.image.id === image.id)?.file;
    const object = file || await env.BUCKET?.get(image.object_key);
    if (!object) throw new Error('Diagnosis image unavailable');
    const bytes = new Uint8Array(await object.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    content.push({ type: 'input_text', text: `附件：${image.turn === 0 ? '开始案例时' : `第 ${image.turn} 轮回答时`}添加的图片。` },
      { type: 'input_image', detail: 'auto', image_url: `data:${image.mime_type};base64,${btoa(binary)}` });
  }
  return content;
}

export async function saveImages(env, uploads) {
  for (const { file, image } of uploads) {
    await env.BUCKET.put(image.object_key, file.stream(), { httpMetadata: { contentType: image.mime_type } });
  }
}

export async function discardImages(env, uploads) {
  // Delete all attempted keys, including a put whose response failed after storage.
  const results = await Promise.allSettled(uploads.map(({ image }) => env.BUCKET.delete(image.object_key)));
  if (results.some(result => result.status === 'rejected')) console.error('Diagnosis image cleanup failed');
}
