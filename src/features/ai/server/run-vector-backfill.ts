import { parseVectorFromPg } from "@/domain/ai/vector-validation";
import { VECTOR_NATIVE_DIMENSION } from "@/domain/ai/vector-search-config";
import {
  countVectorBackfillCandidates,
  findVectorBackfillCandidates,
  getVectorBackfillStats,
  sampleBackfilledVectors,
  setNativeVector,
  type VectorBackfillStats,
} from "@/server/repositories/clause-embedding-vector-repository";

export interface BackfillFailure {
  id: string;
  reason: string;
}

export interface RunVectorBackfillResult {
  eligibleBefore: number;
  processed: number;
  succeeded: number;
  failed: BackfillFailure[];
}

/**
 * §Phase 12.1 §7 - processes up to `limit` eligible rows (see
 * clause-embedding-vector-repository.ts's own eligibility rules: isLatest,
 * dimension matches VECTOR_NATIVE_DIMENSION, not yet populated).
 * Deliberately NOT wrapped in one shared transaction across the whole
 * batch - each row is its own independent, immediately-committed UPDATE,
 * so one bad row (caught and recorded in `failed`) can never roll back
 * every other row already processed in the same run. Idempotent and
 * resumable by construction: re-running with the exact same arguments
 * only ever picks up rows still missing a native vector - there is no
 * separate "resume cursor" to maintain (--resume is the same operation as
 * a plain run; see scripts/vector-backfill.ts).
 */
export async function runVectorBackfill(params: { limit: number }): Promise<RunVectorBackfillResult> {
  const eligibleBefore = await countVectorBackfillCandidates();
  const candidates = await findVectorBackfillCandidates(params.limit);

  const failed: BackfillFailure[] = [];
  let succeeded = 0;

  for (const candidate of candidates) {
    try {
      await setNativeVector(candidate.id, candidate.vector);
      succeeded += 1;
    } catch (error) {
      failed.push({ id: candidate.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { eligibleBefore, processed: candidates.length, succeeded, failed };
}

export interface VectorBackfillDryRunResult {
  eligibleBefore: number;
  stats: VectorBackfillStats;
}

export async function dryRunVectorBackfill(): Promise<VectorBackfillDryRunResult> {
  const [eligibleBefore, stats] = await Promise.all([countVectorBackfillCandidates(), getVectorBackfillStats()]);
  return { eligibleBefore, stats };
}

export interface VectorMismatch {
  id: string;
  maxAbsDiff: number;
}

export interface VerifyVectorBackfillResult {
  stats: VectorBackfillStats;
  sampledCount: number;
  mismatches: VectorMismatch[];
}

/**
 * pgvector's `vector` type stores single-precision (float4) components,
 * while the application fallback (`vector` Float[] - Postgres `double
 * precision[]`) is double-precision - round-tripping through the native
 * column WILL lose precision beyond float4's ~7 significant decimal
 * digits. This tolerance is calibrated for that, not for catching a real
 * corruption bug - a genuinely wrong value (wrong row, transposed
 * components, truncated vector) produces a difference many orders of
 * magnitude larger than this.
 */
const FLOAT32_ROUNDTRIP_TOLERANCE = 1e-4;
const DEFAULT_VERIFY_SAMPLE_SIZE = 200;

export async function verifyVectorBackfill(
  sampleSize: number = DEFAULT_VERIFY_SAMPLE_SIZE
): Promise<VerifyVectorBackfillResult> {
  const [stats, sample] = await Promise.all([getVectorBackfillStats(), sampleBackfilledVectors(sampleSize)]);

  const mismatches: VectorMismatch[] = [];
  for (const row of sample) {
    const native = parseVectorFromPg(row.nativeText);
    if (native.length !== VECTOR_NATIVE_DIMENSION || row.vector.length !== VECTOR_NATIVE_DIMENSION) {
      mismatches.push({ id: row.id, maxAbsDiff: Number.POSITIVE_INFINITY });
      continue;
    }
    let maxAbsDiff = 0;
    for (let i = 0; i < VECTOR_NATIVE_DIMENSION; i += 1) {
      maxAbsDiff = Math.max(maxAbsDiff, Math.abs(native[i]! - row.vector[i]!));
    }
    if (maxAbsDiff > FLOAT32_ROUNDTRIP_TOLERANCE) {
      mismatches.push({ id: row.id, maxAbsDiff });
    }
  }

  return { stats, sampledCount: sample.length, mismatches };
}
