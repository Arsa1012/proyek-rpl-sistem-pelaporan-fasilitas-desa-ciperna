/**
 * Service notifikasi WhatsApp via Fonnte API (fonnte.com).
 * Server-side only — JANGAN pernah mengimpor modul ini dari kode frontend.
 *
 * CATATAN PENTING (jujur):
 * - Fonnte BUKAN Cloud API resmi Meta. Fonnte mengirim DARI nomor WA pribadi
 *   yang dihubungkan via scan QR di dashboard Fonnte (otomasi gateway).
 * - Fonnte sendiri menyatakan ada risiko nomor pengirim di-banned WhatsApp.
 *   Gunakan nomor pengirim khusus/kedua, bukan nomor utama yang kritis.
 * - Nomor admin (082118727522) adalah nomor TUJUAN, bukan pengirim.
 * - Fonnte tidak memakai konsep template/jendela 24 jam seperti Cloud API —
 *   pesan teks dapat dikirim kapan saja selama device terhubung dan kuota ada.
 *
 * Keamanan:
 * - Kredensial dibaca dari service konfigurasi perangkat aktif (lib/fonnteConfig.ts).
 * - Token tidak pernah ditulis ke log, respons API, atau dikirim ke browser.
 * - Nomor tujuan di log selalu disamarkan (4 digit awal + ****).
 * - Fungsi tidak pernah throw — selalu kembalikan WhatsAppResult.
 * - Kegagalan Fonnte tidak pernah membatalkan transaksi database pemanggil.
 */

import { prisma } from '@/lib/prisma';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import {
  getActiveFonnteConfig,
  normalizePhoneTo62,
  resolveActiveFonnteConfig,
  type ResolvedFonnteConfig,
} from '@/lib/fonnteConfig';
import { resolveActiveRecipient } from '@/lib/notificationRecipients';

export interface WhatsAppResult {
  ok: boolean;
  /** false bila kredensial/nomor admin belum dikonfigurasi. */
  configured: boolean;
  /** true bila pesan tidak dikirim karena konfigurasi belum lengkap. */
  skipped?: boolean;
  /** true bila dilewati karena dedupeKey sudah tercatat terkirim. */
  deduped?: boolean;
  /** ID pesan dari Meta bila berhasil. */
  providerMessageId?: string;
  /** Kode error aman (tanpa rahasia), mis. 'not_configured', 'provider_400'. */
  error?: string;
}

const TIMEOUT_MS = 15000;

/**
 * Kode error jaringan/TLS yang aman untuk disimpan (tanpa pesan, URL, token,
 * header, atau data pengguna). Hanya kode beruppercase dari daftar putih.
 */
const SAFE_TRANSPORT_CODES = new Set([
  // DNS
  'ENOTFOUND', 'EAI_AGAIN',
  // TCP
  'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EHOSTUNREACH',
  'ENETUNREACH', 'ENETDOWN', 'EPIPE', 'EADDRNOTAVAIL',
  // TLS
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'CERT_SIGNATURE_FAILURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_PACKET_LENGTH_TOO_LONG',
  // lain-lain yang sering muncul di runtime Node
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT',
]);

/** Jenis kegagalan transporte yang dibedakan sistem. */
export type TransportErrorKind = 'timeout' | 'network_error';

export interface TransportErrorInfo {
  /** 'timeout' bila timeout milik kita (AbortError); selain itu kegagalan jaringan. */
  kind: TransportErrorKind;
  /** Kode aman (mis. 'ENOTFOUND'), null bila tidak teridentifikasi. */
  code: string | null;
  /** String yang AMAN disimpan di log: 'timeout' atau 'network_error:<KODE>'. */
  safe: string;
}

/**
 * Klasifikasikan exception dari fetch/provider menjadi penyebab yang bisa
 * ditindaklanjuti, TANPA menyimpan pesan asli (pesan undici dapat memuat
 * host/URL, dan tidak boleh bocor ke log publik).
 *
 * - 'timeout'          → timeout 15 detik milik kita (AbortError).
 * - 'network_error:X'  → kegagalan jaringan/TLS dengan kode X.
 * - 'network_error'    → kegagalan jaringan tanpa kode yang dikenal
 *                        (kompatibilitas dengan log lama).
 */
export function classifyTransportError(error: unknown): TransportErrorInfo {
  const seen = new Set<unknown>();
  let current: any = error;
  let code: string | null = null;
  let isAbort = false;

  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);

    const name = typeof current.name === 'string' ? current.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') isAbort = true;

    const rawCode = typeof current.code === 'string' ? current.code : '';
    if (rawCode && SAFE_TRANSPORT_CODES.has(rawCode.toUpperCase())) {
      code = rawCode.toUpperCase();
      break;
    }
    // Some runtimes put the useful code in `cause`, or in `errors[]` (AggregateError).
    const cause = current.cause;
    if (cause && typeof cause === 'object') {
      current = cause;
      continue;
    }
    if (Array.isArray(current.errors) && current.errors.length > 0) {
      current = current.errors[0];
      continue;
    }
    break;
  }

  if (isAbort) {
    return { kind: 'timeout', code, safe: 'timeout' };
  }
  return {
    kind: 'network_error',
    code,
    safe: code ? `network_error:${code}` : 'network_error',
  };
}

function maskPhone(digits: string): string {
  return digits.length > 4 ? `${digits.slice(0, 4)}****` : '****';
}

/**
 * Resolusi nomor PENERIMA notifikasi Admin BERSAMA snapshot perangkat pengirim.
 *
 * PENERIMA (nomor tujuan) diambil dari `NotificationRecipient` — nomor yang
 * dipilih Admin. Token PENGIRIM diambil dari perangkat Fonnte aktif. Keduanya
 * adalah konsep terpisah dan tidak saling menggantikan:
 *  - perangkat pengirim Fonnte = nomor yang terkoneksi ke Fonnte,
 *  - penerima notifikasi       = nomor tujuan pesan Admin.
 *
 * Bila tidak ada nomor penerima yang aktif, pengiriman DIHENTIKAN dan
 * dicatat sebagai FAILED — TIDAK ada fallback diam-diam ke nomor lama
 * perangkat pengirim.
 */
async function resolveAdminRecipient(dedupeKey: string): Promise<{
  admin: string | null;
  config: ResolvedFonnteConfig;
}> {
  const config = await fonnteConfig();
  const recipient = await resolveActiveRecipient();
  const admin = recipient.phone;
  if (!admin) {
    const kind = dedupeKey.split(':')[0].toUpperCase().replace(/-/g, '_');
    const reason = recipient.problems[0] || 'tidak ada nomor penerima notifikasi yang aktif';
    console.error(
      `[WhatsApp] Notifikasi Admin dilewati: ${reason}.`
    );
    await recordLog({
      dedupeKey,
      kind,
      toMasked: '-',
      status: 'FAILED',
      error: 'admin_recipient_unavailable',
    });
  }
  return { admin, config };
}

/**
 * Normalisasi nomor Indonesia ke digit internasional.
 * Menerima: 08xx, +628xx, 628xx (termasuk varian berisi tanda kutip/spasi).
 * Hasil: '628...' (tanpa '+'). Fonnte menerima format 08xx maupun 628xx dengan
 * countryCode 62.
 */
export function normalizeIndonesianPhone(input: string): string | null {
  return normalizePhoneTo62(input);
}

/** Nomor tersamarkan untuk ditampilkan ke pengguna (mis. "6281****"). */
export function maskPhoneNumber(input: string): string {
  const normalized = normalizeIndonesianPhone(input) || String(input || '');
  return maskPhone(normalized.replace(/\D/g, ''));
}

/**
 * Nomor Admin milik PERANGKAT PENGIRIM aktif (nomor kontak desa).
 *
 * PENTING: ini BUKAN nomor penerima notifikasi Admin. Notifikasi Admin
 * memakai tabel `NotificationRecipient` (lihat
 * `notificationRecipients.ts`). Fungsi ini dipakai untuk konteks kontak desa
 * dan sebagai informasi perangkat.
 *
 * Sumbernya perangkat aktif di database; bila database belum punya perangkat
 * sama sekali, dipakai nomor dari `.env` (instalasi baru). Bila perangkat
 * aktif ada tetapi nomornya tidak valid, fungsi mengembalikan null — nomor
 * `.env` TIDAK dipakai secara diam-diam.
 */
