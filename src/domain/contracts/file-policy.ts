/**
 * Domain-level rules for contract file uploads. Framework-agnostic so both
 * the upload API route and the storage layer can share the same policy.
 */

export const ALLOWED_CONTRACT_FILE_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/x-hwp",
  "application/haansofthwp",
] as const;

export type AllowedContractFileMimeType =
  (typeof ALLOWED_CONTRACT_FILE_MIME_TYPES)[number];

export const ALLOWED_CONTRACT_FILE_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".hwp",
] as const;

/**
 * Fallback default only - the actual enforced cap comes from
 * lib/config/file-upload.ts's MAX_UPLOAD_SIZE_BYTES (env-configurable via
 * MAX_UPLOAD_SIZE_MB), which callers should pass into
 * isWithinMaxContractFileSize() explicitly. Kept here so this pure domain
 * function still has a sane default when called without a maxBytes
 * argument (e.g. from unit tests) and this module never needs to read
 * process.env itself.
 */
export const MAX_CONTRACT_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

export function isAllowedContractFileMimeType(
  mimeType: string
): mimeType is AllowedContractFileMimeType {
  return (ALLOWED_CONTRACT_FILE_MIME_TYPES as readonly string[]).includes(
    mimeType
  );
}

export function isAllowedContractFileExtension(extension: string): boolean {
  return (ALLOWED_CONTRACT_FILE_EXTENSIONS as readonly string[]).includes(
    extension.toLowerCase()
  );
}

export function isWithinMaxContractFileSize(
  sizeInBytes: number,
  maxBytes: number = MAX_CONTRACT_FILE_SIZE_BYTES
): boolean {
  return sizeInBytes > 0 && sizeInBytes <= maxBytes;
}

// ---------------------------------------------------------------------------
// Magic-byte / container signature checks. Extension and declared MIME type
// are both trivially spoofable by renaming a file or forging a form field -
// these functions inspect the actual leading bytes (and, for ZIP-based
// formats, a best-effort scan of the raw content) so an upload claiming to
// be a PDF but containing something else is rejected before it ever reaches
// storage or the database.
// ---------------------------------------------------------------------------

const PDF_SIGNATURE = Buffer.from("%PDF-", "ascii");
const ZIP_LOCAL_FILE_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_EMPTY_ARCHIVE_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const OLE2_COMPOUND_FILE_SIGNATURE = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

function startsWithSignature(buffer: Buffer, signature: Buffer): boolean {
  return (
    buffer.length >= signature.length &&
    buffer.subarray(0, signature.length).equals(signature)
  );
}

function isZipContainer(buffer: Buffer): boolean {
  return (
    startsWithSignature(buffer, ZIP_LOCAL_FILE_SIGNATURE) ||
    startsWithSignature(buffer, ZIP_EMPTY_ARCHIVE_SIGNATURE)
  );
}

export function matchesPdfSignature(buffer: Buffer): boolean {
  return startsWithSignature(buffer, PDF_SIGNATURE);
}

/**
 * Best-effort DOCX check: confirms the file is a ZIP container (which is
 * what a .docx actually is) *and* that its raw bytes contain the two path
 * fragments every valid .docx produces ("[Content_Types].xml" and
 * "word/"). This is not a real ZIP/OOXML parser - a crafted ZIP that simply
 * embeds those byte sequences somewhere would also pass - but it is a
 * meaningfully stronger check than extension/MIME alone, and full ZIP
 * parsing is out of scope for this phase (documented in README).
 */
export function matchesDocxSignature(buffer: Buffer): boolean {
  if (!isZipContainer(buffer)) {
    return false;
  }
  const text = buffer.toString("latin1");
  return text.includes("[Content_Types].xml") && text.includes("word/");
}

/**
 * HWP has no single reliable magic-byte spec that can be checked without a
 * real parser: legacy .hwp (v5) uses the OLE Compound File Binary Format
 * (the same container family as old .doc/.xls), while some newer
 * HWP-family documents are ZIP-based. This function accepts either
 * container signature as a best-effort signal only - it does NOT confirm
 * the file is actually a valid HWP document, since no true HWP internal
 * structure parsing is implemented. See README's file-upload security
 * section for this explicitly documented limitation.
 */
export function matchesHwpSignature(buffer: Buffer): boolean {
  return startsWithSignature(buffer, OLE2_COMPOUND_FILE_SIGNATURE) || isZipContainer(buffer);
}

/**
 * Dispatches to the right signature check for an already-validated allowed
 * MIME type. Returns false (never throws) for anything unrecognized, so
 * callers can treat "no signature match" uniformly as a validation failure.
 */
export function matchesContractFileSignature(
  mimeType: string,
  buffer: Buffer
): boolean {
  switch (mimeType) {
    case "application/pdf":
      return matchesPdfSignature(buffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return matchesDocxSignature(buffer);
    case "application/x-hwp":
    case "application/haansofthwp":
      return matchesHwpSignature(buffer);
    default:
      return false;
  }
}
