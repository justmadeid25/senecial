import { HASHING_TRICK_DEFAULT_DIMENSION } from "./hashing-trick-embedding";

/**
 * §Phase 12.1 - the FIXED width of `ClauseEmbedding.vectorNative`, a real
 * `vector(256)` pgvector column (see prisma/schema.prisma's migration
 * `pgvector_clause_embeddings`). pgvector requires one unchangeable
 * dimension per column - this is set to the Development embedding
 * provider's ACTUAL dimension (HASHING_TRICK_DEFAULT_DIMENSION), never an
 * arbitrary guess like 1536. A future real provider configured with a
 * different dimension can never populate this column - its rows keep
 * working through the `vector` Float[] application-cosine fallback only,
 * until a new migration changes the column width and every row is
 * re-backfilled (see docs/operations/ai-platform.md).
 */
export const VECTOR_NATIVE_DIMENSION = HASHING_TRICK_DEFAULT_DIMENSION;
