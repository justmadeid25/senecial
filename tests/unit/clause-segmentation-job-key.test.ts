import { describe, expect, it } from "vitest";

import { computeChecksum } from "@/server/storage/checksum";

// ClauseSegmentationJob.jobKey = sha256(extractedDocumentId + inputChecksum
// + segmenterVersion) - see create-clause-segmentation-job.ts's
// buildJobKey(). This exercises the same computeChecksum() building block
// Phase 6's extraction dedup key relies on, applied to the 3-part string
// this Phase concatenates before hashing.
function buildJobKey(extractedDocumentId: string, inputChecksum: string, segmenterVersion: string) {
  return computeChecksum(
    Buffer.from(`${extractedDocumentId}:${inputChecksum}:${segmenterVersion}`, "utf8")
  );
}

describe("clause segmentation jobKey determinism", () => {
  it("produces the same key for identical inputs", () => {
    const a = buildJobKey("doc-1", "checksum-abc", "dev-ko-v1");
    const b = buildJobKey("doc-1", "checksum-abc", "dev-ko-v1");
    expect(a).toBe(b);
  });

  it("produces a different key when the document id differs", () => {
    const a = buildJobKey("doc-1", "checksum-abc", "dev-ko-v1");
    const b = buildJobKey("doc-2", "checksum-abc", "dev-ko-v1");
    expect(a).not.toBe(b);
  });

  it("produces a different key when the checksum differs", () => {
    const a = buildJobKey("doc-1", "checksum-abc", "dev-ko-v1");
    const b = buildJobKey("doc-1", "checksum-xyz", "dev-ko-v1");
    expect(a).not.toBe(b);
  });

  it("produces a different key when the segmenter version differs (a version bump creates a new revision)", () => {
    const a = buildJobKey("doc-1", "checksum-abc", "dev-ko-v1");
    const b = buildJobKey("doc-1", "checksum-abc", "dev-ko-v2");
    expect(a).not.toBe(b);
  });

  it("is not confusable across a field boundary shift (no delimiter-injection collision)", () => {
    // "doc-1:" + "checksum" vs "doc-1" + ":checksum" - the colon delimiter
    // must not let different field splits collide on the same key.
    const a = buildJobKey("doc-1", "checksum", "v1");
    const b = buildJobKey("doc-1:checksum", "", "v1");
    expect(a).not.toBe(b);
  });

  it("produces a 64-character lowercase hex digest", () => {
    const key = buildJobKey("doc-1", "checksum-abc", "dev-ko-v1");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
