-- §Phase 15.1 - DO NOT drop clause_embeddings_vector_native_hnsw_idx or
-- contract_document_chunk_embeddings_vector_native_hnsw_idx. Prisma's
-- drift-detection generated `DROP INDEX` for both here because they are
-- `Unsupported`-typed and therefore invisible to Prisma's own schema model -
-- this is the exact, previously-documented footgun (see
-- docs/operations/ai-platform.md's "prisma migrate dev와 pgvector HNSW
-- index", migration 20260804090000_restore_pgvector_hnsw_index, and
-- migration 20260812120741_add_contract_document_chunks's own comment).
-- Removed by hand; never regenerate this migration with `prisma migrate
-- dev` (no --create-only) or this will reappear.

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('CONFUSING_UX', 'ERROR_ENCOUNTERED', 'AI_ANSWER_SEEMS_WRONG', 'CITATION_SEEMS_WRONG', 'OTHER');

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "FeedbackCategory" NOT NULL,
    "routeContext" VARCHAR(200),
    "contractId" TEXT,
    "message" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_organizationId_createdAt_idx" ON "feedback"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
