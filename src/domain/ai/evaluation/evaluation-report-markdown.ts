import type { EvaluationReport } from "./evaluation-report";
import { evaluateReleaseGate } from "./release-gate";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function num(value: number): string {
  return value.toFixed(3);
}

/**
 * §Evaluation (Phase 12 Part L) - pure formatting, no I/O. Kept separate
 * from run-ai-evaluation.ts so the report format can be unit-tested
 * against a hand-built EvaluationReport fixture without running the real
 * pipeline.
 */
export function renderEvaluationReportMarkdown(report: EvaluationReport): string {
  const lines: string[] = [];
  lines.push("# Senecial AI 평가 리포트 (Phase 12 Part L)");
  lines.push("");
  lines.push(`- 생성 시각: ${report.generatedAt}`);
  lines.push(`- Dataset Version: ${report.datasetVersion}`);
  lines.push(`- AI Config Version: ${report.aiConfigVersion} (checksum: ${report.aiConfigChecksum})`);
  lines.push(`- Vector Search Provider: ${report.vectorSearchProvider}`);
  lines.push(`- Embedding Provider: ${report.embeddingProvider}`);
  lines.push(`- LLM Provider: ${report.llmProvider}`);
  lines.push(`- 질문 수: ${report.summary.questionCount} (Top-K = ${report.summary.topK})`);
  lines.push("");
  lines.push(
    "이 리포트는 검색(Retrieval)과 답변 생성 품질만 평가합니다. 문서 추출/조항 분해 파이프라인은 "
      + "실제 파이프라인을 통해 시딩되지만 그 자체의 정확도는 이 리포트의 평가 대상이 아닙니다."
  );
  lines.push("");

  lines.push("## 요약 지표");
  lines.push("");
  lines.push("| 지표 | 값 |");
  lines.push("| --- | --- |");
  lines.push(`| Recall@${report.summary.topK} | ${pct(report.summary.meanRecall)} |`);
  lines.push(`| Precision@${report.summary.topK} | ${pct(report.summary.meanPrecision)} |`);
  lines.push(`| MRR | ${num(report.summary.meanReciprocalRank)} |`);
  lines.push(`| NDCG@${report.summary.topK} | ${num(report.summary.meanNdcg)} |`);
  lines.push(`| Hit Rate@${report.summary.topK} | ${pct(report.summary.hitRate)} |`);
  lines.push(`| Hallucination Rate (응답해서는 안 될 때 응답한 비율) | ${pct(report.summary.hallucinationRate)} |`);
  lines.push(`| False Refusal Rate (응답 가능한데 거절한 비율) | ${pct(report.summary.falseRefusalRate)} |`);
  lines.push(`| Citation Validity Rate (모든 문단에 유효한 출처 표시가 있었던 비율) | ${pct(report.summary.citationValidityRate)} |`);
  lines.push("");

  lines.push("## 보안 검사");
  lines.push("");
  lines.push(`- Tenant Isolation (cross-org 유출): ${report.security.crossOrgLeakageDetected ? "⚠ 실패" : "정상"}`);
  lines.push(`- Risk-Language Guard: ${report.security.riskLanguageGuardViolated ? "⚠ 위반" : "정상"}`);
  lines.push(`- Prompt Injection 방어: ${report.security.promptInjectionCompromised ? "⚠ 우회됨" : "정상"}`);
  lines.push("");

  lines.push("## Release Gate (Phase 12.2 §25, Phase 12.3 §18 provider-stratified)");
  lines.push("");
  const gate = evaluateReleaseGate(report);
  lines.push(`- 적용된 baseline: ${gate.baselineUsed}`);
  lines.push(`- 판정: ${gate.passed ? "PASS" : "FAIL"}`);
  if (!gate.passed) {
    lines.push("- 위반 항목:");
    for (const violation of gate.violations) {
      lines.push(`  - \`${violation.code}\`: ${violation.message}`);
    }
  }
  lines.push("");

  lines.push("## Phrasing 유형별 False Refusal (Phase 12.3 §17)");
  lines.push("");
  lines.push("| phrasingType | 질문 수 | False Refusal 수 | 비율 |");
  lines.push("| --- | --- | --- | --- |");
  const byPhrasing = new Map<string, { total: number; falselyRefused: number }>();
  for (const q of report.perQuestion) {
    if (q.expectRefusal) continue; // offTopic fixtures are supposed to refuse - not part of this breakdown
    const entry = byPhrasing.get(q.phrasingType) ?? { total: 0, falselyRefused: 0 };
    entry.total += 1;
    if (q.falselyRefused) entry.falselyRefused += 1;
    byPhrasing.set(q.phrasingType, entry);
  }
  for (const [phrasingType, entry] of byPhrasing) {
    lines.push(`| ${phrasingType} | ${entry.total} | ${entry.falselyRefused} | ${pct(entry.total === 0 ? 0 : entry.falselyRefused / entry.total)} |`);
  }
  lines.push("");

  lines.push("## 질문별 상세");
  lines.push("");
  lines.push("| ID | 질문 | 응답 거절 예상 | 실제 거절 여부 | Recall | Precision | RR | NDCG | Hit | 결과 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const q of report.perQuestion) {
    const outcome = q.hallucinated ? "⚠ 환각" : q.falselyRefused ? "⚠ 과도한 거절" : "정상";
    lines.push(
      `| ${q.id} | ${q.question} | ${q.expectRefusal ? "예" : "아니오"} | ${q.actuallyRefused ? "예" : "아니오"} | `
        + `${pct(q.recall)} | ${pct(q.precision)} | ${num(q.reciprocalRank)} | ${num(q.ndcg)} | ${q.hit ? "O" : "X"} | ${outcome} |`
    );
  }
  lines.push("");

  return lines.join("\n");
}

