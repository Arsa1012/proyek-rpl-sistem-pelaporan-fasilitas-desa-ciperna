import type { Metadata } from 'next';
import { RequestResetCard } from '@/components/ui/AccountRecovery';

export const metadata: Metadata = {
  title: 'Lupa Kata Sandi — Desa Ciperna',
  description: 'Minta tautan reset kata sandi Sistem Pelaporan Fasilitas Umum Desa Ciperna.',
};

export default function LupaPasswordPage() {
  return <RequestResetCard />;
}
