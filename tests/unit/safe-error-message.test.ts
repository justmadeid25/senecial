import { describe, expect, it } from "vitest";

import {
  AppError,
  ForbiddenError,
  toSafeErrorMessage,
  UnauthorizedError,
} from "@/lib/errors";

describe("toSafeErrorMessage", () => {
  it("returns the AppError's own message for known error types", () => {
    expect(toSafeErrorMessage(new UnauthorizedError())).toBe("로그인이 필요합니다.");
    expect(toSafeErrorMessage(new ForbiddenError())).toBe(
      "이 작업을 수행할 권한이 없습니다."
    );
    expect(toSafeErrorMessage(new AppError("CUSTOM", "커스텀 메시지"))).toBe(
      "커스텀 메시지"
    );
  });

  it("collapses an unknown Error into a generic message, never exposing internals", () => {
    const internalError = new Error(
      "column \"password_hash\" does not exist at /app/src/server/db/client.ts:42"
    );
    const message = toSafeErrorMessage(internalError);
    expect(message).toBe("요청을 처리하는 중 오류가 발생했습니다.");
    expect(message).not.toContain("password_hash");
    expect(message).not.toContain(".ts:");
  });

  it("collapses a non-Error thrown value into the same generic message", () => {
    expect(toSafeErrorMessage("raw string throw")).toBe(
      "요청을 처리하는 중 오류가 발생했습니다."
    );
    expect(toSafeErrorMessage(undefined)).toBe("요청을 처리하는 중 오류가 발생했습니다.");
  });
});
