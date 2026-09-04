import { describe, expect, it } from "vitest";

import { findUnexpectedDrift } from "../../scripts/migration-drift-filter";

describe("findUnexpectedDrift", () => {
  it("tolerates both known pgvector HNSW index drops together", () => {
    const diff = [
      "-- DropIndex",
      'DROP INDEX "clause_embeddings_vector_native_hnsw_idx";',
      "",
      "-- DropIndex",
      'DROP INDEX "contract_document_chunk_embeddings_vector_native_hnsw_idx";',
    ].join("\n");
    expect(findUnexpectedDrift(diff)).toEqual([]);
  });

  it("tolerates just the clause_embeddings HNSW index drop alone", () => {
    const diff = ["-- DropIndex", 'DROP INDEX "clause_embeddings_vector_native_hnsw_idx";'].join("\n");
    expect(findUnexpectedDrift(diff)).toEqual([]);
  });

  it("tolerates just the contract_document_chunk_embeddings HNSW index drop alone", () => {
    const diff = ["-- DropIndex", 'DROP INDEX "contract_document_chunk_embeddings_vector_native_hnsw_idx";'].join(
      "\n"
    );
    expect(findUnexpectedDrift(diff)).toEqual([]);
  });

  it("tolerates an empty diff and the empty-migration marker", () => {
    expect(findUnexpectedDrift("")).toEqual([]);
    expect(findUnexpectedDrift("-- This is an empty migration.\n")).toEqual([]);
  });

  it("flags a genuinely unrelated dropped table as real drift", () => {
    const diff = ["-- DropTable", 'DROP TABLE "some_table";'].join("\n");
    expect(findUnexpectedDrift(diff)).toEqual(["-- DropTable", 'DROP TABLE "some_table";']);
  });

  it("flags a dropped index that is NOT a vector-native HNSW index as real drift", () => {
    const diff = ["-- DropIndex", 'DROP INDEX "contracts_organization_id_idx";'].join("\n");
    expect(findUnexpectedDrift(diff)).toEqual(['DROP INDEX "contracts_organization_id_idx";']);
  });

  it("flags a hypothetical third vector-native HNSW index name mismatch (wrong suffix) as real drift", () => {
    // Guards against the match becoming so loose it would also swallow a
    // typo'd or unrelated index that merely contains "hnsw" somewhere.
    const diff = ["-- DropIndex", 'DROP INDEX "some_other_hnsw_index";'].join("\n");
    expect(findUnexpectedDrift(diff)).toEqual(['DROP INDEX "some_other_hnsw_index";']);
  });

  it("flags an added column mixed in with an otherwise-tolerated HNSW drop", () => {
    const diff = [
      "-- DropIndex",
      'DROP INDEX "clause_embeddings_vector_native_hnsw_idx";',
      "",
      "-- AlterTable",
      'ALTER TABLE "contracts" ADD COLUMN "unexpected" TEXT;',
    ].join("\n");
    expect(findUnexpectedDrift(diff)).toEqual(["-- AlterTable", 'ALTER TABLE "contracts" ADD COLUMN "unexpected" TEXT;']);
  });
});
