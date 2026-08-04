import type { LlmCompletionResult, LlmMessage, LlmProvider, LlmUsage } from "@/domain/ai/llm-provider";
import { buildCitationMarker } from "@/domain/ai/citation-marker";

const CITATION_BLOCK_PATTERN = /\[CITATION (\d+)\]\n조항: (.+)\n계약: (.+)\n근거: ([\s\S]+?)\n\[\/CITATION \1\]/g;

interface ParsedCitationBlock {
  clauseReference: string;
  contractTitle: string;
  evidenceText: string;
}

/** Parses back out the exact `[CITATION n]...[/CITATION n]` blocks prompt-builder.ts embeds - this is the "development" provider's real contract with that shared format, not a generic LLM capability. */
function parseCitationBlocks(userMessageContent: string): ParsedCitationBlock[] {
  const blocks: ParsedCitationBlock[] = [];
  for (const match of userMessageContent.matchAll(CITATION_BLOCK_PATTERN)) {
    blocks.push({
      clauseReference: match[2]!.trim(),
      contractTitle: match[3]!.trim(),
      evidenceText: match[4]!.trim(),
    });
  }
  return blocks;
}

function estimateTokenCount(text: string): number {
  // A rough, deterministic approximation (roughly 1 token per ~4 characters
  // for mixed Korean/English text) - real providers return an exact count
  // from their own tokenizer; this is a stand-in with the same order of
  // magnitude, good enough for cost/usage trend monitoring in development.
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * !!! DEVELOPMENT ONLY - NOT a real language model !!!
 *
 * A real (not fake/canned) implementation: it deterministically
 * transforms the citations it was actually given (parsed back out of the
 * user message prompt-builder.ts built) into a grounded, per-citation
 * paragraph answer - extractive, not generative, but genuinely derived
 * from its real input, and it genuinely satisfies
 * citation-required.ts's paragraph check because it emits the exact
 * marker format itself (see citation-marker.ts). This is what lets the
 * whole pipeline (retrieval -> prompt -> "LLM" -> hallucination guard ->
 * citation check -> streaming -> persistence) be tested end-to-end for
 * real, without a network credential - exactly the same role
 * DeterministicDevelopmentContractExtractor plays for Phase 6's
 * extraction pipeline.
 */
export class DeterministicDevelopmentLlmProvider implements LlmProvider {
  readonly providerName = "development";
  readonly modelName = "extractive-summary-v1";

  private buildAnswerText(messages: LlmMessage[]): string {
    const userMessage = messages.find((m) => m.role === "user");
    const citationBlocks = userMessage ? parseCitationBlocks(userMessage.content) : [];

    if (citationBlocks.length === 0) {
      return "제공된 근거가 없어 답변할 수 없습니다. 관련 조항을 찾지 못했습니다.";
    }

    return citationBlocks
      .map((block) => {
        const marker = buildCitationMarker(block);
        return `${block.contractTitle}의 ${block.clauseReference}에 따르면, "${block.evidenceText}" ${marker}`;
      })
      .join("\n\n");
  }

  async generateCompletion(messages: LlmMessage[]): Promise<LlmCompletionResult> {
    const text = this.buildAnswerText(messages);
    const promptTokens = estimateTokenCount(messages.map((m) => m.content).join("\n"));
    const completionTokens = estimateTokenCount(text);
    const usage: LlmUsage = { promptTokens, completionTokens };
    return { text, usage };
  }

  async *streamCompletion(messages: LlmMessage[]): AsyncIterable<string> {
    const text = this.buildAnswerText(messages);
    // Real streaming - yields multiple chunks over several ticks of the
    // event loop (never one single chunk), so downstream streaming
    // plumbing (the /ai Route Handler, the browser's ReadableStream
    // consumer) is genuinely exercised, not just plumbing that happens to
    // work because everything arrives in one piece.
    const CHUNK_SIZE = 24;
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      yield text.slice(i, i + CHUNK_SIZE);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}
