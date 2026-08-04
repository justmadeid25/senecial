import { isValidBucketName } from "@/domain/storage/bucket-name";

export type ServerSideEncryption = "AES256" | "aws:kms";

export interface S3Config {
  /** undefined = provider's own default endpoint (real AWS S3). Set for R2/MinIO/any other S3-compatible endpoint. */
  endpoint?: string;
  region: string;
  bucket: string;
  /** Both undefined is valid - the AWS SDK then falls back to its default credential provider chain (IAM role / workload identity / env / shared config). */
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
  serverSideEncryption?: ServerSideEncryption;
  kmsKeyId?: string;
  uploadChecksum: boolean;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) {
    return fallback;
  }
  return raw === "true";
}

/**
 * §3 - reads S3 configuration from the environment. Deliberately does NOT
 * throw for a missing bucket/region here - `loadS3Config()` is called by
 * both the driver factory (which must fail fast/loud when FILE_STORAGE_DRIVER=s3
 * is actually selected) and the production-readiness validator (which
 * wants to report a clean PASS/FAIL/WARN list rather than crash on the
 * first missing value) - callers that need hard validation use
 * `validateS3Config()` below instead of inspecting raw env directly.
 */
export function loadS3Config(env: NodeJS.ProcessEnv = process.env): Partial<S3Config> {
  const serverSideEncryption = env.S3_SERVER_SIDE_ENCRYPTION;
  return {
    endpoint: env.S3_ENDPOINT || undefined,
    region: env.S3_REGION || undefined,
    bucket: env.S3_BUCKET || undefined,
    accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
    forcePathStyle: parseBoolean(env.S3_FORCE_PATH_STYLE, false),
    serverSideEncryption:
      serverSideEncryption === "AES256" || serverSideEncryption === "aws:kms" ? serverSideEncryption : undefined,
    kmsKeyId: env.S3_KMS_KEY_ID || undefined,
    uploadChecksum: parseBoolean(env.S3_UPLOAD_CHECKSUM, true),
  } as Partial<S3Config>;
}

export interface S3ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * §3/§9 - the hard-validation path: called once by the driver factory when
 * `FILE_STORAGE_DRIVER=s3` is actually selected (never for `local`, so a
 * deployment that never uses S3 is never forced to configure it). Access
 * key/secret are intentionally NOT required - an environment using IAM
 * role / workload identity credentials (EC2 instance profile, ECS task
 * role, EKS IRSA, GCP workload identity federation, ...) legitimately has
 * neither set, and the AWS SDK's default credential provider chain
 * resolves them automatically.
 */
export function validateS3Config(config: Partial<S3Config>): S3ConfigValidationResult {
  const errors: string[] = [];

  if (!config.region) {
    errors.push("S3_REGION이 설정되지 않았습니다.");
  }
  if (!config.bucket) {
    errors.push("S3_BUCKET이 설정되지 않았습니다.");
  } else if (!isValidBucketName(config.bucket)) {
    errors.push("S3_BUCKET이 올바른 버킷 이름 형식이 아닙니다.");
  }
  if (config.kmsKeyId && config.serverSideEncryption !== "aws:kms") {
    errors.push("S3_KMS_KEY_ID가 설정되었지만 S3_SERVER_SIDE_ENCRYPTION이 aws:kms가 아닙니다.");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates and narrows in one step - the factory-facing entry point.
 * Throws (with every validation error joined into one message) rather
 * than returning a result, since by the time `FILE_STORAGE_DRIVER=s3` has
 * actually been selected, an invalid config is not a recoverable
 * situation for the caller.
 */
export function resolveS3Config(env: NodeJS.ProcessEnv = process.env): S3Config {
  const config = loadS3Config(env);
  const validation = validateS3Config(config);
  if (!validation.valid) {
    throw new Error(`S3 storage 설정이 올바르지 않습니다: ${validation.errors.join(" / ")}`);
  }
  return config as S3Config;
}
