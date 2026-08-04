-- CreateEnum
CREATE TYPE "ClauseSegmentationJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'REVIEW_REQUIRED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClauseType" AS ENUM ('DEFINITIONS', 'TERM', 'TERMINATION', 'PAYMENT', 'PRICE_ADJUSTMENT', 'SCOPE_OF_WORK', 'DELIVERY', 'ACCEPTANCE', 'WARRANTY', 'LIABILITY', 'LIMITATION_OF_LIABILITY', 'INDEMNITY', 'CONFIDENTIALITY', 'INTELLECTUAL_PROPERTY', 'DATA_PROTECTION', 'SECURITY', 'NON_COMPETE', 'NON_SOLICITATION', 'AUTO_RENEWAL', 'NOTICE', 'FORCE_MAJEURE', 'GOVERNING_LAW', 'JURISDICTION', 'DISPUTE_RESOLUTION', 'ASSIGNMENT', 'CHANGE_CONTROL', 'AUDIT_RIGHTS', 'COMPLIANCE', 'INSURANCE', 'SUBCONTRACTING', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ClauseClassificationState" AS ENUM ('UNREVIEWED', 'CONFIRMED', 'CORRECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClauseReviewSignalStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ClauseReviewSignalType" AS ENUM ('MISSING_EXPECTED_CLAUSE', 'DIFFERENT_FROM_STANDARD', 'UNUSUAL_NUMBER', 'UNUSUAL_DURATION', 'AUTO_RENEWAL_PRESENT', 'UNLIMITED_LIABILITY_LANGUAGE', 'BROAD_INDEMNITY_LANGUAGE', 'ONE_SIDED_TERMINATION_LANGUAGE', 'MANUAL_REVIEW');

-- CreateTable
CREATE TABLE "clause_segmentation_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "extractedDocumentId" TEXT NOT NULL,
    "status" "ClauseSegmentationJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "segmenterVersion" TEXT NOT NULL,
    "inputChecksum" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "warnings" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clause_segmentation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_sections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "extractedDocumentId" TEXT NOT NULL,
    "segmentationJobId" TEXT NOT NULL,
    "title" TEXT,
    "sectionType" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_clauses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "extractedDocumentId" TEXT NOT NULL,
    "segmentationJobId" TEXT NOT NULL,
    "sectionId" TEXT,
    "parentClauseId" TEXT,
    "clauseNumber" TEXT,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "sourcePageStart" INTEGER,
    "sourcePageEnd" INTEGER,
    "suggestedClauseType" "ClauseType",
    "reviewedClauseType" "ClauseType",
    "classificationState" "ClauseClassificationState" NOT NULL DEFAULT 'UNREVIEWED',
    "classificationConfidence" DECIMAL(3,2),
    "classificationSignals" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_clauses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clause_standards" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clauseType" "ClauseType" NOT NULL,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "clause_standards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clause_review_signals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractClauseId" TEXT,
    "clauseStandardId" TEXT,
    "clauseType" "ClauseType",
    "signalType" "ClauseReviewSignalType" NOT NULL,
    "status" "ClauseReviewSignalStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceText" VARCHAR(500),
    "ruleVersion" TEXT NOT NULL,
    "signalKey" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clause_review_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clause_segmentation_jobs_jobKey_key" ON "clause_segmentation_jobs"("jobKey");

-- CreateIndex
CREATE INDEX "clause_segmentation_jobs_organizationId_status_createdAt_idx" ON "clause_segmentation_jobs"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "clause_segmentation_jobs_contractId_createdAt_idx" ON "clause_segmentation_jobs"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "clause_segmentation_jobs_extractedDocumentId_createdAt_idx" ON "clause_segmentation_jobs"("extractedDocumentId", "createdAt");

-- CreateIndex
CREATE INDEX "clause_segmentation_jobs_status_createdAt_idx" ON "clause_segmentation_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "contract_sections_organizationId_contractId_orderIndex_idx" ON "contract_sections"("organizationId", "contractId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "contract_sections_segmentationJobId_orderIndex_key" ON "contract_sections"("segmentationJobId", "orderIndex");

-- CreateIndex
CREATE INDEX "contract_clauses_organizationId_contractId_orderIndex_idx" ON "contract_clauses"("organizationId", "contractId", "orderIndex");

-- CreateIndex
CREATE INDEX "contract_clauses_organizationId_suggestedClauseType_idx" ON "contract_clauses"("organizationId", "suggestedClauseType");

-- CreateIndex
CREATE INDEX "contract_clauses_organizationId_reviewedClauseType_idx" ON "contract_clauses"("organizationId", "reviewedClauseType");

-- CreateIndex
CREATE INDEX "contract_clauses_parentClauseId_idx" ON "contract_clauses"("parentClauseId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_clauses_segmentationJobId_orderIndex_key" ON "contract_clauses"("segmentationJobId", "orderIndex");

-- CreateIndex
CREATE INDEX "clause_standards_organizationId_clauseType_deletedAt_idx" ON "clause_standards"("organizationId", "clauseType", "deletedAt");

-- CreateIndex
CREATE INDEX "clause_standards_organizationId_updatedAt_deletedAt_idx" ON "clause_standards"("organizationId", "updatedAt", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "clause_review_signals_signalKey_key" ON "clause_review_signals"("signalKey");

-- CreateIndex
CREATE INDEX "clause_review_signals_organizationId_contractId_status_idx" ON "clause_review_signals"("organizationId", "contractId", "status");

-- CreateIndex
CREATE INDEX "clause_review_signals_contractClauseId_idx" ON "clause_review_signals"("contractClauseId");

-- AddForeignKey
ALTER TABLE "clause_segmentation_jobs" ADD CONSTRAINT "clause_segmentation_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_segmentation_jobs" ADD CONSTRAINT "clause_segmentation_jobs_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_segmentation_jobs" ADD CONSTRAINT "clause_segmentation_jobs_extractedDocumentId_fkey" FOREIGN KEY ("extractedDocumentId") REFERENCES "contract_extracted_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_segmentation_jobs" ADD CONSTRAINT "clause_segmentation_jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_sections" ADD CONSTRAINT "contract_sections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_sections" ADD CONSTRAINT "contract_sections_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_sections" ADD CONSTRAINT "contract_sections_segmentationJobId_fkey" FOREIGN KEY ("segmentationJobId") REFERENCES "clause_segmentation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_segmentationJobId_fkey" FOREIGN KEY ("segmentationJobId") REFERENCES "clause_segmentation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "contract_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_parentClauseId_fkey" FOREIGN KEY ("parentClauseId") REFERENCES "contract_clauses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_standards" ADD CONSTRAINT "clause_standards_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_standards" ADD CONSTRAINT "clause_standards_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_review_signals" ADD CONSTRAINT "clause_review_signals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_review_signals" ADD CONSTRAINT "clause_review_signals_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_review_signals" ADD CONSTRAINT "clause_review_signals_contractClauseId_fkey" FOREIGN KEY ("contractClauseId") REFERENCES "contract_clauses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_review_signals" ADD CONSTRAINT "clause_review_signals_clauseStandardId_fkey" FOREIGN KEY ("clauseStandardId") REFERENCES "clause_standards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_review_signals" ADD CONSTRAINT "clause_review_signals_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enable pg_trgm for fast Korean substring search on ContractClause.normalizedText.
-- This is a pure performance layer: the application always queries with
-- ILIKE (Prisma's contains + mode:"insensitive", same pattern already used
-- by the contract search service), which is correct with or without this
-- index - if the extension or index is ever unavailable in some future
-- deployment target, search still works, just via a sequential scan.
-- Verified manually against both this project's dev and test databases
-- (PostgreSQL 18.4) before adding this migration.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "contract_clauses_normalizedText_trgm_idx" ON "contract_clauses" USING gin ("normalizedText" gin_trgm_ops);
