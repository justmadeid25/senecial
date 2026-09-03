# Senecial - production Dockerfile (Phase 9 §37, Phase 11 runtime fixes,
# Phase 14 Part 1 real docker build/run verification)
#
# Multi-stage build producing a minimal runtime image via Next.js
# `output: "standalone"` (next.config.ts).
#
# Phase 14 Part 1 - `docker build`/`docker compose --profile smoke up`
# HAVE now been run end-to-end for real (a `docker` CLI is available in
# this environment), not just the `node .next/standalone/server.js`
# same-file-layout approximation described below. That real run found and
# fixed an actual production-blocking bug this approximation could not
# have caught: Next.js 16's standalone file-tracer (Turbopack) does not
# preserve pnpm's isolated node_modules layout for externalized packages
# (`pg`, the Prisma 7 generated client) - their own transitive
# dependencies (`pg-types`, `pg-connection-string`, `pg-pool`,
# `pg-protocol`, `pgpass`, `pg-int8`, `postgres-array`, `postgres-bytea`,
# `postgres-date`, `postgres-interval`, `split2`, `xtend`,
# `@prisma/client-runtime-utils`) were silently absent from the built
# image, and the container crashed on every startup with
# `Cannot find module '...'` before ever reaching instrumentation.ts.
# Fixed by declaring each as an explicit direct dependency in
# package.json (pnpm then symlinks them at the project's top-level
# node_modules, where both the tracer and the runtime's module resolution
# actually look) - never delete these without re-running a real
# `docker build` + `docker compose --profile smoke up` + smoke test to
# confirm a future dependency/Next.js/pnpm upgrade hasn't reintroduced the
# gap.
#
# Verified for real in that same session: the image boots, `/api/health/live`
# and `/api/health/ready` respond correctly (including `batch`/`version`/
# `buildDate`), the Phase 11 startup-config-validation hook
# (instrumentation.ts) runs and correctly rejects a bad production config
# (non-HTTPS URLs, dev AI providers, unencrypted backup, in-memory cache -
# all real FAILs) as well as passes cleanly against a real config (real
# OpenAI key, Redis-backed cache, real `age` backup encryption), and the
# full golden-path E2E (tests/e2e/smoke.spec.ts: signup -> login ->
# contract -> upload -> download -> analytics) passes against the actual
# containerized image, not just a dev server.
#
# Base image is `node:22-bookworm-slim` (Debian/glibc), not
# `node:22-alpine` (musl libc) - @node-rs/argon2 (src/server/auth/
# password-hasher.ts) is a napi-rs native module distributed as
# platform-specific prebuilt binaries, and glibc avoids any musl
# compatibility uncertainty for that binary. Prisma itself needs no native
# query-engine binary at all here (this project uses `@prisma/adapter-pg`
# - see prisma.config.ts / src/server/db/client.ts - which talks to
# Postgres through the plain `pg` driver instead of Prisma's Rust engine).

FROM node:22-bookworm-slim AS base
RUN corepack enable

# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
# prisma.config.ts + prisma/schema.prisma are required here, not just in the
# builder stage below - package.json's own `postinstall: prisma generate`
# runs during `pnpm install` itself, and prisma 7's config-file-based CLI
# needs both files present to resolve the schema. Confirmed via a real local
# `docker build`: omitting either one fails `pnpm install --frozen-lockfile`
# with "Could not find Prisma Schema" before any other stage even runs (same
# bug found and fixed in Dockerfile.worker's identical deps stage). Only
# these two files - not the rest of prisma/ (migrations, seed scripts) - so
# this layer's cache still only invalidates on a real dependency or schema
# change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL is not required for `prisma generate` (it only reads
# prisma/schema.prisma) or for `next build` (every route that touches the
# DB is dynamic, not statically generated - see README's Phase 8 note on
# /analytics always being a dynamic route) - no real secret is ever baked
# into this image.
RUN pnpm exec prisma generate
RUN pnpm run build
# Phase 11 - `output: standalone`'s own file-tracing does not include the
# root `instrumentation.ts` (Next.js awaits this at server startup - see
# instrumentation.ts's own docstring) or its compiled dependency chunks -
# confirmed by actually running the standalone server without this step,
# which threw ChunkLoadError trying to load the instrumentation hook,
# meaning the entire startup-config-validation feature would silently
# never run in this image. See scripts/docker-copy-instrumentation.mjs's
# docstring for the full explanation; this copies exactly the files
# instrumentation.js's own .nft.json manifest declares as required.
RUN node scripts/docker-copy-instrumentation.mjs

# ---------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

# Phase 11 Part H - build identity baked in at image build time (never
# read from the deploy environment, unlike everything else this app
# configures via env vars) - see docker.yml's `--build-arg`, which passes
# the actual commit SHA/build timestamp. Defaults ("unknown") only ever
# apply to a manual `docker build` with no --build-arg, never a real CI
# build. Neither value is a secret - a git commit SHA is already public
# information for any public repo, same information a `git log` shows.
ARG GIT_COMMIT_SHA=unknown
ARG BUILD_DATE=unknown
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV BUILD_DATE=${BUILD_DATE}

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user (§37 "비root 사용자") - matches the convention of Debian's
# node images, which already ship an unprivileged `node` user/group.
RUN mkdir -p /app/storage && chown -R node:node /app

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Writable storage path (§37 "writable storage 경로 명시") - matches
# LOCAL_STORAGE_PATH's default (./storage, see src/server/storage/index.ts).
# In production this should be a mounted persistent volume, not this
# image's own (ephemeral, container-lifetime-only) filesystem - see
# README's Docker section.
VOLUME ["/app/storage"]

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3000

CMD ["node", "server.js"]
