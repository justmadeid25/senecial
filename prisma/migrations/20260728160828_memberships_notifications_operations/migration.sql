-- AlterTable
ALTER TABLE "contract_files" ADD COLUMN     "storageDeleteAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "storageDeleteError" TEXT,
ADD COLUMN     "storageDeletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "organization_invitations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_receipts" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitations_tokenHash_key" ON "organization_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "organization_invitations_organizationId_email_idx" ON "organization_invitations"("organizationId", "email");

-- CreateIndex
CREATE INDEX "organization_invitations_organizationId_createdAt_idx" ON "organization_invitations"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "organization_invitations_organizationId_acceptedAt_revokedA_idx" ON "organization_invitations"("organizationId", "acceptedAt", "revokedAt");

-- CreateIndex
CREATE INDEX "organization_invitations_expiresAt_idx" ON "organization_invitations"("expiresAt");

-- CreateIndex
CREATE INDEX "notifications_organizationId_createdAt_idx" ON "notifications"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_contractId_idx" ON "notifications"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organizationId_eventKey_key" ON "notifications"("organizationId", "eventKey");

-- CreateIndex
CREATE INDEX "notification_receipts_userId_readAt_idx" ON "notification_receipts"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_receipts_notificationId_userId_key" ON "notification_receipts"("notificationId", "userId");

-- CreateIndex
CREATE INDEX "contract_files_deletedAt_storageDeletedAt_storageDeleteAtte_idx" ON "contract_files"("deletedAt", "storageDeletedAt", "storageDeleteAttempts");

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
