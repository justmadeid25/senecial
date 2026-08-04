import { describe, expect, it } from "vitest";

import { counterpartyListQuerySchema, createCounterpartySchema } from "@/lib/validation/counterparties";

const validInput = {
  name: "테스트 상대방",
};

describe("createCounterpartySchema", () => {
  it("accepts minimal valid input (name only)", () => {
    expect(createCounterpartySchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(createCounterpartySchema.safeParse({ ...validInput, name: "" }).success).toBe(false);
  });

  it("rejects a name longer than 200 characters", () => {
    expect(
      createCounterpartySchema.safeParse({ ...validInput, name: "a".repeat(201) }).success
    ).toBe(false);
  });

  it("treats a blank optional contactEmail as absent, not invalid", () => {
    const result = createCounterpartySchema.safeParse({ ...validInput, contactEmail: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contactEmail).toBeUndefined();
    }
  });

  it("rejects a malformed contactEmail", () => {
    const result = createCounterpartySchema.safeParse({
      ...validInput,
      contactEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed contactEmail", () => {
    const result = createCounterpartySchema.safeParse({
      ...validInput,
      contactEmail: "contact@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a memo longer than 2000 characters", () => {
    const result = createCounterpartySchema.safeParse({
      ...validInput,
      memo: "a".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from the name", () => {
    const result = createCounterpartySchema.safeParse({ ...validInput, name: "  공백 상대방  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("공백 상대방");
    }
  });
});

describe("counterpartyListQuerySchema", () => {
  it("applies default pagination values", () => {
    const result = counterpartyListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
    }
  });

  it("rejects a pageSize above 100", () => {
    expect(counterpartyListQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
  });
});
