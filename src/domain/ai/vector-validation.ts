/**
 * §Phase 12.1 §7 - the exact guard the vector-backfill CLI (and any other
 * writer of `ClauseEmbedding.vectorNative`) must run BEFORE ever writing a
 * vector into the native pgvector column: reject a length mismatch against
 * the column's fixed width, and reject any non-finite component (NaN /
 * Infinity) - pgvector's text-format parser DOES accept `nan`/`infinity`
 * literals and would happily store them, silently corrupting every future
 * distance calculation involving that row.
 */
export class InvalidVectorError extends Error {
  constructor(public readonly reason: "DIMENSION_MISMATCH" | "NON_FINITE_VALUE", message: string) {
    super(message);
    this.name = "InvalidVectorError";
  }
}

export function isFiniteVector(vector: readonly number[]): boolean {
  return vector.every((value) => Number.isFinite(value));
}

export function assertValidNativeVector(vector: readonly number[], expectedDimension: number): void {
  if (vector.length !== expectedDimension) {
    throw new InvalidVectorError(
      "DIMENSION_MISMATCH",
      `벡터 차원이 일치하지 않습니다: expected ${expectedDimension}, got ${vector.length}`
    );
  }
  if (!isFiniteVector(vector)) {
    throw new InvalidVectorError("NON_FINITE_VALUE", "벡터에 NaN 또는 Infinity 값이 포함되어 있어 저장할 수 없습니다.");
  }
}

/** pgvector's text input format - `[v1,v2,...]`. Never build this via untrusted string interpolation elsewhere; always go through this function so a NaN/Infinity can never slip through unformatted (`String(NaN)` is "NaN", which pgvector would otherwise happily parse). */
export function serializeVectorForPg(vector: readonly number[], expectedDimension: number): string {
  assertValidNativeVector(vector, expectedDimension);
  return `[${vector.join(",")}]`;
}

/** Inverse of serializeVectorForPg - parses pgvector's `vectorNative::text` output (e.g. from a verification spot-check query) back into a plain number array. */
export function parseVectorFromPg(text: string): number[] {
  const trimmed = text.trim();
  const inner = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  if (inner.length === 0) {
    return [];
  }
  return inner.split(",").map(Number);
}