export async function getAdminWhatsApp(): Promise<string | null> {
  const config = await resolveActiveFonnteConfig();
  return config.adminPhone;
}

export function getAppBaseUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * Baca konfigurasi perangkat aktif (FonnteConfig) sebagai satu sumber
 * kebenaran. thinly wrapper di atas `resolveActiveFonnteConfig()`.
 * @deprecated gunakan `resolveActiveFonnteConfig()` — implementasi ini
 * tidak lagi punya logika fallback `.env` sendiri.
 */
export async function getFonnteConfigFromDb() {
  const config = await resolveActiveFonnteConfig();
  return {
    token: config.token,
    adminPhone: config.adminPhone || '',
    lastValidation: config.lastValidation ?? undefined,
    isActive: config.source === 'database',
    source: config.source === 'database' ? ('database' as const) : ('env' as const),
    deviceName: config.deviceName,
    deviceId: config.deviceId,
    problems: config.problems,
  };
}
export function parseDeviceInfo(ua: string): string {
  const s = ua || '';
  let browser = 'Browser tidak dikenal';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/OPR\//.test(s)) browser = 'Opera';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  else if (/Chrome\//.test(s) && !/Chromium/.test(s)) browser = s.includes('Mobile') ? 'Chrome Mobile' : 'Chrome';
  else if (/Version\/[\d.]+.*Safari\//.test(s)) browser = s.includes('Mobile') ? 'Mobile Safari' : 'Safari';

  let os = 'OS tidak dikenal';
  const android = s.match(/Android ([\d.]+)/);
  const ios = s.match(/OS ([\d_]+) like Mac OS X/);
  const mac = s.match(/Mac OS X ([\d_]+)/);
  if (/Windows NT 10/.test(s)) os = 'Windows 10/11';
  else if (/Windows NT/.test(s)) os = 'Windows';
  else if (android) os = `Android ${android[1]}`;
  else if (/iPhone|iPad/.test(s) && ios) os = `iOS ${ios[1].replace(/_/g, '.')}`;
  else if (/iPhone|iPad/.test(s)) os = 'iOS';
  else if (mac) os = `macOS ${mac[1].replace(/_/g, '.')}`;
  else if (/Linux/.test(s)) os = 'Linux';
  return `${browser} / ${os}`;
}

/** Waktu lokal Indonesia: "16 Oktober 2026 - 20:30 WIB". */
export function formatLoginTime(d: Date = new Date()): string {
  const date = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
  const time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' });
  return `${date} - ${time} WIB`;
}

/** Label IP: localhost dilabeli jaringan lokal; IP publik ditampilkan apa adanya. */
export function formatIpLabel(ip: string): string {
  const v = (ip || '').trim();
  if (!v || v === 'unknown' || v === 'localhost' || v === '127.0.0.1' || v === '::1' || v === '::ffff:127.0.0.1') {
    return 'Localhost (Jaringan Lokal Server Desa)';
  }
  return `${v} (detail lokasi tidak dilacak otomatis)`;
}

/** Jam (0-23) saat ini di zona Asia/Jakarta, eksplisit tidak bergantung server. */
export function jakartaHour(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('id-ID', { hour: 'numeric', hour12: false, timeZone: 'Asia/Jakarta' }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  return h === 24 ? 0 : h;
}

/** Salam otomatis WIB dihitung saat pesan akan dikirim. */
export function greetingFor(date: Date = new Date()): string {
  const h = jakartaHour(date);
  if (h >= 3 && h < 11) return 'Selamat pagi';
  if (h >= 11 && h < 15) return 'Selamat siang';
  if (h >= 15 && h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

/** Format Indonesia WIB: "16 Oktober 2026, 15.30 WIB". */
export function fmtWIB(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tgl = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
  const jam = d
    .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' })
    .replace(':', '.');
  return `${tgl}, ${jam} WIB`;
}

const BRAND_FOOTER = '_Sistem Pelaporan Fasilitas Umum Desa Ciperna_';

/** Penutup baku notifikasi otomatis (teks wajib pada notifikasi pendaftaran). */
const AUTO_REPLY_FOOTER = 'Pesan ini otomatis. Tidak perlu membalas jika tidak ada keperluan lain.';

/** Sapaan penerima; fallback sopan bila nama kosong. */
function greetTo(name?: string | null): string {
  const now = new Date();
  const salam = greetingFor(now);
  const clean = (name || '').trim();
  return clean ? `${salam}, Bapak/Ibu ${clean}.` : `${salam}, Bapak/Ibu.`;
}

/**
 * Konfigurasi perangkat aktif — dibungkus agar kompatibel dengan pemanggil lama.
 * DIBACA ULANG setiap kali dibutuhkan (tanpa cache), sehingga perubahan
 * perangkat aktif oleh Admin langsung berlaku untuk pengiriman berikutnya.
 */
async function fonnteConfig(): Promise<ResolvedFonnteConfig> {
  return resolveActiveFonnteConfig();
}

export { fonnteConfig };

export async function isWhatsAppConfigured(): Promise<boolean> {
  const config = await fonnteConfig();
  return Boolean(config.tokenValid);
}

/**
 * Status kelengkapan konfigurasi perangkat aktif.
 * Aman untuk log/UI: tidak pernah memuat token.
 */
export async function whatsappConfigStatus(): Promise<{
  configured: boolean;
  missing: string[];
  source: string;
  deviceName: string | null;
  problems: string[];
}> {
  const config = await fonnteConfig();
  const missing: string[] = [];
  if (!config.tokenValid) missing.push('Token Fonnte perangkat aktif');
  if (!config.adminPhoneValid) missing.push('Nomor Admin perangkat aktif');
  return {
    configured: config.tokenValid && config.adminPhoneValid,
    missing,
    source: config.source,
    deviceName: config.deviceName,
    problems: config.problems,
  };
}

interface SendOptions {
  /** Kunci idempotency — pesan dengan kunci yang sama tidak dikirim dua kali. */
  dedupeKey?: string;
  /** Jenis notifikasi untuk pencatatan status. */
  kind?: string;
  /**
   * Snapshot konfigurasi perangkat aktif. Wajib diisi agar token pengirim dan
   * nomor admin berasal dari PERANGKAT YANG SAMA (dilewati bila pemanggil
   * hanya memerlukan konfigurasi token).
   */
  config?: ResolvedFonnteConfig;
}

interface CloudApiResult {
  httpStatus?: number;
  messageId?: string;
  error?: string;
  metaCode?: number;
  metaMessage?: string;
}

interface FonnteResult {
  httpStatus?: number;
  messageId?: string;
  error?: string;
  detail?: string;
}

/**
 * Media (foto) yang akan dilampirkan pada pesan Fonnte.
 * Dikirim sebagai multipart `file` (unggahan biner dari server), BUKAN `url`
 * publik — sehingga foto bukti privat tidak perlu dipublikasikan permanen.
 * Lihat https://docs.fonnte.com/api-send/ (parameter `file`).
 */
export interface WhatsAppMedia {
  data: Buffer;
  filename: string;
  mime: string;
}

async function callFonnteApi(
  token: string,
  target: string,
  message: string,
  media?: WhatsAppMedia,
  opts: { quiet?: boolean } = {}
): Promise<FonnteResult> {
  const url = 'https://api.fonnte.com/send';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let body: BodyInit;
    if (media) {
      // Multipart: target + message + file (foto). `message` menjadi caption foto.
      const form = new FormData();
      form.append('target', target);
      form.append('message', message);
      form.append('countryCode', '62');
      form.append(
        'file',
        new Blob([new Uint8Array(media.data)], { type: media.mime }),
        media.filename
      );
      body = form;
    } else {
      body = new URLSearchParams({ target, message, countryCode: '62' });
    }

    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        // Fonnte memakai token mentah (bukan skema Bearer).
        Authorization: token,
      },
      body,
    });
    const data = await res.json().catch(() => ({}));
    // Log diagnostik: status HTTP + body Fonnte (tidak mengandung token).
    // Untuk OTP (`quiet`) body TIDAK dicatat agar kode verifikasi tidak pernah
    // muncul di log bila provider menggemakan isi pesan.
    if (!opts.quiet) {
      const bodyPreview = JSON.stringify(data).slice(0, 600);
      console.log(`[WhatsApp] Fonnte ← status=${res.status} body=${bodyPreview}`);
    } else {
      console.log(`[WhatsApp] Fonnte (OTP) ← status=${res.status}`);
    }
    // Sukses Fonnte: { status: true, ... }. Gagal: { status: false, reason/message }.
    if (data?.status === true) {
      const messageId =
        (Array.isArray(data.message_ids) && data.message_ids[0]) ||
        data.requestid ||
        data.id ||
        undefined;
      return { httpStatus: res.status, messageId: messageId ? String(messageId) : undefined };
    }
    const detail = String(data?.reason || data?.message || `http_${res.status}`).slice(0, 200);
    console.error(`[WhatsApp] Fonnte error status=${res.status} detail=${detail}`);
    return { httpStatus: res.status, error: 'provider_rejected', detail };
  } catch (error: unknown) {
    // Penyebab asli (pesan/URL) TIDAK disimpan — hanya kode aman. Ini membuat
    // 'network_error' dapat ditelusuri (DNS, koneksi ditolak, reset, TLS)
    // tanpa membocorkan informasi sensitif.
    const classified = classifyTransportError(error);
    console.error(
      `[WhatsApp] Gagal menghubungi Fonnte (${classified.safe})` +
        `${classified.code ? ` name=${(error as { name?: string })?.name || '-'}` : ''}`
    );
    return { error: classified.safe };
  } finally {
    clearTimeout(timeout);
  }
}

