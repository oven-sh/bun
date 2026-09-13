import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run, supported } from "../run-fixtures";

// tinycc's own test programs, compiled by Bun's C compiler and run for real. They read the vendored
// tinycc sources, so they only run when asked to (BUN_C_COMPILER_HEAVY_TESTS=1) and the sources exist.
const repo = join(import.meta.dir, "../../../../../..");
const tinycc = join(repo, "vendor/tinycc");
const tests2 = join(tinycc, "tests/tests2");
const enabled = supported && process.env.BUN_C_COMPILER_HEAVY_TESTS === "1" && existsSync(tests2);

// tcc's harness ignores white space at the end of a line.
const trimmed = (text: string) =>
  text
    .split("\n")
    .map(line => line.trimEnd())
    .join("\n")
    .trimEnd();

/** Programs for tcc's own bounds checker, backtraces, assembler and other targets. */
const tccOnly = ["bound", "backtrace", "btdll", "asm", "arm64", "riscv", "stack_safe"];

/** The programs that are not expected to print tcc's output here, and why. */
const notExpected: Record<string, string> = {
  "03_struct": "expects tcc's own warning text",
  "33_ternary_op": "expects tcc's own warning text",
  "60_errors_and_warnings": "a list of tcc diagnostics, not a program",
  "96_nodata_wanted": "a list of tcc diagnostics, not a program",
  "125_atomic_misc": "checks tcc's diagnostics",
  "128_run_atexit": "driven by tcc -run",
  "70_floating_point_literals": "tcc's binary floating constants (0b.11p1)",
  "102_alignas": "implicit int, which GCC rejects too",
  "34_array_assignment": "array assignment, which GCC rejects too",
  "95_bitfields_ms": "expects what tcc prints for its own Windows target; GCC and Clang print other things here too (ours is Clang's)",
  "98_al_ax_extend": "a function written in file-scope assembly",
  "99_fastcall": "32-bit x86 calling conventions in file-scope assembly",
  "117_builtins": "the second half runs under tcc's bounds checker",
};

/** What the real backend gets wrong today. */
const failing: Record<string, string> = {};

const args: Record<string, string[]> = {
  "31_args": ["arg1", "arg2", "arg3", "arg4", "arg5"],
  "46_grep": ["[^* ]*[:a:d: ]+\\:\\*-/: $", "46_grep.c"],
};

/** These link a second file, named like the first with a `+`. */
const twoFiles = ["104_inline", "120_alias"];

