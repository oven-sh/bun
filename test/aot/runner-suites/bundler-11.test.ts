import { holdProgramsOfSuites } from "../harness/runner-suites";

holdProgramsOfSuites(
  "test/bundler/bun-build-api-dts.test.ts",
  "test/bundler/bun-build-compile-sourcemap.test.ts",
  "test/bundler/bun-build-compile-wasm.test.ts",
  "test/bundler/cli.test.ts",
  "test/bundler/compile-asset-bunfs.test.ts",
  "test/bundler/compile-asset-streams.test.ts",
  "test/bundler/compile-corrupted-embed.test.ts",
  "test/bundler/compile-disallow-code-generation-from-strings.test.ts",
  "test/bundler/compile-embedded-root-is-a-read-only-folder.test.ts",
  "test/bundler/compile-node-compile-cache.test.ts",
  "test/bundler/compile-onto-a-compiled-executable.test.ts",
  "test/bundler/compile-process-execargv.test.ts",
  "test/bundler/compile-sourcemap-internal.test.ts",
  "test/bundler/metafile.test.ts",
  "test/bundler/standalone.test.ts",
);
