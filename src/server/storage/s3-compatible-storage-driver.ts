import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

import { isValidStorageKey } from "@/domain/storage/storage-key-pattern";
import type { S3Config } from "@/lib/config/s3";
import { ValidationError } from "@/lib/errors";
import { recordDependencyLatency } from "@/server/monitoring/metrics";

import { computeChecksum } from "./checksum";
import { isS3NotFoundError, toSafeS3Wrapped } from "./s3-error";
import type { PutFileInput, StorageDriver, StoredFile } from "./types";

/**
 * §5 - `StorageDriver` implementation backed by any S3-compatible object
 * storage (AWS S3, Cloudflare R2, MinIO, ...). No provider name is
 * referenced by anything outside `server/storage` - callers only ever see
 * `StorageDriver`.
 *
 * §6 upload atomicity: `put()` here is only ever step 1 of
 * upload-contract-file.ts's existing compensating-transaction pattern
 * (object put -> DB transaction -> delete object on DB failure) - that
 * pattern lives in the feature layer and needed zero changes to work with
 * this driver, since it only depends on the shared `StorageDriver`
 * interface.
 */
export class S3CompatibleStorageDriver implements StorageDriver {
  constructor(
    private readonly client: S3Client,
    private readonly config: S3Config
  ) {}

  private assertValidKey(key: string): void {
    if (!isValidStorageKey(key)) {
      throw new ValidationError("잘못된 파일 키입니다.");
    }
  }

  /** Phase 11 §Monitoring - every S3 SDK round-trip below goes through this, so `clausebase_dependency_duration{dependency="s3"}` reflects EVERY put/get/delete/head call this driver makes, success or failure. */
  private async timed<T>(fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      recordDependencyLatency("s3", performance.now() - start);
    }
  }

  /**
   * §8/§9 - `@aws-sdk/lib-storage`'s `Upload` is used even though every
   * contract file is well under the 20MB cap (so multipart is never
   * strictly required) because it gives a single, uniform upload path
   * that would also handle a future larger-file/streaming input without
   * changing this method's shape. Server-side encryption headers
   * (`ServerSideEncryption`/`SSEKMSKeyId`) are attached whenever
   * configured - never silently omitted. `ChecksumAlgorithm: "SHA256"`
   * asks the provider to compute and verify its own checksum in transit
   * (S3_UPLOAD_CHECKSUM=true, the default) - this is a transport-integrity
   * check, never a substitute for the SHA-256 this function itself
   * computes and returns as `StoredFile.checksum`, which stays the
   * database's source of truth (§8 - an S3 ETag is NOT treated as a
   * SHA-256 hash anywhere in this codebase, and multipart ETags aren't
   * even a hash of the file contents at all).
   */
  async put(input: PutFileInput): Promise<StoredFile> {
    this.assertValidKey(input.key);
    const checksum = computeChecksum(input.data);

    await this.timed(async () => {
      try {
        const upload = new Upload({
          client: this.client,
          params: {
            Bucket: this.config.bucket,
            Key: input.key,
            Body: input.data,
            ContentType: input.mimeType,
            ...(this.config.serverSideEncryption
              ? { ServerSideEncryption: this.config.serverSideEncryption }
              : {}),
            ...(this.config.serverSideEncryption === "aws:kms" && this.config.kmsKeyId
              ? { SSEKMSKeyId: this.config.kmsKeyId }
              : {}),
            ...(this.config.uploadChecksum ? { ChecksumAlgorithm: "SHA256" as const } : {}),
          },
        });
        await upload.done();
      } catch (error) {
        throw toSafeS3Wrapped(error);
      }
    });

    return { key: input.key, size: input.data.byteLength, checksum, mimeType: input.mimeType };
  }

  /**
   * Reads the object in a single pass into a Buffer via the SDK's own
   * `transformToByteArray()` helper (no manual chunk-collection loop, and
   * no second in-memory copy beyond what producing a `Buffer` inherently
   * requires) - the 20MB cap makes this an acceptable strategy; a genuine
   * large-file path would use `getStream()` instead (see below).
   */
  async getBuffer(key: string): Promise<Buffer> {
    this.assertValidKey(key);
    return this.timed(async () => {
      try {
        const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
        if (!result.Body) {
          throw new Error("empty response body");
        }
        const bytes = await result.Body.transformToByteArray();
        return Buffer.from(bytes);
      } catch (error) {
        if (isS3NotFoundError(error)) {
          throw toSafeS3Wrapped(error);
        }
        throw toSafeS3Wrapped(error);
      }
    });
  }

  /**
   * §5 streaming extension point - not used by the current download route
   * (which stays on `getBuffer()`, matching the 20MB proxy-download
   * design §7 keeps), but available for a future large-file path without
   * requiring a new driver method name.
   */
  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    this.assertValidKey(key);
    return this.timed(async () => {
      try {
        const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
        if (!result.Body) {
          throw new Error("empty response body");
        }
        return result.Body as unknown as NodeJS.ReadableStream;
      } catch (error) {
        throw toSafeS3Wrapped(error);
      }
    });
  }

  /** S3's DeleteObject is already idempotent - deleting an already-missing key returns success, matching LocalStorageDriver's `rm(force: true)` behavior with no extra handling needed. */
  async delete(key: string): Promise<void> {
    this.assertValidKey(key);
    return this.timed(async () => {
      try {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
      } catch (error) {
        throw toSafeS3Wrapped(error);
      }
    });
  }

  async exists(key: string): Promise<boolean> {
    this.assertValidKey(key);
    return this.timed(async () => {
      try {
        await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
        return true;
      } catch (error) {
        if (isS3NotFoundError(error)) {
          return false;
        }
        throw toSafeS3Wrapped(error);
      }
    });
  }
}
