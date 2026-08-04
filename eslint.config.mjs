import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma-generated client - never lint generated code.
    "src/generated/**",
    // Phase 12.1 - local dev-only PostgreSQL 18 data/binaries (pgdata,
    // the standalone pgvector-capable binary tree, pgAdmin's bundled web
    // app, the golden pgvector.zip archive) - never project source, never
    // committed (see .gitignore), never lintable.
    ".devdb/**",
  ]),
]);

export default eslintConfig;
