import "dotenv/config";

import { getLogger } from "../src/server/logging";
import { getLawOpenDataProvider } from "../src/server/services/legal/get-law-open-data-provider";
import { createLegalGatewayServer } from "../src/server/services/legal/legal-gateway-server";

/**
 * §Phase L1.3 - a small, standalone HTTP wrapper deployed as its own
 * Railway service (Dockerfile.legal-gateway), the ONLY process intended to
 * hold LAW_OPEN_DATA_OC and call law.go.kr directly, reached only by the
 * Vercel web app's law-open-data-gateway-client-provider.ts over HTTPS
 * with a shared-secret bearer token - mirrors
 * scripts/malware-scanner-server.ts's own role/shape exactly (see that
 * file's docstring for the precedent this follows).
 *
 * All actual request handling (routing, auth, validation, provider calls)
 * lives in createLegalGatewayServer() (src/server/services/legal/
 * legal-gateway-server.ts) so it can be unit-tested with a fake provider -
 * this file is only process bootstrap: env/PORT/signal handling.
 *
 * Never logs LEGAL_GATEWAY_SHARED_SECRET or LAW_OPEN_DATA_OC.
 */

const PORT = Number(process.env.PORT ?? 8080);
const SHARED_SECRET = process.env.LEGAL_GATEWAY_SHARED_SECRET;

if (!SHARED_SECRET) {
  throw new Error("LEGAL_GATEWAY_SHARED_SECRET이 설정되지 않았습니다.");
}

const logger = getLogger();

async function main() {
  // Deliberately explicit rather than relying on getLawOpenDataProvider()'s
  // own "development" default - a Legal Gateway process silently serving
  // fixture data instead of failing loudly on misconfiguration would be a
  // far worse failure mode than refusing to start.
  if (process.env.LAW_OPEN_DATA_PROVIDER !== "http") {
    throw new Error(
      "Legal Gateway는 반드시 LAW_OPEN_DATA_PROVIDER=http로 실행해야 합니다 (development 모드로 배포할 수 없습니다)."
    );
  }
  const provider = getLawOpenDataProvider();

  const server = createLegalGatewayServer({ provider, sharedSecret: SHARED_SECRET!, logger });

  let shuttingDown = false;
  function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("legal_gateway.shutdown_requested", { signal });
    server.close(() => process.exit(0));
    // Force-exit if close() hangs (e.g. a slow in-flight upstream call).
    setTimeout(() => process.exit(0), 8_000).unref();
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  server.listen(PORT, () => {
    logger.info("legal_gateway.listening", { port: PORT });
  });
}

main().catch((error: unknown) => {
  logger.error("legal_gateway.fatal", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
