import { Document, Packer, Paragraph, Table, TableCell, TableRow } from "docx";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { TextExtractionFailedError, UnsupportedFormatError } from "@/domain/extraction/extraction-errors";
import { DocxTextExtractor } from "@/server/services/extraction/docx-text-extractor";

/**
 * Phase 14 Part 6 (security - decompression bomb). A real ~1.2MB DOCX
 * built this same way (larger N) decompressed to ~500MB and crashed the
 * real extraction worker process outright when handed to mammoth - see
 * docx-text-extractor.ts's own comment. This builds a much smaller
 * version of the identical technique (still comfortably over the 100MB
 * guard) so the test itself stays fast.
 */
async function buildDecompressionBombDocxBuffer(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.folder("_rels")!.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  const paragraph = `<w:p><w:r><w:t>${"A".repeat(1000)}</w:t></w:r></w:p>`;
  const chunks = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`,
  ];
  for (let i = 0; i < 150_000; i++) chunks.push(paragraph); // ~150MB decompressed, well over the 100MB guard
  chunks.push(`</w:body></w:document>`);
  zip.folder("word")!.file("document.xml", chunks.join(""), { compression: "DEFLATE", compressionOptions: { level: 9 } });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

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

  it("rejects a decompression bomb (small on disk, huge decompressed) as UnsupportedFormatError instead of crashing", async () => {
    const extractor = new DocxTextExtractor();
    const buffer = await buildDecompressionBombDocxBuffer();
    expect(buffer.length).toBeLessThan(2 * 1024 * 1024); // small compressed size - the whole point of the attack
    await expect(extractor.extract({ buffer })).rejects.toBeInstanceOf(UnsupportedFormatError);
  });
});
