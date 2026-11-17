/**
 * BACKUP + BACKUP TOKEN FONNTE (enkripsi AES-256-GCM).
 *
 * Fungsi:
 *  1. Membuat backup `prisma/dev.db` (dengan checksum + verifikasi integritas).
 *  2. Mengisi kolom `FonnteConfig.tokenCipher` dari kolom `token` (plaintext).
 *
 * Aturan keselamatan (WAJIB):
 *  - TIDAK PERNAH mencetak token Fonnte, ciphertext, maupun APP_ENCRYPTION_KEY.
 *    Yang ditampilkan hanya status, panjang, dan jumlah baris.
 *  - TIDAK PERNAH menghapus/mengubah kolom `token` plaintext — jalur transisi
 *    tetap berfungsi bila kunci berubah atau hilang.
 *  - IDEMPOTEN: baris yang ciphertext-nya sudah valid TIDAK ditulis ulang.
 *  - Setiap ciphertext yang ditulis DIVERIFIKASI (dekripsi & bandingkan dengan
 *    nilai lama) sebelum laporan sukses.
 *  - Tanpa `APP_ENCRYPTION_KEY` yang valid → berhenti, TIDAK menulis apa pun.
 *
 * Pemakaian:
 *   npx tsx scripts/backfill-fonnte-token.ts --dry-run   # pratinjau, tanpa tulis
 *   npx tsx scripts/backfill-fonnte-token.ts             # backup + backfill
 *
 * Opsi:
 *   --skip-backup   lewati pembuatan backup (tidak disarankan)
 *   --dry-run       hanya pemeriksaan, tanpa menulis ke database
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Root proyek.
 *
 * Ditentukan dari lokasi skrip ini (`scripts/` → root), bukan dari `cwd`,
 * sehingga `.env` & database yang dibaca tetap benar walau skrip dijalankan
 * dari direktori lain. Ada pemeriksaan penanda (`prisma/schema.prisma`) sebagai
 * jaring pengaman.
 */
function resolveProjectRoot(): string {
  const fromScript = path.resolve(__dirname, '..');
  if (existsSync(path.join(fromScript, 'prisma', 'schema.prisma'))) return fromScript;
  const fromCwd = process.cwd();
  if (existsSync(path.join(fromCwd, 'prisma', 'schema.prisma'))) return fromCwd;
  return fromScript;
}

const PROJECT_ROOT = resolveProjectRoot();

/**
 * Muat environment SEBELUM membaca/memvalidasi APP_ENCRYPTION_KEY.
 *
 * `npx tsx` tidak memuat `.env` secara otomatis (bukan Next.js, bukan
 * Prisma CLI) dan `src/lib/secretCrypto.ts` hanya membaca `process.env`.
 * Tanpa baris ini, pemeriksaan kunci selalu gagal walaupun `.env` sudah
 * benar.
 *
 * `loadEnvConfig` memakai semantik dotenv: variabel yang SUDAH ada di
 * `process.env` tidak ditimpa, dan variabel bernilai kosong dibuang.
 */
const { loadEnvConfig } = require('@next/env');
loadEnvConfig(PROJECT_ROOT);

/**
 * Lokasi database yang dikerjakan.
 *
 * Default: `prisma/dev.db`. Bila `DATABASE_URL` menunjuk file lain
 * (mis. salinan uji di TEMP), itu yang dipakai — sehingga skrip ini bisa
 * diuji tanpa menyentuh database proyek.
 */
function resolveDbPath(): string {
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith('file:')) {
    const raw = url.slice('file:'.length).split('?')[0];
    if (raw && existsSync(raw)) return path.resolve(PROJECT_ROOT, raw);
  }
  return path.join(PROJECT_ROOT, 'prisma', 'dev.db');
}

const DB_PATH = resolveDbPath();
const BACKUP_DIR = path.dirname(DB_PATH);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_BACKUP = args.includes('--skip-backup');

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function sha256(file: string): string {
  return createHash('sha256').update(require('node:fs').readFileSync(file)).digest('hex');
}

