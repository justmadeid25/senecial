export interface VersionInfo {
  gitCommitSha: string;
  buildDate: string;
}

/**
 * Phase 11 Part H - `GIT_COMMIT_SHA`/`BUILD_DATE` are set as Docker build
 * ARGs (see Dockerfile) baked into `ENV` at image build time - immutable
 * for the life of that image, unlike everything else in this app's
 * config (which is read from the deploy environment). Defaults to
 * "unknown" for local `pnpm dev`/`next start` where no Docker build ever
 * set them - never throws, since a missing build identity must not block
 * `/api/health/ready` from answering.
 */
export function getVersionInfo(env: NodeJS.ProcessEnv = process.env): VersionInfo {
  return {
    gitCommitSha: env.GIT_COMMIT_SHA || "unknown",
    buildDate: env.BUILD_DATE || "unknown",
  };
}
