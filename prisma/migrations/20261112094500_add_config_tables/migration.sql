-- PENERIMA NOTIFIKASI WHATSAPP ADMIN (terpisah dari perangkat pengirim Fonnte).
-- Satu nomor boleh berstatus AKTIF pada satu waktu (partial UNIQUE INDEX).
CREATE TABLE "NotificationRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- KONFIGURASI PROVIDER AI (OpenRouter / Gemini / Groq).
-- API Key disimpan TERENKRIPSI (AES-256-GCM) pada "apiKeyCipher".
CREATE TABLE "AiProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "apiKeyCipher" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "primaryModel" TEXT,
    "fallbackModels" TEXT,
    "models" TEXT,
    "lastValidation" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Token Fonnte terenkripsi. Kolom "token" yang lama (plaintext) DIJAGA sebagai
-- jalur transisi & sumber data migrasi, dan tidak dihapus.
ALTER TABLE "FonnteConfig" ADD COLUMN "tokenCipher" TEXT;

-- Index
CREATE INDEX "NotificationRecipient_isActive_idx" ON "NotificationRecipient"("isActive");
CREATE INDEX "NotificationRecipient_phone_idx" ON "NotificationRecipient"("phone");
CREATE INDEX "AiProvider_isActive_idx" ON "AiProvider"("isActive");

-- Partial UNIQUE INDEX: menjamin HANYA SATU penerima aktif & HANYA SATU
-- provider AI aktif. SQLite membolehkan banyak NULL pada kolom UNIQUE biasa,
-- jadi pola "activeMarker nullable" TIDAK bisa dipakai di sini; partial index
-- adalah mekanisme yang benar dan sudah diuji (SQLite 3.45.0).
CREATE UNIQUE INDEX "NotificationRecipient_one_active" ON "NotificationRecipient"("isActive") WHERE "isActive" = 1;
CREATE UNIQUE INDEX "AiProvider_one_active" ON "AiProvider"("isActive") WHERE "isActive" = 1;

-- Unique per jenis provider (satu baris per provider).
CREATE UNIQUE INDEX "AiProvider_provider_key" ON "AiProvider"("provider");
