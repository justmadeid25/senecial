import type { z } from "zod";

/** Groups Zod issues by field path for Server Action fieldErrors. */
export function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
    (result[key] ??= []).push(issue.message);
  }

  return result;
}
