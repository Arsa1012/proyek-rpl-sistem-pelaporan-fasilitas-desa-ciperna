-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone" TEXT,
    "photo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "suspendReason" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "phoneVerifiedAt" DATETIME,
    "role" TEXT NOT NULL DEFAULT 'CITIZEN',
    "rtId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_rtId_fkey" FOREIGN KEY ("rtId") REFERENCES "VillageRt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "damageType" TEXT,
    "severity" TEXT,
    "location" TEXT NOT NULL,
    "latitude" REAL,
    "longitude" REAL,
    "photo" TEXT,
    "aiResult" TEXT,
    "aiConfidence" REAL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "rejectionReason" TEXT,
    "duplicateStatus" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "duplicateOfReportId" TEXT,
    "duplicateConfidence" REAL,
    "duplicateReason" TEXT,
    "duplicateBand" TEXT,
    "duplicateReviewedBy" TEXT,
    "duplicateReviewedAt" DATETIME,
    "aiStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "aiAnalyzedAt" DATETIME,
    "aiModel" TEXT,
    "aiError" TEXT,
    "analysisCount" INTEGER NOT NULL DEFAULT 0,
    "clientKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "category" TEXT,
    "damageType" TEXT,
    "severity" TEXT,
    "confidence" REAL,
    "summary" TEXT,
    "urgencyReason" TEXT,
    "reasons" TEXT,
    "facts" TEXT,
    "missing" TEXT,
    "recommendation" TEXT,
    "suggestedAction" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportAnalysis_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "notes" TEXT,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    "cancelledBy" TEXT,
    "reviewStatus" TEXT,
    "reviewNotes" TEXT,
    "reviewedAt" DATETIME,
    "reviewedBy" TEXT,
    "notifyMode" TEXT,
    CONSTRAINT "Assignment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assignment_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "photo" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportEvidence_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportEvidence_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportStatusHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportStatusHistory_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "url" TEXT,
    "announcementId" TEXT,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "VillageAnnouncement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetReportId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "VillageProfile" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "name" TEXT NOT NULL DEFAULT 'Desa Ciperna',
    "district" TEXT NOT NULL DEFAULT 'Talun',
    "regency" TEXT NOT NULL DEFAULT 'Cirebon',
    "province" TEXT NOT NULL DEFAULT 'Jawa Barat',
    "postalCode" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "mapLink" TEXT,
    "mapEmbedUrl" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "coordinateSource" TEXT,
    "heroPhoto" TEXT,
    "history" TEXT,
    "historySource" TEXT,
    "geography" TEXT,
    "potential" TEXT,
    "demographics" TEXT,
    "vision" TEXT,
    "mission" TEXT,
    "serviceHours" TEXT,
    "dataStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "sourceUrl" TEXT,
    "verifiedAt" DATETIME,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VillageOfficial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'LAINNYA',
    "level" INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL DEFAULT 0,
    "area" TEXT,
    "period" TEXT,
    "photo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT,
    "verifiedAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VillageService" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "requirements" TEXT,
    "procedure" TEXT,
    "schedule" TEXT,
    "contact" TEXT,
    "link" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VillageAnnouncement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "excerpt" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" DATETIME,
    "authorId" TEXT,
    "category" TEXT,
    "coverPhoto" TEXT,
    "photos" TEXT,
    "target" TEXT NOT NULL DEFAULT 'ALL',
    "notifyWhatsApp" BOOLEAN NOT NULL DEFAULT false,
    "waSendCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "archivedAt" DATETIME,
    "deletedAt" DATETIME,
    "deletedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AnnouncementDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toMasked" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AnnouncementDelivery_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "VillageAnnouncement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VillageRw" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "name" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VillageRt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rwId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VillageRt_rwId_fkey" FOREIGN KEY ("rwId") REFERENCES "VillageRw" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "toMasked" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FonnteConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "adminPhone" TEXT NOT NULL,
    "lastValidation" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RegistrationOtp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "rtId" TEXT,
    "otpHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AccountToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AiKnowledgeEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'LAINNYA',
    "sourceType" TEXT NOT NULL DEFAULT 'CHAT',
    "sourceId" TEXT,
    "sourceRole" TEXT NOT NULL,
    "sourceUserId" TEXT,
    "sourceUserName" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "verifiedAt" DATETIME,
    "verificationNotes" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Report_aiStatus_idx" ON "Report"("aiStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Report_userId_clientKey_key" ON "Report"("userId", "clientKey");

-- CreateIndex
CREATE INDEX "ReportAnalysis_reportId_createdAt_idx" ON "ReportAnalysis"("reportId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_announcementId_idx" ON "Notification"("announcementId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_announcementId_key" ON "Notification"("userId", "announcementId");

-- CreateIndex
CREATE INDEX "VillageOfficial_isActive_level_order_idx" ON "VillageOfficial"("isActive", "level", "order");

-- CreateIndex
CREATE INDEX "VillageService_isActive_order_idx" ON "VillageService"("isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "VillageAnnouncement_slug_key" ON "VillageAnnouncement"("slug");

-- CreateIndex
CREATE INDEX "VillageAnnouncement_isPublished_publishedAt_idx" ON "VillageAnnouncement"("isPublished", "publishedAt");

-- CreateIndex
CREATE INDEX "VillageAnnouncement_deletedAt_archivedAt_idx" ON "VillageAnnouncement"("deletedAt", "archivedAt");

-- CreateIndex
CREATE INDEX "AnnouncementDelivery_announcementId_status_idx" ON "AnnouncementDelivery"("announcementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementDelivery_announcementId_userId_key" ON "AnnouncementDelivery"("announcementId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "VillageRw_number_key" ON "VillageRw"("number");

-- CreateIndex
CREATE INDEX "VillageRt_rwId_isActive_idx" ON "VillageRt"("rwId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "VillageRt_rwId_number_key" ON "VillageRt"("rwId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppLog_dedupeKey_key" ON "WhatsAppLog"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationOtp_email_key" ON "RegistrationOtp"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationOtp_phone_key" ON "RegistrationOtp"("phone");

-- CreateIndex
CREATE INDEX "RegistrationOtp_expiresAt_idx" ON "RegistrationOtp"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountToken_tokenHash_key" ON "AccountToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AccountToken_userId_purpose_idx" ON "AccountToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "AccountToken_expiresAt_idx" ON "AccountToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AiKnowledgeEntry_category_verified_idx" ON "AiKnowledgeEntry"("category", "verified");

-- CreateIndex
CREATE INDEX "AiKnowledgeEntry_sourceRole_idx" ON "AiKnowledgeEntry"("sourceRole");

-- CreateIndex
CREATE INDEX "AiKnowledgeEntry_verified_idx" ON "AiKnowledgeEntry"("verified");

-- CreateIndex
CREATE INDEX "AiKnowledgeEntry_createdAt_idx" ON "AiKnowledgeEntry"("createdAt");
