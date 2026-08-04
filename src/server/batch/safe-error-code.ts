import { AppError } from "@/lib/errors";

/** §29/§31 - never the raw exception message (which could embed row content, a file path, or other internals) - a short, safe classification only. */
export function toSafeBatchErrorCode(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }
  if (error instanceof Error) {
    return error.name || "ERROR";
  }
  return "UNKNOWN_ERROR";
}
