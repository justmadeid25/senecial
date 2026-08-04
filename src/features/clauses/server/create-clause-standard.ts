import { MembershipRole } from "@/generated/prisma/enums";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ValidationError } from "@/lib/errors";
import { clauseStandardSchema } from "@/lib/validation/clauses";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import { createClauseStandard as createClauseStandardRow } from "@/server/repositories/clause-standard-repository";
import { prisma } from "@/server/db/client";
import type { ClauseStandardRow } from "@/server/repositories/clause-standard-repository";

export interface CreateClauseStandardParams {
  userId: string;
  organizationId: string;
  input: unknown;
}

/** OWNER only (§21 - MVP policy: MEMBER can read/compare but not manage standards). */
export async function createClauseStandard(
  params: CreateClauseStandardParams
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
    const standard = await createClauseStandardRow(
      {
        organizationId: authContext.organizationId,
        name: parsed.data.name,
        clauseType: parsed.data.clauseType,
        title: parsed.data.title ?? null,
        text: parsed.data.text,
        normalizedText: normalizeClauseText(parsed.data.text),
        description: parsed.data.description ?? null,
        isActive: parsed.data.isActive,
        createdById: authContext.userId,
      },
      tx
    );

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "ClauseStandard",
        entityId: standard.id,
        action: AUDIT_ACTIONS.CLAUSE_STANDARD_CREATED,
        metadata: { standardId: standard.id, clauseType: standard.clauseType },
      },
    });

    return standard;
  });
}
