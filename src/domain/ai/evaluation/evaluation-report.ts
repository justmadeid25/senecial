/** §Evaluation (Phase 12 Part L, extended Phase 12.1 §19) - report shape shared between the runner (features/ai/server/run-ai-evaluation.ts) and the pure Markdown renderer (evaluation-report-markdown.ts). Lives in the domain layer since it carries no I/O. */
export interface PerQuestionEvaluationResult {
  id: string;
  question: string;
  expectRefusal: boolean;
  /** §Phase 12.3 Part E (§17) - see golden-dataset.ts's QuestionPhrasingType - lets a false-refusal failure be attributed to a specific phrasing category instead of one opaque rate. */
  phrasingType: string;
  relevantClauseCount: number;
  retrievedCount: number;
  recall: number;
  precision: number;
  reciprocalRank: number;
  ndcg: number;
  hit: boolean;
  actuallyRefused: boolean;
  hallucinated: boolean;
  falselyRefused: boolean;
  /** False only if assertEveryParagraphHasCitation() rejected the answer (caught, not thrown - see run-ai-evaluation.ts) - a real, if rare in practice, failure mode distinct from hallucination/false-refusal. */
  citationValid: boolean;
}

export interface EvaluationSummary {
  questionCount: number;
  topK: number;
  meanRecall: number;
  meanPrecision: number;
  meanReciprocalRank: number;
  meanNdcg: number;
  hitRate: number;
  hallucinationRate: number;
  falseRefusalRate: number;
  citationValidityRate: number;
}

/**
 * §Phase 12.2 Part D (§25) - security-invariant checks run once per
 * evaluation, alongside (not folded into) the per-question IR/quality
 * metrics above: these are pass/fail security properties, not something a
 * mean/rate makes sense for. See run-ai-evaluation.ts for how each is
 * computed.
 */
export interface EvaluationSecurityChecks {
  /** True if a decoy second organization's clause ever appeared in the primary organization's search results. */
  crossOrgLeakageDetected: boolean;
  /** True if ANY answer (not just isPromptInjectionProbe questions) contained banned risk-judgment language (ai-review-guard.ts). */
  riskLanguageGuardViolated: boolean;
  /** True if any isPromptInjectionProbe question's answer complied with the injected instruction (i.e. tripped riskLanguageGuardViolated specifically for that question). */
  promptInjectionCompromised: boolean;
}

export interface EvaluationReport {
  generatedAt: string;
  /** §Phase 12.2 Part D (§27) - GOLDEN_DATASET_VERSION that produced this report - see golden-dataset.ts. */
  datasetVersion: string;
  /** §Phase 12.2 Part C (§21) - the AiRuntimeConfiguration.version/checksum active when this report was generated. */
  aiConfigVersion: string;
  aiConfigChecksum: string;
  vectorSearchProvider: string;
  embeddingProvider: string;
  llmProvider: string;
  summary: EvaluationSummary;
  security: EvaluationSecurityChecks;
  perQuestion: PerQuestionEvaluationResult[];
}
