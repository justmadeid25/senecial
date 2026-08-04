import { describe, expect, it } from "vitest";

import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { formatAuditLogEntry } from "@/domain/audit/format-audit-log-entry";

describe("formatAuditLogEntry", () => {
  it("formats CONTRACT_CREATED using the actor name and title", () => {
    const result = formatAuditLogEntry({
      action: AUDIT_ACTIONS.CONTRACT_CREATED,
      entityType: "Contract",
      userName: "김사용자",
      metadata: { contractId: "c1", title: "소프트웨어 개발 용역계약" },
    });
    expect(result).toBe('김사용자님이 계약 "소프트웨어 개발 용역계약"을(를) 생성했습니다.');
  });

  it("includes changedFields for CONTRACT_UPDATED when present", () => {
    const result = formatAuditLogEntry({
      action: AUDIT_ACTIONS.CONTRACT_UPDATED,
      entityType: "Contract",
      userName: "김사용자",
      metadata: { title: "계약", changedFields: ["title", "amount"] },
    });
    expect(result).toContain("변경: title, amount");
  });

  it("falls back to a generic actor label when userName is null", () => {
    const result = formatAuditLogEntry({
      action: AUDIT_ACTIONS.CONTRACT_DELETED,
      entityType: "Contract",
      userName: null,
      metadata: { title: "계약" },
    });
    expect(result).toContain("알 수 없는 사용자");
  });

  it("never includes storageKey even if present in metadata (whitelist, not passthrough)", () => {
    const result = formatAuditLogEntry({
      action: AUDIT_ACTIONS.FILE_UPLOADED,
      entityType: "ContractFile",
      userName: "김사용자",
      metadata: {
        originalName: "계약서.pdf",
        storageKey: "org123/secret-uuid.pdf",
      },
    });
    expect(result).not.toContain("secret-uuid");
    expect(result).not.toContain("storageKey");
  });

  it("never includes counterparty contact values (memo/phone/email) even if present in metadata", () => {
    const result = formatAuditLogEntry({
      action: AUDIT_ACTIONS.COUNTERPARTY_UPDATED,
      entityType: "Counterparty",
      userName: "김사용자",
      metadata: {
        name: "상대방",
        changedFields: ["contactPhone"],
        contactPhone: "010-1234-5678",
      },
    });
    expect(result).not.toContain("010-1234-5678");
  });

  it("caps and truncates an overly long metadata string instead of rendering it raw", () => {
    const longTitle = "a".repeat(500);
    const result = formatAuditLogEntry({
      action: AUDIT_ACTIONS.CONTRACT_CREATED,
      entityType: "Contract",
      userName: "김사용자",
      metadata: { title: longTitle },
    });
    expect(result.length).toBeLessThan(longTitle.length);
  });

  it("falls back to a generic sentence for an unrecognized action instead of throwing", () => {
    const result = formatAuditLogEntry({
      action: "SOME_FUTURE_ACTION",
      entityType: "Widget",
      userName: "김사용자",
      metadata: {},
    });
    expect(result).toContain("SOME_FUTURE_ACTION");
    expect(result).toContain("Widget");
  });

  it("handles non-object metadata (null/array/string) without throwing", () => {
    expect(() =>
      formatAuditLogEntry({
        action: AUDIT_ACTIONS.CONTRACT_CREATED,
        entityType: "Contract",
        userName: "김사용자",
        metadata: null,
      })
    ).not.toThrow();
    expect(() =>
      formatAuditLogEntry({
        action: AUDIT_ACTIONS.CONTRACT_CREATED,
        entityType: "Contract",
        userName: "김사용자",
        metadata: ["not", "an", "object"],
      })
    ).not.toThrow();
  });

  it("formats MEMBER_ROLE_CHANGED with previous and next role", () => {
    const result = formatAuditLogEntry({
      action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
      entityType: "Membership",
      userName: "오너",
      metadata: { previousRole: "MEMBER", nextRole: "OWNER" },
    });
    expect(result).toContain("MEMBER에서 OWNER");
  });
});
