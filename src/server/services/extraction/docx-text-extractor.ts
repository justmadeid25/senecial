import JSZip from "jszip";
import mammoth from "mammoth";

import type {
  DocumentTextExtractor,
  ExtractedDocumentResult,
} from "@/domain/extraction/document-text-extractor";
import { TextExtractionFailedError, UnsupportedFormatError } from "@/domain/extraction/extraction-errors";

/**
 * Phase 14 Part 6 (security - decompression bomb) - REAL crash found and
 * fixed here: a ~1.2MB .docx whose word/document.xml decompresses to
 * ~500MB (ordinary DEFLATE, no nested-zip trickery needed - the 20MB
 * upload cap does nothing to bound the DECOMPRESSED size) crashed the
 * extraction worker process outright when mammoth.extractRawText()
 * decompressed and parsed it (reproduced live: the worker died with an
 * unhandled "Connection terminated unexpectedly" after ~40s of memory/CPU
 * pressure, leaving the job stuck in PROCESSING until stale-job recovery
 * eventually reclaimed it - a real, if recoverable, DoS).
 *
 * JSZip's `loadAsync()` only parses the ZIP's local/central-directory
 * headers (which the ZIP format itself stores each entry's declared
 * uncompressed size in) - it does NOT decompress entry contents until
 * `.async(...)` is called on a specific file, so this check is itself
 * cheap and safe to run on every upload before mammoth ever touches it.
 * `_data.uncompressedSize` is JSZip's own (intentionally undocumented -
 * see its own index.d.ts comment: "if/when made public should be
 * uncommented") but stable, widely-relied-on way to read this without
 * decompressing - there is no alternative public API for it.
 */
const MAX_DECOMPRESSED_DOCX_BYTES = 100 * 1024 * 1024; // 100MB - generous for any real contract's text content

async function assertNotDecompressionBomb(buffer: Buffer): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    // Not a well-formed ZIP at all - let mammoth's own error path handle it.
    return;
  }
  let totalUncompressed = 0;
  for (const entry of Object.values(zip.files)) {
    const data = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
    totalUncompressed += data?.uncompressedSize ?? 0;
    if (totalUncompressed > MAX_DECOMPRESSED_DOCX_BYTES) {
      throw new UnsupportedFormatError(
        "문서 파일의 압축 해제 크기가 너무 큽니다. 손상되었거나 비정상적인 파일일 수 있습니다."
      );
    }
  }
}

/**
 * mammoth's extractRawText() reads body paragraphs and table cell text in
 * document order. It does not include images, headers/footers, footnotes,
 * tracked-change detail, or formulas - see README's "DOCX 처리" section.
 */
export class DocxTextExtractor implements DocumentTextExtractor {
  supports(input: { mimeType: string; extension: string }): boolean {
    return (
      input.mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      input.extension === ".docx"
    );
  }

  async extract(input: { buffer: Buffer }): Promise<ExtractedDocumentResult> {
    await assertNotDecompressionBomb(input.buffer);

    let result;
    try {
      result = await mammoth.extractRawText({ buffer: input.buffer });
    } catch {
      throw new TextExtractionFailedError();
    }

    const warnings = result.messages
      .filter((message) => message.type === "warning" || message.type === "error")
      .map((message) => message.message);

    return {
      text: result.value,
      method: "mammoth",
      warnings,
    };
  }
}
