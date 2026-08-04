-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable
ALTER TABLE "clause_embeddings" ADD COLUMN     "vectorNative" vector(256);

-- CreateIndex
-- §Phase 12.1 Part 10 - HNSW over IVFFlat: this table's row count is small
-- (dev/test/current-production scale), and HNSW needs no training step
-- (build quality does not depend on having "enough" data present at CREATE
-- INDEX time the way IVFFlat's list count does) and gives better recall at
-- query time for the same build cost - the right default at any scale, not
-- just for a data-poor dev environment. NULL vectorNative rows (any row
-- whose `dimension` != 256 - see schema.prisma's own comment) are simply
-- never indexed, which is correct: they can never be found via this index
-- and always fall back to the application cosine path instead.
CREATE INDEX "clause_embeddings_vector_native_hnsw_idx" ON "clause_embeddings" USING hnsw ("vectorNative" vector_cosine_ops);