async function recordLog(opts: {
  dedupeKey?: string;
  kind: string;
  toMasked: string;
  status: string;
  providerMessageId?: string;
  error?: string;
}): Promise<void> {
  try {
    if (!opts.dedupeKey) return;
    await prisma.whatsAppLog.upsert({
      where: { dedupeKey: opts.dedupeKey },
      create: {
        dedupeKey: opts.dedupeKey,
        kind: opts.kind,
        toMasked: opts.toMasked,
        status: opts.status,
        providerMessageId: opts.providerMessageId,
        error: opts.error,
      },
      update: {
        status: opts.status,
        providerMessageId: opts.providerMessageId,
        error: opts.error,
      },
    });
  } catch (e) {
    console.error('[WhatsApp] Gagal mencatat log pengiriman:', e);
  }
}

/**
 * Cek idempotency: true bila dedupeKey sudah tercatat SENT (kirim dilewati).
 */
async function alreadySent(dedupeKey?: string): Promise<boolean> {
  if (!dedupeKey) return false;
  try {
    const existing = await prisma.whatsAppLog.findUnique({ where: { dedupeKey } });
    return existing?.status === 'SENT';
  } catch {
    return false;
  }
}

/**
 * Kirim pesan TEKS via Fonnte (tanpa batasan template/jendela 24 jam —
 * berlaku selama device WA terhubung dan kuota Fonnte tersedia).
 * Best-effort: tidak pernah throw.
 */
export async function sendWhatsApp(to: string, message: string, opts: SendOptions = {}): Promise<WhatsAppResult> {
  return deliverMessage(to, message, opts, undefined, 'TEXT');
}

