import { describe, expect, it } from "vitest";

import { buildContentDisposition } from "@/lib/http/content-disposition";

describe("buildContentDisposition", () => {
  it("produces both an ASCII filename and a UTF-8 filename* for a Korean name", () => {
    const header = buildContentDisposition("계약서 원본.pdf");
    expect(header).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
    expect(header).toContain("filename*=UTF-8''%EA%B3%84%EC%95%BD%EC%84%9C");
  });

  it("strips CR/LF from the ASCII fallback so header injection is impossible", () => {
    const malicious = 'evil.pdf"\r\nX-Injected: true';
    const header = buildContentDisposition(malicious);
    expect(header).not.toMatch(/\r|\n/);
  });

  it("strips double quotes from the ASCII fallback so the quoted string cannot be broken out of", () => {
    const header = buildContentDisposition('normal"; evil="value.pdf');
    const fallbackMatch = header.match(/filename="([^"]*)"/);
    expect(fallbackMatch).not.toBeNull();
    expect(fallbackMatch?.[1]).not.toContain('"');
  });

  it("percent-encodes CR/LF within the UTF-8 filename* parameter", () => {
    const header = buildContentDisposition("a\r\nb.pdf");
    const utf8Part = header.split("filename*=UTF-8''")[1];
    expect(utf8Part).not.toMatch(/\r|\n/);
    expect(utf8Part).toContain("%0D%0A");
  });

  it("falls back to a safe default when the name is empty", () => {
    const header = buildContentDisposition("");
    expect(header).toMatch(/filename="download"/);
  });

  it("always sets the disposition type to attachment (never inline)", () => {
    const header = buildContentDisposition("report.pdf");
    expect(header.startsWith("attachment;")).toBe(true);
  });
});
