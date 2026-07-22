import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import { join } from "node:path";

// `bun:internal-for-testing` (and the native TestingAPIs bindings it references)
// is only bundled for debug and canary builds. Non-canary release builds omit
// it entirely so the module source and testing-only native code are absent from
// the shipped binary.

const repoRoot = join(import.meta.dir, "..", "..", "..", "..");

// Codegen-level: the internal module registry scanner must honor
// `includeInternalForTesting: false` so bundle-modules.ts can drop the module
// (and every $newRustFunction / $newCppFunction binding it references) from
// the js2native table for non-canary release builds.
test("internal-module-registry-scanner honors includeInternalForTesting", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { createInternalModuleRegistry } = require("./src/codegen/internal-module-registry-scanner.ts");
        const BASE = "./src/js";
        const withIt = createInternalModuleRegistry(BASE);
        const withoutIt = createInternalModuleRegistry(BASE, { includeInternalForTesting: false });
        console.log(JSON.stringify({
          withIt: {
            inRegistry: withIt.internalRegistry.has("bun:internal-for-testing"),
            inModuleList: withIt.moduleList.includes("internal-for-testing.ts"),
          },
          withoutIt: {
            inRegistry: withoutIt.internalRegistry.has("bun:internal-for-testing"),
            inModuleList: withoutIt.moduleList.includes("internal-for-testing.ts"),
          },
          nativeStartIndexDelta: withIt.nativeStartIndex - withoutIt.nativeStartIndex,
        }));
      `,
    ],
    env: bunEnv,
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    withIt: { inRegistry: true, inModuleList: true },
    withoutIt: { inRegistry: false, inModuleList: false },
    nativeStartIndexDelta: 1,
  });
  expect(exitCode).toBe(0);
});

// Runtime-level: the built binary's gating must match its build config.
//
// PR CI only builds debug and canary, so `isBundled` is always true there and
// the "missing" branch of the first runtime test is only exercised when this
// file is run against a local `bun run build:release --canary=false` binary.
const isCanary = Bun.version_with_sha.includes("canary");
const isBundled = isDebug || isCanary;

// Spawn without the harness-provided BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING /
// BUN_GARBAGE_COLLECTOR_LEVEL so the only opt-in is the flag under test.
const cleanEnv = { ...bunEnv };
delete (cleanEnv as Record<string, unknown>).BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING;
delete (cleanEnv as Record<string, unknown>).BUN_GARBAGE_COLLECTOR_LEVEL;

const probe = `try { require("bun:internal-for-testing"); console.log("ok"); } catch { console.log("missing"); }`;

test("bun:internal-for-testing with --expose-internals matches build config", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--expose-internals", "-e", probe],
    env: cleanEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe(isBundled ? "ok" : "missing");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("bun:internal-for-testing without --expose-internals", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", probe],
    env: cleanEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Debug builds always allow it; release builds (canary or not) require the flag.
  expect(stdout.trim()).toBe(isDebug ? "ok" : "missing");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