async function deliverMessage(
  to: string,
  message: string,
  opts: SendOptions,
  media: WhatsAppMedia | undefined,
  defaultKind: string
): Promise<WhatsAppResult> {
  // SATU snapshot konfigurasi untuk seluruh proses pengiriman: token pengirim
  // dan (bila relevan) nomor admin berasal dari perangkat aktif yang sama.
  const config = opts.config ?? (await fonnteConfig());
  const kind = opts.kind || defaultKind;
  const target = normalizeIndonesianPhone(to);
  const masked = target ? maskPhone(target) : '-';

  if (!config.tokenValid) {
    const reason = config.problems[0] || 'konfigurasi perangkat WhatsApp aktif belum lengkap';
    console.error(
      `[WhatsApp] Pengiriman DIHENTIKAN (source=${config.source}, perangkat=${config.deviceName || '-'}): ${reason}`
    );
    // Dicatat sebagai FAILED agar kegagalan terlihat di log/monitoring/UI —
    // tidak boleh "hilang" begitu saja.
    await recordLog({
      dedupeKey: opts.dedupeKey,
      kind,
      toMasked: masked,
      status: 'FAILED',
      error: 'not_configured',
    });
    return { ok: false, configured: false, skipped: true, error: 'not_configured' };
  }
  if (await alreadySent(opts.dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  if (!target) {
    console.warn('[WhatsApp] Nomor tujuan tidak valid, pesan tidak dikirim.');
    await recordLog({
      dedupeKey: opts.dedupeKey,
      kind,
      toMasked: masked,
      status: 'FAILED',
      error: 'invalid_recipient',
    });
    return { ok: false, configured: true, error: 'invalid_recipient' };
  }
  if (!message || !message.trim()) {
    return { ok: false, configured: true, error: 'empty_message' };
  }

  const { messageId, error, detail } = await callFonnteApi(
    config.token,
    target,
    message.trim().slice(0, 4000),
    media
  );

  if (error) {
    const safeError = detail ? `${error}:${detail}`.slice(0, 120) : error;
    await recordLog({ dedupeKey: opts.dedupeKey, kind, toMasked: masked, status: 'FAILED', error: safeError });
    return { ok: false, configured: true, error: safeError };
  }
  console.log(
    `[WhatsApp] Terkirim ke ${masked} id=${messageId || '-'} dedupe=${opts.dedupeKey || '-'} ` +
      `perangkat=${config.deviceName || config.source}`
  );
  await recordLog({ dedupeKey: opts.dedupeKey, kind, toMasked: masked, status: 'SENT', providerMessageId: messageId });
  return { ok: true, configured: true, providerMessageId: messageId };
}

/**
 * Kirim pesan TEKS + FOTO (media) via Fonnte. Foto diunggah sebagai multipart
 * `file` dari server sehingga tidak perlu URL publik permanen.
 * Best-effort: tidak pernah throw.
 */
export async function sendWhatsAppMedia(
  to: string,
  message: string,
  media: WhatsAppMedia,
  opts: SendOptions = {}
): Promise<WhatsAppResult> {
  return deliverMessage(to, message, opts, media, 'MEDIA');
}

/**
 * Kirim KODE OTP ke nomor WhatsApp WARGA (bukan Admin).
 *
 * Berbeda dari `deliverMessage`: fungsi ini hanya membutuhkan `FONNTE_TOKEN`
 * (nomor Admin tidak relevan untuk penerima warga), sehingga perilaku
 * pemanggil notifikasi lama TIDAK berubah. Konfigurasi provider, endpoint,
 * header, normalisasi nomor, dan pencatatan log memakai jalur Fonnte yang sama.
 *
 * Keamanan:
 * - Isi pesan (berisi OTP) tidak pernah dicatat ke console/log.
 * - Body respons Fonnte tidak dicatat untuk OTP.
 * - `ok` berarti provider MENERIMA permintaan kirim (`status:true`), bukan
 *   bukti pesan sudah dibaca/diterima pengguna.
 */
export async function sendOtpWhatsApp(
  to: string,
  message: string,
  opts: { dedupeKey?: string } = {}
): Promise<WhatsAppResult> {
  const config = await fonnteConfig();
  const target = normalizeIndonesianPhone(to);
  const masked = target ? maskPhone(target) : '-';

  if (!config.tokenValid) {
    const reason = config.problems[0] || 'token Fonnte perangkat aktif belum valid';
    console.error(`[WhatsApp] OTP tidak dikirim (source=${config.source}): ${reason}`);
    await recordLog({
      dedupeKey: opts.dedupeKey,
      kind: 'OTP',
      toMasked: masked,
      status: 'FAILED',
      error: 'not_configured',
    });
    return { ok: false, configured: false, skipped: true, error: 'not_configured' };
  }
  if (!target) {
    console.warn('[WhatsApp] OTP tidak dikirim: nomor tujuan tidak valid.');
    return { ok: false, configured: true, error: 'invalid_recipient' };
  }
  if (!message || !message.trim()) {
    return { ok: false, configured: true, error: 'empty_message' };
  }

  const { messageId, error, detail } = await callFonnteApi(
    config.token,
    target,
    message.trim().slice(0, 4000),
    undefined,
    { quiet: true }
  );

  if (error) {
    const safeError = detail ? `${error}:${detail}`.slice(0, 120) : error;
    await recordLog({
      dedupeKey: opts.dedupeKey,
      kind: 'OTP',
      toMasked: masked,
      status: 'FAILED',
      error: safeError,
    });
    return { ok: false, configured: true, error: safeError };
  }

  console.log(`[WhatsApp] OTP: permintaan diterima provider untuk ${masked} id=${messageId || '-'}`);
  await recordLog({
    dedupeKey: opts.dedupeKey,
    kind: 'OTP',
    toMasked: masked,
    status: 'SENT',
    providerMessageId: messageId,
  });
  return { ok: true, configured: true, providerMessageId: messageId };
}

/**
 * Kompatibilitas: Fonnte tidak memakai template Meta. Fungsi ini mengirim
 * parameter sebagai pesan teks biasa agar pemanggil lama tetap berfungsi.
 */export async function sendWhatsAppTemplate(
  to: string,
  _templateName: string,
  _lang: string,
  params: string[],
  opts: SendOptions = {}
): Promise<WhatsAppResult> {
  void _templateName;
  void _lang;
  return sendWhatsApp(to, params.map((p) => String(p)).join('\n'), opts);
}

/**
 * Notifikasi PENERIMAAN laporan ke warga pelapor (format 3A).
 */
export async function notifyCitizenReceived(reportId: string): Promise<WhatsAppResult> {
  const dedupeKey = `received:${reportId}`;
  if (await alreadySent(dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { id: true, title: true, createdAt: true, status: true, user: { select: { name: true, phone: true } } },
  });
  if (!report) return { ok: false, configured: true, error: 'report_not_found' };
  const target = report.user.phone ? normalizeIndonesianPhone(report.user.phone) : null;
  if (!target) {
    await recordLog({ dedupeKey, kind: 'CITIZEN_RECEIVED', toMasked: '-', status: 'FAILED', error: 'no_citizen_phone' });
    return { ok: false, configured: true, error: 'no_citizen_phone' };
  }
  return sendWhatsApp(
    target,
    `*✅ LAPORAN BERHASIL DITERIMA*\n\n${greetTo(report.user.name)}\n\nTerima kasih telah melaporkan permasalahan fasilitas umum melalui Sistem Pelaporan Fasilitas Umum Desa Ciperna.\n\nKode laporan: ${report.id.slice(0, 8)}\nJudul: ${report.title}\nTanggal: ${fmtWIB(report.createdAt)}\nStatus: ${report.status}\n\nLaporan Anda telah tercatat dalam sistem. Kami akan memberikan informasi apabila terdapat perkembangan lebih lanjut.\n\nTerima kasih atas partisipasi Anda dalam menjaga fasilitas umum desa.\n\n${BRAND_FOOTER}`,
    { dedupeKey, kind: 'CITIZEN_RECEIVED' }
  );
}

/**
 * Notifikasi PERSETUJUAN hasil ke warga pelapor (format 3B).
 *
 * Dua mode (dipilih Admin saat menyetujui bukti, lihat Assignment.notifyMode):
 *  - 'TEXT'       → dedupeKey `approved:<reportId>`, pesan teks + tautan detail.
 *  - 'TEXT_PHOTO' → dedupeKey `approved-photo:<reportId>`, teks + FOTO bukti
 *                   diunggah sebagai media Fonnte (multipart `file`).
 * Masing-masing idempoten: satu laporan hanya menerima satu notifikasi per mode,
 * sehingga Admin dapat mengubah mode tanpa mengirim pesan ganda di mode yang sama.
 */
export async function notifyCitizenApproved(
  reportId: string,
  opts: {
    officerName?: string;
    notes?: string;
    evidenceUrl?: string;
    approvedAt?: Date | string;
    adminName?: string;
    location?: string;
    /** Kirim FOTO bukti pengerjaan sebagai media (dipilih eksplisit oleh Admin). */
    sendEvidencePhoto?: boolean;
    /** URL foto bukti relatif, mis. "/uploads/xxx.jpg". Wajib bila sendEvidencePhoto. */
    evidencePhoto?: string | null;
  } = {}
): Promise<WhatsAppResult> {
  // Mode media memakai kunci idempotency tersendiri agar Admin dapat memilih
  // mengirim TEKS saja atau TEKS + FOTO tanpa saling memblokir.
  const useMedia = Boolean(opts.sendEvidencePhoto && opts.evidencePhoto);
  const dedupeKey = useMedia ? `approved-photo:${reportId}` : `approved:${reportId}`;
  const kind = useMedia ? 'CITIZEN_APPROVED_PHOTO' : 'CITIZEN_APPROVED';
  if (await alreadySent(dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      title: true,
      location: true,
      status: true,
      user: { select: { name: true, phone: true } },
    },
  });
  if (!report) return { ok: false, configured: true, error: 'report_not_found' };
  const target = report.user.phone ? normalizeIndonesianPhone(report.user.phone) : null;
  if (!target) {
    await recordLog({ dedupeKey, kind, toMasked: '-', status: 'FAILED', error: 'no_citizen_phone' });
    return { ok: false, configured: true, error: 'no_citizen_phone' };
  }

  const approvedAt = opts.approvedAt ? new Date(opts.approvedAt) : new Date();
  const lines = [
    '*PEMBERITAHUAN PENYELESAIAN LAPORAN*',
    'Sistem Pelaporan Fasilitas Umum Desa Ciperna',
    '',
    greetTo(report.user.name),
    '',
    'Kami informasikan bahwa laporan fasilitas umum Anda telah selesai ditangani dan bukti penyelesaiannya telah diverifikasi oleh Admin.',
    '',
    '*Detail Laporan*',
    `Judul: ${report.title}`,
    `Lokasi: ${opts.location || report.location || '-'}`,
    'Status: SELESAI',
    '',
    '*Hasil Penanganan:*',
    opts.notes || 'Pekerjaan perbaikan telah dilaksanakan dan diverifikasi Admin.',
    '',
    '*Ditangani oleh:*',
    opts.officerName ? `${opts.officerName} (Petugas Lapangan)` : 'Petugas Lapangan Desa Ciperna',
    '',
    '*Diverifikasi oleh:*',
    opts.adminName || 'Admin Sistem Pelaporan Desa Ciperna',
    '',
    '*Tanggal Penyelesaian:*',
    fmtWIB(approvedAt),
    '',
    useMedia
      ? 'Foto bukti penyelesaian kami lampirkan pada pesan ini. Detail lengkap laporan:'
      : 'Bukti penyelesaian dapat dilihat melalui:',
    opts.evidenceUrl || 'Silakan buka menu "Laporan Saya" pada sistem.',
    '',
    'Terima kasih telah berpartisipasi dalam menjaga fasilitas umum Desa Ciperna.',
    '',
    'Hormat kami,',
    'Admin Sistem Pelaporan Desa Ciperna',
  ];

  if (useMedia) {
    // Foto dibaca dari server lalu diunggah sebagai multipart `file` Fonnte —
    // tanpa URL publik permanen untuk foto bukti privat.
    const loaded = await loadEvidenceMedia(opts.evidencePhoto);
    if (!loaded.ok) {
      await recordLog({ dedupeKey, kind, toMasked: maskPhone(target), status: 'FAILED', error: loaded.error });
      return { ok: false, configured: true, error: loaded.error };
    }
    return sendWhatsAppMedia(target, lines.join('\n'), loaded.media, { dedupeKey, kind });
  }

  return sendWhatsApp(target, lines.join('\n'), { dedupeKey, kind });
}

/**
 * Notifikasi PROGRES (perlu perbaikan) ke warga — tanpa klaim selesai (format 3C).
 */
export async function notifyCitizenProgress(reportId: string): Promise<WhatsAppResult> {
  const dedupeKey = `progress:${reportId}:${Date.now()}`;
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { id: true, title: true, status: true, user: { select: { name: true, phone: true } } },
  });
  if (!report) return { ok: false, configured: true, error: 'report_not_found' };
  const target = report.user.phone ? normalizeIndonesianPhone(report.user.phone) : null;
  if (!target) {
    await recordLog({ dedupeKey, kind: 'CITIZEN_PROGRESS', toMasked: '-', status: 'FAILED', error: 'no_citizen_phone' });
    return { ok: false, configured: true, error: 'no_citizen_phone' };
  }
  return sendWhatsApp(
    target,
    `*📌 INFORMASI PERKEMBANGAN LAPORAN*\n\n${greetTo(report.user.name)}\n\nLaporan Anda masih dalam proses penanganan. Hasil pekerjaan sedang diperiksa atau memerlukan perbaikan sebelum dapat dinyatakan selesai.\n\nKode laporan: ${report.id.slice(0, 8)}\nJudul: ${report.title}\nStatus: ${report.status}.\n\nKami akan menginformasikan perkembangan selanjutnya setelah ada pembaruan.\n\nTerima kasih atas kesabaran Anda.\n\n${BRAND_FOOTER}`,
    { dedupeKey, kind: 'CITIZEN_PROGRESS' }
  );
}
export async function notifyAdminLogin(input: {
  adminName: string;
  adminEmail: string;
  time: string;
  device: string;
  ipLabel: string;
  dedupeKey: string;
}): Promise<WhatsAppResult> {
  const { admin, config } = await resolveAdminRecipient(input.dedupeKey);
  if (!admin) return { ok: false, configured: false, skipped: true, error: 'not_configured' };
  const SEP = '----------------------------------';
  return sendWhatsApp(
    admin,
    `${SEP}\n🚨 PERINGATAN KEAMANAN LOGIN ADMIN\n${SEP}\nSistem mencatat adanya aktivitas login akun Admin pada Website Desa Ciperna.\n\nRincian Akses:\n👤 Akun Admin: ${input.adminName} (${input.adminEmail})\n🕒 Waktu: ${input.time}\n💻 Perangkat: ${input.device}\n📍 Alamat IP / Lokasi: ${input.ipLabel}\n\nJika ini BUKAN Anda, segera lakukan tindakan pengamanan atau ubah kata sandi akun Admin secara berkala.\n${SEP}`,
    { dedupeKey: input.dedupeKey, kind: 'ADMIN_LOGIN', config }
  );
}
/**
 * Notifikasi PENONAKTIFAN AKUN ke WhatsApp pemilik akun (warga/petugas).
 *
 * - Dikirim saat Admin menonaktifkan akun, memuat alasan dari Admin.
 * - Best-effort: kegagalan Fonnte tidak membatalkan perubahan status akun.
 * - Idempoten per kejadian (dedupeKey dikirim pemanggil; default per waktu).
 * - Akun tanpa nomor WA tetap dicatat sebagai FAILED di log (tanpa throw).
 */
