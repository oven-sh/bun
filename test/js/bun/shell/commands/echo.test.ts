import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("echo", async () => {
  TestBuilder.command`echo`.exitCode(0).stdout("\n").stderr("").runAsTest("no arguments outputs newline");

  TestBuilder.command`echo hello`.exitCode(0).stdout("hello\n").stderr("").runAsTest("single argument");

  TestBuilder.command`echo hello world`.exitCode(0).stdout("hello world\n").stderr("").runAsTest("multiple arguments");

  TestBuilder.command`echo "hello world"`.exitCode(0).stdout("hello world\n").stderr("").runAsTest("quoted argument");

  TestBuilder.command`echo hello   world`
    .exitCode(0)
    .stdout("hello world\n")
    .stderr("")
    .runAsTest("multiple spaces collapsed");

  TestBuilder.command`echo ""`.exitCode(0).stdout("\n").stderr("").runAsTest("empty string");

  TestBuilder.command`echo one two three four`
    .exitCode(0)
    .stdout("one two three four\n")
    .stderr("")
    .runAsTest("many arguments");
});

describe("echo -n flag", async () => {
  TestBuilder.command`echo -n`.exitCode(0).stdout("").stderr("").runAsTest("no arguments with -n flag");

  TestBuilder.command`echo -n hello`.exitCode(0).stdout("hello").stderr("").runAsTest("single argument with -n flag");

  TestBuilder.command`echo -n hello world`
    .exitCode(0)
    .stdout("hello world")
    .stderr("")
    .runAsTest("multiple arguments with -n flag");

  TestBuilder.command`echo -n "hello world"`
    .exitCode(0)
    .stdout("hello world")
    .stderr("")
    .runAsTest("quoted argument with -n flag");

  TestBuilder.command`echo -n ""`.exitCode(0).stdout("").stderr("").runAsTest("empty string with -n flag");

  TestBuilder.command`echo -n one two three`
    .exitCode(0)
    .stdout("one two three")
    .stderr("")
    .runAsTest("many arguments with -n flag");

  // With -n on and -e off, echo writes its operands unchanged and appends nothing.
  const flagForms = ["-n", "-nn", "-nE", "-En", "-n -E", "-E -n", "-n -n", "-n -e -E", "-neE", "-e -nE"];
  const values = ["a", "a\n", "\n", "\n\n", "a\n\n", "a\n\n\n", "\n\n\n", "a\n\nb\n\n", "line 1\nline 2\n\n\n"];
  for (const flags of flagForms) {
    for (const value of values) {
      TestBuilder.command`echo ${{ raw: flags }} ${value}`
        .exitCode(0)
        .stdout(value)
        .stderr("")
        .runAsTest(`echo ${flags} writes ${JSON.stringify(value)} unchanged`);
    }
  }

  TestBuilder.command`echo -n -- ${"a\n\n"}`
    .exitCode(0)
    .stdout("-- a\n\n")
    .stderr("")
    .runAsTest("-n keeps trailing newlines after a double dash");

  TestBuilder.command`echo -n -x ${"a\n\n"}`
    .exitCode(0)
    .stdout("-x a\n\n")
    .stderr("")
    .runAsTest("-n keeps trailing newlines after an invalid flag");

  TestBuilder.command`echo -n ${"a\n\n\n"} ${"a\n\n\n"}`
    .exitCode(0)
    .stdout("a\n\n\n a\n\n\n")
    .stderr("")
    .runAsTest("-n keeps trailing newlines of every argument");

  TestBuilder.command`echo -n "$V"`
    .env({ V: "a\n\n\n" })
    .exitCode(0)
    .stdout("a\n\n\n")
    .stderr("")
    .runAsTest("-n keeps trailing newlines of a quoted variable");

  TestBuilder.command`echo -n ${"a\n\n"} $BUN_ECHO_TEST_UNSET`
    .exitCode(0)
    .stdout("a\n\n")
    .stderr("")
    .runAsTest("-n keeps trailing newlines when an unset variable follows");

  TestBuilder.command`echo ${"-n"} ${"a\n\n"}`
    .exitCode(0)
    .stdout("a\n\n")
    .stderr("")
    .runAsTest("interpolated -n keeps trailing newlines");

  TestBuilder.command`echo -n ${["x", "a\n\n"]}`
    .exitCode(0)
    .stdout("x a\n\n")
    .stderr("")
    .runAsTest("-n keeps trailing newlines of the last array element");

  TestBuilder.command`echo -n ${"line 1\nline 2\n\n\n"} > by-echo.txt`
    .exitCode(0)
    .stdout("")
    .stderr("")
    .fileEquals("by-echo.txt", "line 1\nline 2\n\n\n")
    .runAsTest("-n keeps trailing newlines in a redirect to a file");

  // Without -n, or with -e on, the output does not change.
  TestBuilder.command`echo -E ${"a\n"}`.exitCode(0).stdout("a\n").stderr("").runAsTest("-E adds no second newline");

  TestBuilder.command`echo -E ${"a\n\n"}`
    .exitCode(0)
    .stdout("a\n")
    .stderr("")
    .runAsTest("-E still collapses trailing newlines");

  TestBuilder.command`echo -E ${"\n\n\n"}`
    .exitCode(0)
    .stdout("\n\n")
    .stderr("")
    .runAsTest("-E still collapses a pure-newline argument to two");

  TestBuilder.command`echo -eE ${"a\n\n"}`
    .exitCode(0)
    .stdout("a\n")
    .stderr("")
    .runAsTest("-eE still collapses trailing newlines");

  TestBuilder.command`echo a ${"\n\n\n"}`
    .exitCode(0)
    .stdout("a \n\n")
    .stderr("")
    .runAsTest("no flag still collapses a pure-newline last argument");

  TestBuilder.command`echo -e ${"a\n"}`.exitCode(0).stdout("a\n\n").stderr("").runAsTest("-e still adds its newline");

  TestBuilder.command`echo -ne ${"a\n\n"}`
    .exitCode(0)
    .stdout("a\n\n")
    .stderr("")
    .runAsTest("-ne still keeps trailing newlines");

  TestBuilder.command`echo -nEe ${"a\n\n"}`
    .exitCode(0)
    .stdout("a\n\n")
    .stderr("")
    .runAsTest("-nEe still keeps trailing newlines");

  test.concurrent("bun exec: -n keeps trailing newlines of a quoted variable", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "exec", 'echo -n "$V"'],
      env: { ...bunEnv, V: "a\n\n\n" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "a\n\n\n", stderr: "", exitCode: 0 });
  });

  test.concurrent("bun <file>.sh: -n keeps trailing newlines of a quoted literal", async () => {
    using dir = tempDir("echo-n-newlines", { "check.sh": 'echo -n "a\n\n\n"' });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check.sh"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "a\n\n\n", stderr: "", exitCode: 0 });
  });
});

