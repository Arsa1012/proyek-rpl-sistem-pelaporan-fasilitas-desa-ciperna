/**
 * UMPAN BALIK OPERASI (client-side) — SATU sumber kebenaran untuk menerjemahkan
 * hasil request menjadi pesan yang jujur dan dapat ditindaklanjuti.
 *
 * Mengapa: banyak komponen sebelumnya menampilkan "Gagal terhubung ke server"
 * untuk SEMUA jenis kegagalan (validasi, autentikasi, konflik, server error),
 * sehingga Admin mengira masalahnya selalu sinyal. Modul ini membedakan:
 *   - koneksi terputus / timeout  → bisa dicoba ulang (retryable)
 *   - validasi (400/422)          → perbaiki input, pesan dari server dipakai
 *   - autentikasi (401) / hak akses (403)
 *   - tidak ditemukan (404) / konflik (409)
 *   - server error (5xx) / balasan tidak valid
 *
 * Modul ini HANYA berisi fungsi murni tanpa akses DOM/server sehingga aman
 * diimpor oleh komponen klien mana pun.
 */

export type FailureKind =
  | 'network'
  | 'timeout'
  | 'validation'
  | 'auth'
  | 'forbidden'
  | 'notfound'
  | 'conflict'
  | 'server'
  | 'unknown';

export interface FailureInfo {
  /** Pesan ramah berbahasa Indonesia, siap ditampilkan. */
  message: string;
  kind: FailureKind;
  /** True bila mencoba ulang operasi yang sama masuk akal. */
  retryable: boolean;
}

const RETRYABLE: Record<FailureKind, boolean> = {
  network: true,
  timeout: true,
  validation: false,
  auth: false,
  forbidden: false,
  notfound: false,
  conflict: false,
  server: true,
  unknown: true,
};

function make(kind: FailureKind, message: string): FailureInfo {
  return { kind, message, retryable: RETRYABLE[kind] };
}

/** Baca body JSON dengan aman (tanpa throw) dari sebuah Response. */
export async function safeJson<T = Record<string, unknown>>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}

/** Pesan validasi aman dari server (hanya untuk 4xx), bila ada. */
export function serverMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  const raw = d.error ?? d.message;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
}

/**
 * Terjemahkan Response yang GAGAL (res.ok === false) menjadi FailureInfo.
 * Pesan validasi/izin dari server dipakai bila aman (4xx & pendek), selain itu
 * pesan umum per kategori agar detail teknis tidak bocor ke pengguna.
 */
export function describeFailure(res: Response, data?: unknown): FailureInfo {
  const fromServer = serverMessage(data);
  const status = res.status;
  if (status === 400 || status === 422) {
    return make('validation', fromServer || 'Data yang dikirim belum valid. Periksa kembali isian Anda.');
  }
  if (status === 401) {
    return make('auth', 'Sesi Anda telah berakhir. Silakan masuk kembali, lalu coba lagi.');
  }
  if (status === 403) {
    return make('forbidden', fromServer || 'Anda tidak memiliki izin untuk melakukan tindakan ini.');
  }
  if (status === 404) {
    return make('notfound', fromServer || 'Data yang dituju tidak ditemukan. Muat ulang halaman lalu coba lagi.');
  }
  if (status === 409) {
    return make('conflict', fromServer || 'Data sudah ada atau sedang diproses. Muat ulang halaman untuk melihat kondisi terbaru.');
  }
  if (status >= 500) {
    return make('server', 'Terjadi gangguan pada server. Data Anda belum tersimpan. Silakan coba lagi beberapa saat lagi.');
  }
  return make('unknown', fromServer || 'Data gagal disimpan. Silakan coba lagi.');
}

/**
 * Terjemahkan error dari blok catch (mis. fetch gagal karena jaringan mati
 * atau dibatalkan karena timeout) menjadi FailureInfo.
 */
export function describeError(err: unknown): FailureInfo {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'AbortError') {
    return make('timeout', 'Permintaan melebihi batas waktu. Periksa koneksi Anda lalu coba lagi.');
  }
  if (err instanceof TypeError) {
    // fetch melempar TypeError saat koneksi gagal (offline/DNS/CORS).
    return make('network', 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda lalu coba lagi.');
  }
  const message = err instanceof Error && err.message ? err.message : '';
  if (message && message !== 'Failed to fetch') return make('unknown', message);
  return make('network', 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda lalu coba lagi.');
}

/**
 * Pola lengkap untuk komponen: jalankan fetch, pastikan HTTP status diperiksa,
 * kembalikan hasil sukses atau FailureInfo — tanpa pernah menyatakan sukses
 * hanya karena request dikirim.
 */
export type OperationOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; failure: FailureInfo };

export async function runRequest<T = Record<string, unknown>>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<OperationOutcome<T>> {
  try {
    const res = await fetch(input, init);
    const data = await safeJson<T>(res);
    if (!res.ok) return { ok: false, failure: describeFailure(res, data) };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, failure: describeError(err) };
  }
}

/** Klasifikasi cepat dari sebuah Error/pesan (dipakai komponen yang sudah punya try/catch). */
export function failureFromUnknown(err: unknown): FailureInfo {
  if (err && typeof err === 'object' && 'kind' in err && 'retryable' in err) {
    return err as FailureInfo;
  }
  return describeError(err);
}
