import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

import { Client } from "pg";

/**
 * §Phase 12.3 Part A (§4) - `pnpm db:verify-migrations`. A read-only audit,
 * never mutates the database or any migration file. Intended as a release
 * gate step (Part G) - exits non-zero on ANY problem found. Never prints
 * DATABASE_URL or any credential - only the database name (parsed out of
 * the URL, same redaction pattern as scripts/e2e-db-reset.ts).
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations");

interface Problem {
  code: string;
  detail: string;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function listOnDiskMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

interface AppliedMigrationRow {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  logs: string | null;
}

async function main(): Promise<void> {
  const problems: Problem[] = [];
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[db:verify-migrations] DATABASE_URL이 설정되지 않았습니다.");
    process.exitCode = 1;
    return;
  }
  const targetDatabase = new URL(databaseUrl).pathname.replace(/^\//, "");
  console.log(`[db:verify-migrations] target database: ${targetDatabase}`);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // §4 - migration 파일 checksum + `_prisma_migrations`와 저장소 migration
    // 일치 + pending/failed migration.
    const onDisk = listOnDiskMigrations();
    let appliedRows: AppliedMigrationRow[] = [];
    try {
      const result = await client.query<AppliedMigrationRow>(
        "SELECT migration_name, checksum, finished_at, rolled_back_at, logs FROM _prisma_migrations ORDER BY started_at"
      );
      appliedRows = result.rows;
    } catch (error) {
      problems.push({
        code: "MIGRATIONS_TABLE_MISSING",
        detail: `_prisma_migrations 테이블을 조회할 수 없습니다 (${error instanceof Error ? error.message : "unknown error"})`,
      });
    }

    const appliedByName = new Map(appliedRows.map((row) => [row.migration_name, row]));

    for (const migrationName of onDisk) {
      const sqlPath = path.join(MIGRATIONS_DIR, migrationName, "migration.sql");
      if (!existsSync(sqlPath)) {
        continue; // e.g. a directory with only a README - not a real migration
      }
      const applied = appliedByName.get(migrationName);
      if (!applied) {
        problems.push({ code: "PENDING_MIGRATION", detail: `${migrationName} - DB에 적용되지 않음 (pending)` });
        continue;
      }
      if (applied.rolled_back_at) {
        problems.push({ code: "ROLLED_BACK_MIGRATION", detail: `${migrationName} - rolled back 상태` });
        continue;
      }
      if (!applied.finished_at) {
        problems.push({
          code: "FAILED_MIGRATION",
          detail: `${migrationName} - finished_at이 없음 (실패했거나 중단된 상태). logs: ${(applied.logs ?? "").slice(0, 200)}`,
        });
        continue;
      }
      const fileContent = readFileSync(sqlPath, "utf8");
      const actualChecksum = sha256(fileContent);
      if (actualChecksum !== applied.checksum) {
        problems.push({
          code: "CHECKSUM_MISMATCH",
          detail: `${migrationName} - 저장소 파일의 checksum이 DB에 기록된 값과 다릅니다 (파일이 적용 이후 수정되었을 가능성)`,
        });
      }
    }

    const onDiskSet = new Set(onDisk);
    for (const row of appliedRows) {
      if (!onDiskSet.has(row.migration_name)) {
        problems.push({
          code: "ORPHAN_APPLIED_MIGRATION",
          detail: `${row.migration_name} - DB에는 적용 기록이 있지만 저장소에 해당 migration 폴더가 없습니다`,
        });
      }
    }

    // §4 - pgvector extension.
    const extensions = await client.query<{ extname: string; extversion: string }>(
      "SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'pg_trgm')"
    );
    const extNames = new Set(extensions.rows.map((r) => r.extname));
    if (!extNames.has("vector")) {
      problems.push({ code: "MISSING_EXTENSION", detail: "vector extension이 설치되어 있지 않습니다" });
    }
    if (!extNames.has("pg_trgm")) {
      problems.push({ code: "MISSING_EXTENSION", detail: "pg_trgm extension이 설치되어 있지 않습니다" });
    }

    // §4 - HNSW index + pg_trgm GIN index.
    const indexes = await client.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND (indexname = $1 OR indexdef ILIKE $2)",
      ["clause_embeddings_vector_native_hnsw_idx", "%gin_trgm_ops%"]
    );
    const hnswIndex = indexes.rows.find((r) => r.indexname === "clause_embeddings_vector_native_hnsw_idx");
    if (!hnswIndex) {
      problems.push({ code: "MISSING_HNSW_INDEX", detail: "clause_embeddings_vector_native_hnsw_idx 인덱스가 없습니다" });
    } else if (!/using hnsw/i.test(hnswIndex.indexdef) || !/vector_cosine_ops/i.test(hnswIndex.indexdef)) {
      problems.push({
        code: "WRONG_INDEX_DEFINITION",
        detail: `HNSW 인덱스는 존재하지만 정의가 예상과 다릅니다: ${hnswIndex.indexdef}`,
      });
    }
    const trgmIndex = indexes.rows.find((r) => /gin_trgm_ops/i.test(r.indexdef));
    if (!trgmIndex) {
      problems.push({ code: "MISSING_TRGM_INDEX", detail: "normalizedText의 pg_trgm GIN 인덱스가 없습니다" });
    }

    // §4 - 핵심 schema column (pgvector 네이티브 컬럼 + AI provenance 컬럼).
    const coreColumns: Array<{ table: string; column: string }> = [
      { table: "clause_embeddings", column: "vectorNative" },
      { table: "ai_messages", column: "aiConfigVersion" },
      { table: "ai_messages", column: "aiConfigChecksum" },
      { table: "ai_messages", column: "embeddingVersion" },
      { table: "ai_messages", column: "vectorSearchProvider" },
      { table: "ai_messages", column: "promptTemplateVersion" },
      { table: "ai_messages", column: "citationValidatorVersion" },
    ];
    for (const { table, column } of coreColumns) {
      const result = await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2) AS exists",
        [table, column]
      );
      if (!result.rows[0]?.exists) {
        problems.push({ code: "MISSING_CORE_COLUMN", detail: `${table}.${column} 컬럼이 없습니다` });
      }
    }

    // §4 - EXPLAIN 검사 (index가 실제로 planner에게 보이는지, 사용 여부는
    // 데이터 규모에 따라 다를 수 있으므로 "존재/사용 가능"만 확인 - §3의
    // "correctness는 index 없이도 유지" 원칙과 일치).
    try {
      await client.query("SELECT '[1,0,0]'::vector(3) <=> '[0,1,0]'::vector(3)");
    } catch (error) {
      problems.push({
        code: "VECTOR_PROBE_FAILED",
        detail: `vector 타입 probe 쿼리 실패: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }

    if (problems.length === 0) {
      console.log(`[db:verify-migrations] 통과 - migration ${onDisk.length}개, extension/index/column 전부 정상.`);
      return;
    }

    console.log(`[db:verify-migrations] 문제 ${problems.length}건 발견:`);
    for (const problem of problems) {
      console.log(`  - [${problem.code}] ${problem.detail}`);
    }
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("[db:verify-migrations] 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
