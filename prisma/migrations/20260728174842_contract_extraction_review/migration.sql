-- CreateEnum
CREATE TYPE "ExtractionJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'REVIEW_REQUIRED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExtractionStage" AS ENUM ('FILE_TEXT_EXTRACTION', 'CONTRACT_FIELD_EXTRACTION', 'READY_FOR_REVIEW');

-- CreateEnum
CREATE TYPE "SuggestionReviewStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EDITED');

-- CreateTable
CREATE TABLE "contract_extraction_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractFileId" TEXT NOT NULL,
    "status" "ExtractionJobStatus" NOT NULL DEFAULT 'PENDING',
    "stage" "ExtractionStage",
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "provider" TEXT,
    "model" TEXT,
    "extractorVersion" TEXT NOT NULL,
    "inputChecksum" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "contractUpdatedAtSnapshot" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_extraction_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_extracted_documents" (
    "id" TEXT NOT NULL,
    "extractionJobId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractFileId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "characterCount" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "language" TEXT,
    "extractionMethod" TEXT NOT NULL,
    "contentChecksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_extracted_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_field_suggestions" (
    "id" TEXT NOT NULL,
    "extractionJobId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "rawValue" TEXT,
    "normalizedValue" JSONB,
    "confidence" DECIMAL(3,2),
    "sourceText" VARCHAR(500),
    "sourcePage" INTEGER,
    "reviewStatus" "SuggestionReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedValue" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_field_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_extraction_jobs_organizationId_status_createdAt_idx" ON "contract_extraction_jobs"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "contract_extraction_jobs_contractId_createdAt_idx" ON "contract_extraction_jobs"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "contract_extraction_jobs_contractFileId_createdAt_idx" ON "contract_extraction_jobs"("contractFileId", "createdAt");

-- CreateIndex
CREATE INDEX "contract_extraction_jobs_status_createdAt_idx" ON "contract_extraction_jobs"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "contract_extraction_jobs_contractFileId_inputChecksum_extra_key" ON "contract_extraction_jobs"("contractFileId", "inputChecksum", "extractorVersion");

-- CreateIndex
CREATE UNIQUE INDEX "contract_extracted_documents_extractionJobId_key" ON "contract_extracted_documents"("extractionJobId");

-- CreateIndex
CREATE INDEX "contract_extracted_documents_organizationId_contractId_idx" ON "contract_extracted_documents"("organizationId", "contractId");

-- CreateIndex
CREATE INDEX "contract_field_suggestions_organizationId_contractId_review_idx" ON "contract_field_suggestions"("organizationId", "contractId", "reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "contract_field_suggestions_extractionJobId_fieldKey_key" ON "contract_field_suggestions"("extractionJobId", "fieldKey");

-- AddForeignKey
ALTER TABLE "contract_extraction_jobs" ADD CONSTRAINT "contract_extraction_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_extraction_jobs" ADD CONSTRAINT "contract_extraction_jobs_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_extraction_jobs" ADD CONSTRAINT "contract_extraction_jobs_contractFileId_fkey" FOREIGN KEY ("contractFileId") REFERENCES "contract_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_extraction_jobs" ADD CONSTRAINT "contract_extraction_jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_extracted_documents" ADD CONSTRAINT "contract_extracted_documents_extractionJobId_fkey" FOREIGN KEY ("extractionJobId") REFERENCES "contract_extraction_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_field_suggestions" ADD CONSTRAINT "contract_field_suggestions_extractionJobId_fkey" FOREIGN KEY ("extractionJobId") REFERENCES "contract_extraction_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_field_suggestions" ADD CONSTRAINT "contract_field_suggestions_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
