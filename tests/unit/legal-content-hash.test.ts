import { describe, expect, it } from "vitest";

import { computeLegalContentHash } from "@/domain/legal";

describe("computeLegalContentHash (Phase L1 §5 - deterministic content identity)", () => {
  it("is deterministic for identical content", () => {
    const content = "제398조(배상액의 예정) ① 당사자는 채무불이행에 관한 손해배상액을 예정할 수 있다.";
    expect(computeLegalContentHash(content)).toBe(computeLegalContentHash(content));
  });

  it("produces a 64-character lowercase hex sha256 digest", () => {
    expect(computeLegalContentHash("아무 내용")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different content", () => {
    expect(computeLegalContentHash("내용 A")).not.toBe(computeLegalContentHash("내용 B"));
  });
});
