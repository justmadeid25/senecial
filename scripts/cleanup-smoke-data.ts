import "dotenv/config";

import { prisma } from "../src/server/db/client";

const SMOKE_EMAIL_DOMAIN = "smoke-test.local";

/**
 * Phase 11 §Synthetic organization - deletes every organization/user
 * created by `tests/e2e/smoke.spec.ts` (always `@smoke-test.local` email
 * addresses, `SMOKE-` prefixed org/contract names - see that spec). Only
 * ever matches rows with that exact email domain - structurally incapable
 * of touching any other data, real customer or otherwise, regardless of
 * what else exists in the target database.
 *
 * Runs as a separate step from the Playwright spec itself (see
 * scripts/smoke.ts) because Playwright's TS transform in this project
 * cannot load the generated Prisma client directly (see
 * tests/e2e/contracts-flow.spec.ts's identical note).
 */
async function main() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${SMOKE_EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  const memberships = await prisma.membership.findMany({
    where: { userId: { in: users.map((u) => u.id) } },
    select: { organizationId: true },
  });
  const organizationIds = [...new Set(memberships.map((m) => m.organizationId))];

  // Organization first - cascades away every org-scoped row (contracts,
  // contract files, invitations, audit logs, ...), matching the cleanup
  // order every integration test in this codebase already uses.
  const orgResult = await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  const userResult = await prisma.user.deleteMany({ where: { email: { endsWith: `@${SMOKE_EMAIL_DOMAIN}` } } });

  console.log(`smoke 데이터 정리 완료: organizations=${orgResult.count}, users=${userResult.count}`);
}

main()
  .catch((error: unknown) => {
    console.error("smoke 데이터 정리 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
