import { buildContractNotifications } from "@/domain/notifications/build-contract-notifications";
import { findContracts } from "@/server/repositories/contract-repository";
import { createNotificationIfNew } from "@/server/repositories/notification-repository";

export interface GenerateContractNotificationsParams {
  organizationId: string;
  now: Date;
}

export interface GenerateContractNotificationsResult {
  contractsScanned: number;
  notificationsCreated: number;
}

/**
 * No auth check here by design - this is invoked only from a trusted
 * server-side entry point (scripts/generate-notifications.ts, run via CLI
 * / cron), never from a Server Action or any HTTP-reachable route. See
 * README's "스케줄 실행 구조" section for why no public endpoint exists for
 * this.
 */
export async function generateContractNotifications(
  params: GenerateContractNotificationsParams
): Promise<GenerateContractNotificationsResult> {
  const contracts = await findContracts({ organizationId: params.organizationId });

  let notificationsCreated = 0;

  for (const contract of contracts) {
    const candidates = buildContractNotifications(
      {
        id: contract.id,
        title: contract.title,
        status: contract.status,
        endDate: contract.endDate,
        autoRenewal: contract.autoRenewal,
        noticePeriodDays: contract.noticePeriodDays,
      },
      params.now
    );

    for (const candidate of candidates) {
      const created = await createNotificationIfNew({
        organizationId: params.organizationId,
        contractId: contract.id,
        type: candidate.type,
        title: candidate.title,
        message: candidate.message,
        eventKey: candidate.eventKey,
        scheduledFor: candidate.scheduledFor,
      });
      if (created) {
        notificationsCreated += 1;
      }
    }
  }

  return { contractsScanned: contracts.length, notificationsCreated };
}
