import { describe, expect, it } from "vitest";

import { isAuthorizedBearer } from "@/server/services/legal/legal-gateway-auth";

describe("isAuthorizedBearer (Phase L1.3 §2)", () => {
  const SECRET = "super-secret-correct-value";

  it("accepts the exact matching bearer token", () => {
    expect(isAuthorizedBearer(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(isAuthorizedBearer(undefined, SECRET)).toBe(false);
  });

  it("rejects a header with the wrong scheme", () => {
    expect(isAuthorizedBearer(`Basic ${SECRET}`, SECRET)).toBe(false);
  });

  it("rejects a header with no scheme at all", () => {
    expect(isAuthorizedBearer(SECRET, SECRET)).toBe(false);
  });

  it("rejects a wrong secret of the same length", () => {
    expect(isAuthorizedBearer(`Bearer correct-secret-VALUE!`, SECRET)).toBe(false);
  });

  it("rejects a wrong secret of a different (shorter) length", () => {
    expect(isAuthorizedBearer("Bearer short", SECRET)).toBe(false);
  });

  it("rejects a wrong secret of a different (longer) length", () => {
    expect(isAuthorizedBearer(`Bearer ${SECRET}-and-then-some-more`, SECRET)).toBe(false);
  });

  it("rejects an empty bearer value", () => {
    expect(isAuthorizedBearer("Bearer ", SECRET)).toBe(false);
  });

  it("rejects an array header value (never crashes on non-string header shapes)", () => {
    expect(isAuthorizedBearer([`Bearer ${SECRET}`], SECRET)).toBe(false);
  });

  it("is case-sensitive on the secret itself", () => {
    expect(isAuthorizedBearer(`Bearer ${SECRET.toUpperCase()}`, SECRET)).toBe(false);
  });
});
