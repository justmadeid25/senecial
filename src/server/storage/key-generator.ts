import { randomUUID } from "node:crypto";

import { isAllowedContractFileExtension } from "@/domain/contracts/file-policy";
import { ValidationError } from "@/lib/errors";

const SAFE_SEGMENT_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Generates an opaque, random storage key. The original filename is never
 * used as (or embedded in) the key - only a validated extension is kept, so
 * path traversal via a crafted filename is not possible.
 */
export function generateStorageKey(
  organizationId: string,
  extension: string
): string {
  if (!SAFE_SEGMENT_PATTERN.test(organizationId)) {
    throw new ValidationError("잘못된 조직 식별자입니다.");
  }

  if (!isAllowedContractFileExtension(extension)) {
    throw new ValidationError("허용되지 않은 파일 형식입니다.");
  }

  return `${organizationId}/${randomUUID()}${extension.toLowerCase()}`;
}