export async function notifyAccountDeactivated(input: {
  userId: string;
  name: string;
  phone: string | null;
  reason: string;
  dedupeKey?: string;
}): Promise<WhatsAppResult> {
  const dedupeKey = input.dedupeKey || `account-deactivated:${input.userId}:${Date.now()}`;
  if (await alreadySent(dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  const target = input.phone ? normalizeIndonesianPhone(input.phone) : null;
  if (!target) {
    await recordLog({
      dedupeKey,
      kind: 'ACCOUNT_DEACTIVATED',
      toMasked: '-',
      status: 'FAILED',
      error: 'no_phone',
    });
    return { ok: false, configured: true, error: 'no_phone' };
  }

  const SEP = '----------------------------------';
  const reason = (input.reason || '').trim() || 'Tidak disebutkan oleh Admin';
  return sendWhatsApp(
    target,
    `${SEP}\n` +
      '⚠️ PEMBERITAHUAN PENONAKTIFAN AKUN\n' +
      `${SEP}\n` +
      `Halo ${input.name},\n\n` +
      'Akun Anda di Sistem Pelaporan Desa Ciperna telah DINONAKTIFKAN oleh Administrator.\n\n' +
      '📌 Alasan Penonaktifan:\n' +
      `"${reason}"\n\n` +
      'Catatan: Anda masih dapat login untuk melihat status akun, namun akses pembuatan laporan baru ' +
      'dan fitur utama lainnya telah dibatasi. Untuk informasi lebih lanjut, silakan hubungi Admin Desa ' +
      'di 082118727522.\n' +
      `${SEP}`,
    { dedupeKey, kind: 'ACCOUNT_DEACTIVATED' }
  );
}

/**
 * Notifikasi PERUBAHAN STATUS ke pemilik laporan via nomor WA miliknya sendiri.
 * Bukan ke nomor admin. Best-effort: gagal WA tidak membatalkan apa pun.
 * Deduplikasi: satu report + satu status hanya dikirim sekali.
 */
export async function notifyCitizenStatusChange(
  reportId: string,
  status: string,
  notes?: string
): Promise<WhatsAppResult> {
  const dedupeKey = `status:${reportId}:${status}`;
  if (await alreadySent(dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: {
      id: true, title: true, location: true, status: true,
      user: { select: { name: true, phone: true } },
    },
  });
  if (!report) return { ok: false, configured: true, error: 'report_not_found' };
  const target = report.user.phone ? normalizeIndonesianPhone(report.user.phone) : null;
  const masked = target ? maskPhone(target) : '-';
  if (!target) {
    console.log(`[WhatsApp] Nomor WA pemilik laporan tidak tersedia (report ${reportId}). Hanya notifikasi aplikasi.`);
    await recordLog({ dedupeKey, kind: `STATUS_${status}`, toMasked: masked, status: 'FAILED', error: 'no_citizen_phone' });
    return { ok: false, configured: true, error: 'no_citizen_phone' };
  }

  const STATUS_LABEL: Record<string, string> = {
    SUBMITTED: 'baru diajukan, menunggu verifikasi',
    VERIFIED: 'DIVERIFIKASI admin',
    REJECTED: 'DITOLAK admin',
    ASSIGNED: 'ditugaskan ke petugas (DIPROSES)',
    IN_PROGRESS: 'sedang DIPROSES petugas',
    REVIEW: 'hasil kerja menunggu verifikasi admin',
    COMPLETED: 'SELESAI',
  };
  const result = await sendWhatsApp(
    target,
    `*📢 STATUS LAPORAN BERUBAH*\n\n${greetTo(report.user.name)}\n\nKode laporan: ${report.id.slice(0, 8)}\nJudul: ${report.title}\nStatus terbaru: ${STATUS_LABEL[status] || status}\nWaktu pembaruan: ${fmtWIB()}\n${notes ? `Keterangan: ${notes}\n` : ''}\nPantau detail laporan di website Sistem Pelaporan Desa Ciperna.\n\n${BRAND_FOOTER}`,
    { dedupeKey, kind: `STATUS_${status}` }
  );

  // Fallback: bila WA warga gagal, teruskan ringkasannya ke Admin agar tidak hilang.
  // Nomor admin & token pengirim diambil dari perangkat aktif yang sama.
  if (!result.ok && !result.deduped) {
    const fallbackKey = `status-fallback:${reportId}:${status}`;
    const { admin, config } = await resolveAdminRecipient(fallbackKey);
    if (admin) {
      const fb = await sendWhatsApp(
        admin,
        `*⚠️ NOTIFIKASI WARGA GAGAL*\n\nNotifikasi status laporan gagal terkirim ke nomor warga ${masked}.\n\nKode laporan: ${report.id.slice(0, 8)}\nJudul: ${report.title}\nStatus: ${STATUS_LABEL[status] || status}\nAlasan: ${result.error || 'tidak diketahui'}\n\n${BRAND_FOOTER}`,
        { dedupeKey: fallbackKey, kind: `STATUS_FALLBACK_${status}`, config }
      );
      console.log(`[WhatsApp] Fallback admin ${fb.ok ? 'SENT' : 'FAILED'} untuk ${dedupeKey}`);
    }
  }
  return result;
}

/**
 * Notifikasi PENUGASAN ke nomor WA milik petugas yang ditugaskan (bukan ke admin,
 * bukan ke petugas lain). Best-effort dengan deduplikasi per assignment+petugas.
 */
export async function notifyOfficerAssignment(reportId: string, officerId: string): Promise<WhatsAppResult> {
  const dedupeKey = `assign:${reportId}:${officerId}`;
  if (await alreadySent(dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  const [report, officer] = await Promise.all([
    prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true, title: true, category: true, location: true },
    }),
    prisma.user.findUnique({ where: { id: officerId }, select: { name: true, phone: true } }),
  ]);
  if (!report || !officer) return { ok: false, configured: true, error: 'data_not_found' };
  const target = officer.phone ? normalizeIndonesianPhone(officer.phone) : null;
  const masked = target ? maskPhone(target) : '-';
  if (!target) {
    console.log(`[WhatsApp] Nomor WA petugas ${officer.name} tidak tersedia. Hanya notifikasi aplikasi.`);
    await recordLog({ dedupeKey, kind: 'OFFICER_ASSIGN', toMasked: masked, status: 'FAILED', error: 'no_officer_phone' });
    return { ok: false, configured: true, error: 'no_officer_phone' };
  }
  const assignment = await prisma.assignment.findFirst({
    where: { reportId, officerId, cancelledAt: null },
    orderBy: { assignedAt: 'desc' },
    select: { notes: true },
  });
  return sendWhatsApp(
    target,
    `*🛠️ PENUGASAN LAPORAN BARU*\n\n${greetTo(officer.name)}\n\nAnda mendapatkan tugas penanganan laporan fasilitas umum.\n\nKode laporan: ${report.id.slice(0, 8)}\nJudul: ${report.title}\nKategori: ${report.category || '-'}\nLokasi: ${report.location}\nInstruksi Admin: ${assignment?.notes || '-'}\n\nSilakan buka menu Tugas Saya untuk membaca detail dan memperbarui progres pekerjaan.\n\n${BRAND_FOOTER}`,
    { dedupeKey, kind: 'OFFICER_ASSIGN' }
  );
}

/**
 * Notifikasi BUKTI DITERIMA ke petugas (format 4B).
 */
export async function notifyOfficerReviewReceived(assignmentId: string): Promise<WhatsAppResult> {
  const dedupeKey = `officer-review:${assignmentId}`;
  if (await alreadySent(dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      report: { select: { id: true, title: true } },
      officer: { select: { name: true, phone: true } },
    },
  });
  if (!assignment) return { ok: false, configured: true, error: 'data_not_found' };
  const target = assignment.officer.phone ? normalizeIndonesianPhone(assignment.officer.phone) : null;
  if (!target) {
    await recordLog({ dedupeKey, kind: 'OFFICER_REVIEW', toMasked: '-', status: 'FAILED', error: 'no_officer_phone' });
    return { ok: false, configured: true, error: 'no_officer_phone' };
  }
  return sendWhatsApp(
    target,
    `*📨 BUKTI PEKERJAAN TELAH DITERIMA*\n\n${greetTo(assignment.officer.name)}\n\nBukti pengerjaan telah diterima dan sedang menunggu pemeriksaan Admin.\n\nKode laporan: ${assignment.report.id.slice(0, 8)}\nJudul: ${assignment.report.title}\nStatus: Menunggu persetujuan Admin.\n\nMohon menunggu hasil pemeriksaan. Jika diperlukan perbaikan, informasi dan alasannya akan disampaikan melalui notifikasi berikutnya.\n\n${BRAND_FOOTER}`,
    { dedupeKey, kind: 'OFFICER_REVIEW' }
  );
}

