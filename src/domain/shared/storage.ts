/**
 * Provider-agnostic description of a file that has been persisted through
 * the storage layer. Lives in the domain layer so both `server/storage`
 * (the infrastructure implementation) and `domain/contracts/ai` (which must
 * not depend on infrastructure) can reference the same shape.
 */
export interface StoredFile {
  key: string;
  size: number;
  checksum: string;
  mimeType: string;
}
