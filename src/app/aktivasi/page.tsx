import type { Metadata } from 'next';
import { SetPasswordCard } from '@/components/ui/AccountRecovery';

export const metadata: Metadata = {
  title: 'Aktivasi Akun — Desa Ciperna',
  description: 'Aktivasi akun petugas Sistem Pelaporan Fasilitas Umum Desa Ciperna.',
};

export default function AktivasiPage() {
  return (
    <SetPasswordCard
      endpoint="/api/auth/activate"
      title="Aktivasi Akun Petugas"
      subtitle="Buat kata sandi untuk mengaktifkan akun petugas Anda. Tautan ini bersifat rahasia dan hanya berlaku sekali."
      submitLabel="Aktifkan Akun"
      successMessage="Akun berhasil diaktifkan. Silakan masuk."
    />
  );
}
