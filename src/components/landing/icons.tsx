/**
 * Set ikon SVG inline untuk halaman publik (tanpa dependency tambahan).
 * Semua ikon memakai stroke konsisten 1.8px, currentColor, 24x24 viewBox.
 */

interface IconProps {
  size?: number;
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

export function IconReport({ size = 28 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

export function IconTrack({ size = 28 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function IconBot({ size = 28 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 8V4M8 4h8" />
      <circle cx="9" cy="13" r="0.5" fill="currentColor" />
      <circle cx="15" cy="13" r="0.5" fill="currentColor" />
      <path d="M9.5 16h5" />
    </svg>
  );
}

export function IconBuilding({ size = 28 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 21h18M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-6h6v6M9 10h.01M15 10h.01" />
    </svg>
  );
}

export function IconRoad({ size = 28 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M5 21 9 3M19 21 15 3" />
      <path d="M12 6v2M12 11v2M12 16v2" />
    </svg>
  );
}

export function IconLamp({ size = 28 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.8.6 1.5 1.3 1.5 2.1h4c0-.8.7-1.5 1.5-2.1A6 6 0 0 0 12 3Z" />
    </svg>
  );
}

export function IconWater({ size = 28 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3s6 6.3 6 11a6 6 0 0 1-12 0c0-4.7 6-11 6-11Z" />
      <path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5" />
    </svg>
  );
}

export function IconSchool({ size = 28 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3 2 8l10 5 10-5-10-5Z" />
      <path d="M6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5" />
      <path d="M22 8v6" />
    </svg>
  );
}

export function IconCheck({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconVillage({ size = 28 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 11 12 4l9 7" />
      <path d="M5 10v10h5v-6h4v6h5V10" />
      <circle cx="17.5" cy="17.5" r="2.5" />
      <path d="M17.5 15v2.5l1.5 1" />
    </svg>
  );
}

export function IconSpark({ size = 28 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5 19 19M19 5l-2.5 2.5M7.5 16.5 5 19" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

export function IconPhone({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

export function IconInstagram({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
