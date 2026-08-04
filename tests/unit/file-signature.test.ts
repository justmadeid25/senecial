import { describe, expect, it } from "vitest";

import {
  matchesContractFileSignature,
  matchesDocxSignature,
  matchesHwpSignature,
  matchesPdfSignature,
} from "@/domain/contracts/file-policy";

const PDF_BYTES = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n", "latin1");
const OLE2_BYTES = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
const PLAIN_TEXT_BYTES = Buffer.from("this is just a text file, not a real document", "utf8");

function buildFakeDocxBuffer(): Buffer {
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const marker = Buffer.from(
    "[Content_Types].xml word/document.xml some more zip-ish filler bytes",
    "latin1"
  );
  return Buffer.concat([header, marker]);
}

function buildZipWithoutDocxMarkersBuffer(): Buffer {
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const filler = Buffer.from("just some other zip archive content, not office", "latin1");
  return Buffer.concat([header, filler]);
}

describe("matchesPdfSignature", () => {
  it("accepts a buffer starting with %PDF-", () => {
    expect(matchesPdfSignature(PDF_BYTES)).toBe(true);
  });

  it("rejects a plain text buffer", () => {
    expect(matchesPdfSignature(PLAIN_TEXT_BYTES)).toBe(false);
  });

  it("rejects an empty buffer", () => {
    expect(matchesPdfSignature(Buffer.alloc(0))).toBe(false);
  });
});

describe("matchesDocxSignature", () => {
  it("accepts a ZIP container containing the expected OOXML path fragments", () => {
    expect(matchesDocxSignature(buildFakeDocxBuffer())).toBe(true);
  });

  it("rejects a ZIP container missing the OOXML path fragments", () => {
    expect(matchesDocxSignature(buildZipWithoutDocxMarkersBuffer())).toBe(false);
  });

  it("rejects a non-ZIP buffer even if it contains the marker text", () => {
    const buffer = Buffer.from("[Content_Types].xml word/document.xml", "latin1");
    expect(matchesDocxSignature(buffer)).toBe(false);
  });

  it("rejects a PDF buffer", () => {
    expect(matchesDocxSignature(PDF_BYTES)).toBe(false);
  });
});

describe("matchesHwpSignature (best-effort)", () => {
  it("accepts an OLE2 compound file signature", () => {
    expect(matchesHwpSignature(OLE2_BYTES)).toBe(true);
  });

  it("accepts a ZIP container as a best-effort signal", () => {
    expect(matchesHwpSignature(buildZipWithoutDocxMarkersBuffer())).toBe(true);
  });

  it("rejects a plain text buffer", () => {
    expect(matchesHwpSignature(PLAIN_TEXT_BYTES)).toBe(false);
  });
});

describe("matchesContractFileSignature", () => {
  it("dispatches to the PDF check for application/pdf", () => {
    expect(matchesContractFileSignature("application/pdf", PDF_BYTES)).toBe(true);
    expect(matchesContractFileSignature("application/pdf", PLAIN_TEXT_BYTES)).toBe(false);
  });

  it("dispatches to the DOCX check for the OOXML MIME type", () => {
    expect(
      matchesContractFileSignature(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buildFakeDocxBuffer()
      )
    ).toBe(true);
  });

  it("dispatches to the HWP check for both accepted HWP MIME types", () => {
    expect(matchesContractFileSignature("application/x-hwp", OLE2_BYTES)).toBe(true);
    expect(matchesContractFileSignature("application/haansofthwp", OLE2_BYTES)).toBe(true);
  });

  it("returns false (never throws) for an unrecognized MIME type", () => {
    expect(matchesContractFileSignature("application/octet-stream", PDF_BYTES)).toBe(false);
  });

  it("rejects a PDF-declared upload whose bytes are actually plain text (spoofed MIME)", () => {
    expect(matchesContractFileSignature("application/pdf", PLAIN_TEXT_BYTES)).toBe(false);
  });
});
