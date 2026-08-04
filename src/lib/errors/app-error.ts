/**
 * Base error type for expected, user-facing failures.
 *
 * `message` here is safe to show to end users. Anything that must not be
 * exposed (stack traces, DB errors, internal details) should be logged
 * separately and never attached to this error's message.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "요청한 리소스를 찾을 수 없습니다.") {
    super("NOT_FOUND", message, 404);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "이 작업을 수행할 권한이 없습니다.") {
    super("FORBIDDEN", message, 403);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "입력값이 올바르지 않습니다.") {
    super("VALIDATION_ERROR", message, 422);
    this.name = "ValidationError";
  }
}

export class NotImplementedError extends AppError {
  constructor(message = "아직 지원하지 않는 기능입니다.") {
    super("NOT_IMPLEMENTED", message, 501);
    this.name = "NotImplementedError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "로그인이 필요합니다.") {
    super("UNAUTHORIZED", message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "이미 사용 중인 정보입니다.") {
    super("CONFLICT", message, 409);
    this.name = "ConflictError";
  }
}

export interface RateLimitErrorOptions {
  message?: string;
  /** The budget that was exhausted - undefined when not known/applicable (e.g. a caller that only has resetAt). Surfaced as the `RateLimit-Limit` header on Route Handlers. */
  limit?: number;
  /** Always 0 in practice (this is only ever thrown when a consume() reported `allowed: false`), kept explicit rather than hardcoded so a future caller with different semantics is not forced to lie. Surfaced as `RateLimit-Remaining`. */
  remaining?: number;
}

export class RateLimitError extends AppError {
  readonly resetAt: Date;
  readonly limit?: number;
  readonly remaining?: number;

  constructor(resetAt: Date, options: RateLimitErrorOptions = {}) {
    super("RATE_LIMITED", options.message ?? "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429);
    this.name = "RateLimitError";
    this.resetAt = resetAt;
    this.limit = options.limit;
    this.remaining = options.remaining;
  }
}

/**
 * Converts any thrown value into a message safe to return to the client.
 * Unknown/internal errors are collapsed into a generic message so stack
 * traces and internal details never reach the user.
 */
export function toSafeErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }
  return "요청을 처리하는 중 오류가 발생했습니다.";
}
