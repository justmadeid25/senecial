import { describe, expect, it } from "vitest";

import {
  buildCsvDocument,
  buildCsvRow,
  buildSafeCsvFilename,
  escapeCsvField,
  neutralizeCsvFormulaPrefix,
  withUtf8Bom,
} from "@/domain/analytics/csv";

describe("neutralizeCsvFormulaPrefix / escapeCsvField (§30 CSV formula injection)", () => {
  it("prefixes a leading apostrophe for each dangerous formula-injection character", () => {
    for (const dangerous of ["=SUM(A1)", "+1+1", "-1-1", "@cmd", "\ttab-start", "\rcr-start"]) {
      expect(neutralizeCsvFormulaPrefix(dangerous).startsWith("'")).toBe(true);
    }
  });

  it("does not alter values that do not start with a dangerous character", () => {
    expect(neutralizeCsvFormulaPrefix("계약명")).toBe("계약명");
    expect(neutralizeCsvFormulaPrefix("10,000")).toBe("10,000");
  });

  it("always quotes every field per RFC 4180, doubling embedded quotes", () => {
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeCsvField("plain")).toBe('"plain"');
  });

  it("escapes null/undefined as an empty quoted field", () => {
    expect(escapeCsvField(null)).toBe('""');
    expect(escapeCsvField(undefined)).toBe('""');
  });

  it("neutralizes a formula-injection value AND quotes it", () => {
    expect(escapeCsvField("=1+1")).toBe('"\'=1+1"');
  });
});

describe("buildCsvRow / buildCsvDocument (§30 CRLF handling)", () => {
  it("terminates each row with CRLF", () => {
    expect(buildCsvRow(["a", "b"])).toBe('"a","b"\r\n');
  });

  it("a raw CRLF embedded inside a field value stays inside the quoted field, never creating a new row", () => {
    const row = buildCsvRow(["line1\r\nline2", "next"]);
    // Exactly one row-terminating CRLF (the one at the very end).
    const rowTerminator = row.slice(-2);
    expect(rowTerminator).toBe("\r\n");
    expect(row).toContain("line1\r\nline2");
  });

  it("builds a full document with a header row followed by data rows", () => {
    const doc = buildCsvDocument(["h1", "h2"], [["a", "b"], ["c", "d"]]);
    expect(doc).toBe('"h1","h2"\r\n"a","b"\r\n"c","d"\r\n');
  });

  it("produces an empty-body document (header only) for zero rows", () => {
    expect(buildCsvDocument(["h1"], [])).toBe('"h1"\r\n');
  });
});

describe("withUtf8Bom (§30 Excel compatibility)", () => {
  it("prepends the UTF-8 BOM", () => {
    const withBom = withUtf8Bom("abc");
    expect(withBom.charCodeAt(0)).toBe(0xfeff);
    expect(withBom.slice(1)).toBe("abc");
  });
});

describe("buildSafeCsvFilename (§30 CRLF/quote injection in filenames)", () => {
  it("keeps a clean ASCII base and date suffix intact", () => {
    expect(buildSafeCsvFilename("contract-portfolio", "2026-07-29")).toBe(
      "contract-portfolio-2026-07-29.csv"
    );
  });

  it("strips CRLF, quotes, and other unsafe characters from the base", () => {
    const filename = buildSafeCsvFilename('evil"\r\nX-Injected: true', "2026-07-29");
    expect(filename).not.toContain("\r");
    expect(filename).not.toContain("\n");
    expect(filename).not.toContain('"');
    expect(filename.endsWith(".csv")).toBe(true);
  });
});
