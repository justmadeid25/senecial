import { describe, expect, it } from "vitest";

import { isValidBucketName } from "@/domain/storage/bucket-name";
import { isValidStorageKey } from "@/domain/storage/storage-key-pattern";
import { maskStorageKey } from "@/domain/storage/mask-storage-key";
import { loadS3Config, resolveS3Config, validateS3Config } from "@/lib/config/s3";

describe("isValidBucketName (§3)", () => {
  it("accepts a well-formed bucket name", () => {
    expect(isValidBucketName("clausebase-prod-contracts")).toBe(true);
    expect(isValidBucketName("abc")).toBe(true);
  });

  it("rejects names shorter than 3 characters", () => {
    expect(isValidBucketName("ab")).toBe(false);
  });

  it("rejects uppercase letters", () => {
    expect(isValidBucketName("Clausebase-Bucket")).toBe(false);
  });

  it("rejects a name that starts or ends with a hyphen/dot", () => {
    expect(isValidBucketName("-clausebase")).toBe(false);
    expect(isValidBucketName("clausebase-")).toBe(false);
  });

  it("rejects consecutive dots", () => {
    expect(isValidBucketName("clause..base")).toBe(false);
  });

  it("rejects an IP-address-shaped name", () => {
    expect(isValidBucketName("192.168.1.1")).toBe(false);
  });
});

describe("isValidStorageKey (Phase 10A §35 - shared across local and S3 drivers)", () => {
  it("accepts the real generateStorageKey() shape", () => {
    expect(isValidStorageKey("clxyz123org/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.pdf")).toBe(true);
  });

  it("rejects a key with no organization segment", () => {
    expect(isValidStorageKey("just-a-filename.pdf")).toBe(false);
  });

  it("rejects a key with no extension", () => {
    expect(isValidStorageKey("org123/uuid-no-extension")).toBe(false);
  });

  it("rejects path traversal", () => {
    expect(isValidStorageKey("../../etc/passwd")).toBe(false);
  });
});

describe("maskStorageKey (§12 - never logs a full key)", () => {
  it("masks a normal-length key to prefix...suffix", () => {
    const masked = maskStorageKey("org123/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.pdf");
    expect(masked).toBe("org123...6d.pdf");
    expect(masked).not.toContain("9b1deb4d-3b7d-4bad-9bdd");
  });

  it("fully masks a short key with asterisks rather than leaking it via a too-short prefix/suffix", () => {
    expect(maskStorageKey("a/b.c")).toBe("*****");
  });
});

function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

describe("loadS3Config / validateS3Config / resolveS3Config (§3/§9)", () => {
  it("loadS3Config never throws for a completely empty environment", () => {
    const config = loadS3Config(env({}));
    expect(config.bucket).toBeUndefined();
    expect(config.region).toBeUndefined();
    expect(config.forcePathStyle).toBe(false);
    expect(config.uploadChecksum).toBe(true);
  });

  it("validateS3Config fails when region/bucket are missing", () => {
    const result = validateS3Config({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("validateS3Config fails on a malformed bucket name", () => {
    const result = validateS3Config({ region: "us-east-1", bucket: "Not Valid" });
    expect(result.valid).toBe(false);
  });

  it("validateS3Config fails when a KMS key is set without aws:kms encryption mode", () => {
    const result = validateS3Config({
      region: "us-east-1",
      bucket: "clausebase-contracts",
      kmsKeyId: "arn:aws:kms:us-east-1:111111111111:key/abc",
      serverSideEncryption: "AES256",
    });
    expect(result.valid).toBe(false);
  });

  it("validateS3Config passes without accessKeyId/secretAccessKey set (IAM role / workload identity chain)", () => {
    const result = validateS3Config({ region: "us-east-1", bucket: "clausebase-contracts" });
    expect(result.valid).toBe(true);
  });

  it("resolveS3Config throws a joined, safe error message when config is incomplete", () => {
    expect(() => resolveS3Config(env({}))).toThrow(/S3_REGION|S3_BUCKET/);
  });

  it("resolveS3Config never leaks S3_SECRET_ACCESS_KEY's value into its error", () => {
    try {
      resolveS3Config(env({ S3_SECRET_ACCESS_KEY: "super-secret-value-must-never-leak" }));
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("super-secret-value-must-never-leak");
    }
  });

  it("resolveS3Config returns a fully-typed config for a valid environment", () => {
    const config = resolveS3Config(
      env({
        S3_REGION: "us-east-1",
        S3_BUCKET: "clausebase-contracts",
        S3_FORCE_PATH_STYLE: "true",
      })
    );
    expect(config.region).toBe("us-east-1");
    expect(config.bucket).toBe("clausebase-contracts");
    expect(config.forcePathStyle).toBe(true);
  });
});
