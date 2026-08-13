import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { createFeedbackSchema } from "@/lib/validation/feedback";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findContractById } from "@/server/repositories/contract-repository";
import { createFeedback as createFeedbackRow } from "@/server/repositories/feedback-repository";
import { prisma } from "@/server/db/client";

export interface CreateFeedbackParams {
  userId: string;
  organizationId: string;
  input: unknown;
}

export interface CreatedFeedback {
  id: string;
}

/**
 * §Phase 15.1 Part 6/7 - OWNER and MEMBER can both submit feedback, only
 * membership is required. organizationId/userId always come from the
 * verified session (verifyOrganizationMembership), never from client
 * input - the client sends only category/message/routeContext/contractId.
 *
 * If a contractId is supplied, it is re-verified against THIS caller's own
 * organization before being stored - a client cannot attach another
 * organization's contract id to their own feedback row (§Part 7). An
 * invalid/foreign contractId is rejected outright rather than silently
 * dropped, so the failure is visible during testing rather than a silent
 * data-quality gap.
 *
 * Deliberately never touches contract text, extracted text, clause
 * content, AI prompts/answers, or citation evidence - only the free-text
 * `message` the user typed into the feedback form themselves (§Part 6).
 */
export async function createFeedback(params: CreateFeedbackParams): Promise<CreatedFeedback> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const parsed = createFeedbackSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.");
  }
  const data = parsed.data;

  if (data.contractId) {
    const contract = await findContractById({
      organizationId: authContext.organizationId,
      contractId: data.contractId,
    });
    if (!contract) {
      throw new NotFoundError();
    }
  }

  const created = await createFeedbackRow({
    organizationId: authContext.organizationId,
    userId: authContext.userId,
    category: data.category,
    message: data.message,
    routeContext: data.routeContext ?? null,
    contractId: data.contractId ?? null,
  });

  // Metadata never includes `message` (the free-text content itself) -
  // only the category and entity id, matching every other AuditLog write
  // in this codebase's "never log user-entered content" discipline (§31).
  await prisma.auditLog.create({
    data: {
      organizationId: authContext.organizationId,
      userId: authContext.userId,
      entityType: "Feedback",
      entityId: created.id,
      action: AUDIT_ACTIONS.FEEDBACK_SUBMITTED,
      metadata: { feedbackId: created.id, category: data.category },
    },
  });

  return created;
}
