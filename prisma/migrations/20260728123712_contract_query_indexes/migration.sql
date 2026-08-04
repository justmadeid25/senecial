-- CreateIndex
CREATE INDEX "contracts_organizationId_deletedAt_idx" ON "contracts"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "contracts_organizationId_status_deletedAt_idx" ON "contracts"("organizationId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "contracts_organizationId_endDate_deletedAt_idx" ON "contracts"("organizationId", "endDate", "deletedAt");

-- CreateIndex
CREATE INDEX "contracts_organizationId_updatedAt_deletedAt_idx" ON "contracts"("organizationId", "updatedAt", "deletedAt");
