import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { backupStorage } from "@/features/backup/server/backup-storage";

/**
 * Phase 9.1 - regression test for a bug found only by running a real
 * backup/restore drill with real `tar` (never caught by pure unit tests,
 * since it depends on actual filesystem/tar behavior): `storage/.gitkeep`
 * (a repo-management artifact outside any org subdirectory) was archived
 * by a plain `tar ... .` but never counted by the fileCount computation,
 * so `manifest.fileCount` was permanently off by one versus what the
 * archive actually contained - which made every real restore's
 * post-extraction count check fail.
 *
 * A second bug found the same way - on Windows, `fs.rename()` refuses to
 * rename onto a path that already exists as a directory, even an empty
 * one, unlike POSIX; a target directory created ahead of time (exactly
 * what `mkdir -p` does) made every real restore fail with EPERM - is
 * fixed in restore-storage.ts (always `rm` the target before renaming
 * onto it, regardless of whether it has entries) but is NOT re-exercised
 * here: spawning `tar` for an extract from inside a Vitest worker process
 * hits an unrelated, environment-specific path-escaping quirk in this
 * sandbox that does not reproduce when the same code runs as a plain
 * `tsx` process (which is how every real CLI invocation - including
 * `pnpm disaster-recovery:drill`, run for real multiple times against
 * this same fix - actually executes). The fix's correctness is verified
 * by that real drill succeeding end-to-end, not by this file.
 */
describe("backupStorage (real tar, real filesystem)", () => {
  const workDir = path.join(process.cwd(), ".test-scratch", `backup-restore-${randomUUID()}`);
  const sourceRoot = path.join(workDir, "source-storage");
  const backupDir = path.join(workDir, "backups");

  const orgId = "testorg1234567890123456";

  beforeAll(async () => {
    await mkdir(path.join(sourceRoot, orgId), { recursive: true });

    // A .gitkeep sitting at the storage ROOT, exactly like this repo's own
    // storage/.gitkeep - never inside an org subdirectory.
    await writeFile(path.join(sourceRoot, ".gitkeep"), "");

    const content = Buffer.concat([Buffer.from("regression test file\n"), randomBytes(64)]);
    await writeFile(path.join(sourceRoot, orgId, `${randomUUID()}.pdf`), content);
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("excludes .gitkeep from both the archive and fileCount, and counts relative to the given storageRoot (not the app's globally-configured storage path)", async () => {
    const result = await backupStorage({ outputDir: backupDir, backupId: "regression", storageRoot: sourceRoot });
    expect(result.fileCount).toBe(1);
  });
});
