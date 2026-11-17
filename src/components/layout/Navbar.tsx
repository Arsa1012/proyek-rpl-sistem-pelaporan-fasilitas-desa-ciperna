'use client';
import { Button } from '@/components/ui/Button';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { roleLabel } from '@/lib/roles';

export function Navbar({ userName, role, userPhoto }: { userName: string, role: string, userPhoto?: string | null }) {
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* abaikan: cookie tetap dibersihkan di server bila memungkinkan */
    }
    // Navigasi KERAS agar layout root (navbar publik + sesi) dirender ulang
    // oleh server. Mencegah sisa status login lama muncul di halaman login.
    window.location.assign('/login');
  };

  return (
    <header className="topbar glass">
      <div className="topbar-user">
        <span className="topbar-avatar" aria-hidden="true" style={userPhoto ? { overflow: 'hidden' } : undefined}>
          {userPhoto ? (
            <img src={userPhoto} alt={`Foto ${userName}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            userName.charAt(0).toUpperCase()
          )}
        </span>
        <div className="topbar-user-text">
          <strong className="topbar-name">{userName}</strong>
          <span className="topbar-role">{roleLabel(role)}</span>
        </div>
      </div>
      <div className="topbar-actions">
        <ThemeToggle withLabel />
        <NotificationBell role={role} />
        <Button variant="danger" onClick={handleLogout}>Logout</Button>
      </div>
    </header>
  );
}
