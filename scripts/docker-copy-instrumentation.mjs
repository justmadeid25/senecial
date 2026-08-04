/**
 * Phase 11 - Next.js 16's `output: "standalone"` file-tracing (at least
 * with this project's Turbopack build) does NOT include the root-level
 * `instrumentation.ts` or any of its compiled dependency chunks in
 * `.next/standalone/` - confirmed empirically: after a real `pnpm build`,
 * `.next/server/instrumentation.js` (and the chunks its own
 * `instrumentation.js.nft.json` lists) exist under plain `.next/server/`
 * but are silently absent from `.next/standalone/.next/server/`. Running
 * the standalone server as-is throws `ChunkLoadError` for a missing
 * runtime chunk the moment Next tries to load the instrumentation hook -
 * meaning `register()` (src/server/startup/run-startup-checks.ts) would
 * NEVER run in the actual Docker image, silently disabling Phase 11's
 * entire startup-validation-rejects-bad-config feature.
 *
 * This script copies exactly the files `instrumentation.js.nft.json`
 * declares as required (never the whole `chunks/` directory, which would
 * ~4x that directory's size in the final image) into the standalone
 * output, run once in the Dockerfile's `builder` stage right after
 * `next build` - before the `runner` stage's `COPY --from=builder
 * .../.next/standalone` picks it up.
 *
 * A no-op (not an error) if this project ever has no instrumentation.ts.
 * Plain `.mjs` (not `.ts`) - this must run via bare `node`, with no
 * build/type-strip step, inside the Dockerfile's `builder` stage.
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const serverDir = path.join(projectRoot, ".next", "server");
const standaloneServerDir = path.join(projectRoot, ".next", "standalone", ".next", "server");

const instrumentationJs = path.join(serverDir, "instrumentation.js");
const nftPath = path.join(serverDir, "instrumentation.js.nft.json");

if (!existsSync(instrumentationJs) || !existsSync(nftPath)) {
  console.log("[docker-copy-instrumentation] instrumentation.js/.nft.json not found - nothing to copy.");
  process.exit(0);
}

function copyIntoStandalone(relativeToServerDir) {
  const src = path.join(serverDir, relativeToServerDir);
  const dest = path.join(standaloneServerDir, relativeToServerDir);
  if (!existsSync(src)) {
    console.warn(`[docker-copy-instrumentation] WARNING: expected file missing, skipping: ${relativeToServerDir}`);
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`[docker-copy-instrumentation] copied ${relativeToServerDir}`);
}

copyIntoStandalone("instrumentation.js");

const nft = JSON.parse(readFileSync(nftPath, "utf8"));
for (const relativeFile of nft.files) {
  // nft.json paths are relative to instrumentation.js's own directory
  // (server/), expressed as "./chunks/..." - normalize to a plain
  // server-dir-relative path.
  copyIntoStandalone(path.normalize(relativeFile));
}

console.log("[docker-copy-instrumentation] done.");
