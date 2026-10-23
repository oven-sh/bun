import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { createTestBuilder } from "./util";

const TestBuilder = createTestBuilder(import.meta.path);

describe("shell: piping assignments into command", () => {
  // Original test cases
  TestBuilder.command`FOO=bar BAR=baz | echo hi`
    .stdout("hi\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should not crash with multiple assignments (issue #15714)");

  TestBuilder.command`A=1 B=2 C=3 | echo test`
    .stdout("test\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle multiple assignments");

  TestBuilder.command`FOO=bar | echo single`
    .stdout("single\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle single assignment");

  TestBuilder.command`echo start | FOO=bar BAR=baz | echo end`
    .stdout("end\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle assignments in middle of pipeline");

  // New comprehensive test cases

  // Many assignments in a single pipeline
  TestBuilder.command`A=1 B=2 C=3 D=4 E=5 F=6 G=7 H=8 I=9 J=10 | echo many`
    .stdout("many\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle many assignments (10+) in pipeline");

  // Empty assignment values
  TestBuilder.command`EMPTY= ALSO_EMPTY= | echo empty`
    .stdout("empty\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle empty assignment values");

  // Assignments with spaces in values (quoted)
  TestBuilder.command`FOO="bar baz" HELLO="world test" | echo quoted`
    .stdout("quoted\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle assignments with quoted values containing spaces");

  // Assignments with special characters
  TestBuilder.command`VAR='$HOME' OTHER='$(echo test)' | echo special`
    .stdout("special\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle assignments with special characters in single quotes");

  // Complex pipeline with assignments at different positions
  TestBuilder.command`A=1 | B=2 C=3 | echo first | D=4 | echo second | E=5 F=6 | echo third`
    .stdout("third\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle assignments scattered throughout complex pipeline");

  // Assignments only (no actual commands except assignments)
  TestBuilder.command`FOO=bar BAR=baz | QUX=quux | true`
    .stdout("")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle pipeline with only assignments followed by true");

  // Long assignment values
  const longValue = "x".repeat(1000);
  TestBuilder.command`LONG="${longValue}" | echo long`
    .stdout("long\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle very long assignment values");

  // Assignments with equals signs in values
  TestBuilder.command`EQUATION="a=b+c" FORMULA="x=y*z" | echo math`
    .stdout("math\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle equals signs in assignment values");

  // Unicode in assignments
  TestBuilder.command`EMOJI="🚀" CHINESE="你好" | echo unicode`
    .stdout("unicode\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle unicode characters in assignments");

  // Assignments with expansions
  TestBuilder.command`HOME_BACKUP=$HOME USER_BACKUP=$USER | echo expand`
    .stdout("expand\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle variable expansions in assignments");

  // Multiple pipelines with assignments chained with && and ||
  TestBuilder.command`A=1 | echo first && B=2 | echo second`
    .stdout("first\nsecond\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle assignments in chained pipelines with &&");

  TestBuilder.command`false || X=fail | echo fallback`
    .stdout("fallback\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle assignments in fallback pipeline with ||");

  // Nested command substitution with assignments
  TestBuilder.command`VAR=$(echo FOO=bar | cat) | echo nested`
    .stdout("nested\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle nested command substitution with assignments");

  // Assignments with glob patterns (shouldn't expand in assignments)
  TestBuilder.command`PATTERN="*.txt" GLOB="[a-z]*" | echo glob`
    .stdout("glob\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle glob patterns in assignments without expansion");

  // Assignments with backslashes and escape sequences
  TestBuilder.command`PATH_WIN="C:\\Users\\test" NEWLINE="line1\nline2" | echo escape`
    .stdout("escape\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle backslashes and escape sequences in assignments");

  // Pipeline where assignments appear after regular commands
  TestBuilder.command`echo before | A=1 B=2 | echo after`
    .stdout("after\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle assignments after regular commands in pipeline");

  // Stress test: very long pipeline with alternating assignments and commands
  TestBuilder.command`A=1 | echo a | B=2 | echo b | C=3 | echo c | D=4 | echo d | E=5 | echo e`
    .stdout("e\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle long pipeline with alternating assignments and commands");

  // Assignment with command substitution that itself contains assignments
  TestBuilder.command`RESULT=$(X=1 Y=2 echo done) | echo subshell`
    .stdout("subshell\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle command substitution containing assignments");

  // Multiple assignment statements separated by semicolons in pipeline
  TestBuilder.command`A=1; B=2; C=3 | echo semicolon`
    .stdout("semicolon\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle semicolon-separated assignments before pipeline");

  // Assignments with numeric names (edge case)
  TestBuilder.command`_1=first _2=second _3=third | echo numeric`
    .stdout("numeric\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle assignments with underscore-prefixed numeric names");

  // Pipeline with assignments and input/output redirection
  TestBuilder.command`echo "test" | A=1 B=2 | cat`
    .stdout("")
    .stderr("")
    .exitCode(0)
    .runAsTest("should not pass stdin through assignments in the middle of a pipeline");

  // Assignments with underscores and numbers
  TestBuilder.command`ARR_0=a ARR_1=b | echo array`
    .stdout("array\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle assignments with underscores and numbers");

  // Pipeline where every item is an assignment (stress test)
  TestBuilder.command`A=1 | B=2 | C=3 | D=4 | E=5 | true`
    .stdout("")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle pipeline with multiple assignments ending with true");

  // Assignments with quotes and spaces in various combinations
  TestBuilder.command`A="hello world" B='single quotes' C=no_quotes | echo mixed`
    .stdout("mixed\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle mixed quoting styles in assignments");

  // Pipeline with assignments and background processes (if supported)
  TestBuilder.command`A=1 | echo fg | B=2`
    .stdout("")
    .stderr("")
    .exitCode(0)
    .runAsTest("should send the output of a command to the assignment after it");

  // Assignments that look like commands
  TestBuilder.command`echo=notecho ls=notls | echo real`
    .stdout("real\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle assignments that shadow command names");

  // Complex nested pipeline with subshells and assignments
  TestBuilder.command`(A=1 | echo inner) | B=2 | echo outer`
    .stdout("outer\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle assignments in subshells within pipelines");

  // Assignment with line continuation (if supported)
  TestBuilder.command`MULTI="line1 \
    line2" | echo multiline`
    .stdout("multiline\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle multi-line assignment values");

  // Edge case: assignment-like patterns that aren't assignments
  TestBuilder.command`echo A=1 | B=2 | cat`
    .stdout("")
    .stderr("")
    .exitCode(0)
    .runAsTest("should not pass assignment-like echo output through an assignment");

  // Verify assignments don't affect the shell environment
  TestBuilder.command`TEST_VAR=should_not_persist | echo $TEST_VAR`
    .stdout("\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should not persist assignment variables in pipeline to shell environment");

  // Assignments with percent signs and other special chars
  TestBuilder.command`PERCENT="100%" DOLLAR="$100" | echo special_chars`
    .stdout("special_chars\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle percent signs and dollar signs in assignments");

  // Pipeline with error in command but assignments present
  TestBuilder.command`A=1 B=2 | false | C=3 | echo continue`
    .stdout("continue\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should continue pipeline even when command fails with assignments present");

  // Extreme case: single character variable names
  TestBuilder.command`A=a B=b C=c D=d E=e F=f G=g H=h I=i J=j | echo singles`
    .stdout("singles\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle single character variable names");

  // Assignment with tabs and other whitespace
  TestBuilder.command`TAB="	" SPACE=" " | echo whitespace`
    .stdout("whitespace\n")
    .stderr("")
    .exitCode(0)
    .runAsTest("should handle tabs and spaces in assignment values");
});

