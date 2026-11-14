/**
 * `compile_commands.json` holds argv: clangd and the other readers hand an entry's `arguments` to the compiler
 * without a shell. The flags are written for the shell of the ninja command (`-DX=\"v\"`, `quote()`), so
 * `compile()` turns them into the words the compiler gets (`shellWords()` in scripts/build/shell.ts). Copied as
 * they were, `-DREPORTED_NODEJS_VERSION=\"26.12.1\"` defined the macro as `\"26.12.1\"`, which does not compile.
 * No compiler or ninja runs here.
 */
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cxx } from "../../scripts/build/compile.ts";
import type { Config } from "../../scripts/build/config.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { quote, shellWords } from "../../scripts/build/shell.ts";

/** The `arguments` that `cxx()` records for `flags`, read back from the `compile_commands.json` it writes. */
async function recordedArguments(hostOs: "linux" | "windows", flags: string[]): Promise<string[]> {
  using dir = tempDir("compile-commands-argv", {});
  const buildDir = String(dir);
  const cfg = { buildDir, cwd: buildDir, host: { os: hostOs }, cxx: "/fake/clang++", windows: hostOs === "windows" };
  const n = new Ninja({ buildDir });
  n.rule("cxx", { command: "clang++ $cxxflags -c $in -o $out" });
  cxx(n, cfg as Config, join(buildDir, "a.cpp"), { flags });
  await n.write();
  const [entry] = JSON.parse(readFileSync(join(buildDir, "compile_commands.json"), "utf8"));
  return entry.arguments;
}

describe("compile_commands.json arguments", () => {
  test("a string define reaches the compiler with its quotes", async () => {
    const args = await recordedArguments("linux", ['-DREPORTED_NODEJS_VERSION=\\"26.12.1\\"', '-DTCC_LIBTCC1=\\"\\"']);
    expect(args).toContain('-DREPORTED_NODEJS_VERSION="26.12.1"');
    expect(args).toContain('-DTCC_LIBTCC1=""');
    expect(args.filter(a => a.includes('\\"'))).toEqual([]);
  });

  test("a quoted include path is one word without its quotes", async () => {
    const path = "/build dir/it's/include";
    const args = await recordedArguments("linux", [`-I${quote(path, false)}`, "-O0"]);
    expect(args).toContain(`-I${path}`);
    expect(args).toContain("-O0");
  });

  test("on a Windows host the flags are read the way the program's argv parsing reads them", async () => {
    const args = await recordedArguments("windows", [
      '-DREPORTED_NODEJS_VERSION=\\"26.12.1\\"',
      quote("/I C:\\a b", true),
    ]);
    expect(args).toContain('-DREPORTED_NODEJS_VERSION="26.12.1"');
    expect(args).toContain("/I C:\\a b");
  });
});

describe("shellWords", () => {
  const values = ["plain", "-DX=1", "a b", "it's", 'say "hi"', "C:\\Program Files\\LLVM\\bin\\clang-cl.exe", ""];

  test.each(values)("undoes quote() for %p (posix)", value => {
    expect(shellWords([quote(value, false)], false)).toEqual([value]);
  });

  test.each(values)("undoes quote() for %p (windows)", value => {
    expect(shellWords([quote(value, true)], true)).toEqual([value]);
  });

  test("an element with several words gives each of them", () => {
    expect(shellWords(["-a -b", "  -c\t"], false)).toEqual(["-a", "-b", "-c"]);
    expect(shellWords(["-a -b"], true)).toEqual(["-a", "-b"]);
  });

  test("backslashes before a quote on Windows", () => {
    expect(shellWords(['a\\\\"b c"'], true)).toEqual(["a\\b c"]);
    expect(shellWords(['a\\\\\\"b'], true)).toEqual(['a\\"b']);
    expect(shellWords(["C:\\dir\\"], true)).toEqual(["C:\\dir\\"]);
  });

  test("what the shell would expand, or an unterminated quote, throws", () => {
    expect(() => shellWords(["-DX=$HOME"], false)).toThrow(/expansion/);
    expect(() => shellWords(['-DX="$HOME"'], false)).toThrow(/expansion/);
    expect(() => shellWords(["-DX=`id`"], false)).toThrow(/expansion/);
    expect(() => shellWords(["-DX='v"], false)).toThrow(/unterminated/);
    expect(() => shellWords(['-DX="v'], true)).toThrow(/unterminated/);
  });

  test.skipIf(isWindows)("agrees with /bin/sh", async () => {
    const flags = [
      '-DREPORTED_NODEJS_VERSION=\\"26.12.1\\"',
      '-DTCC_LIBTCC1=\\"\\"',
      quote("/build dir/it's", false),
      '"-DY=a\\\\b"',
      "-O0 -g3",
    ];
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `printf '%s\\0' ${flags.join(" ")}`],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(shellWords(flags, false)).toEqual(stdout.split("\0").slice(0, -1));
    expect(exitCode).toBe(0);
  });
});