describe("echo error handling", async () => {
  TestBuilder.command`echo -x`.exitCode(0).stdout("-x\n").runAsTest("invalid flag");

  TestBuilder.command`echo -abc`.exitCode(0).stdout("-abc\n").runAsTest("invalid multi-char flag");

  TestBuilder.command`echo --invalid`.exitCode(0).stdout("--invalid\n").runAsTest("invalid long flag");
});

describe("echo special cases", async () => {
  TestBuilder.command`echo -n -n hello`.exitCode(0).stdout("hello").stderr("").runAsTest("-n flag with -n as argument");

  TestBuilder.command`echo -- -n hello`
    .exitCode(0)
    .stdout("-- -n hello\n")
    .stderr("")
    .runAsTest("double dash treated as argument");

  TestBuilder.command`echo "\n"`.exitCode(0).stdout("\\n\n").stderr("").runAsTest("literal backslash n");

  // A last arg that is a pure run of >=2 '\n' must keep two newlines (regressed
  // to one: the open-coded trailing-newline collapse floored the kept length
  // at 1 instead of using the trimSubsequentLeadingChars helper).
  TestBuilder.command`echo ${"\n\n"}`
    .exitCode(0)
    .stdout("\n\n")
    .stderr("")
    .runAsTest("pure-newline arg keeps both newlines");

  TestBuilder.command`echo ${"\n\n\n"}`
    .exitCode(0)
    .stdout("\n\n")
    .stderr("")
    .runAsTest("3+ trailing newlines collapse to two");

  TestBuilder.command`echo ${"a\n\n"}`
    .exitCode(0)
    .stdout("a\n")
    .stderr("")
    .runAsTest("mixed trailing newlines still collapse to one");
});
