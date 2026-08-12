"use client";

import { useEffect, useState } from "react";

/**
 * §Phase 14.3 §3/§9 - the "Living Contract" hero visualization. A raw
 * contract sentence is highlighted, lifts into a structured clause, a
 * question appears, an AI answer cites the clause, and the citation
 * connects back to the original sentence - one calm, deterministic loop
 * that IS the product's actual capability (retrieval -> answer ->
 * citation), never an abstract orb/particle effect. 100% synthetic,
 * hardcoded demo content - no backend call, no real customer data (§9).
 *
 * §12 - `prefers-reduced-motion` stops the auto-advancing loop entirely
 * and renders the final, fully-connected state directly - the same
 * information (raw text -> clause -> question -> answer -> citation),
 * just without the timed transition between steps.
 */

const CONTRACT_LINES = [
  "제 7 조 (계약 기간 및 갱신)",
  "본 계약의 유효기간은 계약 체결일로부터 1년으로 하며,",
  "계약 만료 30일 전까지 서면 통지가 없는 한",
  "동일한 조건으로 자동 갱신된다.",
];
const HIGHLIGHT_LINE_INDEX = 2;

const QUESTION = "이 계약에 자동 갱신 조항이 있나요?";
const ANSWER_PREFIX = "네, 있습니다. 만료 30일 전까지 서면 통지가 없으면 자동으로 갱신됩니다.";
const CITATION_LABEL = "제7조";

type Phase = "read" | "highlight" | "extract" | "ask" | "answer" | "connect";
const PHASE_SEQUENCE: Phase[] = ["read", "highlight", "extract", "ask", "answer", "connect"];
const PHASE_DURATIONS_MS: Record<Phase, number> = {
  read: 1400,
  highlight: 1200,
  extract: 1400,
  ask: 1300,
  answer: 1800,
  connect: 2600,
};

function usePrefersReducedMotion(): boolean {
  // Lazy initializer reads the real value on first render (client-only -
  // `window` is unavailable during SSR, so this stays `false` until
  // hydration, same as the effect-based approach would, but without
  // setState-in-effect's extra render pass).
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);
  return reduced;
}

export function ContractIntelligenceVisual() {
  const reducedMotion = usePrefersReducedMotion();
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const currentPhase = PHASE_SEQUENCE[phaseIndex]!;
    const timer = setTimeout(() => {
      setPhaseIndex((index) => (index + 1) % PHASE_SEQUENCE.length);
    }, PHASE_DURATIONS_MS[currentPhase]);
    return () => clearTimeout(timer);
  }, [phaseIndex, reducedMotion]);

  const phase = reducedMotion ? "connect" : PHASE_SEQUENCE[phaseIndex]!;
  const showClause = phase === "extract" || phase === "ask" || phase === "answer" || phase === "connect";
  const showQuestion = phase === "ask" || phase === "answer" || phase === "connect";
  const showAnswer = phase === "answer" || phase === "connect";
  const connecting = phase === "connect";

  return (
    <div
      className="relative w-full max-w-md rounded-2xl border border-border bg-card/80 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_40px_-24px_rgba(20,20,60,0.25)] backdrop-blur-sm"
      aria-hidden="true"
    >
      {/* Raw contract document */}
      <div className="rounded-lg border border-border/70 bg-background p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="mb-2 text-[0.65rem] font-medium tracking-wide text-muted-foreground/70 uppercase">계약 원문</p>
        {CONTRACT_LINES.map((line, index) => (
          <p
            key={index}
            className="transition-colors duration-[--duration-layout] ease-[--ease-standard]"
            style={
              index === HIGHLIGHT_LINE_INDEX && (phase === "highlight" || showClause)
                ? {
                    backgroundColor: connecting || phase === "extract" || showAnswer
                      ? "color-mix(in oklch, var(--primary), transparent 88%)"
                      : "color-mix(in oklch, var(--primary), transparent 80%)",
                    borderRadius: "0.25rem",
                    color: "var(--foreground)",
                    fontWeight: 500,
                  }
                : undefined
            }
          >
            {line}
          </p>
        ))}
      </div>

      {/* Extracted clause card */}
      <div
        className="mt-3 origin-top transition-all ease-[--ease-emphasized]"
        style={{
          transitionDuration: "var(--duration-layout)",
          opacity: showClause ? 1 : 0,
          transform: showClause ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.97)",
          maxHeight: showClause ? "80px" : "0px",
          pointerEvents: showClause ? "auto" : "none",
          overflow: "hidden",
        }}
      >
        <div className="flex items-start gap-2 rounded-lg border border-primary/25 bg-accent/60 p-3">
          <span className="mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full bg-primary/15 px-2 text-[0.65rem] font-semibold text-primary">
            {CITATION_LABEL}
          </span>
          <p className="text-xs leading-relaxed text-accent-foreground">
            만료 30일 전까지 서면 통지가 없는 한 자동 갱신된다.
          </p>
        </div>
      </div>

      {/* Question + answer */}
      <div className="mt-3 space-y-2">
        <div
          className="flex justify-end transition-all ease-[--ease-standard]"
          style={{
            transitionDuration: "var(--duration-component)",
            opacity: showQuestion ? 1 : 0,
            transform: showQuestion ? "translateY(0)" : "translateY(6px)",
          }}
        >
          <div className="rounded-2xl rounded-tr-sm bg-primary px-3 py-1.5 text-xs text-primary-foreground">
            {QUESTION}
          </div>
        </div>

        <div
          className="transition-all ease-[--ease-standard]"
          style={{
            transitionDuration: "var(--duration-component)",
            opacity: showAnswer ? 1 : 0,
            transform: showAnswer ? "translateY(0)" : "translateY(6px)",
          }}
        >
          <div className="rounded-2xl rounded-tl-sm border border-border bg-background px-3 py-2 text-xs leading-relaxed text-foreground">
            <span>{ANSWER_PREFIX}</span>{" "}
            <span
              className="relative inline-flex cursor-default items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-primary transition-transform ease-[--ease-emphasized]"
              style={{
                transitionDuration: "var(--duration-component)",
                transform: connecting ? "scale(1.08)" : "scale(1)",
                boxShadow: connecting ? "0 0 0 3px color-mix(in oklch, var(--primary), transparent 82%)" : "none",
              }}
            >
              [{CITATION_LABEL}]
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
