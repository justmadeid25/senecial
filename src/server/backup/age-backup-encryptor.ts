import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
// age-encryption's own ReadableStreamWithSize is structurally typed against
// the DOM lib's global ReadableStream (this project's tsconfig lib includes
// "dom"/"dom.iterable"), which does not declare the async-iterator members
// (`values`/`Symbol.asyncIterator`) that @types/node's `Readable.fromWeb()`
// requires of its own `node:stream/web` ReadableStream type - a type-only
// friction between two different ReadableStream declarations, not a runtime
// difference (both describe the same real WHATWG ReadableStream at runtime).
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";

import { Decrypter, Encrypter } from "age-encryption";

import type { BackupEncryptor } from "@/domain/backup/backup-encryptor";

/** Recorded in the backup manifest (never a secret) so an operator/auditor can see how a backup is protected without reading code. */
export const AGE_BACKUP_ENCRYPTION_ALGORITHM = "age-encryption.org/v1 (X25519 + ChaCha20-Poly1305 STREAM)";

/**
 * Phase 10C - real envelope encryption via `age` (age-encryption.org/v1,
 * the `age-encryption` npm package - a maintained pure JS/WASM-free port by
 * age's own author, built on audited `@noble/*` primitives, never a
 * hand-rolled cipher). Each recipient's X25519 public key wraps a random
 * per-file key; the file body is then encrypted with that key under
 * ChaCha20-Poly1305 in age's STREAM construction (chunked AEAD, unique
 * nonces derived per-chunk internally by the library - this class never
 * manages nonces itself). Authentication is intrinsic: `decrypt()` rejects
 * (see writeStreamAtomically's cleanup-on-throw) if the ciphertext, its
 * per-chunk tags, or the header MAC were tampered with, or if none of the
 * configured identities can unwrap the file key.
 *
 * `recipients` (public keys, `age1...`) are enough to encrypt - a backup
 * producer only needs these, never the private key that could decrypt its
 * own output. `identity` (`AGE-SECRET-KEY-1...`) is only required for
 * `decrypt()` (restore/DR drill), and is expected to live only on the
 * operator machine performing a restore, never on the routine backup host.
 */
export class AgeBackupEncryptor implements BackupEncryptor {
  constructor(
    private readonly recipients: readonly string[],
    private readonly identity: string | undefined
  ) {
    if (recipients.length === 0) {
      throw new Error(
        "BACKUP_ENCRYPTION_PROVIDER=age는 최소 1개의 BACKUP_AGE_RECIPIENTS(age1... 공개키, 콤마로 구분)가 필요합니다."
      );
    }
  }

  async encrypt(inputPath: string, outputPath: string): Promise<void> {
    const encrypter = new Encrypter();
    for (const recipient of this.recipients) {
      encrypter.addRecipient(recipient);
    }

    try {
      const inputStream = Readable.toWeb(createReadStream(inputPath)) as ReadableStream<Uint8Array>;
      const encryptedStream = await encrypter.encrypt(inputStream);
      await writeStreamAtomically(
        Readable.fromWeb(encryptedStream as unknown as NodeWebReadableStream),
        outputPath
      );
    } catch (error) {
      throw new Error(`백업 암호화(age)에 실패했습니다: ${toSafeErrorMessage(error)}`);
    }
  }

  async decrypt(inputPath: string, outputPath: string): Promise<void> {
    if (!this.identity) {
      throw new Error(
        "BACKUP_AGE_IDENTITY가 설정되지 않아 복호화할 수 없습니다 - 이 값은 백업을 생성하는 환경이 아니라 " +
          "복구를 수행하는 운영자 환경에만 설정해야 합니다."
      );
    }

    const decrypter = new Decrypter();
    decrypter.addIdentity(this.identity);

    try {
      const inputStream = Readable.toWeb(createReadStream(inputPath)) as ReadableStream<Uint8Array>;
      const decryptedStream = await decrypter.decrypt(inputStream);
      await writeStreamAtomically(
        Readable.fromWeb(decryptedStream as unknown as NodeWebReadableStream),
        outputPath
      );
    } catch (error) {
      throw new Error(
        `백업 복호화(age)에 실패했습니다 - 잘못된 key이거나 파일이 손상/변조되었을 수 있습니다: ${toSafeErrorMessage(error)}`
      );
    }
  }
}

/**
 * Streams `source` to a sibling temp file, fsyncs it, then atomically
 * renames it onto `outputPath` - `outputPath` never exists in a partially
 * written state. On ANY failure (source stream error - e.g. a tampered
 * age ciphertext failing its MAC mid-stream - or a filesystem error) the
 * temp file is removed and `outputPath` is left untouched, so a caller can
 * never mistake a half-written file for a complete one and no manifest gets
 * written against it.
 */
async function writeStreamAtomically(source: NodeJS.ReadableStream, outputPath: string): Promise<void> {
  const tempPath = `${outputPath}.tmp-${randomUUID()}`;
  try {
    // Deliberately NOT `FileHandle.createWriteStream()` sharing one handle
    // across both the pipe and the later fsync - on this platform that
    // combination reliably hangs forever on `handle.close()` (even with
    // `autoClose: false`, which docs suggest should avoid this - it does
    // not: destroying the write stream still closes the underlying fd out
    // from under the handle, and NOT destroying it leaves something that
    // makes `close()` never resolve). Using a plain path-based
    // `fs.createWriteStream()` (which owns and fully closes its own fd
    // when the pipe finishes) and only THEN briefly reopening the same
    // path fresh just to fsync is the combination that actually works.
    await pipeline(source, createWriteStream(tempPath));

    const handle = await open(tempPath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/** Age's own errors never embed key material, but this still caps length defensively - never let an unexpected error object leak arbitrary internal state into a log/manifest. */
function toSafeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}
