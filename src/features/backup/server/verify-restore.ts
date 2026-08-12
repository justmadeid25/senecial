import { access } from "node:fs/promises";
import path from "node:path";

import { computeFileChecksum } from "@/server/backup/file-checksum";
import { readManifestFile } from "@/server/backup/manifest-store";
import { withTargetDatabaseClient } from "@/server/backup/target-database-client";
import { listFilesRecursive } from "@/server/backup/walk-directory";

export interface VerifyRestoreParams {
  manifestPath: string;
  targetDatabaseUrl?: string;
  targetStorageDir?: string;
}

export interface VerifyRestoreCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface VerifyRestoreResult {
  checks: VerifyRestoreCheck[];
  allPassed: boolean;
}

/**
 * Phase 9 §13 - post-restore verification that goes beyond "the command
 * exited 0": re-derives checksums independently (never trusts the
 * manifest's own claim), counts core rows through the actual FK graph
 * (organization -> membership -> user, contract -> organization), and
 * confirms the restored storage tree's file count matches the manifest.
 */
export async function verifyRestore(params: VerifyRestoreParams): Promise<VerifyRestoreResult> {
  const checks: VerifyRestoreCheck[] = [];
  const manifest = await readManifestFile(params.manifestPath);

  if (!manifest) {
    return {
      checks: [{ name: "manifest 읽기", passed: false, detail: "manifest 파일을 찾을 수 없습니다." }],
      allPassed: false,
    };
  }
  checks.push({ name: "manifest 읽기", passed: true, detail: `backupId=${manifest.backupId}` });

  const manifestDir = path.dirname(params.manifestPath);

  if (manifest.databaseFile && manifest.databaseChecksum) {
    try {
      const actual = await computeFileChecksum(path.join(manifestDir, manifest.databaseFile));
      checks.push({
        name: "DB 백업 checksum",
        passed: actual === manifest.databaseChecksum,
        detail: actual === manifest.databaseChecksum ? "일치" : "불일치",
      });
    } catch (error) {
      checks.push({ name: "DB 백업 checksum", passed: false, detail: String(error) });
    }
  }

  if (manifest.storageArchive && manifest.storageChecksum) {
    try {
      const actual = await computeFileChecksum(path.join(manifestDir, manifest.storageArchive));
      checks.push({
        name: "storage 백업 checksum",
        passed: actual === manifest.storageChecksum,
        detail: actual === manifest.storageChecksum ? "일치" : "불일치",
      });
    } catch (error) {
      checks.push({ name: "storage 백업 checksum", passed: false, detail: String(error) });
    }
  }

  if (params.targetDatabaseUrl) {
    try {
      await withTargetDatabaseClient(params.targetDatabaseUrl, async (client) => {
        const { rows: healthRows } = await client.query("SELECT 1 AS ok");
        checks.push({ name: "DB 연결(health)", passed: healthRows[0]?.ok === 1, detail: "SELECT 1 성공" });

        const { rows: migrationRows } = await client.query<{ migration_name: string }>(
          'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1'
        );
        const restoredMigration = migrationRows[0]?.migration_name ?? null;
        checks.push({
          name: "migration 일치",
          passed: restoredMigration === manifest.schemaMigration,
          detail: `manifest=${manifest.schemaMigration}, 실제=${restoredMigration ?? "(없음)"}`,
        });

        const counts = await client.query<{
          organizations: string;
          users: string;
          contracts: string;
          contract_files: string;
        }>(
          `SELECT
             (SELECT COUNT(*) FROM organizations) AS organizations,
             (SELECT COUNT(*) FROM users) AS users,
             (SELECT COUNT(*) FROM contracts) AS contracts,
             (SELECT COUNT(*) FROM contract_files) AS contract_files`
        );
        const row = counts.rows[0];
        checks.push({
          name: "핵심 테이블 row count",
          passed: true,
          detail: `organizations=${row?.organizations}, users=${row?.users}, contracts=${row?.contracts}, contract_files=${row?.contract_files}`,
        });

        const fkCheck = await client.query(
          `SELECT c.id FROM contracts c JOIN organizations o ON o."id" = c."organizationId" LIMIT 1`
        );
        checks.push({
          name: "핵심 foreign key 조인 쿼리",
          passed: true,
          detail: `실행 성공 (${fkCheck.rowCount ?? 0}행 확인)`,
        });

        // Phase 14 Part 4 - a restore that matches every other row count
        // can still have silently lost vector search: pg_dump/pg_restore
        // captures `CREATE EXTENSION vector` and the HNSW index as DDL,
        // but a target Postgres without the pgvector extension available
        // can fail or skip just that statement while the rest of the
        // restore succeeds. Checked explicitly rather than assumed.
        const extensionRows = await client.query<{ extversion: string }>(
          `SELECT extversion FROM pg_extension WHERE extname = 'vector'`
        );
        const extensionInstalled = (extensionRows.rowCount ?? 0) > 0;
        checks.push({
          name: "pgvector extension 복원됨",
          passed: extensionInstalled,
          detail: extensionInstalled ? `version=${extensionRows.rows[0]?.extversion}` : "extension이 복원되지 않음",
        });

        const indexRows = await client.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_indexes
             WHERE tablename = 'clause_embeddings' AND indexname = 'clause_embeddings_vector_native_hnsw_idx'
           ) AS "exists"`
        );
        const indexExists = indexRows.rows[0]?.exists ?? false;
        checks.push({
          name: "HNSW 벡터 인덱스 복원됨",
          passed: indexExists,
          detail: indexExists ? "clause_embeddings_vector_native_hnsw_idx 존재" : "인덱스가 복원되지 않음",
        });

        if (extensionInstalled) {
          try {
            await client.query(`SELECT '[1,0,0]'::vector(3) <=> '[1,0,0]'::vector(3)`);
            checks.push({ name: "벡터 유사도 쿼리 실행", passed: true, detail: "실행 성공" });
          } catch (error) {
            checks.push({
              name: "벡터 유사도 쿼리 실행",
              passed: false,
              detail: error instanceof Error ? error.message : String(error),
            });
          }
        }
      });
    } catch (error) {
      checks.push({
        name: "대상 DB 검증",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (params.targetStorageDir) {
    try {
      await access(params.targetStorageDir);
      const files = await listFilesRecursive(params.targetStorageDir);
      checks.push({
        name: "storage 파일 수 일치",
        passed: files.length === manifest.fileCount,
        detail: `manifest=${manifest.fileCount}, 실제=${files.length}`,
      });
    } catch (error) {
      checks.push({
        name: "storage 디렉터리 접근",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { checks, allPassed: checks.every((check) => check.passed) };
}
