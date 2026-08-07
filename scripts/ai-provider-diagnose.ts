import "dotenv/config";

import { assertPaidProviderCliApproved, isPaidProviderCliApproved } from "../src/domain/ai/paid-provider-guard";
import { diagnoseAiProviders } from "../src/features/ai/server/diagnose-ai-providers";

function parseArgs() {
  const args = process.argv.slice(2);
  // §Phase 13.2 - ALLOW_PAID_AI_CALLS=true is an equivalent approval
  // signal to --execute (see src/domain/ai/paid-provider-guard.ts).
  return { execute: isPaidProviderCliApproved(args.includes("--execute")) };
}

/**
 * §Phase 13 Part J (§37) - `pnpm ai:provider-diagnose [--execute]`. Without
 * --execute, only reports CONFIG (provider/model/dimension resolved from
 * env - no network call, safe to run anywhere including CI without
 * credentials). With --execute, additionally makes real (small,
 * non-sensitive, synthetic) probe calls: embedding generation, LLM
 * completion, LLM streaming, and prints usage/latency/circuit-breaker
 * state. Never uses real contract data. Exits non-zero only when --execute
 * was requested and a configured provider's probe failed - a provider
 * simply not being configured (development-only environment) is not
 * treated as a failure.
 */
async function main() {
  const { execute } = parseArgs();
  console.log(`AI provider 진단 시작${execute ? " (--execute: 실제 provider 호출 포함)" : " (dry-run: 설정만 확인, 실제 호출 없음)"}...`);

  // §Phase 13.2 - last line of defense, immediately before the actual paid
  // trigger (diagnoseAiProviders only makes real calls when execute=true).
  if (execute) {
    assertPaidProviderCliApproved({ operation: "ai:provider-diagnose", execute });
  }

  const result = await diagnoseAiProviders({ execute });

  console.log("\n[Embedding Provider]");
  if (!result.embedding.configured) {
    console.log(`  설정되지 않음: ${result.embedding.configError}`);
  } else {
    console.log(`  provider=${result.embedding.providerName} model=${result.embedding.modelName} dimension=${result.embedding.dimension}`);
    if (result.embedding.probe) {
      const p = result.embedding.probe;
      console.log(
        p.ok
          ? `  probe: OK (${p.latencyMs}ms, inputTokens=${p.inputTokens ?? "N/A"}, dimensionMatches=${p.dimensionMatches})`
          : `  probe: FAIL (${p.errorCode}, ${p.latencyMs}ms)`
      );
    }
  }

  console.log("\n[LLM Provider]");
  if (!result.llm.configured) {
    console.log(`  설정되지 않음: ${result.llm.configError}`);
  } else {
    console.log(`  provider=${result.llm.providerName} model=${result.llm.modelName}`);
    if (result.llm.completionProbe) {
      const p = result.llm.completionProbe;
      console.log(
        p.ok
          ? `  completion probe: OK (${p.latencyMs}ms, inputTokens=${p.inputTokens}, outputTokens=${p.outputTokens})`
          : `  completion probe: FAIL (${p.errorCode}, ${p.latencyMs}ms)`
      );
    }
    if (result.llm.streamingProbe) {
      const p = result.llm.streamingProbe;
      console.log(
        p.ok
          ? `  streaming probe: OK (chunks=${p.chunkCount}, first-token=${p.firstTokenLatencyMs}ms, total=${p.totalLatencyMs}ms, usage event=${p.receivedUsageEvent}, request-id=${p.providerRequestId ?? "N/A"})`
          : `  streaming probe: FAIL (${p.errorCode})`
      );
    }
    if (result.llm.abortProbe) {
      const p = result.llm.abortProbe;
      console.log(
        p.ok
          ? `  abort probe: delta received=${p.receivedAnyDeltaBeforeAbort}, abort propagated as error=${p.abortHonoredAsError}`
          : `  abort probe: FAIL (${p.errorCode})`
      );
    }
  }

  console.log("\n[Circuit Breaker State]");
  console.log(`  embedding=${result.circuitBreakerStates.embedding ?? "N/A"} llm=${result.circuitBreakerStates.llm ?? "N/A"}`);

  if (execute) {
    const embeddingFailed = result.embedding.configured && result.embedding.probe && !result.embedding.probe.ok;
    const llmFailed =
      result.llm.configured &&
      ((result.llm.completionProbe && !result.llm.completionProbe.ok) || (result.llm.streamingProbe && !result.llm.streamingProbe.ok));
    if (embeddingFailed || llmFailed) {
      process.exitCode = 1;
    }
  }
}

main().catch((error: unknown) => {
  console.error("AI provider 진단 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
