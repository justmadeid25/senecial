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

/**
 * §Phase 12.2 Part C - identifies which version of the embedding
 * GENERATION PIPELINE (normalization + provider call, independent of which
 * provider/model is configured) is currently active. Distinct from
 * `ClauseEmbedding.embeddingVersion` (a per-row DB counter bumped when a
 * SPECIFIC clause is re-embedded after a text edit) - this constant
 * instead answers "which version of the overall embedding pipeline logic
 * produced embeddings platform-wide right now," for AiRuntimeConfiguration
 * / cache-key / provenance purposes. Bump when normalize-clause-text.ts's
 * normalization rules or the embedding call sequence itself changes shape,
 * not on every provider/model swap (those already have their own
 * identity via `embeddingProvider`/`embeddingModel`).
 */
export const EMBEDDING_PIPELINE_VERSION = "v1";
