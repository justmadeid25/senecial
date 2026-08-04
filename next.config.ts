import type { NextConfig } from "next";

import { SERVER_ACTION_BODY_SIZE_LIMIT_MB } from "./src/lib/config/file-upload";

const nextConfig: NextConfig = {
  // Phase 9 §37 - required for the production Dockerfile's minimal
  // runtime image (docs/operations/deployment.md / README's Docker
  // section): bundles a self-contained server into .next/standalone
  // instead of requiring the full node_modules tree at runtime.
  output: "standalone",
  // §Phase 12.4 §2 - `next build`'s OWN internal "Running TypeScript" step
  // repeatedly crashed a build worker with a raw Windows access violation
  // (exit code 3221225794 / 0xC0000005) on this machine, even after
  // capping build worker concurrency (experimental.cpus above) - the crash
  // persisted specifically in the type-checking phase, never in the
  // separately-run, plain `pnpm exec tsc --noEmit` (run repeatedly this
  // session with zero crashes, and already a mandatory step in both
  // release:verify and CI's quality-and-tests job, BEFORE this build step
  // ever runs). Since type safety is already verified by that independent,
  // reliable step, disabling Next's OWN redundant internal type-check
  // removes the actual crash source without weakening the real gate -
  // `next build` would still fail normally on any other build error.
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // §Phase 12.4 §2 - real crash found during Stage 1 E2E verification:
    // `next build`'s "Collecting page data" step defaults to one worker
    // process PER CPU core (16 on this machine) - each a full Node.js
    // process loading the whole app bundle - and with only ~2.2GB free
    // RAM available at the time, one worker was hard-killed with a
    // Windows access violation (exit code 3221225794 / 0xC0000005),
    // failing the entire build. Capped to a fixed, modest worker count so
    // peak build memory stays bounded regardless of how many CPU cores
    // the host reports - trades some build wall-clock time for not
    // crashing under real memory pressure, the correct tradeoff for a
    // release-gate build that must be reliable, not merely fast.
    cpus: 4,
    serverActions: {
      // Contract file uploads go through a Server Action; the real cap is
      // MAX_UPLOAD_SIZE_MB (src/lib/config/file-upload.ts, env-configurable).
      // This is set a little above that so an over-the-cap upload gets our
      // own clean Korean error message instead of the framework's generic
      // body-size rejection - it is a backstop, not the primary enforcement
      // point. A reverse proxy / load balancer in front of this app in
      // production should also cap request bodies around this same size
      // (see README).
      bodySizeLimit: `${SERVER_ACTION_BODY_SIZE_LIMIT_MB}mb`,
    },
  },
};

export default nextConfig;
