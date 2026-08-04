import type { NextConfig } from "next";

import { SERVER_ACTION_BODY_SIZE_LIMIT_MB } from "./src/lib/config/file-upload";

const nextConfig: NextConfig = {
  // Phase 9 §37 - required for the production Dockerfile's minimal
  // runtime image (docs/operations/deployment.md / README's Docker
  // section): bundles a self-contained server into .next/standalone
  // instead of requiring the full node_modules tree at runtime.
  output: "standalone",
  experimental: {
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
