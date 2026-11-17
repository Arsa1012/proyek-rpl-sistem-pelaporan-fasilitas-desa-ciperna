-- DIAGNONSTIK KONEKSI PROVIDER AI (kode error + penjelasan aman).
--
-- MIGRASI ADDITIF: satu kolom NULLABLE baru pada tabel yang sudah ada.
--  - Tidak menghapus, tidak menimpa, tidak mengubah data lama.
--  - Rollback: SQLite >= 3.35 mendukung DROP COLUMN; bila tidak, kolom diabaikan.
--
-- Isi kolom ini hanya TEKS AMAN (kategori error, HTTP status, model, provider).
-- TIDAK memuat API Key, ciphertext, atau isi respons mentah provider.
ALTER TABLE "AiProvider" ADD COLUMN "lastErrorDetail" TEXT;
