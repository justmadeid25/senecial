-- CreateEnum
CREATE TYPE "MailDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "mail_deliveries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "messageType" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "MailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_deliveries_idempotencyKey_key" ON "mail_deliveries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "mail_deliveries_status_scheduledFor_idx" ON "mail_deliveries"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "mail_deliveries_organizationId_createdAt_idx" ON "mail_deliveries"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "mail_deliveries_userId_createdAt_idx" ON "mail_deliveries"("userId", "createdAt");
