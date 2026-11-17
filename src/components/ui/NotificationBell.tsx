'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type NotificationType =
  | 'REPORT_CREATED'
  | 'REPORT_VERIFIED'
  | 'REPORT_REJECTED'
  | 'REPORT_ASSIGNED'
  | 'WORK_STARTED'
  | 'REPORT_COMPLETED'
  | 'POSSIBLE_DUPLICATE'
  | 'REPORT_DUPLICATE'
  | 'ASSIGNMENT_CANCELLED'
  | 'ANNOUNCEMENT';

interface ServerNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
  /** Tautan tujuan (mis. /pengumuman/<slug>) bila notifikasi punya halaman detail. */
  url?: string | null;
}

interface NotificationBellProps {
  role?: string;
}

const TYPE_EMOJI: Record<NotificationType, string> = {
  REPORT_CREATED: '✅',
  REPORT_VERIFIED: '🔍',
  REPORT_REJECTED: '🚫',
  REPORT_ASSIGNED: '📋',
  WORK_STARTED: '🔧',
  REPORT_COMPLETED: '🏁',
  POSSIBLE_DUPLICATE: '🔗',
  REPORT_DUPLICATE: '⚠️',
  ASSIGNMENT_CANCELLED: '🚫',
  ANNOUNCEMENT: '📣',
};

