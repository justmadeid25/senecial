import type { Citation } from "./citation";

/**
 * §AI 답변 품질 개편 Phase 1.4.3 - a real-model, prompt-only attempt to fix
 * broad-answer prioritization (Phase 1.4.2's comprehensiveRules rewrite)
 * measurably failed twice against the SAME real-OpenAI q14 case ("내 입장에서
 * 이상한 조건 있어?") - the model kept treating ordinary confidentiality/
 * assignment-restriction clauses the same as genuinely material ones, kept
 * inventorying instead of prioritizing, and kept restating the same issues
 * across intro/body/conclusion. Prose instructions alone cannot GUARANTEE
 * this; only a structural reduction of what the model is even shown can.
 *
 * This module is that structural layer: a deterministic, keyword-pattern
 * classifier that (1) buckets each retrieved citation into a coarse
 * "issue category" (a handful of material risk categories vs. a handful
 * of ordinary/boilerplate categories), (2) GROUPS citations sharing the
 * same category into one issue (so Article 3 + Article 4 both being about
 * termination/penalty count as ONE issue, never two), (3) ranks groups
 * material-first, and (4) selects a bounded number of groups (4 by
 * default, adjustable by an explicit user-requested count, bypassed
 * entirely by an explicit exhaustive-review request). The caller (see
 * ask-question.ts) then passes ONLY the selected groups' citations into
 * the synthesis prompt for evaluative comprehensive questions - the model
 * physically cannot inventory what it was never shown, which is the one
 * guarantee prose alone could never provide.
 *
 * Deliberately NOT a semantic/embedding classifier and NOT a database
 * lookup against ContractClause.suggestedClauseType (the existing
 * classifier family-sample-repository.ts already reuses for a DIFFERENT
 * purpose - broadening RETRIEVAL, not narrowing SYNTHESIS) - this module
 * only ever reads the `evidenceText`/`clauseReference` already sitting on
 * an already-retrieved Citation, so it adds no new DB round trip and never
 * touches retrieval itself. Purely a synthesis-shaping step downstream of
 * an unchanged retrieval/guard/budget pipeline.
 */

/** Bump if the category table, grouping rule, or selection algorithm changes shape in a way that could plausibly change which issues get selected. Not currently wired into any cache key - selection is deterministic and reproduced fresh from already-final `contextCitations` on every call, nothing here is itself cached. */
export const BROAD_ISSUE_SELECTION_VERSION = "v1";

export type IssueTier = "material" | "neutral" | "boilerplate";

export type IssueCategory =
  | "termination_penalty"
  | "payment_delay_interest"
  | "auto_renewal"
  | "liability_cap"
  | "indemnity_damages"
  | "unilateral_right"
  | "exclusivity_noncompete"
  | "ip_ownership"
  | "survival_duration"
  | "governing_law_venue"
  | "boilerplate_confidentiality"
  | "boilerplate_assignment"
  | "boilerplate_notice"
  | "boilerplate_general"
  | "other";

interface CategoryRule {
  category: IssueCategory;
  tier: IssueTier;
  patterns: readonly RegExp[];
}

/**
 * §Requirement 3/4 - material categories are checked BEFORE boilerplate
 * ones (see classifyCitationIssue() below), so a clause that is
 * NOMINALLY a boilerplate type (confidentiality, assignment, notice) but
 * whose own evidence text ALSO contains a concrete material signal (an
 * amount, an unusual survival period, a one-sided consent rule) is
 * classified by that material signal instead - the override the task
 * explicitly asks for ("unless the clause contains a concrete unusual
 * burden"). Order within each tier does not matter (classification uses
 * the FIRST array-order match only within a tier, checked material-tier
 * first); ties in real data are rare since these patterns target
 * genuinely distinct vocabulary.
 */