/**
 * Notifikasi PERSETUJUAN ke petugas (format 4C).
 */
export async function notifyOfficerApproved(assignmentId: string): Promise<WhatsAppResult> {
  const dedupeKey = `officer-approved:${assignmentId}`;
  if (await alreadySent(dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      report: { select: { id: true, title: true } },
      officer: { select: { name: true, phone: true } },
    },
  });
  if (!assignment) return { ok: false, configured: true, error: 'data_not_found' };
  const target = assignment.officer.phone ? normalizeIndonesianPhone(assignment.officer.phone) : null;
  if (!target) {
    await recordLog({ dedupeKey, kind: 'OFFICER_APPROVED', toMasked: '-', status: 'FAILED', error: 'no_officer_phone' });
    return { ok: false, configured: true, error: 'no_officer_phone' };
  }
  return sendWhatsApp(
    target,
    `*✅ PEKERJAAN DISETUJUI ADMIN*\n\n${greetTo(assignment.officer.name)}\n\nHasil pengerjaan Anda telah diperiksa dan disetujui oleh Admin.\n\nKode laporan: ${assignment.report.id.slice(0, 8)}\nJudul: ${assignment.report.title}\nTanggal persetujuan: ${fmtWIB(assignment.reviewedAt || new Date())}.\n\nTerima kasih atas pelaksanaan tugas Anda.\n\n${BRAND_FOOTER}`,
    { dedupeKey, kind: 'OFFICER_APPROVED' }
  );
}

/**
 * Notifikasi PERMINTAAN PERBAIKAN ke petugas (format 4D).
 */
export async function notifyOfficerFix(assignmentId: string, reason: string): Promise<WhatsAppResult> {
  const dedupeKey = `officer-fix:${assignmentId}:${Date.now()}`;
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      report: { select: { id: true, title: true } },
      officer: { select: { name: true, phone: true } },
    },
  });
  if (!assignment) return { ok: false, configured: true, error: 'data_not_found' };
  const target = assignment.officer.phone ? normalizeIndonesianPhone(assignment.officer.phone) : null;
  if (!target) {
    await recordLog({ dedupeKey, kind: 'OFFICER_FIX', toMasked: '-', status: 'FAILED', error: 'no_officer_phone' });
    return { ok: false, configured: true, error: 'no_officer_phone' };
  }
  return sendWhatsApp(
    target,
    `*🔄 PERBAIKAN PEKERJAAN DIPERLUKAN*\n\n${greetTo(assignment.officer.name)}\n\nAdmin telah memeriksa hasil pengerjaan dan meminta perbaikan.\n\nKode laporan: ${assignment.report.id.slice(0, 8)}\nJudul: ${assignment.report.title}\nAlasan perbaikan: ${reason}.\n\nSilakan periksa kembali tugas melalui menu Tugas Saya, lakukan perbaikan, lalu unggah bukti terbaru.\n\n${BRAND_FOOTER}`,
    { dedupeKey, kind: 'OFFICER_FIX' }
  );
}

/**
 * Notifikasi PEMBATALAN penugasan ke petugas yang dibatalkan.
 */
