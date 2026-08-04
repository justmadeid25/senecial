import { describe, expect, it } from "vitest";

import { ContractStatus } from "@/generated/prisma/enums";
import { getComputedContractStatus } from "@/domain/contracts/get-computed-contract-status";

const now = new Date("2026-01-15T12:00:00+09:00"); // KST noon, Jan 15 2026

describe("getComputedContractStatus", () => {
  it("keeps the status unchanged when there is no endDate", () => {
    expect(
      getComputedContractStatus({ status: ContractStatus.ACTIVE, endDate: null }, now)
    ).toBe(ContractStatus.ACTIVE);
  });

  it("never changes DRAFT, even with a long-past endDate", () => {
    expect(
      getComputedContractStatus(
        { status: ContractStatus.DRAFT, endDate: new Date("2020-01-01T00:00:00+09:00") },
        now
      )
    ).toBe(ContractStatus.DRAFT);
  });

  it("never changes TERMINATED", () => {
    expect(
      getComputedContractStatus(
        { status: ContractStatus.TERMINATED, endDate: new Date("2020-01-01T00:00:00+09:00") },
        now
      )
    ).toBe(ContractStatus.TERMINATED);
  });

  it("never changes ARCHIVED", () => {
    expect(
      getComputedContractStatus(
        { status: ContractStatus.ARCHIVED, endDate: new Date("2020-01-01T00:00:00+09:00") },
        now
      )
    ).toBe(ContractStatus.ARCHIVED);
  });

  it("returns EXPIRED when endDate's KST calendar day is yesterday", () => {
    expect(
      getComputedContractStatus(
        { status: ContractStatus.ACTIVE, endDate: new Date("2026-01-14T00:00:00+09:00") },
        now
      )
    ).toBe(ContractStatus.EXPIRED);
  });

  it("returns EXPIRING when endDate's KST calendar day is today (0 days remaining)", () => {
    expect(
      getComputedContractStatus(
        { status: ContractStatus.ACTIVE, endDate: new Date("2026-01-15T23:00:00+09:00") },
        now
      )
    ).toBe(ContractStatus.EXPIRING);
  });

  it("returns EXPIRING at exactly 30 days remaining", () => {
    expect(
      getComputedContractStatus(
        { status: ContractStatus.ACTIVE, endDate: new Date("2026-02-14T00:00:00+09:00") },
        now
      )
    ).toBe(ContractStatus.EXPIRING);
  });

  it("keeps the status unchanged at exactly 31 days remaining", () => {
    expect(
      getComputedContractStatus(
        { status: ContractStatus.ACTIVE, endDate: new Date("2026-02-15T00:00:00+09:00") },
        now
      )
    ).toBe(ContractStatus.ACTIVE);
  });

  it("31+ days remaining keeps whatever non-manual status was stored, even if it was EXPIRING", () => {
    expect(
      getComputedContractStatus(
        { status: ContractStatus.EXPIRING, endDate: new Date("2026-03-01T00:00:00+09:00") },
        now
      )
    ).toBe(ContractStatus.EXPIRING);
  });

  describe("month-end boundary", () => {
    const jan1 = new Date("2026-01-01T09:00:00+09:00");

    it("Jan 31 is exactly 30 days from Jan 1 -> EXPIRING", () => {
      expect(
        getComputedContractStatus(
          { status: ContractStatus.ACTIVE, endDate: new Date("2026-01-31T09:00:00+09:00") },
          jan1
        )
      ).toBe(ContractStatus.EXPIRING);
    });

    it("Feb 1 is exactly 31 days from Jan 1 -> unchanged", () => {
      expect(
        getComputedContractStatus(
          { status: ContractStatus.ACTIVE, endDate: new Date("2026-02-01T09:00:00+09:00") },
          jan1
        )
      ).toBe(ContractStatus.ACTIVE);
    });
  });

  describe("year-end boundary", () => {
    const dec15 = new Date("2026-12-15T09:00:00+09:00");

    it("Jan 1 of the next year is 17 days from Dec 15 -> EXPIRING", () => {
      expect(
        getComputedContractStatus(
          { status: ContractStatus.ACTIVE, endDate: new Date("2027-01-01T09:00:00+09:00") },
          dec15
        )
      ).toBe(ContractStatus.EXPIRING);
    });

    it("Jan 15 of the next year is 31 days from Dec 15 -> unchanged", () => {
      expect(
        getComputedContractStatus(
          { status: ContractStatus.ACTIVE, endDate: new Date("2027-01-15T09:00:00+09:00") },
          dec15
        )
      ).toBe(ContractStatus.ACTIVE);
    });
  });

  describe("UTC vs KST calendar-day boundary", () => {
    it("crossing a KST midnight (but not a UTC midnight) flips EXPIRING to EXPIRED", () => {
      // now = 2026-01-15T20:00:00Z -> UTC calendar day is Jan 15, but in KST
      // (UTC+9) it is already 2026-01-16 05:00 -> KST calendar day Jan 16.
      const nowNearUtcMidnight = new Date("2026-01-15T20:00:00Z");
      // endDate = 2026-01-15T10:00:00Z -> UTC calendar day Jan 15 (same UTC
      // day as `now`), but in KST it is 2026-01-15 19:00 -> KST calendar day
      // Jan 15, i.e. *yesterday* relative to `now`'s KST day.
      const endDate = new Date("2026-01-15T10:00:00Z");

      // A naive UTC-calendar-day comparison would see both on Jan 15 UTC
      // (0 days remaining -> EXPIRING). The correct KST-based comparison
      // sees endDate's KST day (Jan 15) before now's KST day (Jan 16).
      expect(
        getComputedContractStatus({ status: ContractStatus.ACTIVE, endDate }, nowNearUtcMidnight)
      ).toBe(ContractStatus.EXPIRED);
    });

    it("two 'now' instants two minutes apart, straddling KST midnight, classify the same endDate differently", () => {
      const endDate = new Date("2026-01-15T00:00:00+09:00"); // KST day Jan 15

      const justBeforeKstMidnight = new Date("2026-01-15T23:59:00+09:00"); // KST day Jan 15
      const justAfterKstMidnight = new Date("2026-01-16T00:01:00+09:00"); // KST day Jan 16

      expect(
        getComputedContractStatus(
          { status: ContractStatus.ACTIVE, endDate },
          justBeforeKstMidnight
        )
      ).toBe(ContractStatus.EXPIRING); // 0 days remaining

      expect(
        getComputedContractStatus({ status: ContractStatus.ACTIVE, endDate }, justAfterKstMidnight)
      ).toBe(ContractStatus.EXPIRED); // -1 days remaining
    });
  });
});
