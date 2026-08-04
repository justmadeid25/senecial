import { MembershipRole } from "@/generated/prisma/enums";
import { formatAuditLogEntry } from "@/domain/audit/format-audit-log-entry";
import { ValidationError } from "@/lib/errors";
import { auditLogListQuerySchema } from "@/lib/validation/audit-logs";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import { countAuditLogs, findAuditLogs } from "@/server/repositories/audit-log-repository";

export interface AuditLogListItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userName: string | null;
  description: string;
  createdAt: Date;
}

export interface ListAuditLogsParams {
  userId: string;
  organizationId: string;
  query: unknown;
}

export interface ListAuditLogsResult {
  items: AuditLogListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** OWNER only - see README's "감사 로그 접근 정책". */
export async function listAuditLogs(params: ListAuditLogsParams): Promise<ListAuditLogsResult> {
  const authContext = await verifyOrganizationRole(
    params.userId,
    params.organizationId,
    MembershipRole.OWNER
  );

  const parsed = auditLogListQuerySchema.safeParse(params.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "검색 조건이 올바르지 않습니다.");
  }
  const { action, userId, entityType, entityId, startDate, endDate, page, pageSize } = parsed.data;

  const findParams = {
    organizationId: authContext.organizationId,
    action,
    userId,
    entityType,
    entityId,
    startDate,
    endDate,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };

  const [rows, total] = await Promise.all([
    findAuditLogs(findParams),
    countAuditLogs(findParams),
  ]);

  return {
    items: rows.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      userName: log.user?.name ?? null,
      description: formatAuditLogEntry({
        action: log.action,
        entityType: log.entityType,
        userName: log.user?.name ?? null,
        metadata: log.metadata,
      }),
      createdAt: log.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
