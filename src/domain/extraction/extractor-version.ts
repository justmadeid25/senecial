/**
 * Bumped whenever the text-extraction or field-extraction logic changes
 * meaningfully enough that old suggestions should no longer be treated as
 * "the same job" for a given file - see ContractExtractionJob's unique
 * constraint in schema.prisma.
 */
export const EXTRACTOR_VERSION = "v1";