describe.skipIf(!enabled)("tinycc tests2", () => {
  const names = enabled
    ? [...new Bun.Glob("*.c").scanSync(tests2)]
        .map(file => file.slice(0, -2))
        .filter(name => existsSync(join(tests2, `${name}.expect`)))
        .filter(name => !tccOnly.some(word => name.includes(word)) && !(name in notExpected) && !name.includes("+"))
        .sort()
    : [];

  test("there are about a hundred of them", () => {
    expect(names.length).toBeGreaterThanOrEqual(90);
  });

  for (const name of names) {
    const declare = name in failing ? test.failing : test.concurrent;
    declare(name in failing ? `${name} (${failing[name]})` : name, async () => {
      let result;
      if (twoFiles.includes(name)) {
        using out = tempDir(`bir-tests2-${name}`, {});
        const exe = join(String(out), "program");
        const build = await run(tests2, ["build", "--compile", `${name}.c`, name.replace("_", "+_") + ".c", "--outfile", exe]);
        expect(build.exitCode, build.stderr).toBe(0);
        // (120_alias only has to link.)
        if (name === "120_alias") return;
        await using proc = Bun.spawn({ cmd: [exe], env: bunEnv, cwd: tests2, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        result = { stdout, stderr };
      } else {
        result = await run(tests2, [`${name}.c`, ...(args[name] ?? [])]);
      }
      // __FILE__ is the path the file was opened by; the expected output has the bare name.
      const printed = trimmed(result.stdout.replaceAll(tests2 + "/", ""));
      expect(printed, result.stderr).toBe(trimmed(readFileSync(join(tests2, `${name}.expect`), "utf8")));
      // (124_atomic_counter's contended threads take six seconds on some machines, compiled by anything.)
    }, name === "124_atomic_counter" ? 30_000 : undefined);
  }
});

/** The lines of tcctest.c's output that are allowed to differ from gcc's, and why. */
const tcctestDifferences: [string, string][] = [
  ["res10 = ", "__builtin_constant_p(i && 0): gcc folds it, clang and this compiler do not"],
  ["res11 = ", "__builtin_constant_p(i * 0), likewise"],
  ["res12 = ", "__builtin_constant_p(i && 0 ? i : 34), likewise"],
];

describe.skipIf(!enabled || !Bun.which("gcc"))("tinycc tcctest.c", () => {
  test("prints what it prints when gcc compiles it", async () => {
    const config = join(repo, "build/release-local/deps/tinycc");
    // Without its inline assembly section, which is 32-bit and AT&T-only in places.
    const source = readFileSync(join(tinycc, "tests/tcctest.c"), "utf8").replace(
      "#if (defined(__i386__) || defined(__x86_64__)) && !(defined _WIN32 && CC_NAME == CC_clang)",
      "#if defined(TCCTEST_INLINE_ASM)",
    );
    using dir = tempDir("bir-tcctest", { "tcctest.c": `#define CC_NAME CC_gcc\n#line 1 "tcctest.c"\n${source}` });
    const includes = [tinycc, join(tinycc, "tests"), config];
    const gcc = Bun.spawnSync({
      // By its full path, as Bun names the file it runs: `__BASE_FILE__` prints it.
      // (-Wno-int-conversion: clang, which is `gcc` on macOS, makes an error of what tcctest.c passes to an old-style function.)
      cmd: ["gcc", "-w", "-Wno-int-conversion", "-O0", ...includes.map(i => `-I${i}`), join(String(dir), "tcctest.c"), "-lm", "-o", "reference"],
      cwd: String(dir),
      stderr: "pipe",
    });
    expect(gcc.exitCode, gcc.stderr.toString()).toBe(0);
    const reference = Bun.spawnSync({ cmd: [join(String(dir), "reference")], cwd: String(dir), stdout: "pipe" });
    const expected = reference.stdout.toString().split("\n");

    const { stdout, stderr } = await run(String(dir), ["tcctest.c"], { ...bunEnv, C_INCLUDE_PATH: includes.join(":") });
    const printed = stdout.split("\n");
    const differing = printed
      .map((line, index) => [index + 1, line, expected[index]] as const)
      .filter(([, got, want]) => got !== want)
      .filter(([, , want]) => !tcctestDifferences.some(([prefix]) => want?.startsWith(prefix)));
    expect(differing.slice(0, 12), stderr.slice(0, 2000)).toEqual([]);
    expect(printed.length).toBe(expected.length);
  });
});

describe.skipIf(!enabled)("tinycc itself", () => {
  const config = join(repo, "build/release-local/deps/tinycc");
  const macros = `#define ONE_SOURCE 1
#define CONFIG_TCC_PREDEFS 1
#define CONFIG_TCC_BACKTRACE 0
#define TCC_VERSION "test"
#define TCC_GITHASH "test"
#define TCC_LIBTCC1 ""
`;
  const env = { ...bunEnv, C_INCLUDE_PATH: [tinycc, join(tinycc, "include"), config].join(":") };

  test.skipIf(!existsSync(join(config, "tccdefs_.h")) || !Bun.which("gcc"))(
    "tcc.c compiles as one source, and the compiler it makes compiles a program that uses long double",
    async () => {
      using dir = tempDir("bir-tcc", {
        "main.c": `${macros}#include "${join(tinycc, "tcc.c")}"\n`,
        "hello.c": `#include <stdio.h>\nint main(void) { long double x = 1.5L; printf("hello from tcc %d %Lg\\n", 6 * 7, x * 2); return 0; }\n`,
      });
      const tcc = join(String(dir), "tcc");
      const build = await run(String(dir), ["build", "--compile", "main.c", "--outfile", tcc], env);
      expect(build.exitCode, build.stderr.slice(0, 2000)).toBe(0);

      const spawn = (cmd: string[]) => Bun.spawnSync({ cmd, cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const version = spawn([tcc, "-v"]);
      expect(version.stdout.toString()).toBe("tcc version test test (x86_64 Linux)\n");
      // (tcc -run wants its own runtime library; an object file linked by the system's linker does not.)
      const object = spawn([tcc, `-B${tinycc}`, `-I${join(tinycc, "include")}`, "-c", "hello.c", "-o", "hello.o"]);
      expect(object.stderr.toString()).toBe("");
      expect(object.exitCode).toBe(0);
      expect(spawn(["gcc", "hello.o", "-o", "hello"]).exitCode).toBe(0);
      expect(spawn([join(String(dir), "hello")]).stdout.toString()).toBe("hello from tcc 42 3\n");
    },
  );

  test("lib/libtcc1.c, tcc's runtime library with its long double conversions, compiles", async () => {
    using dir = tempDir("bir-libtcc1", { "libtcc1.c": `#include "${join(tinycc, "lib/libtcc1.c")}"\n` });
    const build = await run(String(dir), ["build", "--target", "bun", "libtcc1.c", "--outdir", "out"], env);
    expect(build.stderr).not.toContain("error");
    expect(build.exitCode).toBe(0);
  });
});
