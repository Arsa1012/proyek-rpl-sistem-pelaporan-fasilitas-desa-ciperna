/**
 * Tes konfigurasi pengetahuan sistem.
 *
 * Fokus:
 * - Changelog dan struktur fitur tersedia untuk semua role.
 * - Status/kategori mengikuti schema dan formulir yang sebenarnya.
 * - Prompt pengetahuan sistem tidak memuat kredensial.
 * - Pertanyaan "update terbaru" diarahkan ke tool changelog dan dijawab
 *   deterministik tanpa bergantung pada ringkasan LLM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DATABASE_TABLES,
  REPORT_CATEGORIES,
  REPORT_STATUS_KNOWLEDGE,
  SYSTEM_CHANGELOG,
  formatLatestUpdatesAnswer,
  formatSystemKnowledgeForPrompt,
} from '../src/lib/systemConfig';
import { resolveIntent } from '../src/lib/aiIntent';
import { formatDeterministicAnswer } from '../src/lib/aiChat';
import type { ChatRole } from '../src/lib/aiTools';

test('changelog memuat tujuh pembaruan terbaru, termasuk lima update yang diminta', () => {
  assert.equal(SYSTEM_CHANGELOG.length, 7);
  const titles = SYSTEM_CHANGELOG.map((item) => item.title).join(' | ');
  assert.match(titles, /Notifikasi WhatsApp Real-time via Fonnte/i);
  assert.match(titles, /Fitur Keamanan Login Admin/i);
  assert.match(titles, /Pengaturan Tema Terang & Gelap/i);
  assert.match(titles, /Perbaikan Formulir Registrasi/i);
  assert.match(titles, /Auto-fill/i);
  assert.match(titles, /Upload Foto Kerusakan/i);
  assert.match(titles, /Penonaktifan Akun Warga\/Petugas/i);
  assert.match(titles, /Broadcast Pengumuman Otomatis/i);
});

test('pengetahuan sistem memakai struktur database, status, dan kategori yang benar', () => {
  const prompt = formatSystemKnowledgeForPrompt();

  assert.ok(prompt.includes('PENGETAHUAN LENGKAP STRUKTUR DATABASE & ALUR LAPORAN'));
  assert.ok(prompt.includes('Tabel Users'));
  assert.ok(prompt.includes('Tabel Reports'));
  assert.ok(prompt.includes('PENDING (Menunggu Verifikasi)'));
  assert.ok(prompt.includes('IN_PROGRESS (Sedang Diproses)'));
  assert.ok(prompt.includes('COMPLETED (Selesai)'));
  assert.ok(prompt.includes('REJECTED (Ditolak)'));
  assert.ok(prompt.includes('PENDING = SUBMITTED'));
  assert.ok(prompt.includes('VERIFIED + ASSIGNED + IN_PROGRESS + REVIEW'));
  for (const category of REPORT_CATEGORIES) {
    assert.ok(prompt.includes(category), `kategori ${category} harus disebut`);
  }
  for (const term of ['Infrastruktur', 'Jalan Raya', 'Kebersihan', 'Lampu Jalan', 'Fasilitas Umum']) {
    assert.ok(prompt.includes(term), `istilah kategori ${term} harus disebut`);
  }
  for (const table of DATABASE_TABLES) {
    assert.ok(prompt.includes(table.name), `tabel ${table.name} harus disebut`);
  }
  assert.equal(REPORT_STATUS_KNOWLEDGE.find((s) => s.code === 'REVIEW')?.simplified, 'IN_PROGRESS');
  assert.ok(prompt.includes('082118727522'));
  assert.ok(prompt.includes('@syajehh'));
  assert.ok(prompt.includes('ALUR LENGKAP SISTEM'));
  assert.ok(prompt.includes('STATISTIK REAL-TIME DATABASE'));
  assert.ok(prompt.includes('INSTRUKSI CARA MENJAWAB'));
  assert.ok(prompt.includes('Registrasi akun'));
  assert.ok(prompt.includes('Login memakai email atau nomor WhatsApp'));
  assert.ok(prompt.includes('Broadcast Pengumuman'));
  assert.ok(prompt.includes('Login Alert WhatsApp'));
  assert.ok(prompt.includes('cara menonaktifkan akun'));
});

test('pengetahuan prompt menyesuaikan fitur dengan role', () => {
  const citizen = formatSystemKnowledgeForPrompt('CITIZEN');
  assert.ok(citizen.includes('Fitur Warga'));
  assert.equal(citizen.includes('Manajemen User'), false);
  assert.equal(citizen.includes('AdminAuditLog'), false);

  const officer = formatSystemKnowledgeForPrompt('OFFICER');
  assert.ok(officer.includes('Fitur Petugas'));
  assert.ok(officer.includes('Assignment'));

  const admin = formatSystemKnowledgeForPrompt('ADMIN');
  assert.ok(admin.includes('Fitur Admin'));
  assert.ok(admin.includes('Manajemen User'));
  assert.ok(admin.includes('WhatsAppLog'));
});

test('prompt pengetahuan sistem tidak memuat kredensial', () => {
  const prompt = formatSystemKnowledgeForPrompt();
  for (const secret of ['Admin123!', 'password123', 'JWT_SECRET', 'FONNTE_TOKEN']) {
    assert.equal(prompt.includes(secret), false, `prompt tidak boleh memuat ${secret}`);
  }
});

test('pertanyaan update diarahkan ke tool changelog untuk semua role', () => {
  const roles: ChatRole[] = ['CITIZEN', 'OFFICER', 'ADMIN'];
  for (const role of roles) {
    const intent = resolveIntent(role, 'Ada update apa saja di web?');
    assert.equal(intent.tools.length, 1);
    assert.equal(intent.tools[0].name, 'getWebsiteInfo');
    assert.equal(intent.tools[0].args.topic, 'updates');
  }

  const statusUpdate = resolveIntent('ADMIN', 'Tolong update status laporan ini');
  assert.notEqual(statusUpdate.tools[0]?.args?.topic, 'updates');
});

test('jawaban update deterministik memuat seluruh changelog', () => {
  const answer = formatLatestUpdatesAnswer();
  for (const item of SYSTEM_CHANGELOG) {
    assert.ok(answer.includes(item.title), `jawaban harus memuat ${item.title}`);
    assert.ok(answer.includes(item.description), `jawaban harus memuat penjelasan ${item.title}`);
  }

  const direct = formatDeterministicAnswer([], [
    { name: 'getWebsiteInfo', result: { topic: 'updates', items: SYSTEM_CHANGELOG } },
  ]);
  assert.equal(direct, answer);
});
