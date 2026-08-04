/**
 * Phase 11 Part B - Next.js awaits `register()` before serving any request
 * (https://nextjs.org/docs/app/guides/instrumentation), which makes this
 * the correct (and only reliable) place to reject server startup outright
 * on a bad production config - a Route Handler/Server Action runs too late
 * (the server is already accepting traffic by then). Guarded by
 * `NEXT_RUNTIME === "nodejs"` because this hook also fires for the Edge
 * runtime, where the dynamic imports below (Prisma, node:crypto-based
 * checksum, etc.) are not available - this app has no Edge routes, but the
 * guard costs nothing and avoids ever being surprised by that.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartupChecks } = await import("./src/server/startup/run-startup-checks");
    await runStartupChecks();
  }
}
