import { describe, expect, it } from "vitest";

import { emailSchema, loginSchema, signupSchema } from "@/lib/validation/auth";

describe("emailSchema", () => {
  it("trims and lowercases a valid email", () => {
    const result = emailSchema.parse("  Foo@Example.COM  ");
    expect(result).toBe("foo@example.com");
  });

  it("rejects an invalid email", () => {
    expect(() => emailSchema.parse("not-an-email")).toThrow();
  });
});

describe("signupSchema", () => {
  const validInput = {
    name: "홍길동",
    companyName: "클로즈베이스",
    email: "user@example.com",
    password: "Password123",
    confirmPassword: "Password123",
  };

  it("accepts valid input", () => {
    const result = signupSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects when confirmPassword does not match password", () => {
    const result = signupSchema.safeParse({
      ...validInput,
      confirmPassword: "Different123",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const confirmPasswordIssue = result.error.issues.find((issue) =>
        issue.path.includes("confirmPassword")
      );
      expect(confirmPasswordIssue?.message).toBe("비밀번호가 일치하지 않습니다.");
    }
  });

  it("rejects a password shorter than 10 characters", () => {
    const result = signupSchema.safeParse({
      ...validInput,
      password: "short1",
      confirmPassword: "short1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a password without a digit", () => {
    const result = signupSchema.safeParse({
      ...validInput,
      password: "onlyletters",
      confirmPassword: "onlyletters",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a name shorter than 2 characters", () => {
    const result = signupSchema.safeParse({ ...validInput, name: "a" });
    expect(result.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts a valid email/password pair", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "anything",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty password", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "",
    });
    expect(result.success).toBe(false);
  });
});
