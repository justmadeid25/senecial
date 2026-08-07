import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { ConversationRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ConversationRow = Prisma.ConversationGetPayload<Record<string, never>>;
export type MessageRow = Prisma.MessageGetPayload<Record<string, never>>;
export type MessageWithCitations = Prisma.MessageGetPayload<{ include: { citations: true } }>;

export async function createConversation(
  data: { organizationId: string; userId: string; title?: string },
  client: DbClient = prisma
): Promise<ConversationRow> {
  return client.conversation.create({ data });
}

/** Scoped to BOTH organizationId AND userId - §Security "Conversation 조직 격리": one user never sees another user's conversation, even within the same organization. */
export async function findConversationById(
  params: { organizationId: string; userId: string; conversationId: string },
  client: DbClient = prisma
): Promise<ConversationRow | null> {
  return client.conversation.findFirst({
    where: { id: params.conversationId, organizationId: params.organizationId, userId: params.userId },
  });
}

export async function listConversationsForUser(
  params: { organizationId: string; userId: string },
  client: DbClient = prisma
): Promise<ConversationRow[]> {
  return client.conversation.findMany({
    where: { organizationId: params.organizationId, userId: params.userId },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listMessagesForConversation(
  conversationId: string,
  client: DbClient = prisma
): Promise<MessageWithCitations[]> {
  return client.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    include: { citations: true },
  });
}

export interface AddMessageCitationData {
  contractClauseId: string | null;
  contractId: string;
  contractTitle: string;
  clauseNumber: string | null;
  evidenceText: string;
  score: number;
}

/** §Phase 12.2 Part C (§22) - only ever set for ASSISTANT messages; see Message model's own doc comment in schema.prisma. */
export interface AddMessageProvenanceData {
  aiConfigVersion: string;
  aiConfigChecksum: string;
  embeddingVersion: string;
  vectorSearchProvider: string;
  promptTemplateVersion: string;
  citationValidatorVersion: string;
  /** §Phase 13.1 Part 11 - undefined when no completion was actually generated (guard short-circuit) - see AskQuestionStreamEvent's "done" variant. */
  canaryUsed?: boolean;
}

export interface AddMessageData {
  conversationId: string;
  organizationId: string;
  role: ConversationRole;
  content: string;
  citations?: AddMessageCitationData[];
  provenance?: AddMessageProvenanceData;
}

/** Creates the Message and its MessageCitation rows atomically, and bumps the parent Conversation's updatedAt (for the conversation list's "most recently active" ordering) - all in one transaction. */
export async function addMessage(data: AddMessageData): Promise<MessageWithCitations> {
  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        conversationId: data.conversationId,
        organizationId: data.organizationId,
        role: data.role,
        content: data.content,
        aiConfigVersion: data.provenance?.aiConfigVersion,
        aiConfigChecksum: data.provenance?.aiConfigChecksum,
        embeddingVersion: data.provenance?.embeddingVersion,
        vectorSearchProvider: data.provenance?.vectorSearchProvider,
        promptTemplateVersion: data.provenance?.promptTemplateVersion,
        citationValidatorVersion: data.provenance?.citationValidatorVersion,
        canaryUsed: data.provenance?.canaryUsed,
        citations: data.citations?.length
          ? {
              create: data.citations.map((citation) => ({
                contractClauseId: citation.contractClauseId,
                contractId: citation.contractId,
                contractTitle: citation.contractTitle,
                clauseNumber: citation.clauseNumber,
                evidenceText: citation.evidenceText,
                score: new Prisma.Decimal(citation.score.toFixed(5)),
              })),
            }
          : undefined,
      },
      include: { citations: true },
    });

    await tx.conversation.update({ where: { id: data.conversationId }, data: { updatedAt: new Date() } });

    return message;
  });
}

export { ConversationRole };
