import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Streaming SHA-256 for potentially large backup archives/dumps - never loads the whole file into memory (unlike server/storage/checksum.ts's Buffer-based one, which is fine for contract-file-sized uploads but not for a multi-GB DB dump). */
export function computeFileChecksum(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
