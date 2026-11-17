'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { roleLabel } from '@/lib/roles';
import { Logo } from '@/components/landing/Logo';

interface NavItem {
  href: string;
  icon: string;
  label: string;
  /** Apakah item ini adalah sub-item (ditampilkan lebih menjorok dalam submenu). */
  sub?: boolean;
  /** Aturan menu aktif. Dipakai untuk membedakan menu yang berbagi route
   *  tetapi berbeda query (mis. tab "Menunggu Verifikasi" pada halaman yang sama). */
  isActive?: (pathname: string, params: URLSearchParams) => boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
  /** Apakah grup ini bisa dikucupkan (collapsible submenu). */
  collapsible?: boolean;
}

/** Route "akar" per role — tidak boleh dianggap parent dari halaman lain. */
const rootRoutes = ['/admin/dashboard', '/masyarakat/dashboard', '/petugas/dashboard'];

/** Pencocokan default: tepat sama, atau halaman turunan (mis. detail). */
function defaultIsActive(pathname: string, href: string) {
  const clean = href.split('?')[0];
  if (pathname === clean) return true;
  if (!rootRoutes.includes(clean) && pathname.startsWith(clean + '/')) return true;
  return false;
}

const roleConfig = {
  CITIZEN: {
    label: 'Masyarakat',
    badgeClass: 'role-badge-citizen',
    icon: '👤',
  },
  ADMIN: {
    label: 'Admin',
    badgeClass: 'role-badge-admin',
    icon: '🛡️',
  },
  OFFICER: {
    label: 'Petugas',
    badgeClass: 'role-badge-officer',
    icon: '👷',
  },
};

function groupsFor(role: string, isActive = true): NavGroup[] {
  if (role === 'ADMIN') {
    return [
      {
        label: 'Menu Utama',
        collapsible: false,
        items: [
          { href: '/admin/dashboard', icon: '🏠', label: 'Dashboard', isActive: (p) => p === '/admin/dashboard' || p.startsWith('/admin/map') },
        ],
      },
      {
        label: 'Manajemen Laporan',
        collapsible: true,
        items: [
          {
            // Satu halaman untuk semua laporan. Antrean verifikasi tersedia
            // sebagai tab "Menunggu Verifikasi" di dalam halaman ini, bukan
            // menu terpisah (dulu duplikat: /admin/laporan?status=SUBMITTED).
            href: '/admin/laporan',
            icon: '📋',
            label: 'Daftar Laporan',
            sub: true,
            isActive: (p) => p.startsWith('/admin/laporan'),
          },
          { href: '/admin/duplikat', icon: '🔗', label: 'Laporan Duplikat', sub: true },
        ],
      },
      {
        label: 'Manajemen Pengguna',
        collapsible: true,
        items: [
          { href: '/admin/masyarakat', icon: '👥', label: 'Data Warga', sub: true },
          { href: '/admin/wilayah', icon: '🗺️', label: 'Wilayah RT/RW', sub: true },
          { href: '/admin/petugas', icon: '👷', label: 'Data Petugas', sub: true },
        ],
      },
      {
        label: 'Portal Desa',
        collapsible: true,
        items: [
          { href: '/admin/profil-desa', icon: '🏘️', label: 'Profil Desa', sub: true },
          { href: '/admin/pemerintahan', icon: '🏛️', label: 'Struktur Pemerintahan', sub: true },
          { href: '/admin/layanan-desa', icon: '🗂️', label: 'Layanan Desa', sub: true },
          { href: '/admin/pengumuman', icon: '📣', label: 'Pengumuman', sub: true },
        ],
      },
      {
        label: 'Operasional',
        collapsible: true,
        items: [
          { href: '/admin/assign', icon: '📌', label: 'Penugasan Petugas', isActive: (p) => p.startsWith('/admin/assign') },
          { href: '/admin/statistik', icon: '📊', label: 'Statistik & Rekap' },
          { href: '/admin/pusat-pengetahuan', icon: '🧠', label: 'Pusat Pengetahuan AI', isActive: (p) => p.startsWith('/admin/pusat-pengetahuan') },
          { href: '/admin/whatsapp-config', icon: '📱', label: 'Pusat WhatsApp Admin', isActive: (p) => p.startsWith('/admin/whatsapp-config') },
          { href: '/admin/whatsapp-recipients', icon: '👥', label: 'Penerima Notifikasi', isActive: (p) => p.startsWith('/admin/whatsapp-recipients') },
          { href: '/admin/ai-config', icon: '🤖', label: 'Konfigurasi Asisten AI', isActive: (p) => p.startsWith('/admin/ai-config') },
        ],
      },
      {
        label: 'Akun',
        collapsible: false,
        items: [{ href: '/admin/profile', icon: '👤', label: 'Profil' }],
      },
    ];
  }

  if (role === 'OFFICER') {
    return [
      {
        label: 'Menu Utama',
        collapsible: false,
        items: [
          { href: '/petugas/dashboard', icon: '🏠', label: 'Dashboard' },
          { href: '/petugas/tugas', icon: '📋', label: 'Tugas Saya' },
          { href: '/petugas/riwayat', icon: '📜', label: 'Riwayat Tugas' },
        ],
      },
      {
        label: 'Akun',
        collapsible: false,
        items: [{ href: '/petugas/profile', icon: '👤', label: 'Profil' }],
      },
    ];
  }

  // CITIZEN (default). "Laporan Saya" sudah memuat status + detail laporan,
  // sehingga "Lacak Status" (fungsi & data sama) digabung ke sini.
  const citizenItems: NavItem[] = [
    { href: '/masyarakat/dashboard', icon: '🏠', label: 'Dashboard' },
    { href: '/masyarakat/laporan/create', icon: '📝', label: 'Buat Laporan' },
    {
      href: '/masyarakat/laporan',
      icon: '📋',
      label: 'Laporan Saya',
      isActive: (p) =>
        p === '/masyarakat/laporan' ||
        (p.startsWith('/masyarakat/laporan/') && p !== '/masyarakat/laporan/create'),
    },
  ];

  return [
    {
      label: 'Menu Utama',
      collapsible: false,
      items: isActive
        ? citizenItems
        : citizenItems.filter((item) => item.href !== '/masyarakat/laporan/create'),
    },
    {
      label: 'Akun',
      collapsible: false,
      items: [{ href: '/masyarakat/profile', icon: '👤', label: 'Profil' }],
    },
  ];
}

