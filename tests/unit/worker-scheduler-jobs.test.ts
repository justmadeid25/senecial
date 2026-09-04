import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { JOBS, SCRIPT_FILES, scriptFileFor } from "../../scripts/worker-scheduler-jobs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("worker-scheduler-jobs registry", () => {
  it("includes mail:recover-stale (activated for Closed Beta)", () => {
    expect(JOBS.some((job) => job.script === "mail:recover-stale")).toBe(true);
  });

  it("does NOT include mail:recover-stale-token-deliveries (kept manual)", () => {
    expect(JOBS.some((job) => job.script === "mail:recover-stale-token-deliveries")).toBe(false);
  });

  it("does NOT include the destructive operator-only retention jobs", () => {
    expect(JOBS.some((job) => job.script === "retention:scan")).toBe(false);
    expect(JOBS.some((job) => job.script === "retention:purge")).toBe(false);
  });

  it("has no duplicate job registrations", () => {
    const scripts = JOBS.map((job) => job.script);
    expect(new Set(scripts).size).toBe(scripts.length);
  });

  it("gives mail:recover-stale a conservative, non-zero poll interval consistent with the other Tier B recovery jobs", () => {
    const job = JOBS.find((j) => j.script === "mail:recover-stale");
    expect(job).toBeDefined();
    expect(job!.pollIntervalMs).toBeGreaterThan(0);
    // Same tier as extraction:recover-stale / clauses:recover-stale / ai:recover-stale-embeddings.
    const recoveryJob = JOBS.find((j) => j.script === "ai:recover-stale-embeddings");
    expect(job!.pollIntervalMs).toBe(recoveryJob!.pollIntervalMs);
  });

  it("every scheduled job resolves to a script file via scriptFileFor()", () => {
    for (const job of JOBS) {
      expect(() => scriptFileFor(job.script)).not.toThrow();
    }
  });

  it("scriptFileFor() throws on an unregistered job name", () => {
    expect(() => scriptFileFor("not:a:real:job")).toThrow();
  });

  it("every SCRIPT_FILES entry points at a real file under scripts/", () => {
    for (const file of Object.values(SCRIPT_FILES)) {
      const fullPath = path.join(repoRoot, "scripts", file);
      expect(existsSync(fullPath), `scripts/${file} does not exist`).toBe(true);
    }
  });

  it("mail:recover-stale maps to the real recover-stale-mail-deliveries.ts script", () => {
    expect(scriptFileFor("mail:recover-stale")).toBe("recover-stale-mail-deliveries.ts");
  });

  it("includes batch:recover-stale (orphaned batch_executions recovery)", () => {
    expect(JOBS.some((job) => job.script === "batch:recover-stale")).toBe(true);
  });

  it("batch:recover-stale maps to the real recover-stale-batch-executions.ts script", () => {
    expect(scriptFileFor("batch:recover-stale")).toBe("recover-stale-batch-executions.ts");
  });

  it("gives batch:recover-stale the same conservative poll interval as the other Tier B recovery jobs", () => {
    const job = JOBS.find((j) => j.script === "batch:recover-stale");
    expect(job).toBeDefined();
    const recoveryJob = JOBS.find((j) => j.script === "ai:recover-stale-embeddings");
    expect(job!.pollIntervalMs).toBe(recoveryJob!.pollIntervalMs);
  });

  it("registers exactly the expected total job count for this release", () => {
    expect(JOBS.length).toBe(16);
  });
});
