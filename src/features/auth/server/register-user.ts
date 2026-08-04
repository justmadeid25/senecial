import { randomBytes } from "node:crypto";

import { MembershipRole } from "@/generated/prisma/enums";
import { generateOrganizationSlugBase } from "@/domain/organizations/slug";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ConflictError, ValidationError } from "@/lib/errors";
import { signupSchema } from "@/lib/validation/auth";
import { passwordHasher } from "@/server/auth/password-hasher";
import { isUniqueConstraintViolation } from "@/server/db/prisma-errors";
import { prisma } from "@/server/db/client";

export interface RegisterUserResult {
  userId: string;
  organizationId: string;
  organizationSlug: string;
}

const MAX_SLUG_ATTEMPTS = 5;

function randomSlugSuffix(): string {
  return randomBytes(4).toString("hex");
}

/**
 * Registers a new user, their organization, and an OWNER membership.
 *
 * All three rows (User, Organization, Membership) plus the audit log entry
 * are created inside a single $transaction - if any step fails, everything
 * rolls back. Email uniqueness is checked up front for a fast, friendly
 * error, but the DB's unique constraint (caught below as P2002) is the
 * actual authority, since a race between the check and the insert is
 * always possible. The generated organization slug is retried on collision
 * since it includes a random suffix.
 */
export async function registerUser(input: unknown): Promise<RegisterUserResult> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    throw new ValidationError(firstIssue?.message ?? "입력값이 올바르지 않습니다.");
  }

  const { name, companyName, email, password } = parsed.data;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new ConflictError("이미 사용 중인 이메일입니다.");
  }

  const passwordHash = await passwordHasher.hash(password);
  const slugBase = generateOrganizationSlugBase(companyName);

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = `${slugBase}-${randomSlugSuffix()}`;

    try {
      return await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name,
            email,
            passwordHash,
            memberships: {
              create: {
                role: MembershipRole.OWNER,
                organization: {
                  create: { name: companyName, slug },
                },
              },
            },
          },
          include: {
            memberships: { include: { organization: true } },
          },
        });

        const membership = user.memberships[0];
        if (!membership) {
          throw new Error("Membership was not created during registration");
        }

        await tx.auditLog.create({
          data: {
            organizationId: membership.organizationId,
            userId: user.id,
            entityType: "Organization",
            entityId: membership.organizationId,
            action: AUDIT_ACTIONS.ORGANIZATION_CREATED,
            metadata: { role: MembershipRole.OWNER },
          },
        });

        return {
          userId: user.id,
          organizationId: membership.organizationId,
          organizationSlug: membership.organization.slug,
        };
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error, "email")) {
        throw new ConflictError("이미 사용 중인 이메일입니다.");
      }

      const isLastAttempt = attempt === MAX_SLUG_ATTEMPTS - 1;
      if (isUniqueConstraintViolation(error, "slug") && !isLastAttempt) {
        continue;
      }

      throw error;
    }
  }

  throw new ConflictError("가입할 수 없습니다. 입력 정보를 확인하거나 로그인을 시도해 주세요.");
}
