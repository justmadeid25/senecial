import type { FeedbackCategory } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

export interface CreateFeedbackData {
  organizationId: string;
  userId: string;
  category: FeedbackCategory;
  message: string;
  routeContext: string | null;
  contractId: string | null;
}

/** Write-only from the application's perspective (§Part 7) - no findBy/list export exists here on purpose; nothing in this codebase currently reads Feedback back out. */
export async function createFeedback(data: CreateFeedbackData): Promise<{ id: string }> {
  const created = await prisma.feedback.create({ data, select: { id: true } });
  return created;
}
