-- KEBIJAKAN MODEL GRATIS (bukti status gratis per model).
--
-- MIGRASI ADDITIF: hanya membuat tabel BARU.
--  - Tidak altering, tidak menghapus, tidak menimpa tabel/data yang ada.
--  - Rollback = DROP TABLE "AiModelPolicy" (data lama tidak tersentuh).
--
-- Isi tabel ini hanya metadata publik: id model + status gratis + sumber bukti.
-- TIDAK memuat API Key, ciphertext, atau secret apa pun.
CREATE TABLE "AiModelPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "freeStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "evidenceUrl" TEXT,
    "verifiedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Satu model per provider (idempoten saat verifikasi ulang).
CREATE UNIQUE INDEX "AiModelPolicy_provider_modelId_key" ON "AiModelPolicy"("provider", "modelId");

-- Pencarian cepat per provider.
CREATE INDEX "AiModelPolicy_provider_idx" ON "AiModelPolicy"("provider");

-- Pencarian cepat per status (hanya VERIFIED_FREE yang boleh dipakai).
CREATE INDEX "AiModelPolicy_freeStatus_idx" ON "AiModelPolicy"("freeStatus");
