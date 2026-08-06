import { recordBudgetRejection } from "@/server/monitoring/metrics";
import { prisma } from "@/server/db/client";

import { getAiBudgetCounter } from "./get-ai-budget-counter";

const MONTH_TTL_SECONDS = 32 * 24 * 60 * 60;
const DAY_TTL_SECONDS = 25 * 60 * 60;

function monthKey(organizationId: string, now: Date): string {
  return `cost:${organizationId}:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
function requestMonthKey(organizationId: string, now: Date): string {
  return `req-month:${organizationId}:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
function requestDayKey(organizationId: string, now: Date): string {
  return `req-day:${organizationId}:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

/** Realistic AI budgets never approach Number.MAX_SAFE_INTEGER (~9e15) in USD micro-cents (a $10,000/month budget is 1e10) - this guard exists only to fail loudly instead of silently corrupting a reservation if a misconfigured budget value somehow got this large. */
function toSafeAmount(minor: bigint): number {
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("예산 금액이 안전한 정수 범위를 초과했습니다.");
  }
  return Number(minor);
}

export interface AiBudgetReservation {
  organizationId: string;
  costKey?: string;
  reservedCostMinor?: number;
  requestMonthKey?: string;
  requestDayKey?: string;
}

export type AiBudgetReserveOutcome = { allowed: true; reservation: AiBudgetReservation } | { allowed: false };

/**
 * §Phase 13 Part G (§27) - reserves the WORST-CASE estimated cost plus one
 * request-count slot against the organization's monthly cost budget,
 * monthly request limit, and daily request limit (whichever are actually
 * configured - a null limit means unlimited, never enforced). All-or-
 * nothing: if any one reservation would exceed its cap, every reservation
 * already made in this call is rolled back before returning
 * `allowed: false` - a caller never ends up with a partial reservation
 * leaking budget headroom.
 */
export async function reserveAiBudget(params: {
  organizationId: string;
  maxEstimatedCostMinor: bigint;
}): Promise<AiBudgetReserveOutcome> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: params.organizationId },
    select: { monthlyAiBudgetMinor: true, monthlyAiRequestLimit: true, dailyAiRequestLimit: true },
  });

  const counter = getAiBudgetCounter();
  const now = new Date();
  const reservation: AiBudgetReservation = { organizationId: params.organizationId };

  async function rollbackAndReject(): Promise<AiBudgetReserveOutcome> {
    if (reservation.costKey && reservation.reservedCostMinor) {
      await counter.release(reservation.costKey, reservation.reservedCostMinor);
    }
    if (reservation.requestMonthKey) {
      await counter.release(reservation.requestMonthKey, 1);
    }
    if (reservation.requestDayKey) {
      await counter.release(reservation.requestDayKey, 1);
    }
    recordBudgetRejection();
    return { allowed: false };
  }

  if (org.monthlyAiBudgetMinor !== null) {
    const key = monthKey(params.organizationId, now);
    const amount = toSafeAmount(params.maxEstimatedCostMinor);
    const limit = toSafeAmount(org.monthlyAiBudgetMinor);
    const result = await counter.reserve(key, amount, limit, MONTH_TTL_SECONDS);
    if (!result.reserved) {
      return rollbackAndReject();
    }
    reservation.costKey = key;
    reservation.reservedCostMinor = amount;
  }

  if (org.monthlyAiRequestLimit !== null) {
    const key = requestMonthKey(params.organizationId, now);
    const result = await counter.reserve(key, 1, org.monthlyAiRequestLimit, MONTH_TTL_SECONDS);
    if (!result.reserved) {
      return rollbackAndReject();
    }
    reservation.requestMonthKey = key;
  }

  if (org.dailyAiRequestLimit !== null) {
    const key = requestDayKey(params.organizationId, now);
    const result = await counter.reserve(key, 1, org.dailyAiRequestLimit, DAY_TTL_SECONDS);
    if (!result.reserved) {
      return rollbackAndReject();
    }
    reservation.requestDayKey = key;
  }

  return { allowed: true, reservation };
}

/** Called once the REAL cost is known (or the operation failed with zero real cost) - corrects the cost counter from the conservative worst-case reservation down (or up, if the estimate was too low) to the actual amount. Request-count reservations are never adjusted (a request that happened is still one request, regardless of outcome). */
export async function settleAiBudget(reservation: AiBudgetReservation, actualCostMinor: bigint | null): Promise<void> {
  if (!reservation.costKey || reservation.reservedCostMinor === undefined) {
    return;
  }
  const counter = getAiBudgetCounter();
  const actual = actualCostMinor !== null ? toSafeAmount(actualCostMinor) : 0;
  const delta = actual - reservation.reservedCostMinor;
  if (delta !== 0) {
    await counter.adjust(reservation.costKey, delta);
  }
}

/** Called when the AI operation failed before any provider cost was incurred at all - releases every reservation in full (equivalent to settleAiBudget with actualCostMinor=0, plus releasing the request-count reservations too, since a request that never actually ran a paid call should not count against the request limit either). */
export async function releaseAiBudget(reservation: AiBudgetReservation): Promise<void> {
  const counter = getAiBudgetCounter();
  if (reservation.costKey && reservation.reservedCostMinor) {
    await counter.release(reservation.costKey, reservation.reservedCostMinor);
  }
  if (reservation.requestMonthKey) {
    await counter.release(reservation.requestMonthKey, 1);
  }
  if (reservation.requestDayKey) {
    await counter.release(reservation.requestDayKey, 1);
  }
}
