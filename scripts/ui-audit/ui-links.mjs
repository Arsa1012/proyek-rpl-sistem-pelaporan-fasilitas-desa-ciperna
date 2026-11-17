import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-mobile-fix';
const profile = path.join(OUT, 'profile');
const PORT = 9899;
const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let ws;
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(script) {
  const r = await send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}
async function ready() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await ev('document.readyState')) === 'complete') return;
    } catch {}
    await sleep(250);
  }
}
async function goto(url) {
  await send('Page.navigate', { url });
  await sleep(400);
  await ready();
  await sleep(600);
}
async function login(email) {
  return ev(`(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: '${email}', password: '${email === 'admin@ciperna.id' ? 'Admin123!' : 'password123'}' }) });
    return { status: r.status, text: await r.text() };
  })()`);
}
async function logout() {
  return ev(`fetch('/api/auth/logout', { method: 'POST' }).then((r) => r.status)`);
}
async function checkLinks() {
  return ev(`(async () => {
    const links = [...document.querySelectorAll('.sidebar-nav .sidebar-link')];
    const out = [];
    for (const a of links) {
      const href = a.getAttribute('href');
      try {
        const r = await fetch(href, { credentials: 'same-origin', redirect: 'follow' });
        const html = await r.text();
        out.push({ href, label: a.textContent.trim(), status: r.status, final: new URL(r.url).pathname + new URL(r.url).search, login: new URL(r.url).pathname === '/login', hasHeading: /<h2[^>]*>/.test(html) });
      } catch (e) {
        out.push({ href, label: a.textContent.trim(), error: String(e) });
      }
    }
    return { path: location.pathname, links: out };
  })()`);
}

const results = { roles: {} };
try {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) {
        const p = (await r.json()).find((t) => t.type === 'page');
        if (p?.webSocketDebuggerUrl) {
          ws = new WebSocket(p.webSocketDebuggerUrl);
          break;
        }
      }
    } catch {}
    await sleep(250);
  }
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (m) => {
    const j = JSON.parse(m.data);
    if (j.id && pending.has(j.id)) pending.get(j.id)(j);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 771, deviceScaleFactor: 1, mobile: true });

  // Sesi admin dari profil Chrome sebelumnya (cookie persisten 1 hari).
  await goto(`${BASE}/admin/dashboard`);
  let state = await ev(`({ path: location.pathname, loginForm: !!document.querySelector('input[name="email"], input[type="email"]') })`);
  if (state.path === '/login' || state.loginForm) {
    results.roles.ADMIN = { relogin: await login('admin@ciperna.id') };
    await goto(`${BASE}/admin/dashboard`);
  }
  results.roles.ADMIN = { ...(results.roles.ADMIN || {}), ...(await checkLinks()) };
  results.roles.ADMIN.legacy = await ev(`(async () => {
    const check = async (href) => {
      const r = await fetch(href, { credentials: 'same-origin', redirect: 'follow' });
      return { href, status: r.status, final: new URL(r.url).pathname + new URL(r.url).search };
    };
    return {
      reports: await check('/admin/reports'),
      assignments: await check('/admin/assignments'),
      assign: await check('/admin/assign'),
      reportFiltered: await check('/admin/laporan?status=SUBMITTED'),
    };
  })()`);
  results.roles.ADMIN.protected = await ev(`(async () => {
    const r = await fetch('/masyarakat/laporan', { credentials: 'same-origin', redirect: 'follow' });
    return { status: r.status, final: new URL(r.url).pathname };
  })()`);
  await logout();

  // CITIZEN
  results.roles.CITIZEN = { login: (await login('citizen1@example.com')).status };
  await goto(`${BASE}/masyarakat/dashboard`);
  results.roles.CITIZEN = { ...results.roles.CITIZEN, ...(await checkLinks()) };
  results.roles.CITIZEN.protected = await ev(`(async () => {
    const r = await fetch('/admin/laporan', { credentials: 'same-origin', redirect: 'follow' });
    return { status: r.status, final: new URL(r.url).pathname };
  })()`);
  await logout();

  // OFFICER
  results.roles.OFFICER = { login: (await login('officer1@example.com')).status };
  await goto(`${BASE}/petugas/dashboard`);
  results.roles.OFFICER = { ...results.roles.OFFICER, ...(await checkLinks()) };
  results.roles.OFFICER.protected = await ev(`(async () => {
    const r = await fetch('/admin/laporan', { credentials: 'same-origin', redirect: 'follow' });
    return { status: r.status, final: new URL(r.url).pathname };
  })()`);
  await logout();

  // Screenshot header/konten 400x771 setelah logout? login admin lagi tidak perlu:
  // ambil screenshot halaman publik + login untuk memastikan header tidak menutupi.
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 771, deviceScaleFactor: 1, mobile: true });
  await goto(`${BASE}/login`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(OUT, 'login-400.png'), Buffer.from(shot.data, 'base64'));

  await fs.writeFile(path.join(OUT, 'links.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  try {
    ws && ws.close();
  } catch {}
  chrome.kill();
}
