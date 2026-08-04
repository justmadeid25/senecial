import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import { ValidationError } from "@/lib/errors";
import { isValidStorageKey } from "@/domain/storage/storage-key-pattern";

import { computeChecksum } from "./checksum";
import type { ListKeysPage, PutFileInput, StorageDriver, StorageMaintenanceDriver, StoredFile } from "./types";

const DEFAULT_MAX_KEYS = 1000;

export class LocalStorageDriver implements StorageDriver, StorageMaintenanceDriver {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
  }

  private resolveSafePath(key: string): string {
    if (!isValidStorageKey(key)) {
      throw new ValidationError("잘못된 파일 키입니다.");
    }

    const resolved = path.resolve(this.basePath, key);

    // Defense in depth: the key pattern above already rules out traversal,
    // but we still confirm the resolved path never escapes basePath.
    if (
      resolved !== this.basePath &&
      !resolved.startsWith(this.basePath + path.sep)
    ) {
      throw new ValidationError("잘못된 파일 키입니다.");
    }

    return resolved;
  }

  async put(input: PutFileInput): Promise<StoredFile> {
    const targetPath = this.resolveSafePath(input.key);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, input.data);

    return {
      key: input.key,
      size: input.data.byteLength,
      checksum: computeChecksum(input.data),
      mimeType: input.mimeType,
    };
  }

  async getBuffer(key: string): Promise<Buffer> {
    const targetPath = this.resolveSafePath(key);
    return readFile(targetPath);
  }

  async delete(key: string): Promise<void> {
    const targetPath = this.resolveSafePath(key);
    await rm(targetPath, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    const targetPath = this.resolveSafePath(key);
    try {
      await access(targetPath, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Phase 10A §12 - paginated listing for orphan detection
   * (scripts/find-orphan-files.ts) - never for serving files to a user.
   * Storage keys are always exactly two path segments
   * (organizationId/uuid.ext, see generateStorageKey()), so a two-level
   * directory walk is sufficient; this does not need to handle arbitrary
   * nesting.
   *
   * Local disk has no native pagination API, so this walks the full tree
   * once, sorts for a stable order, and slices - `continuationToken` is
   * simply the numeric offset into that sorted list, encoded as a string
   * (an implementation detail; callers must treat it as opaque, exactly
   * as they would an S3 continuation token).
   */
  async listKeysPage(continuationToken?: string, maxKeys = DEFAULT_MAX_KEYS): Promise<ListKeysPage> {
    const offset = continuationToken ? Number.parseInt(continuationToken, 10) : 0;
    if (!Number.isInteger(offset) || offset < 0) {
      throw new ValidationError("잘못된 continuationToken입니다.");
    }

    let orgDirs: string[];
    try {
      const entries = await readdir(this.basePath, { withFileTypes: true });
      orgDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      // basePath does not exist yet (no uploads have ever happened).
      return { keys: [] };
    }

    const allKeys: string[] = [];
    for (const orgDir of orgDirs.sort()) {
      const entries = await readdir(path.join(this.basePath, orgDir), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          allKeys.push(`${orgDir}/${entry.name}`);
        }
      }
    }
    allKeys.sort();

    const page = allKeys.slice(offset, offset + maxKeys);
    const nextOffset = offset + page.length;
    return {
      keys: page,
      nextContinuationToken: nextOffset < allKeys.length ? String(nextOffset) : undefined,
    };
  }
}
