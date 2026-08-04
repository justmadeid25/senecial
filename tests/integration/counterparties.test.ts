import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createCounterparty } from "@/features/counterparties/server/create-counterparty";
import { deleteCounterparty } from "@/features/counterparties/server/delete-counterparty";
import { getCounterparty } from "@/features/counterparties/server/get-counterparty";
import { listCounterparties } from "@/features/counterparties/server/list-counterparties";
import { updateCounterparty } from "@/features/counterparties/server/update-counterparty";
import { createContract } from "@/features/contracts/server/create-contract";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "counterparties-test.local";

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let memberA: { id: string };
let ownerB: { id: string };

const createdCounterpartyIds: string[] = [];
const createdContractIds: string[] = [];

async function cleanup() {
  if (createdContractIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdContractIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  }
  if (createdCounterpartyIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdCounterpartyIds } } });
    await prisma.counterparty.deleteMany({ where: { id: { in: createdCounterpartyIds } } });
  }
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Counterparties Test Org A", slug: `counterparties-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Counterparties Test Org B", slug: `counterparties-test-b-${Date.now()}` },
  });

  ownerA = await prisma.user.create({
    data: {
      name: "Owner A",
      email: `owner-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.OWNER } },
    },
  });
  memberA = await prisma.user.create({
    data: {
      name: "Member A",
      email: `member-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.MEMBER } },
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
  await cleanup();
  await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, memberA.id, ownerB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("createCounterparty", () => {
  it("allows OWNER to create a counterparty", async () => {
    const result = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "OWNER 생성 상대방" },
    });
    createdCounterpartyIds.push(result.id);
    expect(result.name).toBe("OWNER 생성 상대방");
  });

  it("allows MEMBER to create a counterparty", async () => {
    const result = await createCounterparty({
      userId: memberA.id,
      organizationId: orgA.id,
      input: { name: "MEMBER 생성 상대방" },
    });
    createdCounterpartyIds.push(result.id);
    expect(result.name).toBe("MEMBER 생성 상대방");
  });

  it("records a COUNTERPARTY_CREATED audit log entry", async () => {
    const result = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "감사 로그 생성 상대방" },
    });
    createdCounterpartyIds.push(result.id);

    const log = await prisma.auditLog.findFirst({
      where: { entityId: result.id, action: "COUNTERPARTY_CREATED" },
    });
    expect(log).not.toBeNull();
    expect(log?.organizationId).toBe(orgA.id);
  });
});

