/**
 * S3 bucket naming rules (AWS, and followed by R2/MinIO for
 * compatibility): 3-63 chars, lowercase letters/digits/hyphens/dots,
 * must start and end with a letter or digit, no consecutive dots, not
 * formatted as an IP address. Validated up front so a typo'd bucket name
 * fails fast with a clear message instead of a confusing SDK error deep
 * inside an upload.
 */
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const IP_ADDRESS_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export function isValidBucketName(name: string): boolean {
  if (!BUCKET_NAME_PATTERN.test(name)) {
    return false;
  }
  if (name.includes("..")) {
    return false;
  }
  if (IP_ADDRESS_PATTERN.test(name)) {
    return false;
  }
  return true;
}
