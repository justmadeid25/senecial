import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Returns the lexicographically-last migration directory name under
 * prisma/migrations (Prisma's timestamp-prefixed naming means "last
 * alphabetically" is also "most recently created"). Used as
 * BackupManifest.schemaMigration and, at restore time, compared against
 * the target database's own applied-migration state so a restore is never
 * silently attempted against a schema version it was not made for.
 */
export async function getLatestMigrationName(
  migrationsDir: string = path.join(process.cwd(), "prisma", "migrations")
): Promise<string> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && entry.name !== "migration_lock.toml")
    .map((entry) => entry.name)
    .sort();

  const latest = names.at(-1);
  if (!latest) {
    throw new Error("prisma/migrations 디렉터리에서 마이그레이션을 찾을 수 없습니다.");
  }
  return latest;
}
