import { AI_CONCURRENCY_LIMITS } from "@/lib/config/ai-concurrency";
import { ConcurrencyLimitError } from "@/lib/errors";
import { getAiConcurrencyLimiter } from "@/server/services/ai/concurrency/get-ai-concurrency-limiter";

function userConcurrencyKey(userId: string): string {
  return `ai:user:${userId}`;
}
function organizationConcurrencyKey(organizationId: string): string {
  return `ai:org:${organizationId}`;
}

export interface AcquiredAiConcurrencySlots {
  userId: string;
  organizationId: string;
}

/**
 * §Phase 12.2 Part E (§33) - acquires BOTH axes (mirrors
 * enforceLoginRateLimit()'s multi-axis shape): a per-user slot AND a
 * per-organization slot. If the organization axis fails after the user
 * axis already succeeded, the user slot is released before throwing - a
 * failed acquire must never leak a partial hold.
 */
export async function acquireAiConcurrencySlots(params: { userId: string; organizationId: string }): Promise<AcquiredAiConcurrencySlots> {
  const limiter = getAiConcurrencyLimiter();

  const userResult = await limiter.acquire(userConcurrencyKey(params.userId), AI_CONCURRENCY_LIMITS.perUser, AI_CONCURRENCY_LIMITS.leaseSeconds);
  if (!userResult.acquired) {
    throw new ConcurrencyLimitError(AI_CONCURRENCY_LIMITS.perUser, "동시에 처리 중인 AI 요청이 너무 많습니다. 이전 응답이 끝난 뒤 다시 시도해 주세요.");
  }

  const orgResult = await limiter.acquire(
    organizationConcurrencyKey(params.organizationId),
    AI_CONCURRENCY_LIMITS.perOrganization,
    AI_CONCURRENCY_LIMITS.leaseSeconds
  );
  if (!orgResult.acquired) {
    await limiter.release(userConcurrencyKey(params.userId));
    throw new ConcurrencyLimitError(
      AI_CONCURRENCY_LIMITS.perOrganization,
      "현재 조직에서 동시에 처리 중인 AI 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."
    );
  }

  return { userId: params.userId, organizationId: params.organizationId };
}

/** Safe to call more than once for the same slots (the underlying limiter clamps at 0 rather than going negative) - callers should still only call it once per successful acquire in the normal path. */
export async function releaseAiConcurrencySlots(slots: AcquiredAiConcurrencySlots): Promise<void> {
  const limiter = getAiConcurrencyLimiter();
  await limiter.release(userConcurrencyKey(slots.userId));
  await limiter.release(organizationConcurrencyKey(slots.organizationId));
}
