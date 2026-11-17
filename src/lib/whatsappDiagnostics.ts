/**
 * DIAGNOSTIK KONEKSI FONNTE (DNS / TCP / TLS) — tanpa mengirim pesan.
 *
 * Tujuan: saat notifikasi gagal dengan `network_error`, Admin harus bisa
 * membedakan penyebabnya (DNS gagal, koneksi ditolak, reset, TLS gagal)
 * tanpa perlu mengirim pesan uji sungguhan.
 *
 * Keamanan & batasan:
 * - TIDAK ada HTTP POST ke Fonnte. Yang dilakukan hanya resolusi DNS, TCP
 *   handshake, dan TLS handshake (ClientHello/ServerHello) — tidak ada pesan
 *   WhatsApp yang dikirim.
 * - Host yang diperiksa bersifat KONSTAN (lihat FONNTE_HOST); nilai host
 *   dari request TIDAK pernah dipakai.
 * - Token, header Authorization, dan data internal tidak pernah dikembalikan.
 * - Setiap pemeriksaan punya timeout agar UI tidak menggantung.
 */

import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

/** Host Fonnte yang Always dipakai (tidak dapat diubah lewat request). */
export const FONNTE_HOST = 'api.fonnte.com';
export const FONNTE_PORT = 443;

const DNS_TIMEOUT_MS = 5000;
const TCP_TIMEOUT_MS = 6000;
const TLS_TIMEOUT_MS = 8000;

export interface DiagnosticCheck {
  ok: boolean;
  detail: string;
  /** Data aman yang boleh ditampilkan (tanpa rahasia). */
  data?: Record<string, string | number | null>;
}

export interface ConnectivityDiagnostics {
  checkedAt: string;
  host: string;
  port: number;
  dns: DiagnosticCheck;
  tcp: DiagnosticCheck;
  tls: DiagnosticCheck;
  /** Ringkasan singkat untuk ditampilkan. */
  summary: string;
  note: string;
}

/** Ambil kode error aman (tanpa pesan) dari exception Node. */
function safeCode(error: unknown): string {
  const e = error as { code?: unknown; name?: unknown; message?: unknown };
  const code = typeof e?.code === 'string' ? e.code.toUpperCase() : '';
  if (code && /^[A-Z0-9_]{2,32}$/.test(code)) return code;
  const name = typeof e?.name === 'string' ? e.name : '';
  if (name && /^[A-Za-z]{3,32}$/.test(name)) return name;
  return 'UNKNOWN';
}

/** Detail singkat tanpa membocorkan pesan mentah (yang bisa memuat URL/host). */
function shortDetail(error: unknown): string {
  const e = error as { message?: unknown };
  const msg = typeof e?.message === 'string' ? e.message : '';
  if (!msg) return safeCode(error);
  // Ambil bagian akhir yang mengandung kode error saja.
  const match = msg.match(/([A-Z]{2,}[A-Z0-9_]{1,30})$/);
  return match ? match[1] : safeCode(error);
}

async function checkDns(host: string): Promise<DiagnosticCheck> {
  try {
    const addresses = await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('dns timeout'), { code: 'ETIMEDOUT' })), DNS_TIMEOUT_MS)
      ),
    ]);
    const list = addresses.map((a) => a.address);
    return {
      ok: list.length > 0,
      detail: list.length > 0 ? `${list.length} alamat ditemukan` : 'Tidak ada alamat',
      data: { addresses: list.join(', '), count: list.length },
    };
  } catch (error) {
    return { ok: false, detail: `Gagal: ${shortDetail(error)}`, data: { code: safeCode(error) } };
  }
}

