/**
 * Tes offline untuk `src/lib/secretCrypto.ts`.
 *
 * Tidak menyentuh database, tidak memanggil provider, tidak mengirim
 * WhatsApp. Kunci yang dipakai adalah kunci UJI yang dibuat di dalam proses
 * test (bukan kunci produksi).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  isEncryptionReady,
  maskSecret,
  getEncryptionKey,
  SecretCryptoError,
} from '../src/lib/secretCrypto';

// Kunci UJI per-proses (bukan kunci produksi).
const TEST_KEY = randomBytes(32).toString('base64');
process.env.APP_ENCRYPTION_KEY = TEST_KEY;

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return '(tidak melempar)';
  } catch (e) {
    return e instanceof SecretCryptoError ? e.code : `bukan SecretCryptoError: ${(e as Error).message}`;
  }
};

// ---------------------------------------------------------------------------
// T-01 round-trip
// ---------------------------------------------------------------------------
test('T-01 enkripsi -> dekripsi menghasilkan nilai yang sama', () => {
  const secret = 'sk-or-v1-token-rahasia-1234567890';
  const cipher = encryptSecret(secret);
  assert.notEqual(cipher, secret, 'ciphertext tidak boleh sama dengan plaintext');
  assert.ok(isEncrypted(cipher), 'ciphertext harus terdeteksi terenkripsi');
  assert.equal(decryptSecret(cipher), secret, 'dekripsi harus mengembalikan nilai asli');
});

test('T-01b nilai unicode & panjang Bowlength tetap utuh', () => {
  for (const v of ['a', 'token-with-⚡-emoji-😀', 'x'.repeat(5000)]) {
    assert.equal(decryptSecret(encryptSecret(v)), v);
  }
});

test('T-01c input kosong menghasilkan string kosong (bukan error)', () => {
  assert.equal(encryptSecret(''), '');
  assert.equal(encryptSecret(null), '');
  assert.equal(encryptSecret(undefined), '');
  assert.equal(decryptSecret(''), '');
  assert.equal(decryptSecret(null), '');
});

// ---------------------------------------------------------------------------
// T-02 IV unik untuk setiap enkripsi
// ---------------------------------------------------------------------------
test('T-02 IV acak: dua enkripsi nilai sama menghasilkan ciphertext berbeda', () => {
  const secret = 'token-yang-sama';
  const a = encryptSecret(secret);
  const b = encryptSecret(secret);
  assert.notEqual(a, b, 'ciphertext harus berbeda (IV acak)');
  const ivA = a.split(':')[1];
  const ivB = b.split(':')[1];
  assert.notEqual(ivA, ivB, 'IV harus berbeda antar enkripsi');
  assert.equal(decryptSecret(a), secret);
  assert.equal(decryptSecret(b), secret);
});

test('T-02b format ciphertext v1:iv:tag:ct dengan iv 12 byte & tag 16 byte', () => {
  const cipher = encryptSecret('apa saja');
  const parts = cipher.split(':');
  assert.equal(parts.length, 4, 'harus 4 bagian');
  assert.equal(parts[0], 'v1');
  assert.equal(Buffer.from(parts[1], 'base64').length, 12, 'IV harus 12 byte');
  assert.equal(Buffer.from(parts[2], 'base64').length, 16, 'auth tag harus 16 byte');
  assert.ok(Buffer.from(parts[3], 'base64').length > 0, 'ciphertext tidak boleh kosong');
});

// ---------------------------------------------------------------------------
// T-03 auth tag GCM: ciphertext dirusak harus GAGAL dekripsi
// ---------------------------------------------------------------------------
test('T-03 auth tag GCM: mengubah 1 byte ciphertext membuat dekripsi gagal', () => {
  const cipher = encryptSecret('nilai-yang-harus-terlindungi');
  const parts = cipher.split(':');
  const ct = Buffer.from(parts[3], 'base64');
  ct[0] = ct[0] ^ 0xff; // ubah satu byte
  const tampered = [parts[0], parts[1], parts[2], ct.toString('base64')].join(':');
  assert.equal(codeOf(() => decryptSecret(tampered)), 'decrypt_failed');
});

test('T-03b auth tag dirusak juga GAGAL dekripsi', () => {
  const cipher = encryptSecret('nilai-yang-harus-terlindungi');
  const parts = cipher.split(':');
  const tag = Buffer.from(parts[2], 'base64');
  tag[0] = tag[0] ^ 0xff;
  const tampered = [parts[0], parts[1], tag.toString('base64'), parts[3]].join(':');
  assert.equal(codeOf(() => decryptSecret(tampered)), 'decrypt_failed');
});

test('T-03c IV dirusak GAGAL dekripsi', () => {
  const cipher = encryptSecret('nilai');
  const parts = cipher.split(':');
  const iv = Buffer.from(parts[1], 'base64');
  iv[0] = iv[0] ^ 0xff;
  const tampered = [parts[0], iv.toString('base64'), parts[2], parts[3]].join(':');
  assert.equal(codeOf(() => decryptSecret(tampered)), 'decrypt_failed');
});

// ---------------------------------------------------------------------------
// T-04 kunci salah / kunci hilang
// ---------------------------------------------------------------------------
test('T-04 dekripsi dengan kunci yang salah GAGAL (bukan menghasilkan teks)', () => {
  const cipher = encryptSecret('rahasia');
  const saved = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  try {
    assert.equal(codeOf(() => decryptSecret(cipher)), 'decrypt_failed');
  } finally {
    process.env.APP_ENCRYPTION_KEY = saved;
  }
});

test('T-04b kunci hilang -> encryption_key_missing (tanpa fallback, tanpa default)', () => {
  const saved = process.env.APP_ENCRYPTION_KEY;
  delete process.env.APP_ENCRYPTION_KEY;
  try {
    assert.equal(codeOf(() => getEncryptionKey()), 'encryption_key_missing');
    assert.equal(codeOf(() => encryptSecret('apa saja')), 'encryption_key_missing');
    assert.equal(codeOf(() => decryptSecret('v1:aaaa:bbbb:cccc')), 'encryption_key_missing');
    assert.equal(isEncryptionReady(), false);
  } finally {
    process.env.APP_ENCRYPTION_KEY = saved;
  }
});

test('T-04c kunci dengan panjang salah DITOLAK', () => {
  const saved = process.env.APP_ENCRYPTION_KEY;
  for (const bad of [randomBytes(16).toString('base64'), 'terlalu-panjang-sekali', randomBytes(32).toString('hex') + 'ZZ']) {
    process.env.APP_ENCRYPTION_KEY = bad;
    assert.equal(codeOf(() => getEncryptionKey()), 'encryption_key_invalid', `harus ditolak: ${bad.slice(0, 12)}`);
  }
  process.env.APP_ENCRYPTION_KEY = saved;
  assert.equal(isEncryptionReady(), true);
});

test('T-04d kunci hex 64 karakter DITERIMA', () => {
  const saved = process.env.APP_ENCRYPTION_KEY;
  const hex = randomBytes(32).toString('hex');
  process.env.APP_ENCRYPTION_KEY = hex;
  try {
    assert.equal(isEncryptionReady(), true);
    assert.equal(decryptSecret(encryptSecret('hex-ok')), 'hex-ok');
  } finally {
    process.env.APP_ENCRYPTION_KEY = saved;
  }
});

// ---------------------------------------------------------------------------
// T-05 format ciphertext tidak valid
// ---------------------------------------------------------------------------
test('T-05 format ciphertext salah -> ciphertext_invalid', () => {
  for (const bad of [
    'bukan-ciphertext',
    'v1:abc',
    'v2:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbb:cccc',
    'v1:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbb:cccc',
  ]) {
    assert.equal(codeOf(() => decryptSecret(bad)), 'ciphertext_invalid', `harus ditolak: ${bad.slice(0, 16)}`);
  }
});

test('T-05b isEncrypted hanya true untuk format v1 yang benar', () => {
  assert.equal(isEncrypted(encryptSecret('x')), true);
  assert.equal(isEncrypted('v1:a:b:c'), true, 'format 4 bagian dianggap terenkripsi (dekripsi akan menolak)');
  assert.equal(isEncrypted('v2:a:b:c'), false, 'versi lain bukan v1');
  assert.equal(isEncrypted(''), false);
  assert.equal(isEncrypted(null), false);
  assert.equal(isEncrypted(undefined), false);
});

// ---------------------------------------------------------------------------
// T-06 masking rahasia
// ---------------------------------------------------------------------------
test('T-06 maskSecret tidak pernah mengembalikan nilai penuh', () => {
  const secret = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz012345';
  const masked = maskSecret(secret);
  assert.notEqual(masked, secret);
  assert.ok(masked.endsWith(secret.slice(-4)), '4 karakter terakhir boleh terlihat');
  assert.ok(!masked.includes(secret.slice(0, 12)), 'bagian utama tidak boleh terlihat');
  assert.equal(maskSecret(''), '');
  assert.equal(maskSecret(null), '');
  assert.equal(maskSecret('ab'), '••••');
});

// ---------------------------------------------------------------------------
// T-07 tidak ada hardcoded key / fallback diam-diam
// ---------------------------------------------------------------------------
test('T-07 modul tidak memuat kunci enkripsi hardcoded', () => {
  const src = require('node:fs').readFileSync('src/lib/secretCrypto.ts', 'utf8');
  // Tidak boleh ada string base64/hex 32-byte yang tertanam sebagai default.
  const hexLiterals = src.match(/['"][0-9a-fA-F]{64}['"]/g) || [];
  const b64Literals = src.match(/['"][A-Za-z0-9+/]{43,}={0,2}['"]/g) || [];
  assert.equal(hexLiterals.length, 0, 'tidak boleh ada hex 64 char hardcoded');
  assert.equal(b64Literals.length, 0, 'tidak boleh ada base64 panjang hardcoded');
  // Semua pembacaan kunci harus lewat process.env.APP_ENCRYPTION_KEY.
  assert.ok(/process\.env\.APP_ENCRYPTION_KEY/.test(src), 'kunci hanya dari env');
});

test('T-08 error tidak membocorkan nilai rahasia', () => {
  const secret = 'rahasia-yang-tidak-boleh-muncul';
  const cipher = encryptSecret(secret);
  try {
    decryptSecret(cipher.slice(0, cipher.length - 4) + 'AAAA');
  } catch (e) {
    const msg = (e as Error).message;
    assert.ok(!msg.includes(secret), 'pesan error tidak boleh memuat rahasia');
    assert.ok(!msg.includes(cipher), 'pesan error tidak boleh memuat ciphertext penuh');
  }
});
