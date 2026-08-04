import { redactLogData } from "@/domain/logging/redact";
import type { AppLogger, SafeLogData } from "@/domain/logging/logger";

/**
 * §31 - one JSON object per line, written to stdout (info/warn) or stderr
 * (error) so log shippers (journald, a container runtime, a hosting
 * platform's log drain) can parse it as structured data instead of
 * scraping free-text messages.
 */
export class JsonConsoleLogger implements AppLogger {
  info(event: string, data?: SafeLogData): void {
    this.write("info", event, data, console.log);
  }

  warn(event: string, data?: SafeLogData): void {
    this.write("warn", event, data, console.warn);
  }

  error(event: string, data?: SafeLogData): void {
    this.write("error", event, data, console.error);
  }

  private write(
    level: "info" | "warn" | "error",
    event: string,
    data: SafeLogData | undefined,
    sink: (line: string) => void
  ): void {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...redactLogData(data),
    });
    sink(line);
  }
}
