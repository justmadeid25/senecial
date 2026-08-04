import type { AppLogger } from "@/domain/logging/logger";

import { JsonConsoleLogger } from "./json-console-logger";

let cachedLogger: AppLogger | undefined;

/** No driver switch/production guard here unlike the other getX() factories in this codebase - structured JSON-to-stdout is already the correct behavior in every environment (dev included; a JSON line is still readable), so there is nothing unsafe to guard against. */
export function getLogger(): AppLogger {
  if (!cachedLogger) {
    cachedLogger = new JsonConsoleLogger();
  }
  return cachedLogger;
}
