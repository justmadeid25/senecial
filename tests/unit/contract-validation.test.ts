import { describe, expect, it } from "vitest";

import {
  amountSchema,
  contractListQuerySchema,
  createContractSchema,
  currencySchema,
} from "@/lib/validation/contracts";

const validInput = {
  title: "테스트 계약",
  contractType: "SERVICE",
  status: "ACTIVE",
  autoRenewal: false,
  currency: "KRW",
};

describe("createContractSchema", () => {
  it("accepts minimal valid input", () => {
    expect(createContractSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects an empty title", () => {
    const result = createContractSchema.safeParse({ ...validInput, title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a title longer than 200 characters", () => {
    const result = createContractSchema.safeParse({ ...validInput, title: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("treats blank optional date fields as absent, not invalid", () => {
    const result = createContractSchema.safeParse({
      ...validInput,
      startDate: "",
      endDate: "",
      signedDate: "",
    });
    expect(result.success).toBe(true);
  });

  it("treats a blank noticePeriodDays as absent, not zero", () => {
    const result = createContractSchema.safeParse({ ...validInput, noticePeriodDays: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.noticePeriodDays).toBeUndefined();
    }
  });

  it("rejects when endDate is earlier than startDate", () => {
    const result = createContractSchema.safeParse({
      ...validInput,
      startDate: "2026-08-15",
      endDate: "2026-08-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("endDate"));
      expect(issue?.message).toBe("종료일은 시작일보다 빠를 수 없습니다.");
    }
  });

  it("accepts endDate equal to startDate", () => {
    const result = createContractSchema.safeParse({
      ...validInput,
      startDate: "2026-08-01",
      endDate: "2026-08-01",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid decimal amount string", () => {
    const result = createContractSchema.safeParse({ ...validInput, amount: "12345678.90" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe("12345678.90");
    }
  });

  it("rejects an amount with too many decimal places", () => {
    const result = createContractSchema.safeParse({ ...validInput, amount: "100.999" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric amount", () => {
    const result = createContractSchema.safeParse({ ...validInput, amount: "not-a-number" });
    expect(result.success).toBe(false);
  });
});

describe("amountSchema", () => {
  it("accepts integer and decimal amounts", () => {
    expect(amountSchema.safeParse("100000").success).toBe(true);
    expect(amountSchema.safeParse("100000.50").success).toBe(true);
  });

  it("rejects negative amounts", () => {
    expect(amountSchema.safeParse("-100").success).toBe(false);
  });

  it("rejects more than 12 integer digits", () => {
    expect(amountSchema.safeParse("1".repeat(13)).success).toBe(false);
  });
});

describe("currencySchema", () => {
  it("uppercases a lowercase 3-letter code", () => {
    const result = currencySchema.safeParse("usd");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("USD");
    }
  });

  it("rejects a code that is not 3 letters", () => {
    expect(currencySchema.safeParse("US").success).toBe(false);
    expect(currencySchema.safeParse("USDT").success).toBe(false);
    expect(currencySchema.safeParse("12A").success).toBe(false);
  });
});

describe("contractListQuerySchema", () => {
  it("applies defaults when nothing is provided", () => {
    const result = contractListQuerySchema.parse({});
    expect(result).toMatchObject({
      q: "",
      sortBy: "updatedAt",
      sortOrder: "desc",
      page: 1,
      pageSize: 20,
    });
  });

  it("coerces string page/pageSize query params to numbers", () => {
    const result = contractListQuerySchema.parse({ page: "3", pageSize: "50" });
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(50);
  });

  it("rejects a pageSize above the 100 maximum", () => {
    const result = contractListQuerySchema.safeParse({ pageSize: "101" });
    expect(result.success).toBe(false);
  });

  it("rejects a page below 1", () => {
    const result = contractListQuerySchema.safeParse({ page: "0" });
    expect(result.success).toBe(false);
  });

  it("coerces the autoRenewal string flag to a boolean", () => {
    expect(contractListQuerySchema.parse({ autoRenewal: "true" }).autoRenewal).toBe(true);
    expect(contractListQuerySchema.parse({ autoRenewal: "false" }).autoRenewal).toBe(false);
  });
});