function makeBackup(): { file: string; size: number; sha: string } | null {
  if (!existsSync(DB_PATH)) {
    console.error('  ✗ database tidak ditemukan:', DB_PATH);
    return null;
  }
  const target = path.join(BACKUP_DIR, `dev.db.backup-before-token-cipher-${stamp()}`);
  copyFileSync(DB_PATH, target);
  const size = statSync(target).size;
  const sha = sha256(target);
  console.log(`  ✓ backup dibuat : ${path.basename(target)}`);
  console.log(`    ukuran         : ${size} byte`);
  console.log(`    sha256         : ${sha}`);
  return { file: target, size, sha };
}

async function verifyBackup(file: string): Promise<boolean> {
  const { execFileSync } = require('node:child_process');
  const check = path.join(require('node:os').tmpdir(), `tahap6-backup-check-${Date.now()}.db`);
  try {
    copyFileSync(file, check);
    const { PrismaClient } = require('@prisma/client');
    const client = new PrismaClient({ datasources: { db: { url: `file:${check.replace(/\\/g, '/')}` } } });
    const rows = await client.$queryRawUnsafe('PRAGMA integrity_check');
    const ok = Array.isArray(rows) && rows.length === 1 && String(rows[0].integrity_check || rows[0]).toLowerCase() === 'ok';
    const tables = await client.$queryRawUnsafe(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'"
    );
    const users = await client.user.count();
    const reports = await client.report.count();
    await client.$disconnect();
    console.log(`    integritas     : ${ok ? 'OK' : 'GAGAL'}`);
    console.log(`    jumlah tabel   : ${tables[0].n}`);
    console.log(`    user/report    : ${users}/${reports}`);
    return ok;
  } catch (e) {
    console.error('    verifikasi backup GAGAL:', (e as Error).message);
    return false;
  } finally {
    try {
      require('node:fs').unlinkSync(check);
    } catch {
      /* abaikan */
    }
  }
}

