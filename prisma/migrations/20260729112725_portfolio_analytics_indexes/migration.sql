-- CreateIndex
CREATE INDEX "clause_review_signals_organizationId_signalType_status_crea_idx" ON "clause_review_signals"("organizationId", "signalType", "status", "createdAt");

-- CreateIndex
CREATE INDEX "contract_clauses_organizationId_classificationState_idx" ON "contract_clauses"("organizationId", "classificationState");

-- CreateIndex
CREATE INDEX "contracts_organizationId_contractType_deletedAt_idx" ON "contracts"("organizationId", "contractType", "deletedAt");

-- CreateIndex
CREATE INDEX "contracts_organizationId_currency_deletedAt_idx" ON "contracts"("organizationId", "currency", "deletedAt");

-- RenameIndex
ALTER INDEX "contract_clauses_normalizedText_trgm_idx" RENAME TO "contract_clauses_normalizedText_idx";
