import type { NextConfig } from "next";

import { SERVER_ACTION_BODY_SIZE_LIMIT_MB } from "./src/lib/config/file-upload";

const nextConfig: NextConfig = {
  // Phase 9 §37 - required for the production Dockerfile's minimal
  // runtime image (docs/operations/deployment.md / README's Docker
  // section): bundles a self-contained server into .next/standalone
  // instead of requiring the full node_modules tree at runtime.
  // Vercel's own build pipeline (its Adapters output-collection step)
  // conflicts with `output: "standalone"` - it expects
  // `.next/next-server.js.nft.json` at the default location, which
  // standalone mode restructures away. Standalone mode is only needed for
  // the Docker/self-hosted path (root Dockerfile does
  // `COPY --from=builder /app/.next/standalone`), so it's disabled
  // specifically when building inside Vercel (VERCEL=1, set automatically
  // by their build environment) and left on otherwise.
  output: process.env.VERCEL ? undefined : "standalone",
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
    // Phase 14 Part 5 - REAL bug found via live-measured large-file-upload
    // load testing: every request (including this Server Action's own
    // multipart body) passes through middleware.ts first, and Next.js
    // caps how much of the body the middleware/proxy layer will buffer at
    // a SEPARATE, lower default (10MB - confirmed via
    // .next/required-server-files.json's `proxyClientMaxBodySize`, and by
    // reproducing the exact failure live: uploads above ~10MB truncated
    // mid-stream with a raw "Unexpected end of form" error, well BELOW
    // the intended 20MB/25MB ceiling above). This is a distinct config
    // key from `serverActions.bodySizeLimit` (renamed from
    // `middlewareClientMaxBodySize` when Next 16 renamed middleware ->
    // proxy - see the `proxy` upgrade codemod) and was never configured,
    // so it silently won on every upload above 10MB regardless of the
    // serverActions limit above. Matches the same computed ceiling so
    // neither layer is the tighter one.
    proxyClientMaxBodySize: `${SERVER_ACTION_BODY_SIZE_LIMIT_MB}mb`,
  },
  // www.senecial.co.kr has no dashboard/CLI-exposed Vercel domain-redirect
  // toggle (checked - no such field via `vercel domains`), so the
  // canonical-domain redirect is done here instead: permanent (308)
  // host-based redirect to the apex domain, matching Next.js's own
  // documented `has: [{type: "host"}]` pattern.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.senecial.co.kr" }],
        destination: "https://senecial.co.kr/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
