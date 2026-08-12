-- §Phase 14.1 audit - Prisma's drift detection generated DROP INDEX
-- statements for BOTH hand-written HNSW indexes here (clause_embeddings_
-- vector_native_hnsw_idx and contract_document_chunk_embeddings_vector_
-- native_hnsw_idx) - the same known footgun documented in the
-- 20260812120741_add_contract_document_chunks migration: Unsupported-typed
-- vectorNative columns are invisible to Prisma's schema model, so any
-- unrelated schema change touching either table can trigger a spurious
-- "drop this index I don't recognize" diff. Removed by hand - this
-- migration only adds columns to ai_message_citations and must never touch
-- either vector index.

-- AlterTable
ALTER TABLE "ai_message_citations" ADD COLUMN     "chunkEndOffset" INTEGER,
ADD COLUMN     "chunkId" TEXT,
ADD COLUMN     "chunkStartOffset" INTEGER,
ADD COLUMN     "sourcePageEnd" INTEGER,
ADD COLUMN     "sourcePageStart" INTEGER;
