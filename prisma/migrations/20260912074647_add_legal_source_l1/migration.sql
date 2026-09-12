-- CreateEnum
CREATE TYPE "LegalSourceType" AS ENUM ('STATUTE', 'PRECEDENT', 'INTERPRETATION');

-- CreateEnum
CREATE TYPE "LegalAuthority" AS ENUM ('LAW_OPEN_DATA');

-- CreateEnum
CREATE TYPE "LegalVerificationStatus" AS ENUM ('VERIFIED_OFFICIAL', 'UNVERIFIED');

-- CreateTable
CREATE TABLE "legal_sources" (
    "id" TEXT NOT NULL,
    "sourceType" "LegalSourceType" NOT NULL,
    "authority" "LegalAuthority" NOT NULL DEFAULT 'LAW_OPEN_DATA',
    "verificationStatus" "LegalVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "externalId" TEXT NOT NULL,
    "articleId" TEXT,
    "identityKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "citationLabel" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "lawName" TEXT,
    "articleNumber" TEXT,
    "articleTitle" TEXT,
    "court" TEXT,
    "caseNumber" TEXT,
    "caseType" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "decisionDate" TIMESTAMP(3),
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "metadata" JSONB,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_source_fragments" (
    "id" TEXT NOT NULL,
    "legalSourceId" TEXT NOT NULL,
    "fragmentIndex" INTEGER NOT NULL,
    "label" TEXT,
    "content" TEXT NOT NULL,
    "startOffset" INTEGER,
    "endOffset" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_source_fragments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legal_sources_identityKey_key" ON "legal_sources"("identityKey");

-- CreateIndex
CREATE INDEX "legal_sources_sourceType_externalId_idx" ON "legal_sources"("sourceType", "externalId");

-- CreateIndex
CREATE INDEX "legal_sources_verificationStatus_idx" ON "legal_sources"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "legal_source_fragments_legalSourceId_fragmentIndex_key" ON "legal_source_fragments"("legalSourceId", "fragmentIndex");

-- AddForeignKey
ALTER TABLE "legal_source_fragments" ADD CONSTRAINT "legal_source_fragments_legalSourceId_fkey" FOREIGN KEY ("legalSourceId") REFERENCES "legal_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