async function main() {
  console.log('=== TAHAP 6 — BACKUP & BACKFILL TOKEN FONNTE ===');
  console.log(`  mode            : ${DRY_RUN ? 'DRY-RUN (tidak menulis)' : 'LIVE'}`);
  console.log(`  root proyek     : ${PROJECT_ROOT}`);
  console.log(`  database        : ${DB_PATH}`);

  // --- 1. Kunci enkripsi wajib tersedia -------------------------------------
  const { isEncryptionReady, encryptSecret, decryptSecret, isEncrypted } = require(
    path.join(PROJECT_ROOT, 'src/lib/secretCrypto.ts')
  );
  if (!isEncryptionReady()) {
    // Bedakan tiga penyebab kegagalan agar pesan tidak menyesatkan.
    const raw = process.env.APP_ENCRYPTION_KEY;
    const kosong = typeof raw === 'string' && raw.trim() === '';
    const tidakAda = raw === undefined;

    console.error('');
    if (tidakAda) {
      console.error('  ✗ APP_ENCRYPTION_KEY TIDAK DITEMUKAN.');
      console.error(`    Sumber env yang diperiksa: ${path.join(PROJECT_ROOT, '.env')}`);
      console.error('    (variabel ini tidak ada di .env maupun di environment sistem)');
    } else if (kosong) {
      console.error('  ✗ APP_ENCRYPTION_KEY KOSONG.');
      console.error('    Variabel ada tetapi nilainya kosong — hapus/timpa baris tersebut di .env.');
    } else {
      console.error('  ✗ FORMAT APP_ENCRYPTION_KEY TIDAK VALID.');
      console.error('    Nilai ditemukan, tetapi bukan Base64 32 byte (atau hex 64 karakter).');
      console.error(`    Panjang nilai saat ini: ${raw.trim().length} karakter (tanpa menampilkan isinya).`);
    }
    console.error('');
    console.error('    Buat kunci (32 byte, Base64) di PowerShell:');
    console.error('      node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
    console.error('    Simpan hasilnya di password manager, lalu tempel ke file .env server sebagai');
    console.error('      APP_ENCRYPTION_KEY=<nilai>');
    console.error('    Restart server, lalu jalankan ulang perintah ini.');
    process.exit(2);
  }
  console.log('  APP_ENCRYPTION_KEY : tersedia & valid (nilai tidak dicetak)');
  console.log(`  .env yang dibaca    : ${path.join(PROJECT_ROOT, '.env')}`);

  const { prisma } = require(path.join(PROJECT_ROOT, 'src/lib/prisma.ts'));

  // --- 2. Backup -------------------------------------------------------------
  if (!SKIP_BACKUP) {
    console.log('\n=== BACKUP ===');
    const b = makeBackup();
    if (!b) process.exit(1);
    const ok = await verifyBackup(b.file);
    if (!ok) {
      console.error('  ✗ backup tidak terverifikasi — backfill DIBATALKAN.');
      await prisma.$disconnect();
      process.exit(1);
    }
    console.log('  ✓ backup terverifikasi — boleh melanjutkan.');
  } else {
    console.log('\n  ! backup dilewati (--skip-backup)');
  }

  // --- 3. Backfill -----------------------------------------------------------
  console.log('\n=== BACKFILL tokenCipher ===');
  const devices = await prisma.fonnteConfig.findMany({
    select: { id: true, deviceName: true, token: true, tokenCipher: true },
  });
  console.log(`  perangkat diperiksa: ${devices.length}`);

  let written = 0;
  let skipped = 0;
  let failed = 0;

  for (const d of devices) {
    const name = d.deviceName || '(tanpa nama)';
    const hasPlain = typeof d.token === 'string' && d.token.length > 0;

    // Kasus 1: sudah ada ciphertext → verifikasi (idempoten).
    if (d.tokenCipher) {
      if (!isEncrypted(d.tokenCipher)) {
        console.log(`  ✗ ${name}: tokenCipher ada tetapi formatnya tidak valid (dibiarkan).`);
        failed++;
        continue;
      }
      try {
        const dec = decryptSecret(d.tokenCipher);
        const sama = hasPlain ? dec === d.token : true;
        console.log(
          `  = ${name}: sudah terenkripsi (dekripsi OK, cocok dengan nilai lama: ${sama ? 'ya' : 'TIDAK'}) — dilewati.`
        );
        skipped++;
      } catch (e) {
        console.log(`  ✗ ${name}: tokenCipher ada tetapi gagal didekripsi — dilewati (diperiksa manual).`);
        failed++;
      }
      continue;
    }

    // Kasus 2: belum ada ciphertext.
    if (!hasPlain) {
      console.log(`  - ${name}: tidak ada token plaintext untuk dienkripsi — dilewati.`);
      skipped++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`  > ${name}: AKAN ditulis tokenCipher (nilai tidak ditampilkan).`);
      written++;
      continue;
    }

    try {
      const cipher = encryptSecret(d.token);
      // Tulis HANYA kolom tokenCipher; kolom token dibiarkan utuh.
      await prisma.$executeRaw`UPDATE "FonnteConfig" SET "tokenCipher" = ${cipher} WHERE "id" = ${d.id}`;
      // Verifikasi: dekripsi harus cocok dengan nilai lama.
      const check = await prisma.fonnteConfig.findUnique({
        where: { id: d.id },
        select: { token: true, tokenCipher: true },
      });
      if (!check?.tokenCipher) {
        console.log(`  ✗ ${name}: ciphertext tidak tersimpan — dibatalkan.`);
        failed++;
        continue;
      }
      const dec = decryptSecret(check.tokenCipher);
      if (dec !== check.token) {
        console.log(`  ✗ ${name}: verifikasi dekripsi GAGAL — ciphertext ditolak.`);
        failed++;
        continue;
      }
      console.log(`  ✓ ${name}: tokenCipher ditulis & terverifikasi (nilai lama tetap ada).`);
      written++;
    } catch (e) {
      console.log(`  ✗ ${name}: gagal menulis tokenCipher — ${(e as Error).message}`);
      failed++;
    }
  }

  console.log(`\n  ringkasan: ditulis=${written} dilewati=${skipped} gagal=${failed}`);

  const after = await prisma.fonnteConfig.findMany({
    select: { deviceName: true, token: true, tokenCipher: true },
  });
  console.log('\n=== VERIFIKASI AKHIR (tanpa nilai rahasia) ===');
  for (const d of after) {
    const lamaAda = typeof d.token === 'string' && d.token.length > 0;
    const cipherAda = Boolean(d.tokenCipher);
    console.log(
      `  - "${d.deviceName || '(tanpa nama)'}": token lama ${lamaAda ? 'TETAP ADA' : 'tidak ada'}, ` +
        `tokenCipher ${cipherAda ? 'TERISI' : 'null'}`
    );
  }
  console.log(`\n  ℹ️  kolom token plaintext TIDAK pernah dihapus — jalur transisi tetap aktif.`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