export async function notifyOfficerCancellation(assignmentId: string, reason?: string): Promise<WhatsAppResult> {
  const dedupeKey = `assign-cancel:${assignmentId}`;
  if (await alreadySent(dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      report: { select: { id: true, title: true } },
      officer: { select: { name: true, phone: true } },
    },
  });
  if (!assignment) return { ok: false, configured: true, error: 'data_not_found' };
  const target = assignment.officer.phone ? normalizeIndonesianPhone(assignment.officer.phone) : null;
  const masked = target ? maskPhone(target) : '-';
  if (!target) {
    await recordLog({ dedupeKey, kind: 'OFFICER_CANCEL', toMasked: masked, status: 'FAILED', error: 'no_officer_phone' });
    return { ok: false, configured: true, error: 'no_officer_phone' };
  }
  const SEP = '----------------------------------';
  return sendWhatsApp(
    target,
    `*⚠️ PENUGASAN DIBATALKAN*\n\n${greetTo(assignment.officer.name)}\n\nPenugasan Anda pada laporan "${assignment.report.title}" telah dibatalkan oleh Admin.${reason ? `\nAlasan: ${reason}` : ''}\n\n${BRAND_FOOTER}`,
    { dedupeKey, kind: 'OFFICER_CANCEL' }
  );
}

/**
 * Notifikasi Admin saat penugasan dibuat / pekerjaan selesai.
 */
export async function notifyAdminAssignment(assignmentId: string): Promise<WhatsAppResult> {
  const dedupeKey = `admin-assign:${assignmentId}`;
  if (await alreadySent(dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  const { admin, config } = await resolveAdminRecipient(dedupeKey);
  if (!admin) return { ok: false, configured: false, skipped: true, error: 'not_configured' };
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      report: { select: { id: true, title: true, location: true } },
      officer: { select: { name: true } },
    },
  });
  if (!assignment) return { ok: false, configured: true, error: 'data_not_found' };
  const time = new Date(assignment.assignedAt).toLocaleString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const SEP = '----------------------------------';
  return sendWhatsApp(
    admin,
    `${SEP}\n📌 PENUGASAN DIBUAT\n${SEP}\nLaporan "${assignment.report.title}" ditugaskan kepada ${assignment.officer.name}.\n\nNomor Laporan: ${assignment.report.id}\nLokasi: ${assignment.report.location}\nWaktu: ${time}\n${SEP}`,
    { dedupeKey, kind: 'ADMIN_ASSIGN', config }
  );
}

export async function notifyAdminCompletion(assignmentId: string): Promise<WhatsAppResult> {
  const dedupeKey = `admin-complete:${assignmentId}`;
  if (await alreadySent(dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  const { admin, config } = await resolveAdminRecipient(dedupeKey);
  if (!admin) return { ok: false, configured: false, skipped: true, error: 'not_configured' };
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      report: { select: { id: true, title: true, status: true } },
      officer: { select: { name: true } },
    },
  });
  if (!assignment) return { ok: false, configured: true, error: 'data_not_found' };
  return sendWhatsApp(
    admin,
    `*✅ HASIL PEKERJAAN DISETUJUI*\n\n${greetingFor()}, Admin.\n\nHasil pengerjaan telah disetujui dan laporan dinyatakan selesai.\n\nKode laporan: ${assignment.report.id.slice(0, 8)}\nJudul: ${assignment.report.title}\nPetugas: ${assignment.officer.name}\nStatus akhir: ${assignment.report.status}.\n\n${BRAND_FOOTER}`,
    { dedupeKey, kind: 'ADMIN_COMPLETE', config }
  );
}

/**
 * Notifikasi HASIL MENUNGGU PERSETUJUAN ke Admin (format C).
 */
export async function notifyAdminReview(assignmentId: string): Promise<WhatsAppResult> {
  const dedupeKey = `admin-review:${assignmentId}`;
  if (await alreadySent(dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  const { admin, config } = await resolveAdminRecipient(dedupeKey);
  if (!admin) return { ok: false, configured: false, skipped: true, error: 'not_configured' };
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      report: { select: { id: true, title: true } },
      officer: { select: { name: true } },
    },
  });
  if (!assignment) return { ok: false, configured: true, error: 'data_not_found' };
  const evidence = await prisma.reportEvidence.findFirst({
    where: { reportId: assignment.reportId },
    orderBy: { createdAt: 'desc' },
    select: { description: true, createdAt: true },
  });
  return sendWhatsApp(
    admin,
    `*🛠️ HASIL PEKERJAAN MENUNGGU PERSETUJUAN*\n\n${greetingFor()}, Admin.\n\nPetugas telah mengirimkan hasil pengerjaan yang membutuhkan pemeriksaan.\n\nKode laporan: ${assignment.report.id.slice(0, 8)}\nJudul: ${assignment.report.title}\nPetugas: ${assignment.officer.name}\nWaktu pengiriman bukti: ${evidence ? fmtWIB(evidence.createdAt) : '-'}\nCatatan petugas: ${evidence?.description || assignment.reviewNotes || '-'}\n\nStatus: Menunggu persetujuan Admin.\n\nSilakan periksa foto bukti dan catatan pekerjaan melalui dashboard sebelum menyetujui atau meminta perbaikan.\n\n${BRAND_FOOTER}`,
    { dedupeKey, kind: 'ADMIN_REVIEW', config }
  );
}

/**
 * Notifikasi pendaftaran akun baru ke Admin via Fonnte.
 */
export async function notifyAdminNewUser(input: {
  name: string;
  email: string;
  phone: string;
  role: string;
  rt?: string | null;
  rw?: string | null;
  time: string | Date;
  dashboardUrl: string;
  dedupeKey: string;
}): Promise<WhatsAppResult> {
  const { admin, config } = await resolveAdminRecipient(input.dedupeKey);
  if (!admin) return { ok: false, configured: false, skipped: true, error: 'not_configured' };
  const when = fmtWIB(input.time);
  const phoneText = input.phone && input.phone !== '-' ? input.phone : '-';
  const rtText = input.rt && input.rt.trim() ? input.rt.trim() : '-';
  const rwText = input.rw && input.rw.trim() ? input.rw.trim() : '-';
  return sendWhatsApp(
    admin,
    `*🔔 REGISTRASI WARGA BARU — DESA CIPERNA*\n\n${greetingFor()}, Admin.\n\nTelah ada masyarakat yang berhasil mendaftar pada portal Desa Ciperna.\n\nNama: ${input.name}\nEmail: ${input.email}\nNomor WhatsApp: ${phoneText}\nRT: ${rtText}\nRW: ${rwText}\nWaktu registrasi: ${when}\n\nSilakan buka dashboard admin untuk memeriksa data akun.\n\n${AUTO_REPLY_FOOTER}\n\n${BRAND_FOOTER}`,
    { dedupeKey: input.dedupeKey, kind: 'REGISTER', config }
  );
}

/**
 * Notifikasi laporan baru ke Admin.
 */
export async function notifyAdminNewReport(input: {
  reportId: string;
  title: string;
  reporter: string;
  category: string;
  location: string;
  description: string;
  time: string | Date;
  status: string;
  detailUrl: string;
  dedupeKey: string;
}): Promise<WhatsAppResult> {
  const { admin, config } = await resolveAdminRecipient(input.dedupeKey);
  if (!admin) return { ok: false, configured: false, skipped: true, error: 'not_configured' };
  const code = String(input.reportId).slice(0, 8);
  return sendWhatsApp(
    admin,
    `*📋 LAPORAN BARU MASUK*\n\n${greetingFor()}, Admin.\n\nLaporan baru telah dikirim oleh warga melalui sistem.\n\nKode laporan: ${code}\nJudul: ${input.title}\nPelapor: ${input.reporter}\nKategori: ${input.category}\nLokasi: ${input.location}\nWaktu laporan: ${fmtWIB(input.time)}\n\nStatus: Menunggu pemeriksaan Admin.\n\nSilakan buka dashboard untuk melihat detail laporan dan menentukan tindak lanjut.\n\n${BRAND_FOOTER}`,
    { dedupeKey: input.dedupeKey, kind: 'REPORT', config }
  );
}

/**
 * Notifikasi SELAMAT DATANG ke nomor WA milik warganya SENDIRI setelah
 * registrasi berhasil. Best-effort: kegagalan WA TIDAK membatalkan akun.
 *
 * Keamanan: TIDAK pernah memuat kata sandi, hash, token sesi, atau kode
 * verifikasi. Idempoten per akun (dedupeKey `register-welcome:<userId>`).
 */