// bash and dash run every member of a pipeline, also a member that has only assignments.
describe("shell: an assignment-only pipeline member runs like any other member", () => {
  TestBuilder.command`echo hi | FOO=bar`.runAsTest("takes the output of the member before it");

  TestBuilder.command`FOO=1 | false`.exitCode(1).runAsTest("as the first member, leaves the status to the last member");

  TestBuilder.command`true | false | FOO=1`.runAsTest("as the last member, gives the status");

  TestBuilder.command`A=1 | B=2`.runAsTest("as every member");

  TestBuilder.command`true | FOO=$(echo x > side.txt)`
    .fileEquals("side.txt", "x\n")
    .runAsTest("as the last member, runs its command substitution");

  TestBuilder.command`FOO=$(echo x > side.txt) | true`
    .fileEquals("side.txt", "x\n")
    .runAsTest("as the first member, runs its command substitution");

  TestBuilder.command`echo up | FOO=$(echo inner) | cat`.runAsTest(
    "as a middle member, writes nothing to the next member",
  );

  TestBuilder.command`true | A=1 B=$(echo "[$A]" > side.txt)`
    .fileEquals("side.txt", "[1]\n")
    .runAsTest("a later assignment sees an earlier assignment of the same member");

  TestBuilder.command`true | FOO=1; echo "[$FOO]"`.stdout("[]\n").runAsTest("does not set a variable of the shell");

  TestBuilder.command`FOO=old; true | FOO=new; echo "[$FOO]"`
    .stdout("[old]\n")
    .runAsTest("does not change a variable of the shell");

  TestBuilder.command`echo "[$(echo hi | FOO=bar)]"`.stdout("[]\n").runAsTest("in a command substitution");

  TestBuilder.command`(echo hi | FOO=bar)`.runAsTest("in a subshell");

  TestBuilder.command`if echo hi | FOO=bar; then echo yes; fi`.stdout("yes\n").runAsTest("in an if condition");

  TestBuilder.command`false || echo hi | FOO=bar`.runAsTest("after ||");

  // `cat` reads to the end of its input. The end comes when the member before it is done.
  TestBuilder.command`FOO=$(${bunExe()} -e ${"require('fs').writeFileSync('side.txt', 'x\\n')"}) | (cat; cat side.txt)`
    .ensureTempDir()
    .env(bunEnv)
    .stdout("x\n")
    .runAsTest("keeps its pipe ends open until it is done");

  TestBuilder.command`echo late | ${bunExe()} exec ${"FOO=bar | cat"}`
    .env(bunEnv)
    .runAsTest("in bun exec, the member after it does not read the stdin of the shell");

  TestBuilder.command`${bunExe()} script.sh`
    .file("script.sh", "echo hi | FOO=bar\nFOO=1 | false\n")
    .env(bunEnv)
    .exitCode(1)
    .runAsTest("in a .sh file");

  // The status of a pipeline is the status of its last member. So it is the status of the
  // same assignment as a statement, for any status that statement reports.
  test.each(["FOO=$(false)", "FOO=$(exit 3)", "A=1 B=$(false)", "FOO=$(exit 3) BAR=lit"])(
    "`true | %s` has the status of the assignment alone",
    async assignment => {
      const alone = await $`${{ raw: assignment }}`.quiet().nothrow();
      const piped = await $`${{ raw: `true | ${assignment}` }}`.quiet().nothrow();
      expect(piped.exitCode).toBe(alone.exitCode);
    },
  );

  test("a member that writes without end stops when the assignment after it is done", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "exec", "yes | FOO=bar"],
      env: bunEnv,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isLinux)("frees the env and the pipe ends of each member", async () => {
    const fixture = [
      'import { $ } from "bun";',
      'import { readdirSync } from "node:fs";',
      'const lines = ["A=1 | B=2 | true", "true | FOO=bar", "FOO=$(echo x) | BAR=$(false) | true"];',
      "const run = async () => { for (const raw of lines) await $`${{ raw }}`.quiet().nothrow(); };",
      "for (let i = 0; i < 5; i++) await run();",
      'const before = readdirSync("/proc/self/fd").length;',
      "for (let i = 0; i < 50; i++) await run();",
      'console.log(readdirSync("/proc/self/fd").length - before);',
    ].join("\n");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("0\n");
    expect(exitCode).toBe(0);
  });
});
