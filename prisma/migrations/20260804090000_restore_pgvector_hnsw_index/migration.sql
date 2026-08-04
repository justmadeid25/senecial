-- §Phase 12.3 Part A (§3) - defense-in-depth corrective migration.
--
-- `clause_embeddings.vectorNative` is `Unsupported("vector(256)")` in
-- schema.prisma (Prisma has no native pgvector type), so the HNSW index
-- over it is invisible to Prisma's own schema model - it exists only as
-- raw SQL in migration `20260803110916_pgvector_clause_embeddings`, which
-- already creates it correctly and remains untouched (verified against
-- the initial Phase 12.2 baseline commit - no committed migration was
-- modified to produce this one).
--
-- The risk this migration defends against: running `prisma migrate dev`
-- again for ANY future schema change makes Prisma's drift-correction step
-- treat this Prisma-invisible index as an "untracked object" and silently
-- generate a `DROP INDEX` for it in the new migration it creates - this
-- happened for real during Phase 12.2 (caught and fixed before that
-- migration was ever committed - see docs/operations/ai-platform.md's
-- "prisma migrate dev와 pgvector HNSW index" section). This migration does
-- NOT prevent that drift-detection from firing again in a future `migrate
-- dev` invocation (that risk is procedural - always `--create-only` +
-- manual review, per the same doc) - what it DOES guarantee is that
-- `prisma migrate deploy` on any database (pristine or existing) always
-- ends with the index present, using `IF NOT EXISTS` so this migration is
-- safe to apply whether or not the index already exists from the earlier
-- migration.
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE INDEX IF NOT EXISTS "clause_embeddings_vector_native_hnsw_idx"
ON "clause_embeddings"
USING hnsw ("vectorNative" vector_cosine_ops);
