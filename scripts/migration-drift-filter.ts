/**
 * Pure filtering logic for `prisma migrate diff --script` output, split out
 * from scripts/check-migration-drift.ts (the CLI entrypoint) so it can be
 * unit-tested directly without piping real stdin - same rationale as
 * scripts/worker-scheduler-jobs.ts's split from worker-scheduler.ts.
 *
 * Tolerates only the known permanent gap: Prisma has no declarative way to
 * represent a pgvector HNSW index on an Unsupported("vector(...)") column
 * (see prisma/schema.prisma's `vectorNative` fields), so `prisma migrate
 * diff` always proposes dropping every hand-authored HNSW index it finds on
 * such a column - currently two, one per Unsupported vector column
 * (20260804090000_restore_pgvector_hnsw_index,
 * 20260812120741_add_contract_document_chunks). Matched structurally by
 * their shared "<snake_case>_vector_native_hnsw_idx" naming convention
 * (scripts/verify-migrations.ts's own NATIVE_VECTOR_HNSW_INDEXES list uses
 * the same convention) so a future third Unsupported vector column needs no
 * edit here. Any OTHER diff line - dropped/added tables, columns, a non-HNSW
 * index, etc. - is real drift.
 */
const TOLERATED_LINE = /^(-- DropIndex|DROP INDEX "[a-z_]+_vector_native_hnsw_idx";|-- This is an empty migration\.|)$/;

export function findUnexpectedDrift(diff: string): string[] {
  return diff.split(/\r?\n/).filter((line) => !TOLERATED_LINE.test(line));
}
