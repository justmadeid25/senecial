import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConcurrencyLimitError } from "@/lib/errors";
import { AI_CONCURRENCY_LIMITS } from "@/lib/config/ai-concurrency";
import { acquireAiConcurrencySlots, releaseAiConcurrencySlots } from "@/lib/rate-limit/enforce-ai-concurrency";
import { reserveAiBudget, releaseAiBudget } from "@/server/services/ai/budget/reserve-ai-budget";
import { prisma } from "@/server/db/client";

/**
 * Phase 14 Part 2 - RELEASE BLOCKER #1 (cross-tenant isolation). These
 * Redis/in-memory-backed AI resource guards (concurrency slots, cost/
 * request budget reservations) are keyed by organizationId (see
 * enforce-ai-concurrency.ts / reserve-ai-budget.ts), never a shared global
 * key - a noisy/abusive organization must never be able to exhaust another
 * organization's throughput or budget. These tests attack that boundary
 * directly against whatever ConcurrencyLimiter/BudgetCounter driver the
 * test environment resolves to (RATE_LIMITER=memory by default here - the
 * isolation property is a property of the KEY, not the backend).
 */
const TEST_EMAIL_DOMAIN = "ai-cross-tenant-resource-test.local";

let orgA: { id: string };
let orgB: { id: string };

beforeAll(async () => {
  orgA = await prisma.organization.create({
    data: { name: "AI Resource Org A", slug: `ai-resource-org-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "AI Resource Org B", slug: `ai-resource-org-b-${Date.now()}` },
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

describe("AI concurrency slots are organization-scoped (§33)", () => {
  it("exhausting Organization A's per-organization concurrency limit never blocks Organization B", async () => {
    // AI_CONCURRENCY_LIMITS.perUser (default 3) caps a single user, so use
    // enough distinct users to reach the perOrganization cap (default 10)
    // without ever tripping the per-user axis first.
    const usersNeeded = Math.ceil(AI_CONCURRENCY_LIMITS.perOrganization / AI_CONCURRENCY_LIMITS.perUser);
    const acquiredOrgA = [];
    for (let i = 0; i < AI_CONCURRENCY_LIMITS.perOrganization; i++) {
      const userId = `orgA-user-${i % usersNeeded}-${randomUUID()}`;
      acquiredOrgA.push(await acquireAiConcurrencySlots({ userId, organizationId: orgA.id }));
    }

    // Organization A is now fully saturated - one more distinct user must
    // be rejected on the organization axis specifically.
    await expect(
      acquireAiConcurrencySlots({ userId: `orgA-overflow-${randomUUID()}`, organizationId: orgA.id })
    ).rejects.toBeInstanceOf(ConcurrencyLimitError);

    // Organization B shares no state with Organization A's now-exhausted pool.
    const orgBSlots = await acquireAiConcurrencySlots({
      userId: `orgB-user-${randomUUID()}`,
      organizationId: orgB.id,
    });
    expect(orgBSlots.organizationId).toBe(orgB.id);

    await releaseAiConcurrencySlots(orgBSlots);
    for (const slots of acquiredOrgA) {
      await releaseAiConcurrencySlots(slots);
    }
  });
});

describe("AI budget reservations are organization-scoped (§27)", () => {
  it("Organization A hitting its daily AI request limit never blocks Organization B", async () => {
    const limitedOrg = await prisma.organization.update({
      where: { id: orgA.id },
      data: { dailyAiRequestLimit: 1 },
    });
    const unlimitedOrg = await prisma.organization.update({
      where: { id: orgB.id },
      data: { dailyAiRequestLimit: null },
    });

    const first = await reserveAiBudget({ organizationId: limitedOrg.id, maxEstimatedCostMinor: BigInt(0) });
    expect(first.allowed).toBe(true);

    // Second request the same day exceeds Organization A's daily cap.
    const second = await reserveAiBudget({ organizationId: limitedOrg.id, maxEstimatedCostMinor: BigInt(0) });
    expect(second.allowed).toBe(false);

    // Organization B's independent (unlimited) counter is completely unaffected.
    const orgBReservation = await reserveAiBudget({ organizationId: unlimitedOrg.id, maxEstimatedCostMinor: BigInt(0) });
    expect(orgBReservation.allowed).toBe(true);

    if (first.allowed) {
      await releaseAiBudget(first.reservation);
    }
    if (orgBReservation.allowed) {
      await releaseAiBudget(orgBReservation.reservation);
    }
  });
});
