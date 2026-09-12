import { createHash } from "node:crypto";

/**
 * §Phase L1 §5 - the deterministic content-identity signal for a
 * LegalSource, mirroring domain/ai/clause-text-checksum.ts's identical
 * SHA-256-over-normalized-content pattern. Used both for verification
 * ("content hash generated successfully") and for lazy-cache revalidation
 * (a changed hash on refetch means the official text changed - see
 * features/legal/server/get-or-fetch-statute.ts).
 */
export function computeLegalContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