export async function notifyCitizenRegistrationWelcome(userId: string): Promise<WhatsAppResult> {
  const dedupeKey = `register-welcome:${userId}`;
  if (await alreadySent(dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, phone: true },
  });
  if (!user) return { ok: false, configured: true, error: 'user_not_found' };
  const target = user.phone ? normalizeIndonesianPhone(user.phone) : null;
  if (!target) {
    await recordLog({ dedupeKey, kind: 'CITIZEN_WELCOME', toMasked: '-', status: 'FAILED', error: 'no_phone' });
    return { ok: false, configured: true, error: 'no_phone' };
  }
  return sendWhatsApp(
    target,
    `Halo ${user.name},\n\n` +
      `Registrasi akun Anda di Sistem Informasi Desa Ciperna berhasil!\n\n` +
      `Nomor WhatsApp ini telah terverifikasi.\n\n` +
      `Detail akun:\n` +
      `Nama: ${user.name}\n` +
      `Email/username: ${user.email}\n\n` +
      `Silakan login melalui website Desa Ciperna untuk menggunakan layanan yang tersedia.\n\n` +
      `Demi keamanan, jangan bagikan kata sandi atau kode verifikasi kepada orang lain.\n\n` +
      `${AUTO_REPLY_FOOTER}\n\n${BRAND_FOOTER}`,
    { dedupeKey, kind: 'CITIZEN_WELCOME' }
  );
}

/**
 * Notifikasi ke nomor WA milik PETUGAS sendiri setelah akunnya dibuat Admin.
 * Hanya memuat tautan AKTIVASI (token acak sekali pakai) atau info status akun —
 * TIDAK pernah memuat kata sandi. Idempoten per akun + jenis token.
 */
export async function notifyOfficerAccountCreated(input: {
  userId: string;
  activationUrl?: string;
  usedTemporaryPassword?: boolean;
  dedupeKey?: string;
}): Promise<WhatsAppResult> {
  const dedupeKey = input.dedupeKey || `officer-created:${input.userId}`;
  if (await alreadySent(dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { name: true, email: true, phone: true, isActive: true },
  });
  if (!user) return { ok: false, configured: true, error: 'user_not_found' };
  const target = user.phone ? normalizeIndonesianPhone(user.phone) : null;
  if (!target) {
    await recordLog({ dedupeKey, kind: 'OFFICER_CREATED', toMasked: '-', status: 'FAILED', error: 'no_phone' });
    return { ok: false, configured: true, error: 'no_phone' };
  }
  const activationLine = input.activationUrl
    ? `Silakan lanjutkan aktivasi akun atau buat kata sandi melalui tautan resmi berikut:\n${input.activationUrl}\n\nTautan bersifat rahasia, sekali pakai, dan memiliki masa berlaku.`
    : input.usedTemporaryPassword
      ? 'Kata sandi sementara telah diberikan langsung oleh Admin. Demi keamanan, Anda wajib menggantinya saat login pertama.'
      : 'Silakan gunakan kata sandi yang telah ditetapkan Admin, lalu ganti secara berkala.';
  return sendWhatsApp(
    target,
    `Halo ${user.name},\n\n` +
      `Akun petugas Anda untuk Sistem Pelaporan Fasilitas Umum Desa Ciperna telah dibuat oleh Admin.\n\n` +
      `Email/username: ${user.email}\n` +
      `Status akun: ${user.isActive ? 'Aktif' : 'Nonaktif'}\n\n` +
      `${activationLine}\n\n` +
      `Jika Anda tidak merasa mendaftar atau menerima undangan ini secara tidak sengaja, silakan hubungi Admin Desa Ciperna.\n\n` +
      `${AUTO_REPLY_FOOTER}\n\nJangan bagikan kode verifikasi atau tautan aktivasi kepada orang lain.\n\n${BRAND_FOOTER}`,
    { dedupeKey, kind: 'OFFICER_CREATED' }
  );
}

/**
 * Notifikasi tautan RESET KATA SANDI ke nomor WA milik pengguna sendiri.
 * Tidak pernah memuat kata sandi; hanya tautan token sekali pakai.
 */
export async function notifyPasswordReset(input: {
  userId: string;
  resetUrl: string;
  dedupeKey?: string;
}): Promise<WhatsAppResult> {
  const dedupeKey = input.dedupeKey || `password-reset:${input.userId}`;
  if (await alreadySent(dedupeKey)) {
    return { ok: true, configured: true, deduped: true };
  }
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { name: true, phone: true },
  });
  if (!user) return { ok: false, configured: true, error: 'user_not_found' };
  const target = user.phone ? normalizeIndonesianPhone(user.phone) : null;
  if (!target) {
    await recordLog({ dedupeKey, kind: 'PASSWORD_RESET', toMasked: '-', status: 'FAILED', error: 'no_phone' });
    return { ok: false, configured: true, error: 'no_phone' };
  }
  return sendWhatsApp(
    target,
    `Halo ${user.name},\n\n` +
      `Kami menerima permintaan untuk mengatur ulang kata sandi akun Sistem Pelaporan Fasilitas Umum Desa Ciperna.\n\n` +
      `Buat kata sandi baru melalui tautan resmi berikut:\n${input.resetUrl}\n\n` +
      `Tautan bersifat rahasia, sekali pakai, dan memiliki masa berlaku. Jika Anda tidak meminta ini, abaikan pesan ini — kata sandi lama Anda tetap berlaku.\n\n` +
      `${AUTO_REPLY_FOOTER}\n\nJangan bagikan tautan ini kepada orang lain.\n\n${BRAND_FOOTER}`,
    { dedupeKey, kind: 'PASSWORD_RESET' }
  );
}

// ============================================================================
// MEDIA (foto bukti) untuk Fonnte
// ============================================================================

/** Batas ukuran media Fonnte (4 MB). Lihat https://docs.fonnte.com/api-send/. */
const MEDIA_MAX_BYTES = 4 * 1024 * 1024;
const MEDIA_MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function isImageMagic(b: Buffer): boolean {
  return (
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || // JPEG
    (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || // PNG
    (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) // WEBP (RIFF)
  );
}

/**
 * Muat foto bukti pengerjaan dari penyimpanan server (folder public) untuk
 * dikirim sebagai media Fonnte. Sengaja HANYA menerima path internal
 * "/uploads/..." (foto bukti memang disimpan di sana), tidak menerima URL
 * eksternal, dan menolak path traversal.
 *
 * Tidak pernah mengembalikan isi biner ke pemanggil luar; hanya dipakai internal
 * oleh lapisan pengiriman WhatsApp.
 */
export async function loadEvidenceMedia(
  photoUrl: string | null | undefined
): Promise<{ ok: true; media: WhatsAppMedia } | { ok: false; error: string }> {
  try {
    if (!photoUrl || typeof photoUrl !== 'string') return { ok: false, error: 'no_evidence_photo' };
    const rel = photoUrl.split('?')[0].split('#')[0];
    if (!rel.startsWith('/uploads/') || rel.includes('..')) {
      return { ok: false, error: 'unsupported_photo_path' };
    }
    const parts = rel.split('/').filter(Boolean);
    const ext = (parts[parts.length - 1].split('.').pop() || '').toLowerCase();
    const mime = MEDIA_MIME_BY_EXT[ext];
    if (!mime) return { ok: false, error: 'unsupported_photo_type' };

    const abs = path.join(process.cwd(), 'public', ...parts);
    const info = await stat(abs).catch(() => null);
    if (!info || !info.isFile()) return { ok: false, error: 'photo_not_found' };
    if (info.size > MEDIA_MAX_BYTES) return { ok: false, error: 'photo_too_large' };

    const data = await readFile(abs);
    if (!isImageMagic(data)) return { ok: false, error: 'invalid_photo' };

    return { ok: true, media: { data, filename: parts[parts.length - 1], mime } };
  } catch (e) {
    console.error('[WhatsApp] Gagal membaca foto bukti:', e instanceof Error ? e.message : e);
    return { ok: false, error: 'photo_read_error' };
  }
}
