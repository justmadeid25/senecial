import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import type { S3Config } from "@/lib/config/s3";
import { createS3Client } from "@/server/storage/s3-client";
import { S3CompatibleStorageDriver } from "@/server/storage/s3-compatible-storage-driver";
import { S3StorageMaintenanceDriver } from "@/server/storage/s3-storage-maintenance-driver";
import { probeS3BucketAccess, probeS3FullAccess } from "@/server/storage/s3-bucket-probe";
import { computeChecksum } from "@/server/storage/checksum";

/**
 * Phase 10A §29 - real network round-trip tests against an actually-running
 * S3-compatible server (this repo's local dev MinIO instance), never a
 * mock. Skipped entirely (not failed) unless TEST_S3_* env vars point at a
 * real, reachable bucket - the default `pnpm test` run has none of these
 * set, so this file adds no live-infra requirement to the base suite. To
 * run for real:
 *
 *   TEST_S3_ENDPOINT=http://localhost:9010 TEST_S3_BUCKET=senecial-contracts-test \
 *   TEST_S3_ACCESS_KEY_ID=... TEST_S3_SECRET_ACCESS_KEY=... \
 *   pnpm exec dotenv -e .env.test -- vitest run tests/integration/s3-storage-real.test.ts
 */
const hasS3Config = Boolean(process.env.TEST_S3_ENDPOINT && process.env.TEST_S3_BUCKET);

const config: S3Config = {
  endpoint: process.env.TEST_S3_ENDPOINT,
  region: process.env.TEST_S3_REGION || "us-east-1",
  bucket: process.env.TEST_S3_BUCKET || "",
  accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY,
  forcePathStyle: true,
  uploadChecksum: true,
};

describe.skipIf(!hasS3Config)("S3CompatibleStorageDriver against real S3-compatible storage (§29)", () => {
  const client = createS3Client(config);
  const driver = new S3CompatibleStorageDriver(client, config);
  const maintenanceDriver = new S3StorageMaintenanceDriver(client, config);
  const testOrgId = `test-org-${randomUUID().slice(0, 8)}`;
  const keysToCleanUp: string[] = [];

  function testKey(): string {
    const key = `${testOrgId}/${randomUUID()}.pdf`;
    keysToCleanUp.push(key);
    return key;
  }

  afterAll(async () => {
    await Promise.all(keysToCleanUp.map((key) => driver.delete(key).catch(() => undefined)));
  });

  it("HeadBucket probe succeeds against the real bucket", async () => {
    const result = await probeS3BucketAccess(client, config);
    expect(result.status).toBe("ok");
  });

  it("full put -> get -> delete round trip succeeds with a real network round trip", async () => {
    const result = await probeS3FullAccess(client, config);
    expect(result.status).toBe("ok");
  });

  it("put() then getBuffer() returns byte-identical content with a matching checksum", async () => {
    const key = testKey();
    const data = Buffer.from(`senecial real S3 integration test ${randomUUID()}`);
    const expectedChecksum = computeChecksum(data);

    const stored = await driver.put({ key, data, mimeType: "application/pdf" });
    expect(stored.checksum).toBe(expectedChecksum);

    const retrieved = await driver.getBuffer(key);
    expect(retrieved.equals(data)).toBe(true);
    expect(computeChecksum(retrieved)).toBe(expectedChecksum);
  });

  it("exists() reflects real presence/absence", async () => {
    const key = testKey();
    expect(await driver.exists(key)).toBe(false);
    await driver.put({ key, data: Buffer.from("x"), mimeType: "text/plain" });
    expect(await driver.exists(key)).toBe(true);
  });

  it("delete() is idempotent - deleting twice never throws", async () => {
    const key = testKey();
    await driver.put({ key, data: Buffer.from("x"), mimeType: "text/plain" });
    await driver.delete(key);
    await expect(driver.delete(key)).resolves.toBeUndefined();
    expect(await driver.exists(key)).toBe(false);
  });

  it("getBuffer() on a missing key throws rather than returning empty content", async () => {
    await expect(driver.getBuffer(`${testOrgId}/${randomUUID()}.pdf`)).rejects.toThrow();
  });

  it("thrown errors never leak the endpoint/bucket/credentials in their message", async () => {
    try {
      await driver.getBuffer(`${testOrgId}/${randomUUID()}.pdf`);
      expect.unreachable();
    } catch (error) {
      const message = String(error);
      expect(message).not.toContain(config.bucket);
      if (config.endpoint) {
        expect(message).not.toContain(config.endpoint);
      }
    }
  });

  it("listKeysPage() real S3 pagination finds every uploaded key across multiple pages", async () => {
    const scanOrgId = `test-scan-org-${randomUUID().slice(0, 8)}`;
    const uploadedKeys: string[] = [];
    for (let i = 0; i < 5; i++) {
      const key = `${scanOrgId}/${randomUUID()}.pdf`;
      keysToCleanUp.push(key);
      uploadedKeys.push(key);
      await driver.put({ key, data: Buffer.from(`file-${i}`), mimeType: "application/pdf" });
    }

    const foundKeys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await maintenanceDriver.listKeysPage(continuationToken, 2);
      foundKeys.push(...page.keys);
      continuationToken = page.nextContinuationToken;
    } while (continuationToken);

    for (const key of uploadedKeys) {
      expect(foundKeys).toContain(key);
    }
  });
});
