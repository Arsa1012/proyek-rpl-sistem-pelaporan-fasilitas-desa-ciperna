/**
 * Lambang sementara institusi Desa Ciperna.
 * Belum ada berkas lambang resmi di /public, jadi dipakai penanda
 * bergaya institusi (ikon gedung + atap). Ganti dengan berkas resmi
 * bila tersedia tanpa mengubah tata letak.
 */
export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="Lambang Desa Ciperna"
    >
      <defs>
        <linearGradient id="cipernaLogoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0F766E" />
          <stop offset="100%" stopColor="#16A34A" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="45" height="45" rx="13" fill="url(#cipernaLogoGrad)" />
      <path d="M24 9 11 18h26L24 9Z" fill="#FFFFFF" opacity="0.95" />
      <rect x="14" y="19" width="20" height="18" rx="2" fill="#FFFFFF" opacity="0.95" />
      <rect x="18" y="23" width="4" height="4" rx="1" fill="#0F766E" />
      <rect x="26" y="23" width="4" height="4" rx="1" fill="#0F766E" />
      <rect x="18" y="30" width="4" height="4" rx="1" fill="#0F766E" />
      <rect x="26" y="30" width="4" height="4" rx="1" fill="#0F766E" />
      <rect x="21" y="37" width="6" height="9" rx="1.5" fill="#0F766E" />
      <rect x="6" y="38" width="36" height="3.5" rx="1.75" fill="#FFFFFF" opacity="0.9" />
    </svg>
  );
}
