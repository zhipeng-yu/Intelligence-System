import { attachmentDisposition, json, withUser } from '../../../../_shared.js';
import { diagnosisImages } from '../../_images.js';

export const onRequestGet = withUser(async ({ request, env, user, params }) => {
  const row = await env.DB.prepare(`
    SELECT images_json FROM teaching_diagnoses WHERE user_id = ?1 AND id = ?2
  `).bind(user.id, params.id).first();
  const image = row && diagnosisImages(row).find(item => item.id === params.imageId);
  if (!image) return json({ error: '图片不存在。' }, 404);
  const object = await env.BUCKET.get(image.object_key);
  if (!object) return json({ error: '图片暂时不可用，请稍后重试。' }, 404);
  return new Response(object.body, { headers: {
    'Content-Type': image.mime_type,
    'Content-Length': String(image.size_bytes),
    'Content-Disposition': new URL(request.url).searchParams.has('download') ? attachmentDisposition(image.name) : 'inline',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin'
  } });
}, true);
