-- §Phase 14.1 - DO NOT drop clause_embeddings_vector_native_hnsw_idx. Prisma's
-- drift-detection generated a `DROP INDEX` for it here because it is
-- `Unsupported`-typed and therefore invisible to Prisma's own schema model -
-- this is the exact, previously-documented footgun (see
-- docs/operations/ai-platform.md's "prisma migrate dev와 pgvector HNSW
-- index" and migration 20260804090000_restore_pgvector_hnsw_index's own
-- comment). Removed by hand; never regenerate this migration with
-- `prisma migrate dev` (no --create-only) or this will reappear.

-- CreateTable
CREATE TABLE "contract_document_chunks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "extractedDocumentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "headingContext" TEXT,
    "sourcePageStart" INTEGER,
    "sourcePageEnd" INTEGER,
    "chunkerVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_document_chunk_embedding_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "status" "EmbeddingJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "inputChecksum" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_document_chunk_embedding_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_document_chunk_embeddings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL,
    "vector" DOUBLE PRECISION[],
    "vectorNative" vector(256),
    "checksum" TEXT NOT NULL,
    "embeddingVersion" INTEGER NOT NULL DEFAULT 1,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_document_chunk_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_document_chunks_organizationId_contractId_idx" ON "contract_document_chunks"("organizationId", "contractId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_document_chunks_extractedDocumentId_chunkIndex_key" ON "contract_document_chunks"("extractedDocumentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "contract_document_chunk_embedding_jobs_status_createdAt_idx" ON "contract_document_chunk_embedding_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "contract_document_chunk_embedding_jobs_organizationId_statu_idx" ON "contract_document_chunk_embedding_jobs"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contract_document_chunk_embedding_jobs_chunkId_inputChecksu_key" ON "contract_document_chunk_embedding_jobs"("chunkId", "inputChecksum");

-- CreateIndex
CREATE INDEX "contract_document_chunk_embeddings_organizationId_chunkId_i_idx" ON "contract_document_chunk_embeddings"("organizationId", "chunkId", "isLatest");

-- CreateIndex
CREATE INDEX "contract_document_chunk_embeddings_organizationId_isLatest_idx" ON "contract_document_chunk_embeddings"("organizationId", "isLatest");

-- CreateIndex
CREATE UNIQUE INDEX "contract_document_chunk_embeddings_chunkId_embeddingVersion_key" ON "contract_document_chunk_embeddings"("chunkId", "embeddingVersion");

-- AddForeignKey
ALTER TABLE "contract_document_chunks" ADD CONSTRAINT "contract_document_chunks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_document_chunks" ADD CONSTRAINT "contract_document_chunks_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_document_chunks" ADD CONSTRAINT "contract_document_chunks_extractedDocumentId_fkey" FOREIGN KEY ("extractedDocumentId") REFERENCES "contract_extracted_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_document_chunk_embedding_jobs" ADD CONSTRAINT "contract_document_chunk_embedding_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_document_chunk_embedding_jobs" ADD CONSTRAINT "contract_document_chunk_embedding_jobs_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "contract_document_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_document_chunk_embeddings" ADD CONSTRAINT "contract_document_chunk_embeddings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_document_chunk_embeddings" ADD CONSTRAINT "contract_document_chunk_embeddings_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "contract_document_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
-- Same rationale as clause_embeddings_vector_native_hnsw_idx (migration
-- 20260803110916_pgvector_clause_embeddings): HNSW, not IVFFlat - no
-- training step needed. NULL vectorNative rows (dimension != 256) are
-- simply never indexed and always fall back to the application cosine
-- path.
CREATE INDEX IF NOT EXISTS "contract_document_chunk_embeddings_vector_native_hnsw_idx"
ON "contract_document_chunk_embeddings"
USING hnsw ("vectorNative" vector_cosine_ops);
