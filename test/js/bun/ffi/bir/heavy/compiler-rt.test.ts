import { describe, expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { includePath, run, supported } from "../run-fixtures";

// compiler-rt's own unit tests for its builtins: each `NAME_test.c` has a `main` that returns 0 when
// `lib/builtins/NAME.c` behaves. The test, the builtin and whatever other builtins they turn out to call
// are compiled by Bun's C compiler, linked and run. They exercise exactly the lowering of `__int128`,
// `long double`, overflow checks, bit counting and the float/integer conversions.
const root = process.env.BUN_C_COMPILER_RT ?? join(homedir(), "code/llvm-project-bun/compiler-rt");
const units = join(root, "test/builtins/Unit");
const lib = join(root, "lib/builtins");
const enabled = supported && process.env.BUN_C_COMPILER_HEAVY_TESTS === "1" && existsSync(units);

/** The tests that are not expected to pass here, and why. */
const notExpected: Record<string, string> = {
  atomic_test: "16-byte atomic operations",
  clear_cache_test: "needs the builtin's assembly",
  enable_execute_stack_test: "needs the builtin's assembly",
  cpu_model_test: "not self-checking: its exit status is the answer",
  gcc_personality_test: "C++ exception handling; no main",
  mulsi3_test: "the builtin only exists in assembly",
  trampoline_setup_test: "nested functions",
  // `long double _Complex` can be declared and nothing more.
  divxc3_test: "long double _Complex",
  mulxc3_test: "long double _Complex",
};

/** What the real backend gets wrong today. */
const failing: Record<string, string> = {};

async function passes(name: string) {
  const files = [join(units, `${name}.c`)];
  const builtin = join(lib, `${name.replace(/_test$/, "")}.c`);
  if (existsSync(builtin)) files.push(builtin);
  using out = tempDir(`bir-compiler-rt-${name}`, {});
  const exe = join(String(out), "test");
  const env = { ...bunEnv, C_INCLUDE_PATH: includePath(lib) };
  for (let attempt = 0; attempt < 8; attempt++) {
    const build = await run(String(out), ["build", "--compile", ...files, "--outfile", exe], env);
    if (build.exitCode !== 0) return { ok: false, why: `compile: ${build.stderr.slice(0, 600)}` };
    await using proc = Bun.spawn({ cmd: [exe], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode === 0) return { ok: true, why: "" };
    // A builtin the test or the library calls and the process does not have: link it too.
    const missing = /undefined symbol '_*([A-Za-z0-9_]+)'/.exec(stderr)?.[1];
    const source = missing && join(lib, missing === "compilerrt_abort_impl" ? "int_util.c" : `${missing}.c`);
    if (!source || !existsSync(source) || files.includes(source)) {
      return { ok: false, why: `exit ${exitCode}\n${stdout.slice(0, 600)}\n${stderr.slice(0, 600)}` };
    }
    files.push(source);
  }
  return { ok: false, why: "too many missing builtins" };
}

describe.skipIf(!enabled)("compiler-rt builtins", () => {
  const names = enabled
    ? [...new Bun.Glob("*_test.c").scanSync(units)]
        .map(file => file.slice(0, -2))
        .filter(name => !(name in notExpected))
        .sort()
    : [];

  test("there are about two hundred of them", () => {
    expect(names.length).toBeGreaterThanOrEqual(185);
  });

  for (const name of names) {
    const declare = name in failing ? test.failing : test.concurrent;
    declare(name in failing ? `${name} (${failing[name]})` : name, async () => {
      const { ok, why } = await passes(name);
      expect(ok, why).toBe(true);
    });
  }
});
