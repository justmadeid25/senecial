import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";
import { buildDatabaseUrl, createDatabase, dropDatabase } from "@/server/backup/maintenance-database";
import { withTargetDatabaseClient } from "@/server/backup/target-database-client";

import { backupDatabase } from "./backup-database";
import { backupStorage } from "./backup-storage";
import { restoreDatabase } from "./restore-database";
import { restoreStorage } from "./restore-storage";
import { verifyRestore } from "./verify-restore";

export interface DisasterRecoveryDrillResult {
  drillId: string;
  durationMs: number;
  sourceCounts: { organizations: number; users: number; contracts: number; clauseEmbeddings: number };
  targetCounts: { organizations: number; users: number; contracts: number; clauseEmbeddings: number };
  rowCountsMatch: boolean;
  verify: Awaited<ReturnType<typeof verifyRestore>>;
}

/**
 * Phase 9 §14 - full backup -> restore -> verify cycle against a
 * throwaway database and storage directory, never against DATABASE_URL
 * itself. Refuses outright in production (see the CLI wrapper's guard) -
 * this function additionally never touches anything under the drill's own
 * generated names, so even a misconfigured caller cannot make it write to
 * an arbitrary existing database.
 */
export async function runDisasterRecoveryDrill(
  sourceDatabaseUrl: string
): Promise<DisasterRecoveryDrillResult> {
  const start = Date.now();
  const drillId = `dr_drill_${Date.now()}_${randomBytes(3).toString("hex")}`;
  const drillDbName = drillId;
  const drillDatabaseUrl = buildDatabaseUrl(sourceDatabaseUrl, drillDbName);

  const scratchDir = path.join(os.tmpdir(), `senecial-dr-${randomUUID()}`);
  const restoredStorageDir = path.join(scratchDir, "restored-storage");
  await mkdir(scratchDir, { recursive: true });

  const markerEmailDomain = `dr-drill-${Date.now()}.local`;
  let markerOrgId: string | undefined;

  try {
    // 1. Known test data so before/after row counts are meaningful even
    // against an otherwise-empty database.
    const org = await prisma.organization.create({
      data: { name: "DR Drill Org", slug: `dr-drill-${Date.now()}` },
    });
    markerOrgId = org.id;
    const user = await prisma.user.create({
      data: {
        name: "DR Drill User",
        email: `owner@${markerEmailDomain}`,
        passwordHash: "irrelevant-drill-marker",
        memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
      },
    });
    await prisma.contract.create({
      data: {
        organizationId: org.id,
        createdById: user.id,
        title: "DR Drill Contract",
        contractType: "OTHER",
        status: "DRAFT",
      },
    });

    // 2/3. Backup DB + storage.
    await backupDatabase({ outputDir: scratchDir, backupId: drillId, databaseUrl: sourceDatabaseUrl });
    await backupStorage({
      outputDir: scratchDir,
      backupId: drillId,
      storageRoot: process.env.LOCAL_STORAGE_PATH ?? "./storage",
    });
    const manifestPath = path.join(scratchDir, `${drillId}.manifest.json`);

    const sourceCounts = await countCoreRows(sourceDatabaseUrl);

    // 4/5. Fresh empty DB + storage dir.
    await createDatabase(sourceDatabaseUrl, drillDbName);
    await mkdir(restoredStorageDir, { recursive: true });

    // 6. Restore.
    await restoreDatabase({
      manifestPath,
      targetDatabaseUrl: drillDatabaseUrl,
      primaryDatabaseUrl: sourceDatabaseUrl,
      isProduction: false,
      allowProductionOverwrite: false,
      allowOverwrite: false,
    });
    await rm(restoredStorageDir, { recursive: true, force: true });
    await restoreStorage({ manifestPath, targetDir: restoredStorageDir, allowOverwrite: false });

    // 7. Verify.
    const verify = await verifyRestore({
      manifestPath,
      targetDatabaseUrl: drillDatabaseUrl,
      targetStorageDir: restoredStorageDir,
    });

    // 8. Compare row counts against the source.
    const targetCounts = await countCoreRows(drillDatabaseUrl);
    const rowCountsMatch =
      sourceCounts.organizations === targetCounts.organizations &&
      sourceCounts.users === targetCounts.users &&
      sourceCounts.contracts === targetCounts.contracts &&
      sourceCounts.clauseEmbeddings === targetCounts.clauseEmbeddings;

    return {
      drillId,
      durationMs: Date.now() - start,
      sourceCounts,
      targetCounts,
      rowCountsMatch,
      verify,
    };
  } finally {
    // 10. Cleanup - marker data, drill database, and every temp file this
    // drill created, regardless of success/failure above.
    if (markerOrgId) {
      await prisma.organization.delete({ where: { id: markerOrgId } }).catch(() => undefined);
    }
    await dropDatabase(sourceDatabaseUrl, drillDbName).catch(() => undefined);
    await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function countCoreRows(
  databaseUrl: string
): Promise<{ organizations: number; users: number; contracts: number; clauseEmbeddings: number }> {
  return withTargetDatabaseClient(databaseUrl, async (client) => {
    const { rows } = await client.query<{
      organizations: string;
      users: string;
      contracts: string;
      clause_embeddings: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM organizations) AS organizations,
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM contracts) AS contracts,
         (SELECT COUNT(*) FROM clause_embeddings) AS clause_embeddings`
    );
    const row = rows[0];
    return {
      organizations: Number(row?.organizations ?? 0),
      users: Number(row?.users ?? 0),
      contracts: Number(row?.contracts ?? 0),
      clauseEmbeddings: Number(row?.clause_embeddings ?? 0),
    };
  });
}
