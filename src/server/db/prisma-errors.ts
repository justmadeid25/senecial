import { Prisma } from "@/generated/prisma/client";

interface DriverAdapterConstraintMeta {
  driverAdapterError?: {
    cause?: {
      constraint?: {
        fields?: unknown;
      };
    };
  };
}

/**
 * With the traditional (binary-engine) Prisma client, a P2002 error's
 * `meta.target` is a plain string[] of the violated field names. With the
 * `@prisma/adapter-pg` driver adapter (used throughout this project - see
 * src/server/db/client.ts), Postgres's own constraint field names instead
 * show up nested and quote-wrapped under
 * `meta.driverAdapterError.cause.constraint.fields`. Both shapes are
 * checked here so unique-constraint detection works regardless of which
 * path produced the error.
 */
function extractDriverAdapterFields(meta: unknown): string[] {
  if (!meta || typeof meta !== "object") {
    return [];
  }
  const fields = (meta as DriverAdapterConstraintMeta).driverAdapterError?.cause?.constraint?.fields;
  if (!Array.isArray(fields)) {
    return [];
  }
  return fields
    .filter((field): field is string => typeof field === "string")
    .map((field) => field.replace(/"/g, ""));
}

export function isUniqueConstraintViolation(
  error: unknown,
  field: string
): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const target = error.meta?.target;
  if (Array.isArray(target) && target.includes(field)) {
    return true;
  }

  return extractDriverAdapterFields(error.meta).includes(field);
}
