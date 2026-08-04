import { Document, Packer, Paragraph, Table, TableCell, TableRow } from "docx";
import { describe, expect, it } from "vitest";

import { TextExtractionFailedError } from "@/domain/extraction/extraction-errors";
import { DocxTextExtractor } from "@/server/services/extraction/docx-text-extractor";

async function buildBodyContractDocxBuffer(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph("계약명: 사무실 임대차계약"),
          new Paragraph("계약번호: TEST-DOCX-001"),
          new Paragraph("상대방: 감마파트너스"),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function buildTableContractDocxBuffer(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph("계약 주요 정보"),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("계약금액")] }),
                  new TableCell({ children: [new Paragraph("120,000,000원")] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("계약기간")] }),
                  new TableCell({ children: [new Paragraph("2026-08-01 ~ 2027-07-31")] }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

describe("DocxTextExtractor", () => {
  it("supports the OOXML MIME type and .docx extension", () => {
    const extractor = new DocxTextExtractor();
    expect(
      extractor.supports({
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension: ".docx",
      })
    ).toBe(true);
    expect(extractor.supports({ mimeType: "application/octet-stream", extension: ".docx" })).toBe(
      true
    );
    expect(extractor.supports({ mimeType: "application/pdf", extension: ".pdf" })).toBe(false);
  });

  it("extracts body paragraph text in document order", async () => {
    const extractor = new DocxTextExtractor();
    const buffer = await buildBodyContractDocxBuffer();
    const result = await extractor.extract({ buffer });

    expect(result.method).toBe("mammoth");
    expect(result.text).toContain("계약명: 사무실 임대차계약");
    expect(result.text).toContain("계약번호: TEST-DOCX-001");
    expect(result.text).toContain("상대방: 감마파트너스");
    expect(result.text.indexOf("계약명")).toBeLessThan(result.text.indexOf("상대방"));
  });

  it("extracts table cell text", async () => {
    const extractor = new DocxTextExtractor();
    const buffer = await buildTableContractDocxBuffer();
    const result = await extractor.extract({ buffer });

    expect(result.text).toContain("계약금액");
    expect(result.text).toContain("120,000,000원");
    expect(result.text).toContain("2026-08-01 ~ 2027-07-31");
  });

  it("throws TextExtractionFailedError for a corrupted/non-DOCX buffer", async () => {
    const extractor = new DocxTextExtractor();
    const buffer = Buffer.from("this is not a valid docx/zip file, just garbage bytes", "utf8");
    await expect(extractor.extract({ buffer })).rejects.toThrow(TextExtractionFailedError);
  });
});
