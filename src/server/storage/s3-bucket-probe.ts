import { randomUUID } from "node:crypto";

import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

import type { S3Config } from "@/lib/config/s3";

import { toSafeS3Error } from "./s3-error";

export interface S3ProbeResult {
  status: "ok" | "error";
  detail?: string;
}

/**
 * §11 - the "cheap" readiness probe used by the public `/api/health/ready`
 * endpoint on every request: a single `HeadBucket` call confirms the
 * bucket exists and the configured credentials can reach it, without any
 * write. Deliberately does NOT do a put/get/delete round-trip here - that
 * would mean every readiness poll (which orchestrators may call every few
 * seconds) writes to the bucket, which is wasteful and, for a
 * usage-billed provider, has a real ongoing cost.
 */
export async function probeS3BucketAccess(client: S3Client, config: S3Config): Promise<S3ProbeResult> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    return { status: "ok" };
  } catch (error) {
    return { status: "error", detail: toSafeS3Error(error) };
  }
}

/**
 * §10/§11 - the full probe used only by `production:validate` (an
 * operator-invoked, infrequent command, not a per-request health check):
 * writes a small random object, reads it back, and deletes it - proving
 * write/read/delete access all actually work, not just that the bucket is
 * reachable. The key deliberately does NOT match the app's real
 * `<organizationId>/<uuid>.<ext>` storageKey shape (a `.health-check/`
 * prefix instead) so it can never be confused for - or collide with - a
 * real contract file, and is trivially recognizable/excludable in any
 * bucket listing or lifecycle rule. Always deleted before returning,
 * success or failure, so no matter what happens this never leaves an
 * object behind.
 */
export async function probeS3FullAccess(client: S3Client, config: S3Config): Promise<S3ProbeResult> {
  const key = `.health-check/${randomUUID()}`;
  const body = Buffer.from(`senecial production:validate probe ${new Date().toISOString()}`);

  try {
    await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body }));
  } catch (error) {
    return { status: "error", detail: `write 실패: ${toSafeS3Error(error)}` };
  }

  try {
    await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  } catch (error) {
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key })).catch(() => undefined);
    return { status: "error", detail: `read 실패: ${toSafeS3Error(error)}` };
  }

  try {
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  } catch (error) {
    return { status: "error", detail: `delete 실패: ${toSafeS3Error(error)}` };
  }

  return { status: "ok" };
}