function timeAgo(input: string | Date): string {
  const d = new Date(input);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'baru saja';
  if (diffMin < 60) return `${diffMin} menit yang lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam yang lalu`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} hari yang lalu`;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function emojiFor(type: string): string {
  return (TYPE_EMOJI as Record<string, string>)[type] ?? '🔔';
}

export function NotificationBell({ role }: NotificationBellProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<ServerNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  // Pada layar sempit, panel yang rata kanan dapat keluar dari sisi kiri.
  // Nilai ini menggeser panel ke kanan seperlunya agar tetap di dalam viewport.
  const [dropdownShift, setDropdownShift] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications');
      if (res.status === 401) return;
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    load();
    const intervalId = setInterval(load, 30000);
    return () => clearInterval(intervalId);
  }, [load]);

  // Tutup panel saat klik di luar atau menekan Escape.
  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Jaga panel notifikasi tetap berada di dalam viewport pada layar sempit.
  useEffect(() => {
    if (!open) {
      setDropdownShift(0);
      return;
    }
    const update = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(340, window.innerWidth - 32);
      const overflowLeft = rect.right - width;
      setDropdownShift(overflowLeft < 16 ? Math.ceil(16 - overflowLeft) : 0);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  const markRead = useCallback(async (id: string) => {
    // Optimistic update lokal
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      });
    } catch {
      /* silent */
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readAll: true }),
      });
      if (!res.ok) {
        // Refresh state dari server
        load();
      }
    } catch {
      load();
    }
  }, [load]);

  const handleItemClick = useCallback(
    async (n: ServerNotification) => {
      if (!n.isRead) {
        await markRead(n.id);
      }
      setOpen(false);

      // NAVIGASI:
      // - WORK_STARTED / REPORT_COMPLETED / lainnya -> /dashboard/reports
      // - REPORT_ASSIGNED + OFFICER -> /officer/tasks
      const r = (role || '').toUpperCase();
      // Notifikasi dengan tautan tujuan eksplisit (mis. pengumuman) → buka tautannya.
      if (n.url) {
        router.push(n.url);
      } else if (n.type === 'REPORT_ASSIGNED' && r === 'OFFICER') {
        router.push('/petugas/tugas');
      } else if (n.type === 'ASSIGNMENT_CANCELLED' && r === 'OFFICER') {
        router.push('/petugas/tugas');
      } else if (n.type === 'ASSIGNMENT_CANCELLED' && r === 'ADMIN') {
        router.push('/admin/assign');
      } else if (n.type === 'POSSIBLE_DUPLICATE' && r === 'ADMIN') {
        router.push('/admin/duplikat');
      } else if (
        n.type === 'WORK_STARTED' ||
        n.type === 'REPORT_COMPLETED' ||
        n.type === 'REPORT_CREATED' ||
        n.type === 'REPORT_VERIFIED' ||
        n.type === 'REPORT_REJECTED' ||
        n.type === 'REPORT_DUPLICATE'
      ) {
        // Halaman laporan sesuai role (rute lama /dashboard/reports tidak ada).
        if (r === 'ADMIN') {
          router.push('/admin/laporan');
        } else if (r === 'OFFICER') {
          router.push('/petugas/tugas');
        } else {
          router.push('/masyarakat/laporan');
        }
      } else {
        // REPORT_ASSIGNED untuk ADMIN/CITIZEN -> tetap di tempat (tidak navigasi)
        setOpen(false);
      }
    },
    [markRead, role, router]
  );

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        aria-label="Notifikasi"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((s) => !s)}
        style={{
          position: 'relative',
          background: 'var(--surface-solid, #fff)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          width: '40px',
          height: '40px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          transition: 'background 150ms ease, color 150ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(15,118,110,0.12)';
          e.currentTarget.style.color = 'var(--primary-color)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--surface-solid, #fff)';
          e.currentTarget.style.color = 'var(--text-secondary)';
        }}
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-6px',
              right: '-6px',
              background: 'var(--danger-color, #dc2626)',
              color: '#fff',
              fontSize: '0.68rem',
              fontWeight: 700,
              lineHeight: 1,
              minWidth: '18px',
              height: '18px',
              borderRadius: '9999px',
              padding: '0 4px',
              border: '2px solid var(--surface-solid, #fff)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: -dropdownShift,
            width: 'min(340px, calc(100vw - 2rem))',
            maxHeight: 'min(380px, calc(100dvh - 9rem))',
            boxSizing: 'border-box',
            overflow: 'hidden',
            background: 'var(--surface-solid)',
            color: 'var(--text-primary)',
            borderRadius: '12px',
            boxShadow: '0 16px 40px -12px rgba(0,0,0,0.35)',
            border: '1px solid var(--border-color)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '0.75rem 1rem',
              borderBottom: '1px solid var(--divider)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontWeight: 700,
              fontSize: '0.9rem',
            }}
          >
            <span>🔔 Notifikasi</span>
            <span style={{ fontWeight: 500, color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
              {unreadCount > 0 ? `${unreadCount} baru` : 'Tidak ada baru'}
            </span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div
                style={{
                  padding: '2rem 1rem',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '0.875rem',
                }}
              >
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.5 }}>📭</div>
                Belum ada notifikasi.
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  title={n.message}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.6rem',
                    width: '100%',
                    padding: '0.7rem 1rem',
                    borderBottom: '1px solid var(--divider)',
                    background: n.isRead ? 'transparent' : 'var(--soft-primary-bg)',
                    border: 'none',
                    borderTop: 'none',
                    borderRight: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    font: 'inherit',
                    color: 'inherit',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--hover-bg)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = n.isRead ? 'transparent' : 'var(--soft-primary-bg)';
                  }}
                >
                  <span style={{ fontSize: '1.1rem', lineHeight: 1.2 }}>
                    {emojiFor(n.type)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {n.title}
                              {n.isRead ? null : (
                        <span
                          style={{
                            display: 'inline-block',
                            marginLeft: '0.35rem',
                            width: '7px',
                            height: '7px',
                            borderRadius: '9999px',
                            background: 'var(--primary-color, #2563eb)',
                            transform: 'translateY(-2px)',
                          }}
                        />
                      )}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        color: 'var(--text-secondary)',
                        fontSize: '0.78rem',
                        marginLeft: '1.1rem',
                        lineHeight: 1.4,
                      }}
                    >
                      {n.message}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        color: 'var(--text-secondary)',
                        opacity: 0.8,
                        fontSize: '0.72rem',
                        marginLeft: '1.1rem',
                        marginTop: '0.2rem',
                      }}
                    >
                      {timeAgo(n.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          {notifications.length > 0 && (
            <div
              style={{
                padding: '0.5rem 0.75rem',
                borderTop: '1px solid var(--divider)',
                background: 'var(--hover-bg)',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={markAllRead}
                disabled={unreadCount === 0}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--primary-color, #2563eb)',
                  fontWeight: 600,
                  fontSize: '0.78rem',
                  cursor: unreadCount === 0 ? 'default' : 'pointer',
                  opacity: unreadCount === 0 ? 0.5 : 1,
                }}
              >
                ✦ Tandai semua dibaca
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}