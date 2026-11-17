import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const OUT = 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-shots';
const profile = path.join(OUT, 'profile');

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' });

async function waitJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome CDP tidak siap: ' + url);
}

let ws;
let seq = 0;
const pending = new Map();
function send(method, params = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('timeout ' + method));
    }, timeout);
    pending.set(id, (m) => {
      clearTimeout(timer);
      if (m.error) reject(new Error(method + ': ' + m.error.message));
      else resolve(m.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const s = await evalJs('document.readyState');
      if (s === 'complete') return;
    } catch {}
    await sleep(250);
  }
  throw new Error('halaman tidak selesai dimuat');
}

async function goto(url) {
  await send('Page.navigate', { url });
  await sleep(400);
  await waitReady();
  await sleep(600);
}

async function openDrawer() {
  for (let i = 0; i < 10; i++) {
    const isOpen = await evalJs(`document.querySelector('.sidebar')?.classList.contains('open')`);
    if (isOpen) return true;
    await evalJs(`document.querySelector('.sidebar-toggle')?.click()`);
    await sleep(350);
  }
  return await evalJs(`document.querySelector('.sidebar')?.classList.contains('open')`);
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, name + '.png');
  await fs.writeFile(file, Buffer.from(r.data, 'base64'));
  return file;
}

const results = {};

