'use client';

/**
 * SISTEM NOTIFIKASI (toast) — satu komponen konsisten untuk SELURUH operasi
 * simpan/ubah/hapus/unggah di aplikasi (mode terang & gelap, aksesibel).
 *
 * Prinsip yang ditegakkan:
 * - Sukses HANYA ditampilkan setelah server mengonfirmasi (res.ok === true),
 *   bukan saat tombol diklik atau request mulai dikirim.
 * - Pesan gagal dibedakan per jenis (koneksi, validasi, izin, konflik, server)
 *   lewat lib/clientFeedback.ts sehingga pengguna tahu langkah berikutnya.
 * - Kegagalan dapat disertai tombol "Coba lagi" bila memang layak diulang.
 * - Mendukung prefers-reduced-motion (animasi dimatikan otomatis lewat CSS).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { FailureInfo } from '@/lib/clientFeedback';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  message: string;
  kind?: ToastKind;
  /** Durasi tampil (ms). 0 = tidak menutup otomatis (untuk error penting). */
  duration?: number;
  /** Aksi opsional, mis. tombol "Coba lagi". */
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
  kind: ToastKind;
}

interface ToastApi {
  push: (opts: ToastOptions) => void;
  success: (message: string, opts?: Omit<ToastOptions, 'message' | 'kind'>) => void;
  info: (message: string, opts?: Omit<ToastOptions, 'message' | 'kind'>) => void;
  warning: (message: string, opts?: Omit<ToastOptions, 'message' | 'kind'>) => void;
  /** Tampilkan kegagalan; sertakan aksi "Coba lagi" bila failure.retryable. */
  failure: (failure: FailureInfo, retry?: () => void) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Akses API toast. Aman dipanggil walau provider tidak ada (no-op). */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return (
    ctx ?? {
      push: () => {},
      success: () => {},
      info: () => {},
      warning: () => {},
      failure: () => {},
      dismiss: () => {},
    }
  );
}

const ICON: Record<ToastKind, string> = {
  success: '✅',
  error: '⚠️',
  warning: '🔔',
  info: 'ℹ️',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (opts: ToastOptions) => {
      const id = nextId.current++;
      const kind: ToastKind = opts.kind || 'info';
      const item: ToastItem = { ...opts, id, kind };
      setItems((prev) => [...prev, item].slice(-4));
      // Error penting dibiarkan sampai ditutup manual; sisanya menutup otomatis.
      const duration = opts.duration ?? (kind === 'error' ? 0 : 4500);
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
    },
    [dismiss]
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      dismiss,
      success: (message, opts) => push({ ...opts, message, kind: 'success' }),
      info: (message, opts) => push({ ...opts, message, kind: 'info' }),
      warning: (message, opts) => push({ ...opts, message, kind: 'warning' }),
      failure: (failure, retry) =>
        push({
          message: failure.message,
          kind: 'error',
          duration: 0,
          action:
            retry && failure.retryable ? { label: 'Coba lagi', onClick: retry } : undefined,
        }),
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="toast-icon" aria-hidden="true">{ICON[t.kind]}</span>
            <span className="toast-message">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismiss(t.id);
                  t.action!.onClick();
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              className="toast-close"
              aria-label="Tutup notifikasi"
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
