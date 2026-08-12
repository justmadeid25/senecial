import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import {
  addMessage,
  createConversation,
  findConversationById,
  listConversationsForUser,
  listMessagesForConversation,
} from "@/server/repositories/ai-conversation-repository";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "ai-conversation-repo-test.local";

let org: { id: string };
let otherOrg: { id: string };
let userA: { id: string };
let userB: { id: string };
let otherOrgUser: { id: string };

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  org = await prisma.organization.create({
    data: { name: "AI Conversation Repo Test Org", slug: `ai-conv-repo-test-${Date.now()}` },
  });
  otherOrg = await prisma.organization.create({
    data: { name: "AI Conversation Repo Test Other Org", slug: `ai-conv-repo-test-other-${Date.now()}` },
  });
  userA = await prisma.user.create({
    data: {
      name: "User A",
      email: `user-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.MEMBER } },
    },
  });
  userB = await prisma.user.create({
    data: {
      name: "User B",
      email: `user-b@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.MEMBER } },
    },
  });
  otherOrgUser = await prisma.user.create({
    data: {
      name: "Other Org User",
      email: `other-org-user@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: otherOrg.id, role: MembershipRole.MEMBER } },
    },
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

describe("ai-conversation-repository (Phase 12 Part D §Session, §Security Conversation 조직 격리)", () => {
  it("creates a conversation and adds a USER message with no citations", async () => {
    const conversation = await createConversation({ organizationId: org.id, userId: userA.id, title: "테스트" });
    const message = await addMessage({
      conversationId: conversation.id,
      organizationId: org.id,
      role: "USER",
      content: "질문입니다.",
    });

    expect(message.role).toBe("USER");
    expect(message.citations).toEqual([]);
  });

  it("adds an ASSISTANT message with citations atomically", async () => {
    const conversation = await createConversation({ organizationId: org.id, userId: userA.id });
    const message = await addMessage({
      conversationId: conversation.id,
      organizationId: org.id,
      role: "ASSISTANT",
      content: "답변입니다. [출처: 제1조 - 테스트 계약]",
      citations: [
        {
          contractClauseId: "clause-1",
          chunkId: null,
          contractId: "contract-1",
          contractTitle: "테스트 계약",
          clauseNumber: "제1조",
          evidenceText: "근거 문장",
          score: 0.87654,
          sourcePageStart: null,
          sourcePageEnd: null,
          chunkStartOffset: null,
          chunkEndOffset: null,
        },
      ],
    });

    expect(message.citations).toHaveLength(1);
    expect(message.citations[0]!.contractTitle).toBe("테스트 계약");
    expect(message.citations[0]!.score?.toString()).toBe("0.87654");
  });

  it("§Phase 14.1 §9 - a CHUNK citation's real provenance (chunkId, page, offsets) round-trips through persistence, never silently dropped", async () => {
    const conversation = await createConversation({ organizationId: org.id, userId: userA.id });
    const message = await addMessage({
      conversationId: conversation.id,
      organizationId: org.id,
      role: "ASSISTANT",
      content: "답변입니다. [출처: 본문 발췌 3 - 테스트 계약]",
      citations: [
        {
          contractClauseId: null,
          chunkId: "chunk-1",
          contractId: "contract-1",
          contractTitle: "테스트 계약",
          clauseNumber: "본문 발췌 3",
          evidenceText: "원문에서 발췌한 근거 문장",
          score: 0.6,
          sourcePageStart: 2,
          sourcePageEnd: 2,
          chunkStartOffset: 120,
          chunkEndOffset: 260,
        },
      ],
    });

    expect(message.citations).toHaveLength(1);
    const citation = message.citations[0]!;
    expect(citation.contractClauseId).toBeNull();
    expect(citation.chunkId).toBe("chunk-1");
    expect(citation.sourcePageStart).toBe(2);
    expect(citation.sourcePageEnd).toBe(2);
    expect(citation.chunkStartOffset).toBe(120);
    expect(citation.chunkEndOffset).toBe(260);
  });

  it("bumps the conversation's updatedAt when a message is added", async () => {
    const conversation = await createConversation({ organizationId: org.id, userId: userA.id });
    const before = conversation.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await addMessage({ conversationId: conversation.id, organizationId: org.id, role: "USER", content: "질문" });

    const refetched = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(refetched.updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it("§Conversation 조직 격리 - findConversationById never returns another user's conversation, even within the same organization", async () => {
    const conversation = await createConversation({ organizationId: org.id, userId: userA.id });

    const foundByOwner = await findConversationById({
      organizationId: org.id,
      userId: userA.id,
      conversationId: conversation.id,
    });
    expect(foundByOwner).not.toBeNull();

    const foundByOtherUser = await findConversationById({
      organizationId: org.id,
      userId: userB.id,
      conversationId: conversation.id,
    });
    expect(foundByOtherUser).toBeNull();
  });

  it("§Security Tenant Isolation - findConversationById never returns a conversation across organizations, even for the same conversationId and matching userId scoping mistake", async () => {
    const conversation = await createConversation({ organizationId: org.id, userId: userA.id });

    const foundFromOtherOrg = await findConversationById({
      organizationId: otherOrg.id,
      userId: otherOrgUser.id,
      conversationId: conversation.id,
    });
    expect(foundFromOtherOrg).toBeNull();

    // Even if an attacker guessed a real conversationId from another org
    // AND happened to also be a member there under a coincidentally-valid
    // userId, organizationId scoping alone must still block it.
    const foundWithRightOrgWrongUser = await findConversationById({
      organizationId: org.id,
      userId: otherOrgUser.id,
      conversationId: conversation.id,
    });
    expect(foundWithRightOrgWrongUser).toBeNull();
  });

  it("listMessagesForConversation returns messages in chronological order with their citations", async () => {
    const conversation = await createConversation({ organizationId: org.id, userId: userA.id });
    await addMessage({ conversationId: conversation.id, organizationId: org.id, role: "USER", content: "첫 질문" });
    await addMessage({
      conversationId: conversation.id,
      organizationId: org.id,
      role: "ASSISTANT",
      content: "첫 답변",
      citations: [
        {
          contractClauseId: null,
          chunkId: null,
          contractId: "contract-1",
          contractTitle: "계약",
          clauseNumber: null,
          evidenceText: "근거",
          score: 0.5,
          sourcePageStart: null,
          sourcePageEnd: null,
          chunkStartOffset: null,
          chunkEndOffset: null,
        },
      ],
    });

    const messages = await listMessagesForConversation({
      organizationId: org.id,
      userId: userA.id,
      conversationId: conversation.id,
    });
    expect(messages.map((m) => m.role)).toEqual(["USER", "ASSISTANT"]);
    expect(messages[1]!.citations).toHaveLength(1);
  });

  it("§Security Tenant Isolation - listMessagesForConversation never returns another organization's or another user's messages", async () => {
    const conversation = await createConversation({ organizationId: org.id, userId: userA.id });
    await addMessage({ conversationId: conversation.id, organizationId: org.id, role: "USER", content: "비밀 질문" });

    const fromOtherOrg = await listMessagesForConversation({
      organizationId: otherOrg.id,
      userId: otherOrgUser.id,
      conversationId: conversation.id,
    });
    expect(fromOtherOrg).toEqual([]);

    const fromOtherUserSameOrg = await listMessagesForConversation({
      organizationId: org.id,
      userId: userB.id,
      conversationId: conversation.id,
    });
    expect(fromOtherUserSameOrg).toEqual([]);
  });

  it("listConversationsForUser only returns that user's own conversations, ordered by most recently active", async () => {
    const conversations = await listConversationsForUser({ organizationId: org.id, userId: userB.id });
    expect(conversations.every((c) => c.userId === userB.id)).toBe(true);
  });
});
