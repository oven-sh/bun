// A test that needs a build of Bun of its own skips itself on every other build. No test of this file skips itself.
// getTestBunStep() of .buildkite/ci.ts says in EXPECTED_PLATFORM_* what build it hands to scripts/runner.node.ts.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { closeSync, openSync, readSync } from "node:fs";
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

function namesOfSections(path: string) {
  const file = openSync(path, "r");
  const read = (at: number, length: number) => {
    const bytes = Buffer.alloc(length);
    readSync(file, bytes, 0, length, at);
    return bytes;
  };
  try {
    const header = read(0, 64);
    const [size, names] = [header.readUInt16LE(0x3a), header.readUInt16LE(0x3e)];
    const section = read(Number(header.readBigUInt64LE(0x28)) + names * size, size);
    return read(Number(section.readBigUInt64LE(0x18)), Number(section.readBigUInt64LE(0x20)))
      .toString("latin1")
      .split("\0");
  } finally {
    closeSync(file);
  }
}

// Every executable is a copy of the Bun that builds it, and a symbolizer unpacks all the debug information of an executable before it names one function.
test("it has its table of symbols and no debug information in the step that tests a build with AddressSanitizer", () => {
  if (profile !== "asan") return;
  const names = namesOfSections(bunExe());
  expect(names).toContain(".symtab");
  expect(names.filter(name => name.startsWith(".debug_"))).toEqual([]);
});

// run-parallel.ts leaves every program out on a build that is no canary.
test("it is a canary in a step that tests one", () => {
  if (!canary) return;
  expect(Bun.spawnSync([bunExe(), "--revision"], { env: bunEnv }).stdout.toString()).toContain("-canary");
});
