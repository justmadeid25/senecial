import type { LlmProvider } from "@/domain/ai/llm-provider";

import { DeterministicDevelopmentLlmProvider } from "./deterministic-development-llm-provider";
import { AnthropicLlmProvider } from "./providers/anthropic-llm-provider";
import { GeminiLlmProvider } from "./providers/gemini-llm-provider";
import { OpenAiCompatibleLlmProvider } from "./providers/openai-compatible-llm-provider";

let cachedProvider: LlmProvider | undefined;

/**
 * Returns the configured LLM provider. `AI_LLM_PROVIDER=development` (the
 * default) is the real (not fake/canned) extractive Development provider -
 * not a trained language model - and is refused in production unless
 * explicitly overridden, mirroring getEmbeddingProvider()'s identical
 * pattern.
 *
 * §Provider (Part N) - openai/azure-openai/ollama all reuse the same
 * OpenAiCompatibleLlmProvider class (see that file's docstring for why);
 * anthropic/gemini get their own classes. None of the five real providers
 * has been live-network-verified in this session (no API key/local Ollama
 * available in this sandbox) - see docs/operations/ai-platform.md.
 */
export function getLlmProvider(): LlmProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const driver = process.env.AI_LLM_PROVIDER ?? "development";

  switch (driver) {
    case "development": {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEVELOPMENT_AI_PROVIDER !== "true") {
        throw new Error(
          "AI_LLM_PROVIDER=development은 운영 환경에서 사용할 수 없습니다. 실제 LLM 공급자를 연동하거나, " +
            "위험을 감수하고 명시적으로 ALLOW_DEVELOPMENT_AI_PROVIDER=true를 설정하십시오."
        );
      }
      cachedProvider = new DeterministicDevelopmentLlmProvider();
      return cachedProvider;
    }
    case "openai": {
      const apiKey = requireEnv("OPENAI_API_KEY");
      const model = process.env.AI_LLM_MODEL ?? "gpt-4o-mini";
      cachedProvider = new OpenAiCompatibleLlmProvider("openai", model, {
        baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        apiKey,
        authHeaderStyle: "bearer",
      });
      return cachedProvider;
    }
    case "azure-openai": {
      const apiKey = requireEnv("AZURE_OPENAI_API_KEY");
      const baseUrl = requireEnv("AZURE_OPENAI_ENDPOINT");
      const deployment = requireEnv("AZURE_OPENAI_DEPLOYMENT");
      cachedProvider = new OpenAiCompatibleLlmProvider("azure-openai", deployment, {
        baseUrl: `${baseUrl.replace(/\/$/, "")}/openai/deployments/${deployment}`,
        apiKey,
        authHeaderStyle: "api-key",
        extraQueryParams: { "api-version": process.env.AZURE_OPENAI_API_VERSION ?? "2024-06-01" },
      });
      return cachedProvider;
    }
    case "ollama": {
      const model = process.env.AI_LLM_MODEL ?? "llama3";
      cachedProvider = new OpenAiCompatibleLlmProvider("ollama", model, {
        baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
        // Ollama's OpenAI-compatible endpoint typically needs no key at all for a local instance.
        apiKey: process.env.OLLAMA_API_KEY,
        authHeaderStyle: "bearer",
      });
      return cachedProvider;
    }
    case "anthropic": {
      const apiKey = requireEnv("ANTHROPIC_API_KEY");
      const model = process.env.AI_LLM_MODEL ?? "claude-sonnet-5";
      cachedProvider = new AnthropicLlmProvider(model, { apiKey });
      return cachedProvider;
    }
    case "gemini": {
      const apiKey = requireEnv("GEMINI_API_KEY");
      const model = process.env.AI_LLM_MODEL ?? "gemini-2.0-flash";
      cachedProvider = new GeminiLlmProvider(model, { apiKey });
      return cachedProvider;
    }
    default:
      throw new Error(`지원하지 않는 AI_LLM_PROVIDER 입니다: ${driver}`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`AI_LLM_PROVIDER 설정에 필요한 환경변수 ${name}이(가) 설정되지 않았습니다.`);
  }
  return value;
}
