import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createFeedback } from "@/features/feedback/server/create-feedback";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/server/db/client";

/**
 * §Phase 15.1 Part 7 - "Attack the feedback endpoint/action." Organization
 * A must never be able to: read Organization B's feedback, submit
 * feedback attributed to B, attach B's contractId, modify B's feedback,
 * or enumerate B's feedback ids.
 *
 * No modify/enumerate test exists for the last two: create-feedback.ts's
 * only public surface is createFeedback() (write-only by construction, see
 * feedback-repository.ts's docstring) - there is no update/list/findById
 * function anywhere in this codebase for a test to call, so "cannot
 * modify"/"cannot enumerate" hold by the absence of any such code path,
 * not by a runtime check this test could exercise.
 */
const TEST_EMAIL_DOMAIN = "feedback-tenant-isolation-test.local";

let orgA: { id: string };
let orgB: { id: string };
let memberA: { id: string };
let memberB: { id: string };
let contractA: { id: string };
let contractB: { id: string };

const createdFeedbackIds: string[] = [];

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Feedback Isolation Org A", slug: `feedback-isolation-org-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Feedback Isolation Org B", slug: `feedback-isolation-org-b-${Date.now()}` },
  });

  memberA = await prisma.user.create({
    data: {
      name: "Member A",
      email: `member-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.MEMBER } },
    },
  });
  memberB = await prisma.user.create({
    data: {
      name: "Member B",
      email: `member-b@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgB.id, role: MembershipRole.MEMBER } },
    },
  });

  contractA = await prisma.contract.create({
    data: {
      organizationId: orgA.id,
      createdById: memberA.id,
      title: "Org A 계약",
      contractType: "SERVICE",
      status: "ACTIVE",
      autoRenewal: false,
      currency: "KRW",
    },
  });
  contractB = await prisma.contract.create({
    data: {
      organizationId: orgB.id,
      createdById: memberB.id,
      title: "Org B 계약",
      contractType: "SERVICE",
      status: "ACTIVE",
      autoRenewal: false,
      currency: "KRW",
    },
  });
});

afterAll(async () => {
  if (createdFeedbackIds.length > 0) {
    await prisma.feedback.deleteMany({ where: { id: { in: createdFeedbackIds } } });
  }
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contract.deleteMany({ where: { id: { in: [contractA.id, contractB.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [memberA.id, memberB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("createFeedback tenant isolation (§Phase 15.1 Part 7)", () => {
  it("stores feedback scoped to the caller's own organization", async () => {
    const result = await createFeedback({
      userId: memberA.id,
      organizationId: orgA.id,
      input: { category: "CONFUSING_UX", message: "업로드 버튼을 찾기 어려웠어요." },
    });
    createdFeedbackIds.push(result.id);

    const row = await prisma.feedback.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.organizationId).toBe(orgA.id);
    expect(row.userId).toBe(memberA.id);
  });

  it("rejects a user submitting feedback into an organization they are not a member of (cannot submit feedback attributed to another org)", async () => {
    await expect(
      createFeedback({
        userId: memberA.id,
        organizationId: orgB.id,
        input: { category: "OTHER", message: "spoofed org attempt" },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows attaching a contractId that belongs to the caller's own organization", async () => {
    const result = await createFeedback({
      userId: memberA.id,
      organizationId: orgA.id,
      input: { category: "ERROR_ENCOUNTERED", message: "추출이 실패했어요.", contractId: contractA.id },
    });
    createdFeedbackIds.push(result.id);

    const row = await prisma.feedback.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.contractId).toBe(contractA.id);
  });

  it("rejects attaching another organization's contractId (cannot attach B's contractId)", async () => {
    await expect(
      createFeedback({
        userId: memberA.id,
        organizationId: orgA.id,
        input: { category: "ERROR_ENCOUNTERED", message: "cross-org contractId attempt", contractId: contractB.id },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a org-scoped query never returns another organization's feedback (cannot read B's feedback)", async () => {
    const forB = await createFeedback({
      userId: memberB.id,
      organizationId: orgB.id,
      input: { category: "AI_ANSWER_SEEMS_WRONG", message: "답변이 이상해요." },
    });
    createdFeedbackIds.push(forB.id);

    const rowsVisibleToOrgA = await prisma.feedback.findMany({ where: { organizationId: orgA.id } });
    expect(rowsVisibleToOrgA.some((row) => row.id === forB.id)).toBe(false);

    const rowsVisibleToOrgB = await prisma.feedback.findMany({ where: { organizationId: orgB.id } });
    expect(rowsVisibleToOrgB.some((row) => row.id === forB.id)).toBe(true);
  });

  it("never stores contract content, prompts, or AI answers - only the free-text the user typed", async () => {
    const message = "이건 그냥 짧은 메시지입니다.";
    const result = await createFeedback({
      userId: memberA.id,
      organizationId: orgA.id,
      input: { category: "CITATION_SEEMS_WRONG", message, routeContext: "/ai" },
    });
    createdFeedbackIds.push(result.id);

    const row = await prisma.feedback.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.message).toBe(message);
    expect(Object.keys(row)).not.toContain("contractText");
    expect(Object.keys(row)).not.toContain("evidenceText");
    expect(Object.keys(row)).not.toContain("prompt");
  });
});
