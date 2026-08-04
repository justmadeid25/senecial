import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { OcrRequiredError, TextExtractionFailedError } from "@/domain/extraction/extraction-errors";
import { PdfTextExtractor } from "@/server/services/extraction/pdf-text-extractor";

// pdf-lib's standard fonts (Helvetica) can only encode WinAnsi text, so
// fixtures here stay ASCII/English - see normalize-extracted-fields.ts's
// Korean-numeral tests and the Phase 6 README for why DOCX fixtures (built
// with the `docx` package instead) are used wherever Korean text matters.
async function buildTextPdfBuffer(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  const lines = [
    "Title: Office Lease Agreement",
    "Contract Number: TEST-PDF-001",
    "Period: 2026-08-01 to 2027-07-31",
    "Amount: 8,000,000",
    "This agreement auto-renews unless terminated with 30 days notice.",
    "Governing law and jurisdiction: Seoul Central District Court.",
  ];
  let y = 700;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 14, font });
    y -= 24;
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

async function buildNearTextlessPdfBuffer(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  // Well under the 20-characters-per-page heuristic threshold - simulates a
  // scanned page with no real text layer.
  page.drawText("x", { x: 50, y: 700, size: 10, font });
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe("PdfTextExtractor", () => {
  it("supports application/pdf and .pdf extension", () => {
    const extractor = new PdfTextExtractor();
    expect(extractor.supports({ mimeType: "application/pdf", extension: ".pdf" })).toBe(true);
    expect(extractor.supports({ mimeType: "application/octet-stream", extension: ".pdf" })).toBe(
      true
    );
    expect(extractor.supports({ mimeType: "application/pdf", extension: ".bin" })).toBe(true);
    expect(
      extractor.supports({
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension: ".docx",
      })
    ).toBe(false);
  });

  it("extracts text from a normal text-layer PDF", async () => {
    const extractor = new PdfTextExtractor();
    const buffer = await buildTextPdfBuffer();
    const result = await extractor.extract({ buffer });

    expect(result.method).toBe("pdf-parse");
    expect(result.text).toContain("Office Lease Agreement");
    expect(result.text).toContain("TEST-PDF-001");
    expect(result.pageCount).toBe(1);
  });

  it("throws OcrRequiredError for a near-textless (presumed scanned) PDF", async () => {
    const extractor = new PdfTextExtractor();
    const buffer = await buildNearTextlessPdfBuffer();
    await expect(extractor.extract({ buffer })).rejects.toThrow(OcrRequiredError);
  });

  it("throws TextExtractionFailedError for a corrupted/non-PDF buffer", async () => {
    const extractor = new PdfTextExtractor();
    const buffer = Buffer.from("this is not a valid pdf file at all, just garbage bytes", "utf8");
    await expect(extractor.extract({ buffer })).rejects.toThrow(TextExtractionFailedError);
  });
});
