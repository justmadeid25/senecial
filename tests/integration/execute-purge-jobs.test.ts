import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { executePurgeJobs } from "@/features/retention/server/execute-purge-jobs";
import { registerPurgeJob } from "@/server/repositories/data-purge-job-repository";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "execute-purge-jobs-test.local";
const DAY_MS = 24 * 60 * 60 * 1000;

let org: { id: string };
let owner: { id: string };

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  org = await prisma.organization.create({
    data: { name: "Execute Purge Jobs Test Org", slug: `execute-purge-jobs-test-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });
});

afterAll(async () => {
  await prisma.dataPurgeJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.contract.deleteMany({ where: { organizationId: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
});

async function createEligibleContract(deletedDaysAgo: number) {
  const created = await createContract({
    userId: owner.id,
    organizationId: org.id,
    input: { title: "Execute purge 대상", contractType: "SERVICE", status: "ACTIVE", autoRenewal: false },
  });
  await prisma.contract.update({
    where: { id: created.id },
    data: { deletedAt: new Date(Date.now() - deletedDaysAgo * DAY_MS) },
  });
  return created.id;
}

describe("executePurgeJobs (§27/§28 - claim + dispatch + retry marking)", () => {
  it("claims a PENDING job, purges the contract, and marks it COMPLETED", async () => {
    const contractId = await createEligibleContract(45);
    await registerPurgeJob({
      organizationId: org.id,
      entityType: "Contract",
      entityId: contractId,
      scheduledFor: new Date(),
    });

    const result = await executePurgeJobs(10, new Date());
    expect(result.purged).toBeGreaterThanOrEqual(1);

    const job = await prisma.dataPurgeJob.findUnique({
      where: { entityType_entityId: { entityType: "Contract", entityId: contractId } },
    });
    expect(job?.status).toBe("COMPLETED");

    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(contract).toBeNull();
  });

  it("marks an unsupported entityType FAILED with a generic errorCode instead of skipping it silently", async () => {
    const job = await registerPurgeJob({
      organizationId: org.id,
      entityType: "SomeFutureEntityType",
      entityId: `fake-id-${Date.now()}`,
      scheduledFor: new Date(),
    });

    const result = await executePurgeJobs(10, new Date());
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const updated = await prisma.dataPurgeJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe("FAILED");
    expect(updated?.errorCode).toBe("UNSUPPORTED_ENTITY_TYPE");
  });

  it("respects the limit parameter - never claims more than requested", async () => {
    const contractIds = await Promise.all([
      createEligibleContract(50),
      createEligibleContract(50),
      createEligibleContract(50),
    ]);
    for (const contractId of contractIds) {
      await registerPurgeJob({
        organizationId: org.id,
        entityType: "Contract",
        entityId: contractId,
        scheduledFor: new Date(),
      });
    }

    const result = await executePurgeJobs(2, new Date());
    expect(result.claimed).toBeLessThanOrEqual(2);
  });
});
