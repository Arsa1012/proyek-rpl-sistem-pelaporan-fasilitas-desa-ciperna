'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'ciperna-theme';

function getInitialTheme(): 'light' | 'dark' {
  if (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark') {
    return 'dark';
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function ThemeToggle({ withLabel = false }: { withLabel?: boolean }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(getInitialTheme());
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Abaikan jika penyimpanan tidak tersedia
    }
  };

  const isDark = mounted && theme === 'dark';
  const label = isDark ? 'Mode terang' : 'Mode gelap';

  return (
    <button
      type="button"
      className={`theme-toggle${withLabel ? ' theme-toggle--labeled' : ''}`}
      onClick={toggle}
      aria-label={isDark ? 'Ubah ke mode terang' : 'Ubah ke mode gelap'}
      aria-pressed={isDark}
      title={label}
    >
      <span aria-hidden="true" className="theme-toggle-icon">
        {isDark ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
          </svg>
        )}
      </span>
      {withLabel && <span>{label}</span>}
    </button>
  );
}