try {
  await waitJson(`http://127.0.0.1:${PORT}/json/version`);
  const list = await waitJson(`http://127.0.0.1:${PORT}/json/list`);
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)(m);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  });

  // ---- Login sekali (cookie disimpan di profil) ----
  await goto('http://localhost:3000/login');
  const login = await evalJs(`(async () => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@ciperna.id', password: 'Admin123!' }),
    });
    return { status: r.status, body: (await r.text()).slice(0, 200) };
  })()`);
  results.login = login;

  const viewports = [
    [320, 640], [360, 800], [390, 844], [430, 932],
    [768, 1024], [1024, 768], [1366, 768], [1920, 1080],
  ];

  for (const [w, h] of viewports) {
    const label = `${w}x${h}`;
    await send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile: w < 768,
    });
    await goto('http://localhost:3000/admin/dashboard');
    await evalJs('document.documentElement.dataset.theme = "light"; localStorage.setItem("ciperna-theme","light");');
    await sleep(150);

    const state = await evalJs(`(() => {
      const de = document.documentElement;
      const sb = document.querySelector('.sidebar');
      const cs = getComputedStyle(sb);
      const r = sb.getBoundingClientRect();
      const toggle = document.querySelector('.sidebar-toggle');
      const link = document.querySelector('.sidebar-link');
      return {
        innerWidth, innerHeight,
        scrollWidth: de.scrollWidth,
        overflowX: de.scrollWidth > innerWidth + 1,
        sidebar: {
          position: cs.position, width: Math.round(r.width), height: Math.round(r.height),
          left: Math.round(r.left), top: Math.round(r.top),
          visibility: cs.visibility, transform: cs.transform, zIndex: cs.zIndex,
          maxWidth: cs.maxWidth, overflowY: cs.overflowY,
          linkColor: link ? getComputedStyle(link).color : null,
        },
        toggle: toggle ? { display: getComputedStyle(toggle).display, zIndex: getComputedStyle(toggle).zIndex } : null,
        bodyOverflow: getComputedStyle(document.body).overflow,
      };
    })()`);

    const record = { closed: state, lightShot: await shot(`dash-${label}-light`) };

    if (w <= 768) {
      record.toggleOpened = await openDrawer();
      await sleep(450);
      record.open = await evalJs(`(() => {
        const sb = document.querySelector('.sidebar');
        const cs = getComputedStyle(sb);
        const r = sb.getBoundingClientRect();
        const bd = document.querySelector('.sidebar-backdrop');
        const cl = document.querySelector('.sidebar-close');
        const cr = cl.getBoundingClientRect();
        const toggle = document.querySelector('.sidebar-toggle');
        return {
          ratio: +((r.width / innerWidth).toFixed(3)),
          left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height),
          visibility: cs.visibility, transform: cs.transform, zIndex: cs.zIndex,
          backdrop: bd ? { display: getComputedStyle(bd).display, zIndex: getComputedStyle(bd).zIndex, bg: getComputedStyle(bd).backgroundColor } : null,
          close: { display: getComputedStyle(cl).display, w: Math.round(cr.width), h: Math.round(cr.height), inViewport: cr.left >= 0 && cr.right <= innerWidth, label: cl.getAttribute('aria-label') },
          toggleDisplay: toggle ? getComputedStyle(toggle).display : null,
          bodyOverflow: getComputedStyle(document.body).overflow,
          activeIsClose: document.activeElement === cl,
          role: sb.getAttribute('role'), ariaModal: sb.getAttribute('aria-modal'),
          navScrollable: (() => { const n = document.querySelector('.sidebar-nav'); return n ? { scrollH: n.scrollHeight, clientH: n.clientHeight, overflowY: getComputedStyle(n).overflowY } : null; })(),
          docScrollWidth: document.documentElement.scrollWidth,
        };
      })()`);
      record.openShot = await shot(`dash-${label}-drawer-open-light`);

      // Escape
      await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      await sleep(400);
      record.afterEscape = await evalJs(`({ open: document.querySelector('.sidebar').classList.contains('open'), bodyOverflow: getComputedStyle(document.body).overflow, toggleDisplay: getComputedStyle(document.querySelector('.sidebar-toggle')).display })`);

      // Overlay click
      await openDrawer();
      await sleep(300);
      record.backdropExists = await evalJs(`!!document.querySelector('.sidebar-backdrop')`);
      if (record.backdropExists) {
        await evalJs(`document.querySelector('.sidebar-backdrop').click()`);
        await sleep(400);
      }
      record.afterBackdrop = await evalJs(`({ open: document.querySelector('.sidebar').classList.contains('open'), bodyOverflow: getComputedStyle(document.body).overflow })`);
    }

    // Dark mode
    await evalJs(`document.documentElement.dataset.theme = 'dark'; localStorage.setItem('ciperna-theme','dark');`);
    await sleep(200);
    record.dark = await evalJs(`(() => {
      const de = document.documentElement;
      const sb = document.querySelector('.sidebar');
      const link = document.querySelector('.sidebar-link');
      return { overflowX: de.scrollWidth > innerWidth + 1, linkColor: link ? getComputedStyle(link).color : null, bg: getComputedStyle(document.body).backgroundColor };
    })()`);
    record.darkShot = await shot(`dash-${label}-dark`);

    // Landing page overflow
    await goto('http://localhost:3000/');
    record.landing = await evalJs(`({ scrollWidth: document.documentElement.scrollWidth, innerWidth, overflowX: document.documentElement.scrollWidth > innerWidth + 1 })`);

    results[label] = record;
    await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
  }

  // ---- Halaman tambahan: tabel, statistik, dan chatbot ----
  results.pages = {};
  for (const [w, h] of [[320, 640], [390, 844], [768, 1024], [1366, 768]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
    results.pages[w] = {};
    for (const p of ['/admin/masyarakat', '/admin/laporan', '/admin/statistik', '/admin/asisten']) {
      await goto('http://localhost:3000' + p);
      await evalJs(`document.documentElement.dataset.theme='light'; localStorage.setItem('ciperna-theme','light')`);
      await sleep(250);
      results.pages[w][p] = await evalJs(`(() => {
        const de = document.documentElement;
        const tables = [...document.querySelectorAll('table')].map(t => {
          const wrap = t.parentElement;
          const cw = wrap ? getComputedStyle(wrap) : null;
          return {
            tableW: Math.round(t.getBoundingClientRect().width),
            wrapW: wrap ? Math.round(wrap.getBoundingClientRect().width) : null,
            wrapOverflowX: cw ? cw.overflowX : null,
          };
        });
        return { overflowX: de.scrollWidth > innerWidth + 1, scrollWidth: de.scrollWidth, innerWidth, tables };
      })()`);
      if (w === 320 || w === 1366) {
        results.pages[w][p + ':shot'] = await shot(`page-${w}-${p.replace(/\//g, '_')}-light`);
      }
    }
    await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
  }

  // Chatbot di layar 320 (tidak boleh keluar viewport / menutupi navigasi)
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
  await goto('http://localhost:3000/admin/dashboard');
  for (let i = 0; i < 8; i++) {
    const open = await evalJs(`!!document.querySelector('.chatbot-panel')`);
    if (open) break;
    await evalJs(`document.querySelector('.chatbot-fab')?.click()`);
    await sleep(350);
  }
  await sleep(300);
  results.chatbot320 = await evalJs(`(() => {
    const p = document.querySelector('.chatbot-panel');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      left: Math.round(r.left), right: Math.round(r.right),
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      inVP: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
      docOverflowX: document.documentElement.scrollWidth > innerWidth + 1,
    };
  })()`);
  results.chatbot320Shot = await shot('chatbot-320');

  // ---- Uji AI live (endpoint nyata) ----
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await goto('http://localhost:3000/admin/dashboard');
  results.ai = await evalJs(`(async () => {
    const ask = async (message, history) => {
      const r = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, history: history || [] }),
      });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, answer: (j.answer || j.reply || j.error || '').slice(0, 700), tools: j.toolsUsed || j.tools || j.meta || null, keys: Object.keys(j) };
    };
    const a1 = await ask('siapa yg baru regis hari ini?');
    const a2 = await ask('kalau kemarin?', [
      { role: 'user', content: 'siapa yg baru regis hari ini?' },
      { role: 'assistant', content: a1.answer },
    ]);
    const a3 = await ask('tadi ada warga daftar ga?');
    const a4 = await ask('siapa user terakhir yang bikin akun?');
    return { a1, a2, a3, a4 };
  })()`);
} catch (e) {
  results.error = String(e && e.stack ? e.stack : e);
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log(JSON.stringify({ out: OUT, error: results.error || null }, null, 2));
}

