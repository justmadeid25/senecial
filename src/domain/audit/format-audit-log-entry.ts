import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";

export interface AuditLogEntryInput {
  action: string;
  entityType: string;
  userName: string | null;
  metadata: unknown;
}

/**
 * AuditLog.metadata is untyped JSON written by many different call sites -
 * it must never be rendered as-is. This module only ever reads specific,
 * pre-known field names for each action (a whitelist, not a passthrough),
 * caps string length, and returns plain text (React/JSX escapes text
 * content by default, so this is safe to render directly - never pass the
 * result through dangerouslySetInnerHTML). Fields that must never appear
 * here regardless of what a caller happens to have stored: storageKey,
 * tokenHash, and any raw JSON dump of `metadata`.
 */
function asRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function asSafeString(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function asSafeStringArray(value: unknown, maxItems = 10): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const strings = value.filter((item): item is string => typeof item === "string").slice(0, maxItems);
  return strings.length > 0 ? strings.join(", ") : null;
}

export function formatAuditLogEntry(entry: AuditLogEntryInput): string {
  const meta = asRecord(entry.metadata);
  const actor = entry.userName ?? "알 수 없는 사용자";

  switch (entry.action) {
    case AUDIT_ACTIONS.ORGANIZATION_CREATED:
      return `${actor}님이 조직을 생성했습니다.`;

    case AUDIT_ACTIONS.CONTRACT_CREATED:
      return `${actor}님이 계약 "${asSafeString(meta.title) ?? "제목 없음"}"을(를) 생성했습니다.`;

    case AUDIT_ACTIONS.CONTRACT_UPDATED: {
      const title = asSafeString(meta.title) ?? "제목 없음";
      const changed = asSafeStringArray(meta.changedFields);
      return changed
        ? `${actor}님이 계약 "${title}"을(를) 수정했습니다. (변경: ${changed})`
        : `${actor}님이 계약 "${title}"을(를) 수정했습니다.`;
    }

    case AUDIT_ACTIONS.CONTRACT_DELETED:
      return `${actor}님이 계약 "${asSafeString(meta.title) ?? "제목 없음"}"을(를) 삭제했습니다.`;

    case AUDIT_ACTIONS.COUNTERPARTY_CREATED:
      return `${actor}님이 상대방 "${asSafeString(meta.name) ?? "이름 없음"}"을(를) 등록했습니다.`;

    case AUDIT_ACTIONS.COUNTERPARTY_UPDATED: {
      const name = asSafeString(meta.name) ?? "이름 없음";
      const changed = asSafeStringArray(meta.changedFields);
      return changed
        ? `${actor}님이 상대방 "${name}" 정보를 수정했습니다. (변경: ${changed})`
        : `${actor}님이 상대방 "${name}" 정보를 수정했습니다.`;
    }

    case AUDIT_ACTIONS.COUNTERPARTY_DELETED:
      return `${actor}님이 상대방 "${asSafeString(meta.name) ?? "이름 없음"}"을(를) 삭제했습니다.`;

    case AUDIT_ACTIONS.FILE_UPLOADED:
      return `${actor}님이 파일 "${asSafeString(meta.originalName) ?? "파일"}"을(를) 업로드했습니다.`;

    case AUDIT_ACTIONS.FILE_DOWNLOADED:
      return `${actor}님이 파일 "${asSafeString(meta.originalName) ?? "파일"}"을(를) 다운로드했습니다.`;

    case AUDIT_ACTIONS.FILE_DELETED:
      return `${actor}님이 파일 "${asSafeString(meta.originalName) ?? "파일"}"을(를) 삭제했습니다.`;

    case AUDIT_ACTIONS.MEMBER_INVITED: {
      const email = asSafeString(meta.email) ?? "알 수 없는 이메일";
      const role = asSafeString(meta.role) ?? "MEMBER";
      return `${actor}님이 ${email}님을 ${role} 권한으로 초대했습니다.`;
    }

    case AUDIT_ACTIONS.MEMBER_INVITATION_REVOKED:
      return `${actor}님이 ${asSafeString(meta.email) ?? "알 수 없는 이메일"}님에 대한 초대를 취소했습니다.`;

    case AUDIT_ACTIONS.MEMBER_INVITATION_ACCEPTED:
      return `${actor}님이 초대를 수락하고 ${asSafeString(meta.role) ?? "MEMBER"} 권한으로 합류했습니다.`;

    case AUDIT_ACTIONS.MEMBER_ROLE_CHANGED: {
      const previousRole = asSafeString(meta.previousRole) ?? "?";
      const nextRole = asSafeString(meta.nextRole) ?? "?";
      return `${actor}님이 구성원의 역할을 ${previousRole}에서 ${nextRole}(으)로 변경했습니다.`;
    }

    case AUDIT_ACTIONS.MEMBER_REMOVED:
      return `${actor}님이 구성원을 조직에서 제거했습니다.`;

    default:
      return `${actor}님이 ${entry.entityType}에 대해 ${entry.action} 작업을 수행했습니다.`;
  }
}
