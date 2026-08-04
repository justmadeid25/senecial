import { toSafeErrorMessage } from "./app-error";

/**
 * Uniform Server Action return shape. Never carries a stack trace or raw
 * Prisma error - only a safe message and, for form validation failures,
 * per-field messages.
 */
export type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; message: string; fieldErrors?: Record<string, string[]> };

export function actionSuccess<T>(data: T): ActionResult<T> {
  return { success: true, data };
}

export function actionError(
  message: string,
  fieldErrors?: Record<string, string[]>
): ActionResult<never> {
  return { success: false, message, fieldErrors };
}

export function toActionErrorResult(error: unknown): ActionResult<never> {
  return actionError(toSafeErrorMessage(error));
}
