import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";
import { createTestBuilder } from "./test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

const BUN = bunExe();

$.nothrow();
describe("bun exec", () => {
  TestBuilder.command`${BUN} exec ${"echo hi!"}`.env(bunEnv).stdout("hi!\n").runAsTest("it works");
  TestBuilder.command`${BUN} exec sldkfjslkdjflksdjflj`
    .env(bunEnv)
    .exitCode(1)
    .stderr("bun: command not found: sldkfjslkdjflksdjflj\n")
    .runAsTest("it works on command fail");

  TestBuilder.command`${BUN} exec`
    .env(bunEnv)
    .stdout(
      'Usage: bun exec <script>\n\nExecute a shell script directly from Bun.\n\nNote: If executing this from a shell, make sure to escape the string!\n\nExamples:\n  bun exec "echo hi"\n  bun exec "echo \\"hey friends\\"!"\n',
    )
    .runAsTest("no args prints help text");

  TestBuilder.command`${BUN} exec ${{ raw: Bun.$.escape(`echo 'hi "there bud"'`) }}`
    .stdout('hi "there bud"\n')
    .runAsTest("it works2");

  TestBuilder.command`${BUN} exec ${"cat filename"}`
    .file(
      "filename",
      Array(128 * 1024)
        .fill("a")
        .join(""),
    )
    .env(bunEnv)
    .stdout(
      `${Array(128 * 1024)
        .fill("a")
        .join("")}`,
    )
    .runAsTest("write a lot of data");

  // Like getopt(3), a builtin names the one byte that it rejects. touch, mkdir, cat and cp name a whole `--word`.
  describe("an illegal option is named", () => {
    const illegal = (builtin: string, option: string) => `${builtin}: illegal option -- ${option}\n`;
    const unsupported = (builtin: string, option: string) =>
      `${builtin}: unsupported option, please open a GitHub issue -- ${option}\n`;
    // prettier-ignore
    const messages = {
      "touch -Z":              illegal("touch", "Z"),
      "touch -Zq":             illegal("touch", "Z"),
      "touch -Za":             illegal("touch", "Z"),
      "touch --bogus":         illegal("touch", "bogus"),
      "mkdir -Z":              illegal("mkdir", "Z"),
      "mkdir -pZq":            illegal("mkdir", "Z"),
      "mkdir -pvZ":            illegal("mkdir", "Z"),
      "mkdir -Zp d":           illegal("mkdir", "Z"),
      "mkdir -Zm d":           illegal("mkdir", "Z"),
      "mkdir -p -Z d":         illegal("mkdir", "Z"),
      "mkdir --parents -Zq d": illegal("mkdir", "Z"),
      "mkdir --bogus d":       illegal("mkdir", "bogus"),
      "cat -Z":                illegal("cat", "Z"),
      "cat -Zq":               illegal("cat", "Z"),
      "cat --bogus":           illegal("cat", "bogus"),
      "cp -Z a b":             illegal("cp", "Z"),
      "cp -Zq a b":            illegal("cp", "Z"),
      "cp --bogus a b":        illegal("cp", "bogus"),
      "ls -az":                illegal("ls", "z"),
      "ls -l%q":               illegal("ls", "%"),
      "ls --bogus":            illegal("ls", "-"),
      "mv -Z a b":             illegal("mv", "Z"),
      "mv -fZ a b":            illegal("mv", "Z"),
      "mv --bogus a b":        illegal("mv", "-"),
      "rm -rZq":               illegal("rm", "Z"),
      "rm --bogus":            illegal("rm", "-"),
      // A quoted string is one argument, so the rejected byte is its space.
      "rm '-r -f' d":          illegal("rm", " "),
      "mkdir '-p -v' d":       illegal("mkdir", " "),
      // One byte of a longer character is not valid UTF-8.
      "touch -€":              illegal("touch", "\uFFFD"),
      "rm -é":                 illegal("rm", "\uFFFD"),
      // An option that comes first is still the one that is reported.
      "touch -aZ":             unsupported("touch", "-a"),
    };

    test.concurrent.each([
      ["a file descriptor", "inherit"],
      ["a buffer", "quiet"],
    ])("when stderr is %s", async (_, mode) => {
      using dir = tempDir("shell-illegal-option", {
        "commands.json": JSON.stringify(Object.keys(messages)),
        "illegal-option-fixture.ts": /* ts */ `
          import { $ } from "bun";
          import commands from "./commands.json";

          $.nothrow();
          const results: Record<string, unknown> = {};
          for (const command of commands) {
            const run = $\`\${{ raw: command }}\`;
            const { exitCode, stdout, stderr } = await (process.argv[2] === "quiet" ? run.quiet() : run);
            results[command] = { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
          }
          console.log(JSON.stringify(results));
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "illegal-option-fixture.ts", mode],
        // cat and cp are builtins only on Windows unless this is set. The other builtins do not read it.
        env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // Without .quiet() each command also writes its message to the stderr of the process.
      expect(stderr).toBe(mode === "quiet" ? "" : Object.values(messages).join(""));
      expect(JSON.parse(stdout)).toEqual(
        Object.fromEntries(
          Object.entries(messages).map(([command, message]) => [command, { exitCode: 1, stdout: "", stderr: message }]),
        ),
      );
      expect(exitCode).toBe(0);
    });
  });

  describe("--help works", () => {
    // prettier-ignore
    const programs = [
      // ["cat",    1, "", ""],
      ["touch",  1, "touch: illegal option -- help\n", ""],
      ["mkdir",  1, "mkdir: illegal option -- help\n", ""],
      // ["cd",     1, "cd: no such file or directory: --help\n", ""],
      ["echo",   0, "", "--help\n"],
      ["pwd",    1, "pwd: too many arguments\n", ""],
      // ["which",  1, "--help not found\n", ""],
      ["rm",     1, "rm: illegal option -- -\n", ""],
      ["mv",     1, "mv: illegal option -- -\n", ""],
      ["ls",     1, "ls: illegal option -- -\n", ""],
      ["exit",   1, "exit: numeric argument required\n", ""],
      ["true",   0, "", ""],
      ["false",  1, "", ""],
      // ["yes",    1, "", ""],
      ["seq",    1, "seq: invalid argument\n", ""],
    ] as const;
    for (const [item, exitCode, stderr, stdout] of programs) {
      TestBuilder.command`${BUN} exec ${`${item} --help`}`
        .env(bunEnv)
        .exitCode(exitCode)
        .stderr(stderr)
        .stdout(stdout)
        .runAsTest(item);
    }
  });

  TestBuilder.command`${BUN} exec cd`
    .env(bunEnv)
    .exitCode(0)
    .stderr("")
    .stdout("")
    .runAsTest("cd with no arguments works");

  test("bun works even when not in PATH", async () => {
    const val = await $`bun exec 'bun'`.env({ ...bunEnv, PATH: "" }).nothrow();
    expect(val.stderr.toString()).not.toContain("bun: command not found: bun");
    expect(val.stdout.toString()).toContain("Bun is a fast JavaScript runtime");
  });

  test("works with latin1 paths", async () => {
    const tempdir = tmpdirSync();
    const abs = join(tempdir, "Í", "hi");
    await Bun.write(abs, "text");
    const result = await $`${BUN} exec ls`
      .env({ ...(bunEnv as any) })
      .cwd(join(tempdir, "Í"))
      .quiet();
    expect(result.text()).toBe("hi\n");
  });
});
