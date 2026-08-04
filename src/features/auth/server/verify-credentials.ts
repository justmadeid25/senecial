import type { MembershipRole } from "@/generated/prisma/enums";
import { loginSchema } from "@/lib/validation/auth";
import { passwordHasher } from "@/server/auth/password-hasher";
import { prisma } from "@/server/db/client";

/**
 * Fixed argon2id hash of an unrelated dummy password. When no user matches
 * the submitted email, we still run a verify() against this so a failed
 * login due to "no such user" and a failed login due to "wrong password"
 * take roughly the same amount of time - reduces (does not fully
 * eliminate) timing-based account enumeration.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$4D83pYq9Aevy2Mw5m5xpjQ$GTa+g8gb6LRfsYT5MVxGk31aVGvLTJ065E6JuEBHqBY";

export interface VerifiedCredentials {
  userId: string;
  name: string;
  email: string;
  organizationId: string;
  role: MembershipRole;
  sessionVersion: number;
}

/**
 * Core credential-verification logic used by Auth.js's Credentials
 * provider (see src/auth.ts). Kept separate from src/auth.ts so it can be
 * unit/integration tested directly without spinning up the Auth.js HTTP
 * request/session flow.
 *
 * Default organization rule: the oldest membership (the organization the
 * user joined/created first) is used as the session's active organization.
 * A user with no membership at all cannot log in.
 */
export async function verifyCredentials(
  input: unknown
): Promise<VerifiedCredentials | null> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      sessionVersion: true,
      memberships: { orderBy: { createdAt: "asc" }, take: 1 },
    },
  });

  if (!user) {
    await passwordHasher.verify(parsed.data.password, DUMMY_PASSWORD_HASH);
    return null;
  }

  const isValidPassword = await passwordHasher.verify(
    parsed.data.password,
    user.passwordHash
  );
  if (!isValidPassword) {
    return null;
  }

  const membership = user.memberships[0];
  if (!membership) {
    return null;
  }

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    organizationId: membership.organizationId,
    role: membership.role,
    sessionVersion: user.sessionVersion,
  };
}
