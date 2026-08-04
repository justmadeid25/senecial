import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { deleteContract } from "@/features/contracts/server/delete-contract";
import { getContract } from "@/features/contracts/server/get-contract";
import { listContracts } from "@/features/contracts/server/list-contracts";
import { updateContract } from "@/features/contracts/server/update-contract";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "contracts-test.local";

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let memberA: { id: string };
let ownerB: { id: string };
let counterpartyA: { id: string; name: string };
let counterpartyB: { id: string };

const createdContractIds: string[] = [];

async function cleanupContracts() {
  if (createdContractIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdContractIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  }
}

beforeAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
  });

  orgA = await prisma.organization.create({
    data: { name: "Contracts Test Org A", slug: `contracts-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Contracts Test Org B", slug: `contracts-test-b-${Date.now()}` },
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

  counterpartyA = await prisma.counterparty.create({
    data: { organizationId: orgA.id, name: "카운터파티 A" },
  });
  counterpartyB = await prisma.counterparty.create({
    data: { organizationId: orgB.id, name: "카운터파티 B" },
  });
});

afterAll(async () => {
  await cleanupContracts();
  await prisma.counterparty.deleteMany({ where: { id: { in: [counterpartyA.id, counterpartyB.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, memberA.id, ownerB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

const baseInput = {
  contractType: "SERVICE",
  status: "ACTIVE",
  autoRenewal: false,
  currency: "KRW",
};

describe("createContract", () => {
  it("allows OWNER to create a contract", async () => {
    const result = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "OWNER 생성 계약" },
    });
    createdContractIds.push(result.id);
    expect(result.title).toBe("OWNER 생성 계약");
  });

  it("allows MEMBER to create a contract", async () => {
    const result = await createContract({
      userId: memberA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "MEMBER 생성 계약" },
    });
    createdContractIds.push(result.id);
    expect(result.title).toBe("MEMBER 생성 계약");
  });

  it("records a CONTRACT_CREATED audit log entry", async () => {
    const result = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "감사 로그 생성 계약" },
    });
    createdContractIds.push(result.id);

    const log = await prisma.auditLog.findFirst({
      where: { entityId: result.id, action: "CONTRACT_CREATED" },
    });
    expect(log).not.toBeNull();
    expect(log?.organizationId).toBe(orgA.id);
    expect((log?.metadata as { title?: string } | null)?.title).toBe("감사 로그 생성 계약");
  });

  it("rejects a counterpartyId belonging to another organization", async () => {
    await expect(
      createContract({
        userId: ownerA.id,
        organizationId: orgA.id,
        input: { ...baseInput, title: "잘못된 상대방", counterpartyId: counterpartyB.id },
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts a counterpartyId belonging to the same organization", async () => {
    const result = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "올바른 상대방", counterpartyId: counterpartyA.id },
    });
    createdContractIds.push(result.id);
    expect(result.counterparty?.id).toBe(counterpartyA.id);
  });
});

describe("getContract / organization isolation", () => {
  it("org B cannot view org A's contract - NotFoundError, not Forbidden", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "격리 테스트 계약" },
    });
    createdContractIds.push(created.id);

    await expect(
      getContract({ userId: ownerB.id, organizationId: orgB.id, contractId: created.id })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("updateContract", () => {
  it("allows OWNER to update a contract", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "수정 전" },
    });
    createdContractIds.push(created.id);

    const updated = await updateContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: created.id,
      input: { ...baseInput, title: "수정 후 (OWNER)" },
    });
    expect(updated.title).toBe("수정 후 (OWNER)");
  });

  it("allows MEMBER to update a contract", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "수정 전 2" },
    });
    createdContractIds.push(created.id);

    const updated = await updateContract({
      userId: memberA.id,
      organizationId: orgA.id,
      contractId: created.id,
      input: { ...baseInput, title: "수정 후 (MEMBER)" },
    });
    expect(updated.title).toBe("수정 후 (MEMBER)");
  });

  it("records a CONTRACT_UPDATED audit log with only changed field names", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "감사 로그 수정 계약", amount: "1000" },
    });
    createdContractIds.push(created.id);

    await updateContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: created.id,
      input: { ...baseInput, title: "감사 로그 수정 계약 (변경됨)", amount: "1000" },
    });

    const log = await prisma.auditLog.findFirst({
      where: { entityId: created.id, action: "CONTRACT_UPDATED" },
    });
    expect(log).not.toBeNull();
    const metadata = log?.metadata as { changedFields?: string[] } | null;
    expect(metadata?.changedFields).toEqual(["title"]);
  });

  it("org B cannot update org A's contract", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "위조 수정 시도 대상" },
    });
    createdContractIds.push(created.id);

    await expect(
      updateContract({
        userId: ownerB.id,
        organizationId: orgB.id,
        contractId: created.id,
        input: { ...baseInput, title: "위조된 수정" },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deleteContract", () => {
  it("allows OWNER to soft-delete a contract", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "OWNER 삭제 대상" },
    });
    createdContractIds.push(created.id);

    await deleteContract({ userId: ownerA.id, organizationId: orgA.id, contractId: created.id });

    const row = await prisma.contract.findUnique({ where: { id: created.id } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("blocks MEMBER from deleting a contract", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "MEMBER 삭제 차단 대상" },
    });
    createdContractIds.push(created.id);

    await expect(
      deleteContract({ userId: memberA.id, organizationId: orgA.id, contractId: created.id })
    ).rejects.toBeInstanceOf(ForbiddenError);

    const row = await prisma.contract.findUnique({ where: { id: created.id } });
    expect(row?.deletedAt).toBeNull();
  });

  it("org B cannot delete org A's contract", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "위조 삭제 시도 대상" },
    });
    createdContractIds.push(created.id);

    await expect(
      deleteContract({ userId: ownerB.id, organizationId: orgB.id, contractId: created.id })
    ).rejects.toBeInstanceOf(NotFoundError);

    const row = await prisma.contract.findUnique({ where: { id: created.id } });
    expect(row?.deletedAt).toBeNull();
  });

  it("records a CONTRACT_DELETED audit log entry", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "감사 로그 삭제 계약" },
    });
    createdContractIds.push(created.id);

    await deleteContract({ userId: ownerA.id, organizationId: orgA.id, contractId: created.id });

    const log = await prisma.auditLog.findFirst({
      where: { entityId: created.id, action: "CONTRACT_DELETED" },
    });
    expect(log).not.toBeNull();
  });

  it("treats an already-deleted contract as NotFound, not a silent no-op success", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "이중 삭제 대상" },
    });
    createdContractIds.push(created.id);

    await deleteContract({ userId: ownerA.id, organizationId: orgA.id, contractId: created.id });

    await expect(
      deleteContract({ userId: ownerA.id, organizationId: orgA.id, contractId: created.id })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("excludes a deleted contract from the list", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "목록 제외 확인용 계약" },
    });
    createdContractIds.push(created.id);

    await deleteContract({ userId: ownerA.id, organizationId: orgA.id, contractId: created.id });

    const result = await listContracts({
      userId: ownerA.id,
      organizationId: orgA.id,
      query: { q: "목록 제외 확인용 계약" },
    });
    expect(result.items.find((item) => item.id === created.id)).toBeUndefined();
  });

  it("returns NotFound when fetching a deleted contract's detail", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "삭제 후 상세 접근 확인용" },
    });
    createdContractIds.push(created.id);

    await deleteContract({ userId: ownerA.id, organizationId: orgA.id, contractId: created.id });

    await expect(
      getContract({ userId: ownerA.id, organizationId: orgA.id, contractId: created.id })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("listContracts / search & filters", () => {
  it("finds a contract by title search", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "고유검색어제목계약" },
    });
    createdContractIds.push(created.id);

    const result = await listContracts({
      userId: ownerA.id,
      organizationId: orgA.id,
      query: { q: "고유검색어제목" },
    });
    expect(result.items.map((item) => item.id)).toContain(created.id);
  });

  it("finds a contract by counterparty name search", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "상대방검색용계약", counterpartyId: counterpartyA.id },
    });
    createdContractIds.push(created.id);

    const result = await listContracts({
      userId: ownerA.id,
      organizationId: orgA.id,
      query: { q: counterpartyA.name },
    });
    expect(result.items.map((item) => item.id)).toContain(created.id);
  });

  it("filters by displayStatus", async () => {
    const draft = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { ...baseInput, title: "상태필터DRAFT계약", status: "DRAFT" },
    });
    createdContractIds.push(draft.id);

    const result = await listContracts({
      userId: ownerA.id,
      organizationId: orgA.id,
      query: { q: "상태필터DRAFT계약", displayStatus: "DRAFT" },
    });
    expect(result.items.map((item) => item.id)).toContain(draft.id);
    expect(result.items.every((item) => item.displayStatus === "DRAFT")).toBe(true);
  });

  it("sorts by endDate ascending", async () => {
    const soon = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: {
        ...baseInput,
        title: "정렬테스트빠른만료",
        endDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString(),
      },
    });
    const later = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: {
        ...baseInput,
        title: "정렬테스트늦은만료",
        endDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 50).toISOString(),
      },
    });
    createdContractIds.push(soon.id, later.id);

    const result = await listContracts({
      userId: ownerA.id,
      organizationId: orgA.id,
      query: { q: "정렬테스트", sortBy: "endDate", sortOrder: "asc" },
    });
    const ids = result.items.map((item) => item.id);
    expect(ids.indexOf(soon.id)).toBeLessThan(ids.indexOf(later.id));
  });

  it("computes EXPIRING for a contract ending within 30 days", async () => {
    const expiring = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: {
        ...baseInput,
        title: "만료임박계산테스트",
        endDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 10).toISOString(),
      },
    });
    createdContractIds.push(expiring.id);

    const result = await listContracts({
      userId: ownerA.id,
      organizationId: orgA.id,
      query: { q: "만료임박계산테스트" },
    });
    const item = result.items.find((i) => i.id === expiring.id);
    expect(item?.displayStatus).toBe("EXPIRING");
    expect(item?.storedStatus).toBe("ACTIVE");
  });
});