async function checkTcp(host: string, port: number): Promise<DiagnosticCheck> {
  return new Promise<DiagnosticCheck>((resolve) => {
    let settled = false;
    const socket = new net.Socket();
    const finish = (result: DiagnosticCheck) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* noop */ }
      resolve(result);
    };
    socket.setTimeout(TCP_TIMEOUT_MS);
    socket.once('connect', () =>
      finish({ ok: true, detail: `TCP ${port} dapat dijangkau`, data: { port } })
    );
    socket.once('timeout', () =>
      finish({ ok: false, detail: `Gagal: timeout ${TCP_TIMEOUT_MS} ms`, data: { code: 'ETIMEDOUT' } })
    );
    socket.once('error', (error: unknown) =>
      finish({ ok: false, detail: `Gagal: ${shortDetail(error)}`, data: { code: safeCode(error) } })
    );
    try {
      socket.connect(port, host);
    } catch (error) {
      finish({ ok: false, detail: `Gagal: ${shortDetail(error)}`, data: { code: safeCode(error) } });
    }
  });
}

async function checkTls(host: string, port: number): Promise<DiagnosticCheck> {
  return new Promise<DiagnosticCheck>((resolve) => {
    let settled = false;
    const finish = (result: DiagnosticCheck) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* noop */ }
      resolve(result);
    };
    const isIp = net.isIP(host) !== 0;
    const socket = tls.connect({
      host,
      port,
      // SNI hanya bermakna untuk nama domain, bukan alamat IP (RFC 6066).
      ...(isIp ? {} : { servername: host }),
      timeout: TLS_TIMEOUT_MS,
      // Verifikasi sertifikat dinonaktifkan HANYA untuk diagnostik handshake;
      // Pesan tetap terenkripsi, dan status sertifikat ditampilkan terpisah.
      rejectUnauthorized: false,
    });
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate?.() || {};
      const asText = (value: unknown): string | null => {
        if (Array.isArray(value)) return value.length ? String(value[0]) : null;
        if (typeof value === 'string' && value.trim()) return value.trim();
        return null;
      };
      finish({
        ok: true,
        detail: 'TLS handshake berhasil',
        data: {
          protocol: socket.getProtocol?.() || '-',
          authorized: socket.authorized ? 'ya' : 'tidak',
          validTo: asText(cert?.valid_to),
          issuer: asText(cert?.issuer?.O),
          subject: asText(cert?.subject?.CN),
        },
      });
    });
    socket.once('timeout', () =>
      finish({ ok: false, detail: `Gagal: timeout ${TLS_TIMEOUT_MS} ms`, data: { code: 'ETIMEDOUT' } })
    );
    socket.once('error', (error: unknown) =>
      finish({ ok: false, detail: `Gagal: ${shortDetail(error)}`, data: { code: safeCode(error) } })
    );
  });
}

/**
 * Jalankan diagnostik konektivitas terhadap host Fonnte.
 * Tidak mengirim pesan apa pun dan tidak membaca token.
 */
export async function runConnectivityDiagnostics(
  host: string = FONNTE_HOST,
  port: number = FONNTE_PORT
): Promise<ConnectivityDiagnostics> {
  const [dnsResult, tcpResult, tlsResult] = await Promise.all([
    checkDns(host),
    checkTcp(host, port),
    checkTls(host, port),
  ]);

  const summary = dnsResult.ok && tcpResult.ok && tlsResult.ok
    ? 'Koneksi jaringan ke Fonnte normal (DNS, TCP, dan TLS semuanya berhasil). Pesan tetap harus diuji nyata untuk dipastikan terkirim.'
    : 'Ada bagian konektivitas yang bermasalah — lihat rincian di bawah.';

  return {
    checkedAt: new Date().toISOString(),
    host,
    port,
    dns: dnsResult,
    tcp: tcpResult,
    tls: tlsResult,
    summary,
    note:
      'Diagnostik ini hanya memeriksa DNS, TCP, dan TLS — tidak mengirim pesan WhatsApp dan tidak memakai token. ' +
      'Koneksi jaringan berhasil BELUM berarti pesan terkirim; bukti pengiriman tetap berasal dari catatan pengiriman nyata.',
  };
}
