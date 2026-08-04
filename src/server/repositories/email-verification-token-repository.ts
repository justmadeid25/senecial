import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type EmailVerificationTokenRow = Prisma.EmailVerificationTokenGetPayload<Record<string, never>>;

export async function createEmailVerificationToken(
  data: { userId: string; tokenHash: string; expiresAt: Date },
  client: DbClient = prisma
): Promise<EmailVerificationTokenRow> {
  return client.emailVerificationToken.create({ data });
}

export async function findEmailVerificationTokenByHash(
  tokenHash: string,
  client: DbClient = prisma
): Promise<EmailVerificationTokenRow | null> {
  return client.emailVerificationToken.findUnique({ where: { tokenHash } });
}

/** Phase 10C - stale-token-mail recovery looks up the token row by id (parsed from the stale MailDelivery's idempotencyKey), never by its hash - it has no plaintext token to hash. */
export async function findEmailVerificationTokenById(
  id: string,
  client: DbClient = prisma
): Promise<EmailVerificationTokenRow | null> {
  return client.emailVerificationToken.findUnique({ where: { id } });
}

export async function markEmailVerificationTokenUsed(
  id: string,
  usedAt: Date,
  client: DbClient = prisma
): Promise<void> {
  await client.emailVerificationToken.update({ where: { id }, data: { usedAt } });
}

/** §19 - "새 token 발급 시 이전 활성 token 취소". Marks every still-unused token for this user as used (without a real verification having happened) so only the newest link ever works. */
export async function invalidateActiveEmailVerificationTokens(
  userId: string,
  now: Date,
  client: DbClient = prisma
): Promise<void> {
  await client.emailVerificationToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: now },
  });
}
