import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { generateContractNotifications } from "@/features/notifications/server/generate-contract-notifications";
import { listNotifications } from "@/features/notifications/server/list-notifications";
import { markNotificationRead } from "@/features/notifications/server/mark-notification-read";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "notifications-test.local";

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let ownerB: { id: string };

const createdContractIds: string[] = [];

const baseContractData = {
  contractType: "SERVICE" as const,
  status: "ACTIVE" as const,
  autoRenewal: false,
};

async function createTestContract(overrides: Record<string, unknown>) {
  const contract = await prisma.contract.create({
    data: {
      organizationId: orgA.id,
      createdById: ownerA.id,
      title: `알림테스트-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...baseContractData,
      ...overrides,
    },
  });
  createdContractIds.push(contract.id);
  return contract;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Notifications Test Org A", slug: `notifications-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Notifications Test Org B", slug: `notifications-test-b-${Date.now()}` },
  });

  ownerA = await prisma.user.create({
    data: {
      name: "Owner A",
      email: `owner-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.OWNER } },
    },
  });
  ownerB = await prisma.user.create({
    data: {
      name: "Owner B",
      email: `owner-b@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgB.id, role: MembershipRole.OWNER } },
    },
  });
});

afterAll(async () => {
  await prisma.notificationReceipt.deleteMany({
    where: { notification: { organizationId: { in: [orgA.id, orgB.id] } } },
  });
  await prisma.notification.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, ownerB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("generateContractNotifications / expiration thresholds", () => {
  it.each([
    [30, "EXPIRATION_30D"],
    [14, "EXPIRATION_14D"],
    [7, "EXPIRATION_7D"],
    [1, "EXPIRATION_1D"],
    [0, "EXPIRATION_TODAY"],
  ] as const)("generates a %s-day notification (%s)", async (days, type) => {
    const contract = await createTestContract({ endDate: daysFromNow(days) });
    const now = new Date();

    await generateContractNotifications({ organizationId: orgA.id, now });

    const notification = await prisma.notification.findFirst({
      where: { contractId: contract.id, type },
    });
    expect(notification).not.toBeNull();
  });
});

describe("generateContractNotifications / exclusions", () => {
  it.each(["DRAFT", "TERMINATED", "ARCHIVED"] as const)(
    "excludes %s contracts even on a threshold day",
    async (status) => {
      const contract = await createTestContract({ status, endDate: daysFromNow(7) });
      await generateContractNotifications({ organizationId: orgA.id, now: new Date() });

      const notification = await prisma.notification.findFirst({
        where: { contractId: contract.id },
      });
      expect(notification).toBeNull();
    }
  );

  it("excludes a soft-deleted contract", async () => {
    const contract = await createTestContract({ endDate: daysFromNow(7), deletedAt: new Date() });
    await generateContractNotifications({ organizationId: orgA.id, now: new Date() });

    const notification = await prisma.notification.findFirst({
      where: { contractId: contract.id },
    });
    expect(notification).toBeNull();
  });
});

describe("generateContractNotifications / renewal notice", () => {
  it("generates RENEWAL_NOTICE_DUE when today matches the notice-period boundary", async () => {
    const contract = await createTestContract({
      endDate: daysFromNow(15),
      autoRenewal: true,
      noticePeriodDays: 15,
    });
    await generateContractNotifications({ organizationId: orgA.id, now: new Date() });

    const notification = await prisma.notification.findFirst({
      where: { contractId: contract.id, type: "RENEWAL_NOTICE_DUE" },
    });
    expect(notification).not.toBeNull();
  });
});

describe("generateContractNotifications / dedup and isolation", () => {
  it("does not create a duplicate notification when run twice for the same day", async () => {
    const contract = await createTestContract({ endDate: daysFromNow(7) });
    const now = new Date();

    await generateContractNotifications({ organizationId: orgA.id, now });
    await generateContractNotifications({ organizationId: orgA.id, now });

    const notifications = await prisma.notification.findMany({
      where: { contractId: contract.id, type: "EXPIRATION_7D" },
    });
    expect(notifications).toHaveLength(1);
  });

  it("does not create notifications for another organization's contracts", async () => {
    const contract = await prisma.contract.create({
      data: {
        organizationId: orgB.id,
        createdById: ownerB.id,
        title: `orgB-알림테스트-${Date.now()}`,
        ...baseContractData,
        endDate: daysFromNow(7),
      },
    });
    createdContractIds.push(contract.id);

    await generateContractNotifications({ organizationId: orgA.id, now: new Date() });

    const notification = await prisma.notification.findFirst({
      where: { contractId: contract.id },
    });
    expect(notification).toBeNull();
  });
});

describe("listNotifications / per-user read state", () => {
  it("shows a notification as unread until this specific user marks it read", async () => {
    const contract = await createTestContract({ endDate: daysFromNow(14) });
    await generateContractNotifications({ organizationId: orgA.id, now: new Date() });

    const notificationRow = await prisma.notification.findFirstOrThrow({
      where: { contractId: contract.id, type: "EXPIRATION_14D" },
    });

    const before = await listNotifications({ userId: ownerA.id, organizationId: orgA.id });
    const beforeItem = before.items.find((n) => n.id === notificationRow.id);
    expect(beforeItem?.isRead).toBe(false);

    await markNotificationRead({
      userId: ownerA.id,
      organizationId: orgA.id,
      notificationId: notificationRow.id,
    });

    const after = await listNotifications({ userId: ownerA.id, organizationId: orgA.id });
    const afterItem = after.items.find((n) => n.id === notificationRow.id);
    expect(afterItem?.isRead).toBe(true);
  });
});
