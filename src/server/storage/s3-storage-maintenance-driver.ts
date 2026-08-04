import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";

import type { S3Config } from "@/lib/config/s3";

import { toSafeS3Wrapped } from "./s3-error";
import type { ListKeysPage, StorageMaintenanceDriver } from "./types";

const DEFAULT_MAX_KEYS = 1000;

/**
 * §12 - one `ListObjectsV2` call per page, real S3-side pagination via
 * `ContinuationToken`/`IsTruncated`/`NextContinuationToken` - never loads
 * an entire bucket's key list into memory at once, unlike a naive
 * `listKeys(): Promise<string[]>` would have to.
 */
export class S3StorageMaintenanceDriver implements StorageMaintenanceDriver {
  constructor(
    private readonly client: S3Client,
    private readonly config: S3Config
  ) {}

  async listKeysPage(continuationToken?: string, maxKeys = DEFAULT_MAX_KEYS): Promise<ListKeysPage> {
    try {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          MaxKeys: maxKeys,
          ContinuationToken: continuationToken,
        })
      );

      const keys = (result.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => typeof key === "string");

      return {
        keys,
        nextContinuationToken: result.IsTruncated ? result.NextContinuationToken : undefined,
      };
    } catch (error) {
      throw toSafeS3Wrapped(error);
    }
  }
}
