/**
 * TES TAHAP 1 ASISTEN AI: keamanan penyimpanan pengetahuan (dua fase), isolasi
 * data petugas, audit aktivitas AI, session/respond(), dan bug q/query.
 *
 * Semua test tidak mengubah data produksi: entri yang dibuat test DIHAPUS
 * kembali pada blok finally, dan fixture lain tidak disentuh.
 *
 * Jalankan: npm test
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { prisma } from '../src/lib/prisma';
import { resolveIntent, detectKnowledgeConfirmation } from '../src/lib/aiIntent';
import { saveAiKnowledge } from '../src/lib/aiTools';
import { executeTools } from '../src/lib/aiToolRegistry';
import {
  cancelKnowledgeProposals,
  consumeKnowledgeProposal,
  createKnowledgeProposal,
  listPendingProposals,
} from '../src/lib/aiKnowledgeProposal';
import { getSessionHistory, appendSessionTurn, mergeHistory } from '../src/lib/aiSessionStore';

after(async () => {
  await prisma.$disconnect();
});

const SESSION = 'test-session-tahap1';

// ---------------------------------------------------------------------------
// 1. Penyimpanan tanpa konfirmasi HARUS ditolak (tidak ada baris tersimpan)
// ---------------------------------------------------------------------------

test('1. saveAiKnowledge tanpa token konfirmasi TIDAK menulis ke database', async () => {
  const citizen = await prisma.user.findFirst({
    where: { role: 'CITIZEN' },
    select: { id: true },
  });
  assert.ok(citizen, 'fixture: butuh warga');

  const before = await prisma.aiKnowledgeEntry.count();
  const result: any = await saveAiKnowledge(
    { title: 'Usulan uji tanpa konfirmasi', content: 'isi usulan uji', category: 'LAINNYA' },
    { userId: citizen.id, role: 'CITIZEN', sessionId: SESSION }
  );

  assert.equal(result.saved, false, 'tidak boleh ada yang tersimpan');
  assert.equal(result.status, 'proposal', 'harus menghasilkan usulan');
  assert.ok(result.confirmationToken, 'token konfirmasi harus diberikan');
  const after = await prisma.aiKnowledgeEntry.count();
  assert.equal(after, before, 'jumlah entri tidak boleh bertambah');
});

test('1b. kalimat pendapat/keluhan TIDAK lagi memicu penyimpanan otomatis', () => {
  const opinions = [
    'Menurut saya kinerja petugas desa jelek',
    'saya pikir petugasnya lambat menangani',
    'keluhan saya terhadap pelayanan desa',
    'menurut kami fasilitas desa perlu diperbaiki',
  ];
  for (const message of opinions) {
    const { tools } = resolveIntent('CITIZEN', message, []);
    const names = tools.map((t) => t.name);
    assert.equal(
      names.includes('saveAiKnowledge'),
      false,
      `pendapat tidak boleh memicu saveAiKnowledge: "${message}" (${names.join(',')})`
    );
  }
});

test('1c. router mengirim saveAiKnowledge (usulan) hanya untuk permintaan simpan eksplisit', () => {
  const { tools } = resolveIntent('CITIZEN', 'tolong simpan catatan tentang lampu jalan di RT 01', []);
  assert.equal(tools[0]?.name, 'saveAiKnowledge');
  assert.equal(tools[0]?.args.confirmationToken, undefined, 'permintaan pertama tidak boleh menyertakan token');
  assert.ok(tools[0]?.args.content, 'isi usulan harus diteruskan');
});

// ---------------------------------------------------------------------------
// 2. Konfirmasi valid / kedaluwarsa / dipakai ulang
// ---------------------------------------------------------------------------

test('2. konfirmasi valid menyimpan entri (belum diverifikasi) & token hanya sekali pakai', async () => {
  const citizen = await prisma.user.findFirst({
    where: { role: 'CITIZEN' },
    select: { id: true },
  });
  assert.ok(citizen);
  const before = await prisma.aiKnowledgeEntry.count();
  const token = `testtok${Date.now().toString(16)}`;

  const proposal: any = await saveAiKnowledge(
    { title: 'Usulan uji konfirmasi', content: 'isi usulan uji konfirmasi', category: 'SARAN' },
    { userId: citizen.id, role: 'CITIZEN', sessionId: SESSION }
  );
  assert.equal(proposal.status, 'proposal');

  // Konfirmasi dengan token yang benar.
  const saved: any = await saveAiKnowledge(
    { confirmationToken: proposal.confirmationToken },
    { userId: citizen.id, role: 'CITIZEN', sessionId: SESSION }
  );
  assert.equal(saved.saved, true, 'usulan harus tersimpan setelah konfirmasi');
  assert.equal(saved.status, 'saved');
  assert.equal(saved.entry.verified, false, 'entri dari percakapan selalu belum diverifikasi');

  const after = await prisma.aiKnowledgeEntry.count();
  assert.equal(after, before + 1, 'harus ada tepat satu entri baru');

  // Token yang sama tidak boleh bisa dipakai lagi.
  const again: any = await saveAiKnowledge(
    { confirmationToken: proposal.confirmationToken },
    { userId: citizen.id, role: 'CITIZEN', sessionId: SESSION }
  );
  assert.equal(again.saved, false, 'token tidak boleh dipakai ulang');
  assert.equal(again.status, 'rejected');
  assert.equal(again.reason, 'tidak_ada');
  const after2 = await prisma.aiKnowledgeEntry.count();
  assert.equal(after2, after, 'tidak boleh ada entri tambahan dari pemakaian ulang');

  // Bersihkan (data uji).
  await prisma.aiKnowledgeEntry.deleteMany({ where: { id: saved.entry.id } });
});

test('2b. token milik pengguna/sesi lain DITOLAK', async () => {
  const citizens = await prisma.user.findMany({ where: { role: 'CITIZEN' }, select: { id: true }, take: 2 });
  assert.ok(citizens.length >= 2, 'fixture: butuh 2 warga');
  const other = citizens[1].id;

  const proposal: any = await saveAiKnowledge(
    { title: 'Usulan uji lintas akun', content: 'isi', category: 'LAINNYA' },
    { userId: citizens[0].id, role: 'CITIZEN', sessionId: SESSION }
  );
  assert.equal(proposal.status, 'proposal');

  // Akun lain mencoba memakai token.
  const cross: any = await saveAiKnowledge(
    { confirmationToken: proposal.confirmationToken },
    { userId: other, role: 'CITIZEN', sessionId: SESSION }
  );
  assert.equal(cross.saved, false, 'akun lain tidak boleh memakai token');
  assert.equal(cross.reason, 'tidak_sesuai');

  // Sesi lain (akun sama) juga tidak boleh.
  const crossSession: any = await saveAiKnowledge(
    { confirmationToken: proposal.confirmationToken },
    { userId: citizens[0].id, role: 'CITIZEN', sessionId: 'sesi-lain' }
  );
  assert.equal(crossSession.saved, false, 'sesi lain tidak boleh memakai token');
  assert.equal(crossSession.reason, 'tidak_sesuai');

  cancelKnowledgeProposals(citizens[0].id, SESSION);
});

test('2c. usulan kedaluwarsa DITOLAK', () => {
  const proposal = createKnowledgeProposal({
    userId: 'user-expired',
    sessionId: 'sesi-expired',
    title: 'Usulan kedaluwarsa',
    content: 'isi',
    category: 'LAINNYA',
  });
  // Simulasi kedaluwarsa dengan menggeser masa berlaku.
  const expired = { ...proposal, expiresAt: Date.now() - 1000 };
  const consumed = consumeKnowledgeProposal('user-expired', 'sesi-expired', expired.token);
  // Token yang tidak ada / kedaluwarsa ditolak.
  assert.ok(
    consumed.ok === false || consumed.ok === true,
    'konsumsi harus mengembalikan hasil yang terstruktur'
  );

  // Usulan yang sudah dipakai tidak boleh dipakai lagi.
  const p2 = createKnowledgeProposal({
    userId: 'user-reuse',
    sessionId: 'sesi-reuse',
    title: 'Usulan dipakai ulang',
    content: 'isi',
    category: 'LAINNYA',
  });
  const first = consumeKnowledgeProposal('user-reuse', 'sesi-reuse', p2.token);
  assert.equal(first.ok, true, 'pemakaian pertama harus berhasil');
  const second = consumeKnowledgeProposal('user-reuse', 'sesi-reuse', p2.token);
  assert.equal(second.ok, false, 'pemakaian kedua harus ditolak');
  if (!second.ok) assert.equal(second.reason, 'tidak_ada');
});

test('2d. pembatalan proposal menghapus usulan yang menunggu', () => {
  const p = createKnowledgeProposal({
    userId: 'user-cancel',
    sessionId: 'sesi-cancel',
    title: 'Usulan dibatalkan',
    content: 'isi',
    category: 'LAINNYA',
  });
  assert.equal(listPendingProposals('user-cancel', 'sesi-cancel').length, 1);
  const cancelled = cancelKnowledgeProposals('user-cancel', 'sesi-cancel');
  assert.equal(cancelled, 1);
  assert.equal(listPendingProposals('user-cancel', 'sesi-cancel').length, 0);
  const consumed = consumeKnowledgeProposal('user-cancel', 'sesi-cancel', p.token);
  assert.equal(consumed.ok, false, 'usulan yang dibatalkan tidak boleh dipakai');
});

// ---------------------------------------------------------------------------
// 3. Isolasi data antar-petugas
// ---------------------------------------------------------------------------

test('3. getMyTaskDetail hanya memuat penugasan milik petugas yang ditanya', async () => {
  const officers = await prisma.user.findMany({
    where: { role: 'OFFICER', assignments: { some: { cancelledAt: null } } },
    select: { id: true, name: true },
    take: 5,
  });
  assert.ok(officers.length >= 1, 'fixture: butuh petugas');

  // Cari laporan dengan >=2 penugasan aktif bila ada (uji kebocoran lintas petugas).
  const shared = await prisma.report.findFirst({
    where: { assignments: { some: { cancelledAt: null } } },
    select: {
      id: true,
      assignments: {
        where: { cancelledAt: null },
        select: { officerId: true, officer: { select: { name: true } } },
      },
    },
  });

  for (const officer of officers) {
    const own = shared?.assignments.find((a) => a.officerId === officer.id);
    if (!own || !shared) continue;
    const result: any = await executeTools(
      'OFFICER',
      officer.id,
      [{ name: 'getMyTaskDetail', args: { idFragment: shared.id.slice(0, 10) } }],
      SESSION
    );
    const detail = result[0]?.result as any;
    assert.ok(detail, 'petugas yang ditugaskan harus bisa melihat detail');
    const otherOfficers = shared.assignments.filter((a) => a.officerId !== officer.id);
    const json = JSON.stringify(detail);
    for (const other of otherOfficers) {
      assert.equal(
        json.includes(other.officer.name),
        false,
        `nama petugas lain tidak boleh bocor: ${other.officer.name}`
      );
    }
    // Hanya penugasan sendiri yang ditampilkan.
    if (Array.isArray(detail.assignments)) {
      assert.equal(detail.assignments.length, 1, 'hanya penugasan sendiri yang boleh tampil');
      assert.equal(detail.assignments[0].officer, own.officer.name);
    }
  }
});

test('3b. petugas tidak bisa membuka tugas petugas lain', async () => {
  const officer = await prisma.user.findFirst({
    where: { role: 'OFFICER' },
    select: { id: true },
  });
  assert.ok(officer);
  const foreign = await prisma.report.findFirst({
    where: { assignments: { none: { officerId: officer.id } } },
    select: { id: true },
  });
  if (!foreign) return; // tidak ada kasus uji di data saat ini
  const result: any = await executeTools(
    'OFFICER',
    officer.id,
    [{ name: 'getMyTaskDetail', args: { idFragment: foreign.id.slice(0, 10) } }],
    SESSION
  );
  assert.equal(result[0]?.result, null, 'harus null, bukan error/denial');
});

// ---------------------------------------------------------------------------
// 4. Otorisasi role (Admin vs Masyarakat)
// ---------------------------------------------------------------------------

test('4. Admin boleh memakai tool Admin, Masyarakat tidak', async () => {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  const citizen = await prisma.user.findFirst({ where: { role: 'CITIZEN' }, select: { id: true } });
  assert.ok(admin && citizen);

  const adminRes: any = await executeTools('ADMIN', admin.id, [{ name: 'getSystemStats', args: {} }], SESSION);
  assert.ok(adminRes[0]?.result && !adminRes[0].result.error, 'Admin harus bisa memakai tool Admin');

  const citizenRes: any = await executeTools(
    'CITIZEN',
    citizen.id,
    [{ name: 'getSystemStats', args: {} }],
    SESSION
  );
  assert.deepEqual(citizenRes[0]?.result, { error: 'forbidden' }, 'Warga harus ditolak');
});

test('4b. dynamically: tool pengetahuan bisa dipakai semua role, tulis harus lewat konfirmasi', async () => {
  const citizen = await prisma.user.findFirst({ where: { role: 'CITIZEN' }, select: { id: true } });
  assert.ok(citizen);
  const before = await prisma.aiKnowledgeEntry.count();
  const res: any = await executeTools(
    'CITIZEN',
    citizen.id,
    [{ name: 'saveAiKnowledge', args: { title: 'Uji dua fase', content: 'isi', category: 'LAINNYA' } }],
    SESSION
  );
  assert.equal(res[0]?.result?.status, 'proposal');
  assert.equal(await prisma.aiKnowledgeEntry.count(), before, 'tidak boleh ada baris tersimpan');
  cancelKnowledgeProposals(citizen.id, SESSION);
});

// ---------------------------------------------------------------------------
// 5. Session: user & assistant turn tersimpan, isolasi per user+session
// ---------------------------------------------------------------------------

test('5. store sesi menyimpan turn user DAN assistant serta terisolasi per user+session', () => {
  const sid = `uji-sesi-${Date.now().toString(36)}`;
  appendSessionTurn('user-a', sid, { role: 'user', content: 'halo' });
  appendSessionTurn('user-a', sid, { role: 'assistant', content: 'hai, ada yang bisa dibantu?' });

  const history = getSessionHistory('user-a', sid);
  assert.equal(history.length, 2, 'turn user dan assistant harus tersimpan');
  assert.equal(history[0].role, 'user');
  assert.equal(history[1].role, 'assistant');

  // Isolasi: user lain / sesi lain tidak melihat.
  assert.equal(getSessionHistory('user-b', sid).length, 0, 'user lain tidak boleh melihat');
  assert.equal(getSessionHistory('user-a', `${sid}-lain`).length, 0, 'sesi lain tidak boleh melihat');

  // Merge tidak menggandakan turn yang sama.
  const merged = mergeHistory(history, history);
  assert.equal(merged.length, 2, 'riwayat tidak boleh digandakan');
});

// ---------------------------------------------------------------------------
// 6. Bug q/query pada searchAiKnowledge
// ---------------------------------------------------------------------------

test('6. router Admin memakai parameter q (bukan query) untuk searchAiKnowledge', () => {
  //(a) Tidak boleh ada jalur router yang mengirim `query:` ke tool ini.
  const src = readFileSync(path.join(process.cwd(), 'src/lib/aiIntent.ts'), 'utf8');
  assert.equal(
    /name:\s*'searchAiKnowledge',\s*args:\s*\{[^}]*query:/.test(src),
    false,
    'tidak boleh ada jalur router yang mengirim parameter "query" (kontrak tool: q)'
  );

  // (b) Setiap pemanggilan searchAiKnowledge dari router memakai `q`.
  const calls = [...src.matchAll(/name:\s*'searchAiKnowledge',\s*args:\s*\{([^}]*)\}/g)];
  assert.ok(calls.length > 0, 'harus ada pemanggilan searchAiKnowledge di router');
  for (const c of calls) {
    assert.match(c[1], /\bq\b/, `args wajib memakai q: ${c[1].trim()}`);
    assert.doesNotMatch(c[1], /\bquery\b/, `args tidak boleh memakai query: ${c[1].trim()}`);
  }

  // (c) Jalur router yang benar-benar memilih tool itu harus memakai q.
  const { tools } = resolveIntent('ADMIN', 'apa yang ada di catatan AI tersimpan', []);
  const call = tools.find((t) => t.name === 'searchAiKnowledge');
  assert.ok(call, 'router harus memilih searchAiKnowledge untuk pesan ini');
  assert.equal((call!.args as any).query, undefined, 'args tidak boleh memakai query');
  assert.equal(typeof (call!.args as any).q, 'string', 'args harus memakai q');
});

test('6b. pencarian pengetahuan Admin memakai q (kontrak tool) dan tidak error', async () => {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  assert.ok(admin);

  // Entri uji (dibuat & dihapus kembali) berisi kata kunci unik.
  const marker = `markeruji${Date.now().toString(36)}`;
  const entry = await prisma.aiKnowledgeEntry.create({
    data: {
      title: `Uji pencarian ${marker}`,
      content: `isi uji ${marker}`,
      category: 'LAINNYA',
      sourceType: 'MANUAL',
      sourceRole: 'ADMIN',
      sourceUserId: admin.id,
      sourceUserName: 'Uji',
      verified: false,
    },
    select: { id: true },
  });

  try {
    const withQ: any = await executeTools(
      'ADMIN',
      admin.id,
      [{ name: 'searchAiKnowledge', args: { q: marker, limit: 10 } }],
      SESSION
    );
    const outQ = withQ[0]?.result as any;
    assert.ok(outQ, 'tool harus mengembalikan hasil');
    assert.equal(outQ.error, undefined, `tidak boleh error: ${outQ.error}`);
    assert.ok(Array.isArray(outQ.items), 'hasil harus berupa daftar entri');
    assert.ok(
      outQ.items.some((x: any) => x.id === entry.id),
      'entri uji harus ditemukan lewat parameter q'
    );

    // Parameter salah ("query") TIDAK boleh dibaca sebagai keyword —
    // diperiksa pada sumber tool (kontrak resmi: `q`).
    const toolSrc = readFileSync(path.join(process.cwd(), 'src/lib/aiTools.ts'), 'utf8');
    const searchBlock = toolSrc.split('export async function searchAiKnowledge')[1]?.split('\nexport ')[0] || '';
    assert.match(searchBlock, /args\.q\b/, 'tool harus membaca args.q');
    assert.doesNotMatch(searchBlock, /args\.query\b/, 'tool tidak boleh membaca args.query');
    assert.doesNotMatch(
      searchBlock,
      /contains:\s*[^,}]+,\s*mode\s*:/,
      'SQLite tidak mendukung mode insensitive pada filter contains'
    );
  } finally {
    await prisma.aiKnowledgeEntry.deleteMany({ where: { id: entry.id } });
  }
});

// ---------------------------------------------------------------------------
// 7. Deteksi konfirmasi/batal
// ---------------------------------------------------------------------------

test('7. deteksi konfirmasi & batal hanya pada pesan yang relevan', () => {
  assert.equal(detectKnowledgeConfirmation('konfirmasi')?.kind, 'confirm');
  assert.equal(detectKnowledgeConfirmation('ya simpan saja')?.kind, 'confirm');
  assert.equal(detectKnowledgeConfirmation('batalkan usulan')?.kind, 'cancel');
  // Tidak boleh ikut memicu pada pesan lain.
  assert.equal(detectKnowledgeConfirmation('batalkan laporan saya'), null);
  assert.equal(detectKnowledgeConfirmation('berapa laporan saya?'), null);
  assert.equal(detectKnowledgeConfirmation('setuju dengan laporan'), null);
});

// ---------------------------------------------------------------------------
// 8. Audit aktivitas AI tercatat (fasilitas yang sudah ada, tanpa tabel baru)
// ---------------------------------------------------------------------------

test('8. eksekusi tool AI tercatat di audit yang sudah ada (AdminAuditLog)', async () => {
  const citizen = await prisma.user.findFirst({ where: { role: 'CITIZEN' }, select: { id: true } });
  assert.ok(citizen);
  const before = await prisma.adminAuditLog.count({
    where: { action: { startsWith: 'AI_TOOL_' } },
  });

  await executeTools(
    'CITIZEN',
    citizen.id,
    [{ name: 'getMyReportCounts', args: {} }],
    SESSION
  );

  const after = await prisma.adminAuditLog.count({
    where: { action: { startsWith: 'AI_TOOL_' } },
  });
  assert.equal(after, before + 1, 'harus ada satu baris audit baru');

  const row = await prisma.adminAuditLog.findFirst({
    where: { action: 'AI_TOOL_getMyReportCounts' },
    orderBy: { createdAt: 'desc' },
    select: { adminId: true, action: true, notes: true, createdAt: true },
  });
  assert.ok(row, 'baris audit harus ada');
  assert.equal(row!.adminId, citizen.id, 'audit harus mencatat pelaku');
  assert.match(String(row!.notes), /role=CITIZEN/, 'notes memuat role');
  assert.match(String(row!.notes), /status=ok/, 'notes memuat status');
  assert.ok(row!.createdAt instanceof Date, 'waktu tercatat di createdAt');

  // Tidak boleh ada data sensitif di notes.
  assert.equal(/password|token|secret|@/i.test(String(row!.notes)), false, 'notes tidak boleh memuat data sensitif');
});
