// A test that needs a build of Bun of its own skips itself on every other build. No test of this file skips itself.
// getTestBunStep() of .buildkite/ci.ts says in EXPECTED_PLATFORM_* what build it hands to scripts/runner.node.ts.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
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

// run-parallel.ts leaves every program out on a build that is no canary.
test("it is a canary in a step that tests one", () => {
  if (!canary) return;
  expect(Bun.spawnSync([bunExe(), "--revision"], { env: bunEnv }).stdout.toString()).toContain("-canary");
});
