import { describe, expect, it } from "vitest";

import {
  buildHistoryAugmentedSearchQuery,
  buildHistoryFingerprint,
  MAX_CONTEXT_TURNS,
  MAX_HISTORY_MESSAGE_CHARS,
  MAX_RETRIEVAL_HISTORY_TURNS,
  selectRecentConversationHistory,
  toLlmHistoryMessages,
  type ConversationTurn,
} from "@/domain/ai/conversation-context";

function turn(role: "USER" | "ASSISTANT", content: string): ConversationTurn {
  return { role, content };
}

describe("selectRecentConversationHistory (§AI 답변 품질 개편 P0-1)", () => {
  it("returns nothing for an empty message list", () => {
    expect(selectRecentConversationHistory([])).toEqual([]);
  });

  it("bounds to the most recent maxTurns PAIRS (2 * maxTurns messages)", () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      turn(i % 2 === 0 ? "USER" : "ASSISTANT", `message-${i}`)
    );
    const history = selectRecentConversationHistory(messages, 2);
    expect(history).toHaveLength(4);
    expect(history.map((t) => t.content)).toEqual(["message-6", "message-7", "message-8", "message-9"]);
  });

  it("defaults to MAX_CONTEXT_TURNS when no explicit bound is given", () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      turn(i % 2 === 0 ? "USER" : "ASSISTANT", `m${i}`)
    );
    expect(selectRecentConversationHistory(messages)).toHaveLength(MAX_CONTEXT_TURNS * 2);
  });

  it("truncates any single message longer than MAX_HISTORY_MESSAGE_CHARS", () => {
    const longContent = "가".repeat(MAX_HISTORY_MESSAGE_CHARS + 200);
    const history = selectRecentConversationHistory([turn("USER", longContent)], 1);
    expect(history[0]!.content.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGE_CHARS + 3); // + "..."
    expect(history[0]!.content.endsWith("...")).toBe(true);
  });

  it("tolerates a non-alternating tail (e.g. two consecutive USER messages when a prior ASSISTANT reply was never persisted after a grounding failure)", () => {
    const messages = [turn("USER", "q1"), turn("USER", "q2")];
    expect(() => selectRecentConversationHistory(messages, 2)).not.toThrow();
    expect(selectRecentConversationHistory(messages, 2).map((t) => t.content)).toEqual(["q1", "q2"]);
  });

  it("maxTurns <= 0 returns nothing", () => {
    expect(selectRecentConversationHistory([turn("USER", "q1")], 0)).toEqual([]);
  });
});

describe("buildHistoryAugmentedSearchQuery (§AI 답변 품질 개편 P0-1 - Test A scenario)", () => {
  it("returns the bare question unchanged when there is no history", () => {
    expect(buildHistoryAugmentedSearchQuery("그럼 언제까지 말해야 돼?", [])).toBe("그럼 언제까지 말해야 돼?");
  });

  it("folds the concepts from a real prior turn into the search text - the exact audit scenario", () => {
    const history: ConversationTurn[] = [
      turn("USER", "이 계약 자동갱신돼?"),
      turn("ASSISTANT", "네, 자동 갱신되는 구조입니다. 종료 30일 전까지 통지해야 합니다."),
    ];
    const searchQuery = buildHistoryAugmentedSearchQuery("그럼 언제까지 말해야 돼?", history);
    expect(searchQuery).toContain("그럼 언제까지 말해야 돼?");
    expect(searchQuery).toContain("자동갱신");
    expect(searchQuery).toContain("통지");
    expect(searchQuery).toContain("30일");
  });

  it("only folds in the most recent MAX_RETRIEVAL_HISTORY_TURNS turn(s), not the entire conversation", () => {
    const history: ConversationTurn[] = [
      turn("USER", "옛날질문키워드아리팜"),
      turn("ASSISTANT", "옛날답변키워드바나나"),
      turn("USER", "최근질문키워드체리"),
      turn("ASSISTANT", "최근답변키워드포도"),
    ];
    const searchQuery = buildHistoryAugmentedSearchQuery("후속질문", history);
    expect(searchQuery).toContain("체리");
    expect(searchQuery).toContain("포도");
    if (MAX_RETRIEVAL_HISTORY_TURNS === 1) {
      expect(searchQuery).not.toContain("아리팜");
      expect(searchQuery).not.toContain("바나나");
    }
  });
});

describe("buildHistoryFingerprint (§AI 답변 품질 개편 P0-1 - cache-safety, Test B scenario)", () => {
  it("is empty for no history", () => {
    expect(buildHistoryFingerprint([])).toBe("");
  });

  it("is deterministic - identical history produces an identical fingerprint", () => {
    const history: ConversationTurn[] = [turn("USER", "q"), turn("ASSISTANT", "a")];
    expect(buildHistoryFingerprint(history)).toBe(buildHistoryFingerprint([...history]));
  });

  it("differs for two different histories - the exact property that prevents cross-conversation cache contamination for an identical final question", () => {
    const historyA: ConversationTurn[] = [
      turn("USER", "이 계약 자동갱신돼?"),
      turn("ASSISTANT", "네, 자동 갱신됩니다."),
    ];
    const historyB: ConversationTurn[] = [
      turn("USER", "이 계약 손해배상 한도 있어?"),
      turn("ASSISTANT", "네, 배상액의 50%로 제한됩니다."),
    ];
    expect(buildHistoryFingerprint(historyA)).not.toBe(buildHistoryFingerprint(historyB));
  });

  it("is the same for two DIFFERENT conversationIds sharing identical content - identity never matters, only content", () => {
    const historyA: ConversationTurn[] = [turn("USER", "q"), turn("ASSISTANT", "a")];
    const historyB: ConversationTurn[] = [turn("USER", "q"), turn("ASSISTANT", "a")];
    expect(buildHistoryFingerprint(historyA)).toBe(buildHistoryFingerprint(historyB));
  });
});

describe("toLlmHistoryMessages", () => {
  it("maps USER/ASSISTANT roles to the LlmMessage 'user'/'assistant' roles, never 'system'", () => {
    const messages = toLlmHistoryMessages([turn("USER", "q"), turn("ASSISTANT", "a")]);
    expect(messages).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
    ]);
  });

  it("empty history maps to an empty message array", () => {
    expect(toLlmHistoryMessages([])).toEqual([]);
  });
});
