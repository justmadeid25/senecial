import { describe, expect, it } from "vitest";

import { buildContractNotifications } from "@/domain/notifications/build-contract-notifications";
import { NOTIFICATION_TYPES } from "@/domain/notifications/notification-types";

const NOW = new Date("2026-06-01T00:00:00.000Z"); // KST 2026-06-01 09:00

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

const baseContract = {
  id: "contract-1",
  title: "테스트 계약",
  status: "ACTIVE" as const,
  autoRenewal: false,
  noticePeriodDays: null,
};

describe("buildContractNotifications / expiration thresholds", () => {
  it("generates an EXPIRATION_30D notification exactly 30 days before endDate", () => {
    const candidates = buildContractNotifications(
      { ...baseContract, endDate: daysFromNow(30) },
      NOW
    );
    expect(candidates.map((c) => c.type)).toContain(NOTIFICATION_TYPES.EXPIRATION_30D);
  });

  it("generates an EXPIRATION_14D notification exactly 14 days before endDate", () => {
    const candidates = buildContractNotifications(
      { ...baseContract, endDate: daysFromNow(14) },
      NOW
    );
    expect(candidates.map((c) => c.type)).toContain(NOTIFICATION_TYPES.EXPIRATION_14D);
  });

  it("generates an EXPIRATION_7D notification exactly 7 days before endDate", () => {
    const candidates = buildContractNotifications(
      { ...baseContract, endDate: daysFromNow(7) },
      NOW
    );
    expect(candidates.map((c) => c.type)).toContain(NOTIFICATION_TYPES.EXPIRATION_7D);
  });

  it("generates an EXPIRATION_1D notification exactly 1 day before endDate", () => {
    const candidates = buildContractNotifications(
      { ...baseContract, endDate: daysFromNow(1) },
      NOW
    );
    expect(candidates.map((c) => c.type)).toContain(NOTIFICATION_TYPES.EXPIRATION_1D);
  });

  it("generates an EXPIRATION_TODAY notification when endDate is today", () => {
    const candidates = buildContractNotifications(
      { ...baseContract, endDate: daysFromNow(0) },
      NOW
    );
    expect(candidates.map((c) => c.type)).toContain(NOTIFICATION_TYPES.EXPIRATION_TODAY);
  });

  it("generates no expiration notification on a non-threshold day", () => {
    const candidates = buildContractNotifications(
      { ...baseContract, endDate: daysFromNow(15) },
      NOW
    );
    expect(candidates).toHaveLength(0);
  });

  it("generates no notification when endDate is null", () => {
    const candidates = buildContractNotifications({ ...baseContract, endDate: null }, NOW);
    expect(candidates).toHaveLength(0);
  });
});

describe("buildContractNotifications / excluded statuses", () => {
  it.each(["DRAFT", "TERMINATED", "ARCHIVED"] as const)(
    "generates nothing for %s contracts even on a threshold day",
    (status) => {
      const candidates = buildContractNotifications(
        { ...baseContract, status, endDate: daysFromNow(7) },
        NOW
      );
      expect(candidates).toHaveLength(0);
    }
  );
});

describe("buildContractNotifications / renewal notice", () => {
  it("generates RENEWAL_NOTICE_DUE when today is exactly noticePeriodDays before endDate for an autoRenewal contract", () => {
    const candidates = buildContractNotifications(
      { ...baseContract, endDate: daysFromNow(10), autoRenewal: true, noticePeriodDays: 10 },
      NOW
    );
    expect(candidates.map((c) => c.type)).toContain(NOTIFICATION_TYPES.RENEWAL_NOTICE_DUE);
  });

  it("does not generate RENEWAL_NOTICE_DUE when autoRenewal is false", () => {
    const candidates = buildContractNotifications(
      { ...baseContract, endDate: daysFromNow(10), autoRenewal: false, noticePeriodDays: 10 },
      NOW
    );
    expect(candidates.map((c) => c.type)).not.toContain(NOTIFICATION_TYPES.RENEWAL_NOTICE_DUE);
  });

  it("does not generate RENEWAL_NOTICE_DUE when noticePeriodDays is null", () => {
    const candidates = buildContractNotifications(
      { ...baseContract, endDate: daysFromNow(10), autoRenewal: true, noticePeriodDays: null },
      NOW
    );
    expect(candidates.map((c) => c.type)).not.toContain(NOTIFICATION_TYPES.RENEWAL_NOTICE_DUE);
  });

  it("can generate both an expiration threshold and a renewal notice on the same day", () => {
    const candidates = buildContractNotifications(
      { ...baseContract, endDate: daysFromNow(7), autoRenewal: true, noticePeriodDays: 7 },
      NOW
    );
    expect(candidates.map((c) => c.type)).toContain(NOTIFICATION_TYPES.EXPIRATION_7D);
    expect(candidates.map((c) => c.type)).toContain(NOTIFICATION_TYPES.RENEWAL_NOTICE_DUE);
  });
});

describe("buildContractNotifications / eventKey", () => {
  it("embeds the contract id, threshold, and today's KST date in the expiration eventKey", () => {
    const candidates = buildContractNotifications(
      { ...baseContract, id: "abc", endDate: daysFromNow(30) },
      NOW
    );
    expect(candidates[0]?.eventKey).toBe("contract:abc:expiration:30d:2026-06-01");
  });

  it("produces the same eventKey for the same contract/day on repeated calls (idempotent)", () => {
    const first = buildContractNotifications({ ...baseContract, endDate: daysFromNow(7) }, NOW);
    const second = buildContractNotifications({ ...baseContract, endDate: daysFromNow(7) }, NOW);
    expect(first[0]?.eventKey).toBe(second[0]?.eventKey);
  });

  it("produces a distinct eventKey for the renewal-notice candidate", () => {
    const candidates = buildContractNotifications(
      { ...baseContract, id: "abc", endDate: daysFromNow(10), autoRenewal: true, noticePeriodDays: 10 },
      NOW
    );
    const renewalCandidate = candidates.find(
      (c) => c.type === NOTIFICATION_TYPES.RENEWAL_NOTICE_DUE
    );
    expect(renewalCandidate?.eventKey).toBe("contract:abc:renewal-notice:2026-06-01");
  });
});
