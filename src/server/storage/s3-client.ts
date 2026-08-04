import { S3Client } from "@aws-sdk/client-s3";

import type { S3Config } from "@/lib/config/s3";

/**
 * §3 - `endpoint: undefined` makes the SDK use real AWS S3's own regional
 * endpoint; setting it points at any other S3-compatible provider (R2,
 * MinIO, ...). `credentials: undefined` (when access key/secret are not
 * configured) makes the SDK fall back to its default credential provider
 * chain (env vars, shared config file, EC2/ECS/EKS instance role,
 * workload identity federation, ...) - this is what lets an IAM-role-based
 * environment work with zero S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY set.
 */
export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined,
  });
}
