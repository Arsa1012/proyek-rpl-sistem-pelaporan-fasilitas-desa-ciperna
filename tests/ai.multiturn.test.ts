/**
 * Tes MULTI-TURN + ISOLASI SESI (Stage 3).
 *
 * Semua tes di file ini OFFLINE: tidak memanggil LLM, tidak memanggil
 * provider AI, dan tidak menyentuh database. Konteks live dan tool AI
 * diuji di file lain (ai.answer.test.ts dan ai.security.stage1.test.ts).
 *
 * Yang diuji:
 *  1. Pemahaman balasan singkat (affirmative / negative / continuation)
 *     berdasarkan pertanyaan assistant TERAKHIR - bukan keyword bebas.
 *  2. Balasan singkat yang TIDAK punya konteks tidak dianggap balasan.
 *  3. Isolasi riwayat per user DAN per sesi.
 *  4. Isolasi saat ROLE berubah: konteks lama milik role sebelumnya dibuang.
 *  5. Konsistensi batas giliran (CHAT_HISTORY_TURNS) di semua lapisan.
 *  6. Anti-duplikasi pesan terbaru.
 *
 * Jalankan: npm test  (atau npx tsx --test tests/ai.multiturn.test.ts)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyReplyTone,
  classifyAssistantQuestion,
  detectPendingReply,
  extractContext,
  resolveIntent,
  type ChatTurn,
} from '../src/lib/aiIntent';
import { detectChatIntent, parseHistory, formatShortReplyAnswer } from '../src/lib/aiChat';
import {
  getSessionHistory,
  appendSessionTurn,
  mergeHistory,
  clearSession,
  sanitizeSessionId,
} from '../src/lib/aiSessionStore';
import { CHAT_HISTORY_TURNS } from '../src/lib/aiTypes';

const user = (content: string): ChatTurn => ({ role: 'user', content });
const assistant = (content: string): ChatTurn => ({ role: 'assistant', content });

// ---------------------------------------------------------------------------
// 1. Pemahaman balasan singkat berdasarkan pertanyaan assistant terakhir
// ---------------------------------------------------------------------------

test('1a. balasan singkat dibaca berdasarkan pertanyaan assistant terakhir', () => {
  const openOffer = [user('Hai'), assistant('Selamat malam! Ada yang bisa saya bantu?')];
  const ctx = extractContext(openOffer);
  assert.equal(ctx.lastAssistantQuestionKind, 'open_offer', 'pertanyaan terakhir harus terdeteksi open_offer');

  const reply = detectPendingReply('Ada', ctx);
  assert.ok(reply, '"Ada" setelah tawaran bantuan harus menjadi balasan');
  assert.equal(reply!.tone, 'affirmative');
  assert.equal(reply!.questionKind, 'open_offer');
});

test('1b. negasi dikenali sebagai balasan, bukan pertanyaan baru', () => {
  const ctx = extractContext([user('Hai'), assistant('Ada yang bisa saya bantu?')]);
  const reply = detectPendingReply('tidak', ctx);
  assert.ok(reply);
  assert.equal(reply!.tone, 'negative');
});

test('1c. "tidak ada laporan" BUKAN balasan (bukan pesan pendek negatif)', () => {
  const ctx = extractContext([user('Hai'), assistant('Ada yang bisa saya bantu?')]);
  assert.equal(detectPendingReply('tidak ada laporan', ctx), null);
});

test('1d. "ada laporan?" (pertanyaan baru) BUKAN balasan', () => {
  const ctx = extractContext([user('Hai'), assistant('Ada yang bisa saya bantu?')]);
  assert.equal(detectPendingReply('ada laporan?', ctx), null);
});

test('1e. balasan singkat tanpa pertanyaan assistant sebelumnya TIDAK dianggap balasan', () => {
  const ctx = extractContext([user('Hai')]); // tidak ada giliran assistant
  assert.equal(ctx.lastAssistantQuestionKind, undefined);
  assert.equal(detectPendingReply('Ada', ctx), null, 'tanpa pertanyaan pending, "Ada" bukan balasan');
});

test('1f. assistant terakhir menjawab DATA (bukan bertanya) => balasan singkat tidak bermakna', () => {
  const ctx = extractContext([
    user('Berapa jumlah laporan?'),
    assistant('Terdapat 68 laporan.'),
  ]);
  assert.equal(ctx.lastAssistantQuestionKind, 'data');
  assert.equal(detectPendingReply('ya', ctx), null);
});

test('1g. bentuk pertanyaan assistant dikenali dengan benar', () => {
  assert.equal(classifyAssistantQuestion('Ada yang bisa saya bantu?'), 'open_offer');
  assert.equal(classifyAssistantQuestion('Terdapat 68 laporan.'), 'data');
  assert.equal(classifyAssistantQuestion('Bisa diperjelas sedikit, Admin?'), 'clarification');
  assert.equal(classifyAssistantQuestion('Sebutkan nomor atau ID laporan yang dimaksud.'), 'clarification');
});

test('1h. router memakai balasan singkat dan TIDAK memanggil tool apa pun', () => {
  const history = [user('Hai'), assistant('Selamat malam! Ada yang bisa saya bantu?')];
  const { tools, context } = resolveIntent('CITIZEN', 'Ada', history);
  assert.equal(tools.length, 0, 'balasan singkat tidak boleh memicu query database');
  assert.ok(context.pendingReply, 'konteks balasan harus tersimpan');
  assert.equal(context.pendingReply!.tone, 'affirmative');
});

test('1i. pesan singkat milik role lain tidak membuka akses data role itu', () => {
  const history = [user('Hai'), assistant('Selamat malam! Ada yang bisa saya bantu?')];

  // Admin yang bertanya "petugas" -> tool data petugas (hanya Admin).
  const admin = resolveIntent('ADMIN', 'petugas', history);
  assert.ok(
    admin.tools.some((t) => t.name === 'getOfficerWorkload' || t.name === 'getOfficerStats'),
    'Admin boleh memakai tool data petugas'
  );

  // Warga dengan pertanyaan SAMA -> hanya data miliknya sendiri.
  // Tool data petugas milik Admin TIDAK boleh terpilih untuk warga.
  const citizen = resolveIntent('CITIZEN', 'petugas', history);
  assert.ok(citizen.tools.length > 0, 'warga tetap mendapat jawaban dari datanya sendiri');
  const adminOnly = ['getOfficerWorkload', 'getOfficerStats', 'getOfficerDetail', 'getOfficerTaskCounts', 'searchAccounts'];
  for (const t of citizen.tools) {
    assert.equal(
      adminOnly.includes(t.name),
      false,
      `warga tidak boleh memakai tool khusus Admin/petugas: ${t.name}`
    );
  }
});

test('1j. jawaban deterministik untuk balasan singkat tersedia dan ramah', () => {
  const ctx = extractContext([user('Hai'), assistant('Ada yang bisa saya bantu?')]);
  const reply = detectPendingReply('Ada', ctx)!;
  const answer = formatShortReplyAnswer(reply, 'CITIZEN');
  assert.match(answer, /Silakan sampaikan pertanyaan/);
  assert.doesNotMatch(answer, /narasi AI tidak tersedia/);
});

test('1k. negasi mendapat jawaban penutup yang sopan', () => {
  const ctx = extractContext([user('Hai'), assistant('Ada yang bisa saya bantu?')]);
  const reply = detectPendingReply('tidak', ctx)!;
  const answer = formatShortReplyAnswer(reply, 'ADMIN');
  assert.match(answer, /Terima kasih|Baik/i);
});

// ---------------------------------------------------------------------------
// 2. Anti-duplikasi pesan terbaru
// ---------------------------------------------------------------------------

test('2a. parseHistory membatasi jumlah giliran sesuai CHAT_HISTORY_TURNS', () => {
  const many = Array.from({ length: 50 }, (_, i) =>
    i % 2 === 0 ? user(`pesan ${i}`) : assistant(`jawaban ${i}`)
  );
  const parsed = parseHistory(many);
  assert.equal(parsed.length, CHAT_HISTORY_TURNS, 'riwayat harus dipotong ke CHAT_HISTORY_TURNS');
  assert.equal(parsed[parsed.length - 1].content, 'jawaban 49', 'giliran terbaru harus dipertahankan');
});

test('2b. mergeHistory tidak menggandakan giliran yang sama', () => {
  const h = [user('halo'), assistant('hai')];
  const merged = mergeHistory(h, h);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].content, 'halo');
  assert.equal(merged[1].content, 'hai');
});

test('2c. mergeHistory juga membatasi ke CHAT_HISTORY_TURNS', () => {
  const many = Array.from({ length: 40 }, (_, i) => user(`u${i}`));
  assert.ok(mergeHistory(many, many).length <= CHAT_HISTORY_TURNS);
});

// ---------------------------------------------------------------------------
// 3. Isolasi riwayat per user DAN per sesi
// ---------------------------------------------------------------------------

test('3a. riwayat milik user lain tidak pernah terlihat', () => {
  const sid = `uji-iso-user-${Date.now().toString(36)}`;
  appendSessionTurn('user-a', sid, user('rahasia A'));
  assert.equal(getSessionHistory('user-a', sid).length, 1);
  assert.equal(getSessionHistory('user-b', sid).length, 0, 'user lain tidak boleh melihat');
  assert.equal(getSessionHistory('user-a', `${sid}-lain`).length, 0, 'sesi lain tidak boleh melihat');
  clearSession('user-a', sid);
});

test('3b. sesi dengan sessionId sama milik user berbeda tidak tercampur', () => {
  const sid = `uji-iso-campur-${Date.now().toString(36)}`;
  appendSessionTurn('user-x', sid, user('milik X'));
  appendSessionTurn('user-y', sid, user('milik Y'));
  const x = getSessionHistory('user-x', sid);
  const y = getSessionHistory('user-y', sid);
  assert.equal(x.length, 1);
  assert.equal(y.length, 1);
  assert.equal(x[0].content, 'milik X');
  assert.equal(y[0].content, 'milik Y');
  clearSession('user-x', sid);
  clearSession('user-y', sid);
});

test('3c. sessionId dari klien divalidasi (nilai aneh ditolak)', () => {
  assert.equal(sanitizeSessionId('pendek'), undefined);
  assert.equal(sanitizeSessionId('a'.repeat(200)), undefined);
  assert.equal(sanitizeSessionId('../../etc/passwd'), undefined);
  assert.equal(sanitizeSessionId('web-abc123-def'), 'web-abc123-def');
});

// ---------------------------------------------------------------------------
// 4. Isolasi saat ROLE berubah
// ---------------------------------------------------------------------------

test('4a. role berubah => konteks lama milik role sebelumnya dibuang', () => {
  const sid = `uji-iso-role-${Date.now().toString(36)}`;
  appendSessionTurn('user-r', sid, user('tampilkan daftar akun'), 'ADMIN');
  appendSessionTurn('user-r', sid, assistant('Ada 59 akun'), 'ADMIN');
  assert.equal(getSessionHistory('user-r', sid, 'ADMIN').length, 2, 'role sama: konteks utuh');

  // Akun diturunkan menjadi CITIZEN -> konteks ADMIN harus hilang.
  const afterDemotion = getSessionHistory('user-r', sid, 'CITIZEN');
  assert.equal(afterDemotion.length, 0, 'konteks role lama tidak boleh terbawa ke role baru');
  assert.equal(getSessionHistory('user-r', sid, 'ADMIN').length, 0, 'sesi harus dibuang, bukan hanya disembunyikan');
  clearSession('user-r', sid);
});

test('4b. role berubah saat menambah giliran => sesi dimulai ulang', () => {
  const sid = `uji-iso-role2-${Date.now().toString(36)}`;
  appendSessionTurn('user-s', sid, user('data internal admin'), 'ADMIN');
  assert.equal(getSessionHistory('user-s', sid, 'ADMIN').length, 1);

  // Sekarang akun yang sama menjadi CITIZEN dan mengirim pesan baru.
  appendSessionTurn('user-s', sid, user('apa status laporan saya?'), 'CITIZEN');
  const history = getSessionHistory('user-s', sid, 'CITIZEN');
  assert.equal(history.length, 1, 'hanya giliran baru yang tersimpan');
  assert.equal(history[0].content, 'apa status laporan saya?');
  assert.equal(
    history.some((h) => h.content.includes('data internal admin')),
    false,
    'konteks role ADMIN tidak boleh ada di sesi CITIZEN'
  );
  clearSession('user-s', sid);
});

test('4c. role yang sama tidak membuang konteks (percakapan normal berjalan)', () => {
  const sid = `uji-iso-sama-${Date.now().toString(36)}`;
  appendSessionTurn('user-t', sid, user('halo'), 'CITIZEN');
  appendSessionTurn('user-t', sid, assistant('hai'), 'CITIZEN');
  assert.equal(getSessionHistory('user-t', sid, 'CITIZEN').length, 2);
  clearSession('user-t', sid);
});

// ---------------------------------------------------------------------------
// 5. Konsistensi batas giliran antar lapisan
// ---------------------------------------------------------------------------

test('5a. session store memakai CHAT_HISTORY_TURNS yang sama', () => {
  const sid = `uji-limit-${Date.now().toString(36)}`;
  const total = CHAT_HISTORY_TURNS + 10;
  for (let i = 0; i < total; i++) {
    appendSessionTurn('user-l', sid, i % 2 === 0 ? user(`u${i}`) : assistant(`a${i}`));
  }
  const history = getSessionHistory('user-l', sid);
  assert.equal(history.length, CHAT_HISTORY_TURNS, 'store harus memotong ke CHAT_HISTORY_TURNS');
  assert.equal(history[history.length - 1].content, `a${total - 1}`, 'giliran terbaru tersimpan');
  clearSession('user-l', sid);
});

test('5b. giliran user identik berturut-turut tidak digandakan (kirim ulang)', () => {
  const sid = `uji-retry-${Date.now().toString(36)}`;
  appendSessionTurn('user-u', sid, user('ada'), 'CITIZEN');
  appendSessionTurn('user-u', sid, user('ada'), 'CITIZEN');
  const history = getSessionHistory('user-u', sid);
  assert.equal(history.length, 1, 'pesan user yang sama tidak boleh tersimpan dua kali');
  clearSession('user-u', sid);
});

// ---------------------------------------------------------------------------
// 6. Multi-turn: konteks lintas giliran tetap dipakai router
// ---------------------------------------------------------------------------

test('6a. router memakai konteks giliran sebelumnya untuk pertanyaan lanjutan', () => {
  const history = [user('Berapa jumlah laporan desa?'), assistant('Terdapat 68 laporan.')];
  const { tools } = resolveIntent('ADMIN', 'Berapa yang sudah selesai?', history);
  assert.ok(tools.length > 0, 'pertanyaan lanjutan harus tetap memilih tool');
});

test('6b. detectChatIntent tidak berubah untuk pesan biasa', () => {
  assert.equal(detectChatIntent('Berapa jumlah laporan?', 'ADMIN'), 'STATS');
  assert.equal(detectChatIntent('Hai', 'CITIZEN'), 'GREETING');
});
