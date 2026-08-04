import { describe, expect, it } from "vitest";

import { passwordHasher } from "@/server/auth/password-hasher";

describe("passwordHasher", () => {
  it("hashes a password and verifies the correct password against it", async () => {
    const hash = await passwordHasher.hash("Password123");
    expect(hash).not.toBe("Password123");
    expect(hash.startsWith("$argon2id$")).toBe(true);

    const isValid = await passwordHasher.verify("Password123", hash);
    expect(isValid).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await passwordHasher.hash("Password123");
    const isValid = await passwordHasher.verify("WrongPassword123", hash);
    expect(isValid).toBe(false);
  });

  it("produces a different hash for the same password each time (random salt)", async () => {
    const [hashA, hashB] = await Promise.all([
      passwordHasher.hash("Password123"),
      passwordHasher.hash("Password123"),
    ]);
    expect(hashA).not.toBe(hashB);
  });
});