function NavItemLink({
  item,
  active,
  pathname,
  params,
}: {
  item: NavItem;
  active: boolean;
  pathname: string;
  params: URLSearchParams;
}) {
  return (
    <Link
      href={item.href}
      className={`sidebar-link${item.sub ? ' sub' : ''}${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="sidebar-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span>{item.label}</span>
    </Link>
  );
}

function NavGroupItem({
  group,
  pathname,
  params,
  openSubmenus,
  toggleSubmenu,
}: {
  group: NavGroup;
  pathname: string;
  params: URLSearchParams;
  openSubmenus: Set<string>;
  toggleSubmenu: (label: string) => void;
}) {
  const isOpen = openSubmenus.has(group.label);
  const hasActiveChild = group.items.some((item) => {
    const active = item.isActive
      ? item.isActive(pathname, params)
      : defaultIsActive(pathname, item.href);
    return active;
  });

  // Non-collapsible groups (Menu Utama, Akun) always show items directly.
  if (!group.collapsible) {
    return (
      <div className="sidebar-group" key={group.label}>
        <div className="sidebar-section-label">{group.label}</div>
        {group.items.map((item) => {
          const active = item.isActive
            ? item.isActive(pathname, params)
            : defaultIsActive(pathname, item.href);
          return <NavItemLink key={item.href} item={item} active={active} pathname={pathname} params={params} />;
        })}
      </div>
    );
  }

  // Collapsible groups act as sub-menus.
  return (
    <div className="sidebar-group" key={group.label}>
      <button
        type="button"
        className={`sidebar-submenu-header${isOpen ? ' open' : ''}${hasActiveChild ? ' has-active' : ''}`}
        onClick={() => toggleSubmenu(group.label)}
        aria-expanded={isOpen}
        aria-label={isOpen ? `Tutup ${group.label}` : `Buka ${group.label}`}
      >
        <span className="sidebar-submenu-icon">{group.label}</span>
        <span className="sidebar-submenu-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="sidebar-submenu-items">
          {group.items.map((item) => {
            const active = item.isActive
              ? item.isActive(pathname, params)
              : defaultIsActive(pathname, item.href);
            return <NavItemLink key={item.href} item={item} active={active} pathname={pathname} params={params} />;
          })}
        </div>
      )}
    </div>
  );
}

function NavContent({
  groups,
  query,
  openSubmenus,
  toggleSubmenu,
}: {
  groups: NavGroup[];
  query: string;
  openSubmenus: Set<string>;
  toggleSubmenu: (label: string) => void;
}) {
  const pathname = usePathname();
  const params = new URLSearchParams(query);

  return (
    <>
      {groups.map((group) => (
        <NavGroupItem
          key={group.label}
          group={group}
          pathname={pathname}
          params={params}
          openSubmenus={openSubmenus}
          toggleSubmenu={toggleSubmenu}
        />
      ))}
    </>
  );
}

function NavWithSearchParams({
  groups,
  openSubmenus,
  toggleSubmenu,
}: {
  groups: NavGroup[];
  openSubmenus: Set<string>;
  toggleSubmenu: (label: string) => void;
}) {
  const params = useSearchParams();
  return (
    <NavContent
      groups={groups}
      query={params?.toString() ?? ''}
      openSubmenus={openSubmenus}
      toggleSubmenu={toggleSubmenu}
    />
  );
}

export function Sidebar({
  role,
  userName,
  userPhoto,
  isActive = true,
}: {
  role: string;
  userName: string;
  userPhoto?: string | null;
  /** Akun nonaktif: menu "Buat Laporan" disembunyikan (API tetap menolak). */
  isActive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [openSubmenus, setOpenSubmenus] = useState<Set<string>>(new Set());
  const pathname = usePathname();
  const config = roleConfig[role as keyof typeof roleConfig] || roleConfig.CITIZEN;
  const groups = groupsFor(role, isActive);

  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  const toggleSubmenu = (label: string) => {
    setOpenSubmenus((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  // Tutup drawer setiap kali rute berubah (mis. tautan di dalam menu diklik).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Tutup drawer saat modal lain dibuka (mis. form tambah perangkat desa).
  useEffect(() => {
    const onCloseSidebar = () => setOpen(false);
    window.addEventListener('close-sidebar', onCloseSidebar);
    return () => window.removeEventListener('close-sidebar', onCloseSidebar);
  }, []);

  // Bila layar melebar ke ukuran desktop (rotasi/resize), tutup drawer agar
  // kunci gulir body tidak tertinggal saat sidebar kembali tampil permanen.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 769px)');
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Kunci gulir halaman selama drawer terbuka, kelola fokus, dan bersihkan
  // saat komponen dilepas. `wasOpen` mencegah fokus berpindah saat load awal.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      document.body.classList.add('drawer-open');
      // Setiap kali drawer dibuka, mulai dari menu paling atas.
      const nav = panelRef.current?.querySelector<HTMLElement>('.sidebar-nav');
      if (nav) nav.scrollTop = 0;
      const timer = window.setTimeout(() => closeRef.current?.focus(), 40);
      return () => window.clearTimeout(timer);
    }

    document.body.classList.remove('drawer-open');
    if (wasOpen.current) {
      wasOpen.current = false;
      window.requestAnimationFrame(() => toggleRef.current?.focus());
    }
    return undefined;
  }, [open]);

  // Pastikan kunci gulir tidak tertinggal bila pengguna berpindah halaman.
  useEffect(() => () => document.body.classList.remove('drawer-open'), []);

  // Escape menutup drawer dari mana pun fokus berada.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Perangkat fokus sederhana: Tab berputar di dalam panel saat drawer terbuka.
  const trapFocus = (e: React.KeyboardEvent) => {
    if (!open || e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      // Navigasi keras supaya layout privat tidak tersaji dari cache (bfcache).
      window.location.assign('/login');
    }
  };

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className={`sidebar-toggle${open ? ' is-open' : ''}`}
        aria-label={open ? 'Tutup menu' : 'Buka menu'}
        aria-expanded={open}
        aria-controls="app-sidebar"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '✕' : '☰'}
      </button>
      {open && (
        <div
          className="sidebar-backdrop"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        id="app-sidebar"
        ref={panelRef}
        className={`sidebar${open ? ' open' : ''}`}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-label="Menu navigasi"
        onKeyDown={trapFocus}
      >
        <button
          ref={closeRef}
          type="button"
          className="sidebar-close"
          aria-label="Tutup menu"
          onClick={() => setOpen(false)}
        >
          <span aria-hidden="true">✕</span>
        </button>

        {/* Brand */}
        <div className="sidebar-brand">
          <Logo size={38} className="sidebar-brand-icon" />
          <div>
            <span className="sidebar-brand-text">Sistem Pelaporan</span>
            <span className="sidebar-brand-sub">Desa Ciperna</span>
          </div>
        </div>

        {/* Navigation */}
        <nav
          className="sidebar-nav"
          onClick={(e) => {
            // Tutup hanya saat tautan menu dipilih; mengetuk label/ruang kosong
            // di dalam daftar tidak menutup drawer.
            if (e.target instanceof Element && e.target.closest('a')) setOpen(false);
          }}
        >
          <Suspense fallback={<NavContent groups={groups} query="" openSubmenus={openSubmenus} toggleSubmenu={toggleSubmenu} />}>
            <NavWithSearchParams groups={groups} openSubmenus={openSubmenus} toggleSubmenu={toggleSubmenu} />
          </Suspense>
        </nav>

        {/* User Profile - Bagian Bawah */}
        <div className="sidebar-user-section">
          <div className="sidebar-user">
            <div
              className="sidebar-user-avatar"
              aria-hidden="true"
              style={userPhoto ? { overflow: 'hidden' } : undefined}
            >
              {userPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={userPhoto}
                  alt={`Foto ${userName}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                config.icon
              )}
            </div>
            <div className="sidebar-user-info">
              <p className="sidebar-user-name">{userName}</p>
              <span className={`sidebar-role-badge ${config.badgeClass}`}>{roleLabel(role)}</span>
            </div>
          </div>
          <button onClick={handleLogout} className="sidebar-logout" aria-label="Logout" title="Logout">
            <span aria-hidden="true">🚪</span>
            <span>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
}
