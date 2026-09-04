import { findUnexpectedDrift } from "./migration-drift-filter";

/**
 * Reads `prisma migrate diff --script` output from stdin, echoes it, and
 * fails only on genuinely unexpected drift (see migration-drift-filter.ts
 * for exactly what's tolerated and why). Used by ci.yml's
 * "Drift check - migrations vs schema.prisma" step:
 *
 *   pnpm exec prisma migrate diff --from-config-datasource \
 *     --to-schema=prisma/schema.prisma --script | pnpm exec tsx scripts/check-migration-drift.ts
 */
async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const diff = Buffer.concat(chunks).toString("utf8");
  console.log(diff);

  const unexpected = findUnexpectedDrift(diff);
  if (unexpected.length > 0) {
    console.error("::error::Unexpected schema/migration drift beyond the known pgvector HNSW index gap:");
    console.error(unexpected.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("Only the expected, permanent pgvector HNSW index gap(s) - no real drift.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