const CATEGORY_RULES: readonly CategoryRule[] = [
  // --- material (checked first) ---
  { category: "termination_penalty", tier: "material", patterns: [/해지/, /위약금/, /지체상금/, /위약벌/] },
  // §Fixed via this module's own test suite - the original /대금.*지급/,
  // /지급.*대금/ wildcard patterns also matched 제11조's liability-cap
  // formula ("발주자가 수행자에게 지급한 총 대금의 범위 내로 제한된다" -
  // "대금"/"지급" appear together there purely as a REFERENCE POINT for
  // the cap, not a payment obligation) since it's checked before
  // liability_cap in array order. "지급하여야"/"지급기한" require the
  // actual OBLIGATORY-payment phrasing, narrow enough to exclude that.
  { category: "payment_delay_interest", tier: "material", patterns: [/지연이자/, /연체/, /지연손해금/, /지급기한/, /지급하여야/] },
  { category: "auto_renewal", tier: "material", patterns: [/자동\s*(연장|갱신)/] },
  { category: "liability_cap", tier: "material", patterns: [/책임.*제한/, /배상액.*제한/, /한도/] },
  { category: "indemnity_damages", tier: "material", patterns: [/손해배상/, /배상책임/, /면책/] },
  { category: "unilateral_right", tier: "material", patterns: [/일방적으로/, /단독으로/, /사전\s*통지\s*없이/, /임의로/] },
  { category: "exclusivity_noncompete", tier: "material", patterns: [/독점/, /경업금지/, /동종업계/, /경쟁금지/] },
  { category: "ip_ownership", tier: "material", patterns: [/지식재산권/, /저작권/, /특허/] },
  { category: "survival_duration", tier: "material", patterns: [/종료\s*후.*\d+\s*년/, /존속/] },
  // --- neutral (checked after material, before boilerplate) ---
  { category: "governing_law_venue", tier: "neutral", patterns: [/준거법/, /관할/] },
  // --- boilerplate (checked last - only reached if no material/neutral pattern matched) ---
  // §Fixed via this module's own test suite - the article TITLE says
  // "비밀유지" but the clause's own EVIDENCE TEXT (the quoted sentence
  // actually classified here) typically says "영업상 비밀"/"비밀 정보",
  // never the compound "비밀유지" itself - matching bare "비밀" is what
  // actually catches real confidentiality clause text.
  { category: "boilerplate_confidentiality", tier: "boilerplate", patterns: [/비밀/, /기밀/] },
  { category: "boilerplate_assignment", tier: "boilerplate", patterns: [/양도/] },
  { category: "boilerplate_notice", tier: "boilerplate", patterns: [/통지/] },
  { category: "boilerplate_general", tier: "boilerplate", patterns: [/목적/, /정의/, /협조/, /완전합의/] },
];

const TIER_RANK: Record<IssueTier, number> = { material: 2, neutral: 1, boilerplate: 0 };

export interface ClassifiedCitation {
  citation: Citation;
  category: IssueCategory;
  tier: IssueTier;
}

/**
 * Classifies ONE citation's evidence text (+ its clauseReference, which
 * for a chunk citation often carries the article's own heading, e.g.
 * "제7조(납품 및 검수)") against CATEGORY_RULES, material tier first. Never
 * throws; a citation matching nothing becomes "other" (neutral-ranked
 * alongside governing_law_venue - selectable, but never preferred over a
 * real material signal).
 */
export function classifyCitationIssue(citation: Citation): ClassifiedCitation {
  const haystack = `${citation.clauseReference} ${citation.evidenceText}`;
  for (const tier of ["material", "neutral", "boilerplate"] as const) {
    for (const rule of CATEGORY_RULES) {
      if (rule.tier !== tier) continue;
      if (rule.patterns.some((pattern) => pattern.test(haystack))) {
        return { citation, category: rule.category, tier: rule.tier };
      }
    }
  }
  return { citation, category: "other", tier: "neutral" };
}

export interface IssueGroup {
  category: IssueCategory;
  tier: IssueTier;
  citations: Citation[];
  /** The highest score among this group's own citations - used for ranking groups within the same tier, never compared across tiers (tier always dominates). */
  maxScore: number;
}

/**
 * §Requirement 5 - groups citations sharing the SAME issue category into
 * ONE IssueGroup, so "Article 3 (해지) + Article 4 (중도해지/위약금)" - both
 * classified `termination_penalty` - count as one issue, never two. Order
 * of the returned groups is NOT the selection order (see
 * selectBroadIssueCandidates() for ranking) - this function only groups.
 */
export function groupCitationsByIssue(citations: readonly Citation[]): IssueGroup[] {
  const groups = new Map<IssueCategory, IssueGroup>();
  for (const citation of citations) {
    const classified = classifyCitationIssue(citation);
    const existing = groups.get(classified.category);
    if (existing) {
      existing.citations.push(citation);
      existing.maxScore = Math.max(existing.maxScore, citation.score);
    } else {
      groups.set(classified.category, {
        category: classified.category,
        tier: classified.tier,
        citations: [citation],
        maxScore: citation.score,
      });
    }
  }
  return [...groups.values()];
}

/** §Requirement 2 - the default cap on selected issue GROUPS (not raw citation count) for an evaluative comprehensive question with no explicit count and no exhaustive-review request. */
export const DEFAULT_MAX_ISSUE_GROUPS = 4;