describe("getCounterparty / organization isolation", () => {
  it("org B cannot view org A's counterparty - NotFoundError, not Forbidden", async () => {
    const created = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "격리 테스트 상대방" },
    });
    createdCounterpartyIds.push(created.id);

    await expect(
      getCounterparty({ userId: ownerB.id, organizationId: orgB.id, counterpartyId: created.id })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("updateCounterparty", () => {
  it("allows MEMBER to update a counterparty", async () => {
    const created = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "수정 전" },
    });
    createdCounterpartyIds.push(created.id);

    const updated = await updateCounterparty({
      userId: memberA.id,
      organizationId: orgA.id,
      counterpartyId: created.id,
      input: { name: "수정 후 (MEMBER)" },
    });
    expect(updated.name).toBe("수정 후 (MEMBER)");
  });

  it("records a COUNTERPARTY_UPDATED audit log with only changed field names, never contact values", async () => {
    const created = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "감사 로그 수정 상대방", contactPhone: "02-0000-0000" },
    });
    createdCounterpartyIds.push(created.id);

    await updateCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      counterpartyId: created.id,
      input: { name: "감사 로그 수정 상대방", contactPhone: "02-9999-9999" },
    });

    const log = await prisma.auditLog.findFirst({
      where: { entityId: created.id, action: "COUNTERPARTY_UPDATED" },
    });
    expect(log).not.toBeNull();
    const metadata = log?.metadata as { changedFields?: string[] } | null;
    expect(metadata?.changedFields).toEqual(["contactPhone"]);
    expect(JSON.stringify(metadata)).not.toContain("02-9999-9999");
    expect(JSON.stringify(metadata)).not.toContain("02-0000-0000");
  });

  it("org B cannot update org A's counterparty", async () => {
    const created = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "위조 수정 시도 대상" },
    });
    createdCounterpartyIds.push(created.id);

    await expect(
      updateCounterparty({
        userId: ownerB.id,
        organizationId: orgB.id,
        counterpartyId: created.id,
        input: { name: "위조된 수정" },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deleteCounterparty", () => {
  it("allows OWNER to soft-delete a counterparty with no linked contracts", async () => {
    const created = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "OWNER 삭제 대상" },
    });
    createdCounterpartyIds.push(created.id);

    await deleteCounterparty({ userId: ownerA.id, organizationId: orgA.id, counterpartyId: created.id });

    const row = await prisma.counterparty.findUnique({ where: { id: created.id } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("blocks MEMBER from deleting a counterparty", async () => {
    const created = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "MEMBER 삭제 차단 대상" },
    });
    createdCounterpartyIds.push(created.id);

    await expect(
      deleteCounterparty({ userId: memberA.id, organizationId: orgA.id, counterpartyId: created.id })
    ).rejects.toBeInstanceOf(ForbiddenError);

    const row = await prisma.counterparty.findUnique({ where: { id: created.id } });
    expect(row?.deletedAt).toBeNull();
  });

  it("org B cannot delete org A's counterparty", async () => {
    const created = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "위조 삭제 시도 대상" },
    });
    createdCounterpartyIds.push(created.id);

    await expect(
      deleteCounterparty({ userId: ownerB.id, organizationId: orgB.id, counterpartyId: created.id })
    ).rejects.toBeInstanceOf(NotFoundError);

    const row = await prisma.counterparty.findUnique({ where: { id: created.id } });
    expect(row?.deletedAt).toBeNull();
  });

  it("blocks deletion with ConflictError when a live contract still references this counterparty", async () => {
    const created = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "연결된 계약이 있는 상대방" },
    });
    createdCounterpartyIds.push(created.id);

    const contract = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: {
        title: "연결 계약",
        contractType: "SERVICE",
        status: "ACTIVE",
        autoRenewal: false,
        currency: "KRW",
        counterpartyId: created.id,
      },
    });
    createdContractIds.push(contract.id);

    await expect(
      deleteCounterparty({ userId: ownerA.id, organizationId: orgA.id, counterpartyId: created.id })
    ).rejects.toBeInstanceOf(ConflictError);

    const row = await prisma.counterparty.findUnique({ where: { id: created.id } });
    expect(row?.deletedAt).toBeNull();
  });

  it("records a COUNTERPARTY_DELETED audit log entry", async () => {
    const created = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "감사 로그 삭제 상대방" },
    });
    createdCounterpartyIds.push(created.id);

    await deleteCounterparty({ userId: ownerA.id, organizationId: orgA.id, counterpartyId: created.id });

    const log = await prisma.auditLog.findFirst({
      where: { entityId: created.id, action: "COUNTERPARTY_DELETED" },
    });
    expect(log).not.toBeNull();
  });

  it("treats an already-deleted counterparty as NotFound, not a silent no-op success", async () => {
    const created = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "이중 삭제 대상" },
    });
    createdCounterpartyIds.push(created.id);

    await deleteCounterparty({ userId: ownerA.id, organizationId: orgA.id, counterpartyId: created.id });

    await expect(
      deleteCounterparty({ userId: ownerA.id, organizationId: orgA.id, counterpartyId: created.id })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("excludes a deleted counterparty from the list", async () => {
    const created = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "목록 제외 확인용 상대방" },
    });
    createdCounterpartyIds.push(created.id);

    await deleteCounterparty({ userId: ownerA.id, organizationId: orgA.id, counterpartyId: created.id });

    const result = await listCounterparties({
      userId: ownerA.id,
      organizationId: orgA.id,
      query: { q: "목록 제외 확인용 상대방" },
    });
    expect(result.items.find((item) => item.id === created.id)).toBeUndefined();
  });
});

describe("listCounterparties / search", () => {
  it("finds a counterparty by name search", async () => {
    const created = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "고유검색어상대방" },
    });
    createdCounterpartyIds.push(created.id);

    const result = await listCounterparties({
      userId: ownerA.id,
      organizationId: orgA.id,
      query: { q: "고유검색어" },
    });
    expect(result.items.map((item) => item.id)).toContain(created.id);
  });

  it("does not leak org B's counterparties into org A's list", async () => {
    const created = await createCounterparty({
      userId: ownerB.id,
      organizationId: orgB.id,
      input: { name: "OrgB전용상대방검증" },
    });
    createdCounterpartyIds.push(created.id);

    const result = await listCounterparties({
      userId: ownerA.id,
      organizationId: orgA.id,
      query: { q: "OrgB전용상대방검증" },
    });
    expect(result.items.find((item) => item.id === created.id)).toBeUndefined();
  });
});
