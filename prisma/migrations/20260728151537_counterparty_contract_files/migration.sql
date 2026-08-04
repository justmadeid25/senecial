-- AlterTable
ALTER TABLE "contract_files" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "counterparties" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "contract_files_organizationId_deletedAt_idx" ON "contract_files"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "contract_files_contractId_deletedAt_idx" ON "contract_files"("contractId", "deletedAt");

-- CreateIndex
CREATE INDEX "counterparties_organizationId_deletedAt_idx" ON "counterparties"("organizationId", "deletedAt");