/** A safe upper bound on an explicit user-requested count - prevents "20개 알려줘" from defeating prioritization entirely while still respecting a reasonable explicit ask (requirement 2's "higher... within a safe bound"). */
export const MAX_SAFE_REQUESTED_ISSUE_GROUPS = 8;

const EXHAUSTIVE_REVIEW_PATTERN = /전체|빠짐없이|모든\s*조항|모두\s*(검토|알려|보여)|전수/;
const EXPLICIT_COUNT_PATTERN = /(\d+)\s*개/;

/** §Requirement 2 - an explicit "전체 검토해줘"/"빠짐없이 알려줘"-style request bypasses the selection cap entirely (see selectBroadIssueCandidates()). Deliberately narrower than question-complexity.ts's own COMPREHENSIVE_SIGNAL_KEYWORDS (which only decides focused-vs-comprehensive, a different concern this module never touches) - only phrases that specifically ask for an EXHAUSTIVE, not just broad, review count here. */
export function isExhaustiveReviewRequest(question: string): boolean {
  return EXHAUSTIVE_REVIEW_PATTERN.test(question);
}

/** §Requirement 2 - parses a "3개만"/"5개까지"-style explicit count, bounded to [1, MAX_SAFE_REQUESTED_ISSUE_GROUPS]. Returns null when the question names no explicit count (the caller then falls back to DEFAULT_MAX_ISSUE_GROUPS). */
export function parseExplicitRequestedIssueCount(question: string): number | null {
  const match = question.match(EXPLICIT_COUNT_PATTERN);
  if (!match) return null;
  const requested = Number(match[1]);
  if (!Number.isInteger(requested) || requested < 1) return null;
  return Math.min(requested, MAX_SAFE_REQUESTED_ISSUE_GROUPS);
}

export interface BroadIssueSelectionResult {
  /** The flattened citations from every SELECTED group, in group-then-score order - this, not the original `citations` input, is what a caller should pass into buildPromptMessages() for an evaluative comprehensive question. */
  selectedCitations: Citation[];
  /** All groups that were formed, selected or not - useful for logging/tests, never sent to the LLM itself. */
  allGroups: IssueGroup[];
  /** The subsequence of allGroups that was actually selected, already in final rank order. */
  selectedGroups: IssueGroup[];
  /** True when isExhaustiveReviewRequest() bypassed the cap - selectedCitations equals the full input set in that case (still grouped/deduped, never re-ordered destructively). */
  exhaustive: boolean;
}

/**
 * §Requirements 1-6 - the main entry point. Groups `citations` by issue
 * (groupCitationsByIssue()), ranks groups (material tier first, then
 * neutral, then boilerplate - a real material signal ALWAYS outranks a
 * boilerplate one regardless of citation score; within the same tier,
 * higher maxScore first), and selects the top N groups where N is:
 * `parseExplicitRequestedIssueCount(question) ?? DEFAULT_MAX_ISSUE_GROUPS`
 * - unless `isExhaustiveReviewRequest(question)` is true, in which case
 * every group is selected (the cap never applies to an explicit
 * exhaustive-review request, per requirement 2's own bypass clause).
 *
 * Never invents a citation - every returned citation is a real object
 * from the `citations` input (requirement 7); this function performs pure
 * selection/grouping only. Existing citation-marker validation and
 * answer-used-citation filtering (citation-required.ts /
 * answer-used-citations.ts) remain the sole, unchanged authority on what
 * is safe to render - this module runs strictly BEFORE the prompt is even
 * built, entirely independent of that downstream validation.
 */
export function selectBroadIssueCandidates(params: {
  question: string;
  citations: readonly Citation[];
}): BroadIssueSelectionResult {
  const allGroups = groupCitationsByIssue(params.citations);
  const ranked = [...allGroups].sort((a, b) => {
    const tierDiff = TIER_RANK[b.tier] - TIER_RANK[a.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.maxScore - a.maxScore;
  });

  if (isExhaustiveReviewRequest(params.question)) {
    return {
      selectedCitations: ranked.flatMap((g) => g.citations),
      allGroups,
      selectedGroups: ranked,
      exhaustive: true,
    };
  }

  const maxGroups = parseExplicitRequestedIssueCount(params.question) ?? DEFAULT_MAX_ISSUE_GROUPS;
  const selectedGroups = ranked.slice(0, maxGroups);
  return {
    selectedCitations: selectedGroups.flatMap((g) => g.citations),
    allGroups,
    selectedGroups,
    exhaustive: false,
  };
}
