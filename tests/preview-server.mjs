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
const { env, call } = await fixture({ after() {} }, false, false);
env.BUCKET = {};
let errors = 0;
const routes = { '/api/profile': { GET: profile }, '/api/network/binding': { GET: bindingGet, POST: bindingPost },
  '/api/network/accounts': { GET: accounts, POST: add }, '/api/network/searches': { GET: searches, POST: search } };
createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url, 'http://127.0.0.1:8788');
  let response;
  if (url.pathname === '/mobile') response = new Response('<iframe title="390px 页面" src="/" style="width:390px;height:844px;border:1px solid #ccc"></iframe>');
  else if (url.pathname === '/') {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace('<script>', `<script>
      window.addEventListener('error', () => fetch('/test-error', {method:'POST'}));
      window.addEventListener('unhandledrejection', () => fetch('/test-error', {method:'POST'}));
      setInterval(() => { let check = document.getElementById('testDiagnostics');
        if (!check) { check = document.createElement('p'); check.id = 'testDiagnostics'; document.body.append(check); }
        check.textContent = '测试检查：页面宽度 ' + innerWidth + '；横向溢出 ' + (document.documentElement.scrollWidth > innerWidth) + '；焦点 ' + (document.activeElement.id || document.activeElement.tagName);
      }, 500);
    </script><script>`);
    response = new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } else if (url.pathname === '/test-error') { errors++; response = new Response('ok'); }
  else if (url.pathname === '/diagnostics') response = Response.json({ errors });
  else if (url.pathname === '/api/auth/me') response = Response.json({ authenticated: true, user: { id: 'u0', phone_last4: '1234', note: '测试用户' }, turnstile_site_key: '' });
  else if (url.pathname === '/api/documents') response = Response.json({ documents: [], is_admin: false });
  else if (routes[url.pathname]?.[incoming.method]) {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    response = await routes[url.pathname][incoming.method]({ env, request: new Request(url, {
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
