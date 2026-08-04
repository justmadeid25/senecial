import { describe, expect, it } from "vitest";

import { isValidBackupManifest } from "@/domain/backup/manifest";
import { isSameDatabaseTarget, assertRestoreTargetIsSafe } from "@/domain/backup/restore-safety";
import { parseDatabaseUrl, toPgEnv } from "@/domain/backup/database-url";

const VALID_DB_ONLY = {
  backupId: "b1",
  createdAt: "2026-01-01T00:00:00.000Z",
  schemaMigration: "20260101000000_init",
  databaseFile: "b1.db.dump",
  databaseChecksum: "abc123",
  fileCount: 0,
  encrypted: false,
};

describe("isValidBackupManifest (§45)", () => {
  it("accepts a DB-only manifest", () => {
    expect(isValidBackupManifest(VALID_DB_ONLY)).toBe(true);
  });

  it("accepts a storage-only manifest", () => {
    expect(
      isValidBackupManifest({
        backupId: "b1",
        createdAt: "2026-01-01T00:00:00.000Z",
        schemaMigration: "20260101000000_init",
        storageArchive: "b1.storage.tar.gz",
        storageChecksum: "def456",
        fileCount: 3,
        encrypted: false,
      })
    ).toBe(true);
  });

  it("rejects a manifest with neither DB nor storage fields", () => {
    expect(
      isValidBackupManifest({
        backupId: "b1",
        createdAt: "2026-01-01T00:00:00.000Z",
        schemaMigration: "20260101000000_init",
        fileCount: 0,
        encrypted: false,
      })
    ).toBe(false);
  });

  it("rejects a manifest with databaseFile but no databaseChecksum (corrupted/partial write)", () => {
    const { databaseChecksum: _omit, ...corrupted } = VALID_DB_ONLY;
    expect(isValidBackupManifest(corrupted)).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(isValidBackupManifest(null)).toBe(false);
    expect(isValidBackupManifest("not an object")).toBe(false);
    expect(isValidBackupManifest({})).toBe(false);
  });

  it("rejects a negative or non-integer fileCount", () => {
    expect(isValidBackupManifest({ ...VALID_DB_ONLY, fileCount: -1 })).toBe(false);
    expect(isValidBackupManifest({ ...VALID_DB_ONLY, fileCount: 1.5 })).toBe(false);
  });
});

describe("database-url parsing (never exposes the password as a CLI-visible value)", () => {
  it("parses host/port/user/password/database", () => {
    const parsed = parseDatabaseUrl("postgresql://myuser:my%20pass@dbhost:5433/mydb?sslmode=require");
    expect(parsed.host).toBe("dbhost");
    expect(parsed.port).toBe("5433");
    expect(parsed.user).toBe("myuser");
    expect(parsed.password).toBe("my pass");
    expect(parsed.database).toBe("mydb");
    expect(parsed.sslmode).toBe("require");
  });

  it("toPgEnv builds env vars for pg_dump/pg_restore's env-only credential passing", () => {
    const env = toPgEnv(parseDatabaseUrl("postgresql://u:p@h:5432/d"));
    expect(env.PGHOST).toBe("h");
    expect(env.PGPORT).toBe("5432");
    expect(env.PGUSER).toBe("u");
    expect(env.PGPASSWORD).toBe("p");
    expect(env.PGDATABASE).toBe("d");
  });

  it("rejects a non-postgresql URL", () => {
    expect(() => parseDatabaseUrl("mysql://u:p@h:3306/d")).toThrow();
  });
});

describe("restore-safety (§12 production overwrite guard)", () => {
  it("isSameDatabaseTarget compares host+port+database, ignoring credentials", () => {
    expect(
      isSameDatabaseTarget("postgresql://a:1@host:5432/db", "postgresql://b:2@host:5432/db")
    ).toBe(true);
    expect(
      isSameDatabaseTarget("postgresql://a:1@host:5432/db1", "postgresql://a:1@host:5432/db2")
    ).toBe(false);
  });

  it("blocks a production restore onto the same database as DATABASE_URL", () => {
    expect(() =>
      assertRestoreTargetIsSafe({
        targetDatabaseUrl: "postgresql://a:1@host:5432/db",
        primaryDatabaseUrl: "postgresql://a:1@host:5432/db",
        isProduction: true,
        allowProductionOverwrite: false,
      })
    ).toThrow();
  });

  it("allows it when allowProductionOverwrite is explicitly set", () => {
    expect(() =>
      assertRestoreTargetIsSafe({
        targetDatabaseUrl: "postgresql://a:1@host:5432/db",
        primaryDatabaseUrl: "postgresql://a:1@host:5432/db",
        isProduction: true,
        allowProductionOverwrite: true,
      })
    ).not.toThrow();
  });

  it("never blocks outside production, even for the same database", () => {
    expect(() =>
      assertRestoreTargetIsSafe({
        targetDatabaseUrl: "postgresql://a:1@host:5432/db",
        primaryDatabaseUrl: "postgresql://a:1@host:5432/db",
        isProduction: false,
        allowProductionOverwrite: false,
      })
    ).not.toThrow();
  });

  it("never blocks a genuinely different target database in production", () => {
    expect(() =>
      assertRestoreTargetIsSafe({
        targetDatabaseUrl: "postgresql://a:1@host:5432/db_restore_test",
        primaryDatabaseUrl: "postgresql://a:1@host:5432/db",
        isProduction: true,
        allowProductionOverwrite: false,
      })
    ).not.toThrow();
  });
});
