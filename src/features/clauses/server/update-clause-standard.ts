import { MembershipRole } from "@/generated/prisma/enums";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { clauseStandardSchema } from "@/lib/validation/clauses";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import {
  updateClauseStandard as updateClauseStandardRow,
  type ClauseStandardRow,
} from "@/server/repositories/clause-standard-repository";
import { prisma } from "@/server/db/client";

export interface UpdateClauseStandardParams {
  userId: string;
  organizationId: string;
  standardId: string;
  input: unknown;
}

/** OWNER only (§21). */
export async function updateClauseStandard(
  params: UpdateClauseStandardParams
): Promise<ClauseStandardRow> {
  const authContext = await verifyOrganizationRole(
    params.userId,
    params.organizationId,
    MembershipRole.OWNER
  );

  const parsed = clauseStandardSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await updateClauseStandardRow(
      {
        organizationId: authContext.organizationId,
        standardId: params.standardId,
        data: {
          name: parsed.data.name,
          clauseType: parsed.data.clauseType,
          title: parsed.data.title ?? null,
          text: parsed.data.text,
          normalizedText: normalizeClauseText(parsed.data.text),
          description: parsed.data.description ?? null,
          isActive: parsed.data.isActive,
        },
      },
      tx
    );
    if (!updated) {
      throw new NotFoundError();
    }

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "ClauseStandard",
        entityId: updated.id,
        action: AUDIT_ACTIONS.CLAUSE_STANDARD_UPDATED,
        metadata: { standardId: updated.id, clauseType: updated.clauseType },
      },
    });

    return updated;
  });
}
