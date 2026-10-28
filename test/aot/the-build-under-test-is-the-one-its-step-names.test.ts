// A test that needs a build of Bun of its own skips itself on every other build. No test of this file skips itself.
// getTestBunStep() of .buildkite/ci.ts says in EXPECTED_PLATFORM_* what build it hands to scripts/runner.node.ts.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { hasGuardedPages, isHardened, locksEnvironment } from "./hardened";
import { unsupported } from "./harness/compiler";

const { EXPECTED_PLATFORM_PROFILE: profile, EXPECTED_PLATFORM_CANARY: canary } = process.env;

test("it has the compiler", () => {
  expect(unsupported).toBeUndefined();
});

test("it is built with --hardened=on in the step that tests such a build", () => {
  if (profile !== "hardened") return;
  expect({ isHardened, locksEnvironment, hasGuardedPages }).toEqual({
    isHardened: true,
    locksEnvironment: true,
    hasGuardedPages: true,
  });
});

test("it is built with AddressSanitizer in the step that tests such a build", () => {
  if (profile !== "asan") return;
  expect(isASAN).toBe(true);
});

// A symbolizer unpacks all the compressed debug information of an executable before it names one function. scripts/runner.node.ts lays an unpacked copy where it looks first.
test("a symbolizer finds the debug information unpacked in the step that tests a build with AddressSanitizer", () => {
  if (profile !== "asan") return;
  const [, directory] = /^--debug-file-directory=(.+)$/.exec(process.env.LLVM_SYMBOLIZER_OPTS ?? "") ?? [];
  expect(directory).toBeString();
  const files = readdirSync(join(directory, ".build-id"), { recursive: true, encoding: "utf8" });
  expect(files.filter(name => name.endsWith(".debug"))).toHaveLength(1);
});

// scripts/runner.node.ts ends a file at its time limit and tries it again. A build or a server that the first try has started would run on beside the second.
test("what a file of this folder starts ends with it in a step of CI", () => {
  if (!process.env.EXPECTED_PLATFORM_OS) return;
  expect(process.env.BUN_FEATURE_FLAG_NO_ORPHANS).toBe("1");
});

// run-parallel.ts leaves every program out on a build that is no canary.
test("it is a canary in a step that tests one", () => {
  if (!canary) return;
  expect(Bun.spawnSync([bunExe(), "--revision"], { env: bunEnv }).stdout.toString()).toContain("-canary");
});
