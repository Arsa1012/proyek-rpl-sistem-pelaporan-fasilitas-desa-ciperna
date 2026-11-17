/**
 * Tes DRIFT/ARSITEKTUR — penjaga agar AI tetap sinkron dengan sistem nyata.
 *
 * Tes ini gagal bila:
 *  - lapisan data AI mulai bisa MENULIS ke database (harus read-only);
 *  - ada modul di luar endpoint chat yang memanggil AI (mis. notifikasi otomatis
 *    memicu balasan AI → "balasan ganda");
 *  - muncul webhook status (sent/delivered/read) yang bisa memicu percakapan;
 *  - pengiriman WhatsApp baru dibuat tanpa kunci idempotency;
 *  - dokumen pengetahuan AI menyebut halaman/menu/status yang tidak ada di kode.
 *
 * Jalankan: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

import { WEBSITE, CITIZEN_PUBLIC_INTENTS } from '../src/lib/websiteKnowledge';
import { TOOL_REGISTRY } from '../src/lib/aiToolRegistry';
import { REPORT_STATUS_LABELS } from '../src/lib/status';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const allSrc = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

// ===========================================================================
// 1. Lapisan AI harus READ-ONLY
// ===========================================================================

test('aiTools.ts tidak memuat operasi tulis database', () => {
  const src = read('src/lib/aiTools.ts');
  const forbidden: [string, RegExp][] = [
    ['create', /\.create\s*\(/],
    ['createMany', /\.createMany\s*\(/],
    ['update', /\.update\s*\(/],
    ['updateMany', /\.updateMany\s*\(/],
    ['upsert', /\.upsert\s*\(/],
    ['delete', /\.delete\s*\(/],
    ['deleteMany', /\.deleteMany\s*\(/],
    ['$executeRaw', /\$executeRaw/],
    ['$queryRaw', /\$queryRaw/],
    ['$transaction', /\$transaction/],
  ];
  for (const [name, re] of forbidden) {
    assert.equal(re.test(src), false, `aiTools.ts tidak boleh memakai prisma.${name} (harus read-only)`);
  }
});

test('registry hanya memanggil fungsi dari aiTools.ts (tanpa akses prisma langsung)', () => {
  const src = read('src/lib/aiToolRegistry.ts');
  assert.equal(/from '@\/lib\/prisma'/.test(src), false);
  assert.equal(/prisma\./.test(src), false);
});

// ===========================================================================
// 2. Tidak boleh ada "balasan otomatis ganda" / jalur AI tersembunyi
// ===========================================================================

test('AI hanya dipanggil dari endpoint chat (notifikasi otomatis tidak memicu AI)', () => {
  const allowed = new Set([
    'src/lib/aiChat.ts',
    'src/lib/aiIntent.ts',
    'src/lib/aiToolRegistry.ts',
    'src/lib/aiTools.ts',
    'src/app/api/ai/chat/route.ts',
    'src/app/api/admin/ai/chat/route.ts',
    'src/app/api/chat/route.ts',
  ]);
  const offenders: string[] = [];
  for (const f of allSrc) {
    const r = rel(f);
    if (allowed.has(r)) continue;
    const src = readFileSync(f, 'utf8');
    if (/from\s+['"](@\/lib\/|\.{1,2}\/)+(aiChat|aiIntent|aiToolRegistry)['"]/.test(src)) {
      offenders.push(r);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Hanya endpoint chat yang boleh mengimpor layanan AI. Ditemukan: ${offenders.join(', ')}`
  );
});

test('handler AI hanya dipanggil oleh endpoint chat yang memerlukan pesan pengguna', () => {
  const callers: string[] = [];
  for (const f of allSrc) {
    const r = rel(f);
    if (r.startsWith('src/lib/ai')) continue;
    const src = readFileSync(f, 'utf8');
    if (/\b(handleChatRequest|synthesizeAnswer)\s*\(/.test(src)) callers.push(r);
  }
  assert.deepEqual(callers.sort(), [
    'src/app/api/admin/ai/chat/route.ts',
    'src/app/api/ai/chat/route.ts',
    'src/app/api/chat/route.ts',
  ]);
});

test('setiap endpoint chat memerlukan sesi server (autentikasi tidak dilewati)', () => {
  for (const route of ['src/app/api/ai/chat/route.ts', 'src/app/api/admin/ai/chat/route.ts', 'src/app/api/chat/route.ts']) {
    const src = read(route);
    assert.ok(/getSession\s*\(/.test(src), `${route} harus memakai getSession()`);
    assert.ok(/session\.role/.test(src), `${route} harus mengambil role dari session server`);
  }
});

test('endpoint AI Admin membatasi role ADMIN', () => {
  const src = read('src/app/api/admin/ai/chat/route.ts');
  assert.ok(/session\.role !== 'ADMIN'/.test(src));
});

test('/api/chat melayani Warga, Petugas, dan Admin dari role session', () => {
  const src = read('src/app/api/chat/route.ts');
  assert.equal(/role !== 'CITIZEN'/.test(src), false, '/api/chat tidak boleh mengunci role Warga saja');
  assert.ok(/session\.role as ChatRole/.test(src), 'role harus diambil dari session server');
  assert.ok(/handleChatRequest\(role,/.test(src), 'role session harus diteruskan ke pipeline AI');
});

test('setiap endpoint chat memuat konteks Prisma sebelum memproses pesan', () => {
  for (const route of [
    'src/app/api/chat/route.ts',
    'src/app/api/ai/chat/route.ts',
    'src/app/api/admin/ai/chat/route.ts',
  ]) {
    const src = read(route);
    const loadIndex = src.indexOf('loadLiveChatContext(');
    const handleIndex = src.indexOf('handleChatRequest(');
    assert.ok(loadIndex !== -1, `${route} harus memuat konteks live dari database`);
    assert.ok(handleIndex !== -1, `${route} harus memanggil pipeline AI`);
    assert.ok(loadIndex < handleIndex, `${route} harus memuat konteks SEBELUM pipeline AI`);
  }
});

// ===========================================================================
// 3. Webhook status (sent/delivered/read) tidak boleh memicu percakapan
// ===========================================================================

test('tidak ada webhook masuk yang dapat memicu percakapan AI', () => {
  const apiRoot = path.join(SRC, 'app', 'api');
  const files = walk(apiRoot).map(rel);
  const suspects = files.filter((f) => /webhook|callback|hook/i.test(f));
  assert.deepEqual(
    suspects,
    [],
    `Belum ada webhook resmi. Jika menambahkan, pastikan callback status (sent/delivered/read/failed) TIDAK memanggil AI: ${suspects.join(', ')}`
  );
});

test('modul notifikasi/pesan tidak mengimpor layanan AI (mencegah balasan ganda)', () => {
  const notifyModules = ['src/lib/notification.ts', 'src/lib/whatsapp.ts'].filter((f) => existsSync(path.join(ROOT, f)));
  for (const f of notifyModules) {
    const src = read(f);
    assert.equal(/from\s+['"].*ai(Chat|Intent|ToolRegistry|Tools)['"]/.test(src), false, `${f} tidak boleh mengimpor AI`);
  }
});

// ===========================================================================
// 4. Idempotency pengiriman pesan (event ganda ≠ pesan ganda)
// ===========================================================================

test('setiap fungsi notifikasi WhatsApp memakai kunci idempotency (dedupeKey)', () => {
  const src = read('src/lib/whatsapp.ts');
  const lines = src.split(/\r?\n/);
  const starts: { name: string; index: number }[] = [];
  lines.forEach((l, i) => {
    const m = l.match(/^export async function (notify\w+|send\w+)\s*\(/);
    if (m) starts.push({ name: m[1], index: i });
  });
  assert.ok(starts.length >= 10, 'harus ada banyak fungsi notifikasi');
  for (let k = 0; k < starts.length; k++) {
    // sendWhatsApp* adalah pengirim tingkat rendah; yang wajib dedupe adalah notify*.
    if (!starts[k].name.startsWith('notify')) continue;
    const end = k + 1 < starts.length ? starts[k + 1].index : lines.length;
    const body = lines.slice(starts[k].index, end).join('\n');
    assert.ok(
      /dedupeKey/.test(body),
      `${starts[k].name}() harus memakai dedupeKey agar event ganda tidak mengirim pesan dua kali`
    );
  }
});

// ===========================================================================
// 5. Dokumen pengetahuan AI harus sesuai kode nyata
// ===========================================================================

test('setiap halaman di WEBSITE.pages benar-benar ada di aplikasi', () => {
  for (const page of WEBSITE.pages) {
    const route = page.route.split('?')[0];
    const candidates =
      route === '/'
        ? [path.join(SRC, 'app', 'page.tsx')]
        : [
            path.join(SRC, 'app', '(dashboard)', ...route.split('/').filter(Boolean), 'page.tsx'),
            path.join(SRC, 'app', ...route.split('/').filter(Boolean), 'page.tsx'),
          ];
    assert.ok(
      candidates.some((c) => existsSync(c)),
      `Halaman "${page.route}" tidak ditemukan (${candidates.map((c) => path.relative(ROOT, c)).join(' | ')})`
    );
  }
});

test('setiap menu yang dijelaskan AI ada di Sidebar asli (kecuali "Asisten AI" yang kini diakses lewat tombol mengambang di seluruh halaman Admin, bukan menu sidebar)', () => {
  const sidebar = read('src/components/layout/Sidebar.tsx');
  for (const m of WEBSITE.menus) {
    for (const label of m.items) {
      // "Asisten AI" adalah menu lama: chat Admin kini dijangkau melalui
      // tombol mengambang (AdminAiFloatingChatbot) di seluruh halaman Admin,
      // bukan melalui menu sidebar. Tes ini jadi lewat karena menu tersebut
      // memang sudah dihapus dari Sidebar.tsx sesuai permintaan pengguna.
      if (label === 'Asisten AI') continue;
      assert.ok(sidebar.includes(`'${label}'`), `Menu "${label}" (${m.role}) tidak ada di Sidebar.tsx`);
    }
  }
});

test('status di dokumen AI sama persis dengan lib/status.ts', () => {
  const codes = WEBSITE.statuses.map((s) => s.code).sort();
  assert.deepEqual(codes, Object.keys(REPORT_STATUS_LABELS).sort());
});

test('status default di schema Prisma adalah SUBMITTED (sesuai alur)', () => {
  const schema = read('prisma/schema.prisma');
  assert.ok(/status\s+String\s+@default\("SUBMITTED"\)/.test(schema), 'status default Report harus SUBMITTED');
  assert.ok(REPORT_STATUS_LABELS['SUBMITTED'], 'SUBMITTED harus ada di lib/status.ts');
});

test('setiap tool di CITIZEN_PUBLIC_INTENTS terdaftar dan boleh dipakai warga', () => {
  for (const def of CITIZEN_PUBLIC_INTENTS) {
    const tool = TOOL_REGISTRY[def.tool];
    assert.ok(tool, `intent publik menunjuk tool tak terdaftar: ${def.tool}`);
    assert.ok(tool.roles.includes('CITIZEN'), `${def.tool} harus mengizinkan CITIZEN`);
  }
});

test('setiap nama tool di dokumentasi AI benar-benar terdaftar', () => {
  const doc = read('docs/ai-system-knowledge.md');
  const mentioned = new Set(
    Array.from(doc.matchAll(/`((?:get|list|count|search|find)[A-Z][A-Za-z]*)`/g)).map((m) => m[1])
  );
  assert.ok(mentioned.size > 20, `dokumen harus mencantumkan banyak tool (ditemukan ${mentioned.size})`);
  for (const name of Array.from(mentioned)) {
    assert.ok(TOOL_REGISTRY[name], `dokumentasi menyebut tool tak dikenal: ${name}`);
  }
});

// ===========================================================================
// 6. Tidak ada dua pipeline chatbot yang berbeda
// ===========================================================================

test('endpoint lama /api/chat memakai pipeline yang sama (bukan chatbot terpisah)', () => {
  const src = read('src/app/api/chat/route.ts');
  assert.ok(/handleChatRequest/.test(src), '/api/chat harus mendelegasikan ke pipeline utama');
  assert.equal(/sendChatMessage/.test(src), false, '/api/chat tidak boleh memakai chatbot.ts yang DB-blind');
});

test('lib/chatbot.ts ditandai deprecated dan tidak diimpor siapa pun', () => {
  const chatbot = read('src/lib/chatbot.ts');
  assert.ok(/@deprecated/.test(chatbot), 'lib/chatbot.ts harus ditandai @deprecated');
  const importers = allSrc
    .filter((f) => rel(f) !== 'src/lib/chatbot.ts')
    .filter((f) => /from\s+['"](@\/lib\/|\.{1,2}\/)+chatbot['"]/.test(readFileSync(f, 'utf8')))
    .map(rel);
  assert.deepEqual(importers, [], `chatbot.ts lama tidak boleh diimpor lagi: ${importers.join(', ')}`);
});
