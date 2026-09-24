// Local-only UI acceptance with synthetic identities; no external service calls.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fixture } from './network-fixture.mjs';
import { onRequestGet as profile } from '../functions/api/profile/index.js';
import { onRequestGet as bindingGet, onRequestPost as bindingPost } from '../functions/api/network/binding.js';
import { onRequestGet as accounts, onRequestPost as add } from '../functions/api/network/accounts/index.js';
import { onRequestGet as searches, onRequestPost as search } from '../functions/api/network/searches/index.js';
import { onRequestPost as claim } from '../functions/api/network/worker/claim.js';
import { onRequestPost as report } from '../functions/api/network/worker/binding.js';
import { onRequestGet as diagnoses, onRequestPost as createDiagnosis } from '../functions/api/diagnoses/index.js';
import { onRequestPatch as updateDiagnosis } from '../functions/api/diagnoses/[id].js';
const { env, call } = await fixture({ after() {} }, false, false);
env.BUCKET = {};
const aiTurns = [
  { status: 'question', question: '这几名未交学生是否一直是同一批？', problem: '', evidence: [], solution: '', verification: '' },
  { status: 'question', question: '老师对这些固定未交学生具体做过什么？', problem: '', evidence: [], solution: '', verification: '' },
  { status: 'complete', question: '', problem: '主讲老师只做了群提醒，没有跟进固定未交学生',
    evidence: ['未交集中在固定 6 名学生', '老师没有逐一联系', '同期作业难度和出勤未变化'],
    solution: '教学人员请主讲老师本周逐一联系这 6 名学生，确认困难并约定提交时间。',
    verification: '下两讲核对这 6 名学生的提交情况，并确认家长是否收到跟进。' },
  { status: 'question', question: '请举一条反馈，老师写出了孩子的哪些具体表现？', problem: '', evidence: [], solution: '', verification: '' }
];
env.ARK_API_KEY = 'local-synthetic-key';
env.ARK_FETCH = async () => {
  const value = aiTurns.shift() || {
    status: 'question', question: '当时老师具体采取了什么动作？', problem: '', evidence: [], solution: '', verification: ''
  };
  return Response.json({ output: [{
    type: 'function_call', name: 'continue_teaching_diagnosis', arguments: JSON.stringify(value)
  }] });
};
const seeded = await call(createDiagnosis, {
  name: '王老师作业跟进', phenomenon: '连续三周未提交人数由 2 人增加到 8 人，教学人员已发现这个问题。'
});
const seededId = seeded.data.diagnosis.id;
await call(updateDiagnosis, { answer: '集中在八年级一班固定 6 名学生；同期出勤和作业难度没有变化。' }, { method: 'PATCH', id: seededId });
await call(updateDiagnosis, { answer: '只在班级群统一提醒，没有逐一联系这些学生。' }, { method: 'PATCH', id: seededId });
let errors = 0;
const routes = { '/api/profile': { GET: profile }, '/api/network/binding': { GET: bindingGet, POST: bindingPost },
  '/api/network/accounts': { GET: accounts, POST: add }, '/api/network/searches': { GET: searches, POST: search },
  '/api/diagnoses': { GET: diagnoses, POST: createDiagnosis } };
createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url, 'http://127.0.0.1:8788');
  let response;
  if (url.pathname === '/mobile') response = new Response('<iframe title="390px 页面" src="/" style="width:390px;height:844px;border:1px solid #ccc"></iframe>');
  else if (url.pathname === '/favicon.ico') response = new Response(null, { status: 204 });
  else if (url.pathname === '/' || url.pathname === '/screenshot') {
    const screenshotSetup = url.pathname === '/screenshot' ? `
      window.addEventListener('load', async () => {
        document.getElementById('diagnosisNav').click();
        for (let count = 0; count < 20 && !document.querySelector('#diagnosisList .diagnosis-case'); count++) await new Promise(resolve => setTimeout(resolve, 50));
        [...document.querySelectorAll('#diagnosisList .diagnosis-case')].find(button => button.textContent.includes('诊断完成'))?.click();
        document.getElementById('diagnosisWorkspace')?.scrollIntoView({block:'start'});
      });` : '';
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace('<script>', `<script>
      window.addEventListener('DOMContentLoaded', () => {
        const notice = document.createElement('div');
        notice.textContent = '本地验收：合成数据与模拟 AI，非真实 AI 诊断';
        notice.style.cssText = 'background:#fff3cd;color:#542c00;padding:8px 12px;margin-bottom:12px;font:14px sans-serif;border:2px solid #9a6700';
        document.querySelector('main').prepend(notice);
      });
      window.addEventListener('error', () => fetch('/test-error', {method:'POST'}));
      window.addEventListener('unhandledrejection', () => fetch('/test-error', {method:'POST'}));
      setInterval(() => { let check = document.getElementById('testDiagnostics');
        if (!check) { check = document.createElement('p'); check.id = 'testDiagnostics'; document.body.append(check); }
        check.textContent = '测试检查：页面宽度 ' + innerWidth + '；横向溢出 ' + (document.documentElement.scrollWidth > innerWidth) + '；焦点 ' + (document.activeElement.id || document.activeElement.tagName);
      }, 500);
      ${screenshotSetup}
    </script><script>`);
    response = new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } else if (url.pathname === '/test-error') { errors++; response = new Response('ok'); }
  else if (url.pathname === '/diagnostics') response = Response.json({ errors });
  else if (url.pathname === '/api/auth/me') response = Response.json({ authenticated: true, user: { id: 'u0', phone_last4: '1234', note: '测试用户' }, turnstile_site_key: '' });
  else if (url.pathname === '/api/documents') response = Response.json({ documents: [], is_admin: false });
  else if (routes[url.pathname]?.[incoming.method] || (incoming.method === 'PATCH' && /^\/api\/diagnoses\/[^/]+$/.test(url.pathname))) {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const diagnosisId = url.pathname.startsWith('/api/diagnoses/') ? decodeURIComponent(url.pathname.split('/').pop()) : '';
    const handler = diagnosisId ? updateDiagnosis : routes[url.pathname][incoming.method];
    response = await handler({ env, params: { id: diagnosisId }, request: new Request(url, {
      method: incoming.method, headers: { Cookie: 'ledu_session=session-0', 'Content-Type': 'application/json' },
      body: body.length ? body : undefined
    }) });
    if (url.pathname === '/api/network/binding' && incoming.method === 'POST' && response.status === 202) {
      setTimeout(async () => {
        const job = (await call(claim, { user_sessions: true }, { worker: true })).data.job;
        if (!job) return;
        if (job.status === 'unbinding') await call(report, { profile_id: job.profile_id, claim_token: job.claim_token, status: 'unbound' }, { worker: true });
        else {
          await call(report, { profile_id: job.profile_id, claim_token: job.claim_token, status: 'waiting',
            png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' }, { worker: true });
          setTimeout(() => call(report, { profile_id: job.profile_id, claim_token: job.claim_token, status: 'ready' }, { worker: true }), 15000);
        }
      }, 500);
    }
  } else response = new Response('Not found', { status: 404 });
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}).listen(8788, '127.0.0.1', () => console.log('Local acceptance page ready'));