export interface EvaluationComparisonEntry {
  report: EvaluationReport;
  totalElapsedMs: number;
}

/**
 * §Phase 12.1 §19 - `pnpm ai:evaluate --compare` output: the SAME golden
 * dataset, scored under each vector search provider, side by side. This
 * is what "품질 저하 시 완료 처리하지 마십시오" is actually checked against -
 * a human (or a future CI gate) reading this table can see immediately
 * whether switching to pgvector regressed any metric.
 */
export function renderEvaluationComparisonMarkdown(entries: readonly EvaluationComparisonEntry[]): string {
  const lines: string[] = [];
  lines.push("# Senecial AI 평가 비교 리포트 (Phase 12.1 §19 - provider 간 비교)");
  lines.push("");
  lines.push(`- 생성 시각: ${new Date().toISOString()}`);
  lines.push(`- Dataset Version: ${entries[0]?.report.datasetVersion ?? "(unknown)"}`);
  lines.push(`- 질문 수: ${entries[0]?.report.summary.questionCount ?? 0}`);
  lines.push("");

  const header = ["지표", ...entries.map((e) => e.report.vectorSearchProvider)];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);

  const rows: Array<[string, (entry: EvaluationComparisonEntry) => string]> = [
    ["Recall@K", (e) => pct(e.report.summary.meanRecall)],
    ["Precision@K", (e) => pct(e.report.summary.meanPrecision)],
    ["MRR", (e) => num(e.report.summary.meanReciprocalRank)],
    ["NDCG@K", (e) => num(e.report.summary.meanNdcg)],
    ["Hit Rate@K", (e) => pct(e.report.summary.hitRate)],
    ["Hallucination Rate", (e) => pct(e.report.summary.hallucinationRate)],
    ["False Refusal Rate", (e) => pct(e.report.summary.falseRefusalRate)],
    ["Citation Validity Rate", (e) => pct(e.report.summary.citationValidityRate)],
    ["Release Gate", (e) => (evaluateReleaseGate(e.report).passed ? "PASS" : "FAIL")],
    ["총 소요시간 (ms)", (e) => e.totalElapsedMs.toFixed(0)],
  ];
  for (const [label, fn] of rows) {
    lines.push(`| ${label} | ${entries.map(fn).join(" | ")} |`);
  }
  lines.push("");

  return lines.join("\n");
}
