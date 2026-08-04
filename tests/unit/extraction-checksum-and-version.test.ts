import { describe, expect, it } from "vitest";

import { EXTRACTOR_VERSION } from "@/domain/extraction/extractor-version";
import { computeChecksum } from "@/server/storage/checksum";

// The extraction job dedup key is (contractFileId, inputChecksum,
// extractorVersion) - see create-extraction-job.ts. computeChecksum() and
// EXTRACTOR_VERSION are the two pure ingredients of that key that don't
// depend on which file/contract row is involved, so their determinism is
// what makes the dedup key stable across calls for identical input.
describe("computeChecksum (extraction job dedup key ingredient)", () => {
  it("is deterministic for identical input", () => {
    const buffer = Buffer.from("계약서 내용입니다.", "utf8");
    expect(computeChecksum(buffer)).toBe(computeChecksum(buffer));
  });

  it("produces different checksums for different content", () => {
    const a = Buffer.from("첫 번째 문서", "utf8");
    const b = Buffer.from("두 번째 문서", "utf8");
    expect(computeChecksum(a)).not.toBe(computeChecksum(b));
  });

  it("produces a 64-character lowercase hex sha256 digest", () => {
    const checksum = computeChecksum(Buffer.from("test", "utf8"));
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is sensitive to a single-byte difference", () => {
    const a = Buffer.from("금액: 100", "utf8");
    const b = Buffer.from("금액: 101", "utf8");
    expect(computeChecksum(a)).not.toBe(computeChecksum(b));
  });
});

describe("EXTRACTOR_VERSION", () => {
  it("is a stable non-empty string", () => {
    expect(typeof EXTRACTOR_VERSION).toBe("string");
    expect(EXTRACTOR_VERSION.length).toBeGreaterThan(0);
  });
});
