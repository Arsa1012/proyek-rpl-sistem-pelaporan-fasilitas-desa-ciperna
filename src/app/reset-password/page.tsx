import type { Metadata } from 'next';
import { SetPasswordCard } from '@/components/ui/AccountRecovery';

export const metadata: Metadata = {
  title: 'Reset Kata Sandi — Desa Ciperna',
  description: 'Buat kata sandi baru untuk akun Sistem Pelaporan Fasilitas Umum Desa Ciperna.',
};

export default function ResetPasswordPage() {
  return (
    <SetPasswordCard
      endpoint="/api/auth/reset-password"
      title="Buat Kata Sandi Baru"
      subtitle="Masukkan kata sandi baru untuk akun Anda. Tautan ini bersifat rahasia dan hanya berlaku sekali."
      submitLabel="Simpan Kata Sandi Baru"
      successMessage="Kata sandi berhasil diperbarui. Silakan masuk."
    />
  );
}
