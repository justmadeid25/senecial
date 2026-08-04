import { describe, expect, it } from "vitest";

import { actionError, actionSuccess, ForbiddenError, toActionErrorResult } from "@/lib/errors";

describe("ActionResult helpers", () => {
  it("actionSuccess wraps data with success: true", () => {
    expect(actionSuccess({ id: "abc" })).toEqual({ success: true, data: { id: "abc" } });
  });

  it("actionError wraps a message with success: false", () => {
    expect(actionError("문제가 발생했습니다.")).toEqual({
      success: false,
      message: "문제가 발생했습니다.",
      fieldErrors: undefined,
    });
  });

  it("actionError can carry field-level errors", () => {
    const result = actionError("입력값을 확인해 주세요.", { title: ["필수 항목입니다."] });
    expect(result).toEqual({
      success: false,
      message: "입력값을 확인해 주세요.",
      fieldErrors: { title: ["필수 항목입니다."] },
    });
  });

  it("toActionErrorResult converts a known AppError into a safe message", () => {
    const result = toActionErrorResult(new ForbiddenError());
    expect(result).toEqual({
      success: false,
      message: "이 작업을 수행할 권한이 없습니다.",
      fieldErrors: undefined,
    });
  });

  it("toActionErrorResult collapses an unknown error into a generic message, never leaking internals", () => {
    const result = toActionErrorResult(new Error("column contracts.secret_field does not exist"));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toBe("요청을 처리하는 중 오류가 발생했습니다.");
      expect(result.message).not.toContain("secret_field");
    }
  });
});
