import { findStalePendingTokenDeliveries } from "@/server/repositories/mail-delivery-repository";

export interface StaleTokenDeliverySummaryItem {
  id: string;
  messageType: string;
  ageMinutes: number;
}

export interface ScanStaleTokenDeliveriesResult {
  scanned: number;
  byMessageType: Record<string, number>;
  items: StaleTokenDeliverySummaryItem[];
}

export const DEFAULT_STALE_TOKEN_MAIL_MINUTES = 5;

/**
 * Read-only report - never mutates anything (unlike
 * recover-stale-token-deliveries.ts). Deliberately reports only id/
 * messageType/age: never the recipient email (only recipientHash is on the
 * row anyway), never a token, never a URL, matching every other operator
 * report in this codebase (retention-scan.ts, disaster-recovery-drill.ts).
 */
export async function scanStaleTokenDeliveries(
  staleMinutes: number = DEFAULT_STALE_TOKEN_MAIL_MINUTES
): Promise<ScanStaleTokenDeliveriesResult> {
  const now = Date.now();
  const staleBefore = new Date(now - staleMinutes * 60 * 1000);
  const stale = await findStalePendingTokenDeliveries(staleBefore);

  const byMessageType: Record<string, number> = {};
  const items: StaleTokenDeliverySummaryItem[] = [];
  for (const delivery of stale) {
    byMessageType[delivery.messageType] = (byMessageType[delivery.messageType] ?? 0) + 1;
    items.push({
      id: delivery.id,
      messageType: delivery.messageType,
      ageMinutes: Math.floor((now - delivery.createdAt.getTime()) / (60 * 1000)),
    });
  }

  return { scanned: stale.length, byMessageType, items };
}
