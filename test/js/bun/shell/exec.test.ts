import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
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

  describe("--help works", () => {
    // prettier-ignore
    const programs = [
      // ["cat",    1, "", ""],
      ["touch",  1, "touch: illegal option -- -\n", ""],
      ["mkdir",  1, "mkdir: illegal option -- -\n", ""],
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

  // Like getopt(3), the message names the one byte that was rejected, wherever
  // it sits in a cluster of short flags. An unknown --long option is rejected
  // at its second `-`, so it is reported as `-` (what BSD getopt prints too).
  describe.concurrent("illegal option names the rejected flag", () => {
    // prettier-ignore
    const programs: [program: string, cases: [args: string, rejected: string][]][] = [
      ["cat",   [["-z", "z"], ["-zb", "z"],                 ["--bogus", "-"]]],
      ["touch", [["-z", "z"], ["-za", "z"],                 ["--bogus", "-"]]],
      ["mkdir", [["-z", "z"], ["-pz", "z"], ["-zp", "z"],   ["--bogus", "-"]]],
      ["cp",    [["-z", "z"], ["-zR", "z"],                 ["--bogus", "-"]]],
      ["ls",    [["-z", "z"], ["-az", "z"], ["-za", "z"],   ["--bogus", "-"]]],
      ["rm",    [["-z", "z"], ["-rz", "z"], ["-zr", "z"],   ["--bogus", "-"]]],
      ["mv",    [["-z", "z"], ["-fz", "z"], ["-zf", "z"],   ["--bogus", "-"]]],
    ];
    for (const [program, cases] of programs) {
      for (const [args, rejected] of cases) {
        TestBuilder.command`${BUN} exec ${`${program} ${args}`}`
          // cat and cp are builtins only on Windows unless this flag is set.
          .env({ ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" })
          .exitCode(1)
          .stderr(`${program}: illegal option -- ${rejected}\n`)
          .stdout("")
          .runAsTest(`${program} ${args}`);
      }
    }
  });

  // Recognised but unimplemented options take the other branch of the same parser result.
  describe.concurrent("unsupported option names the option", () => {
    for (const [program, option] of [
      ["cat", "-n"],
      ["touch", "--no-create"],
      ["cp", "-i"],
    ]) {
      TestBuilder.command`${BUN} exec ${`${program} ${option}`}`
        .env({ ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" })
        .exitCode(1)
        .stderr(`${program}: unsupported option, please open a GitHub issue -- ${option}\n`)
        .stdout("")
        .runAsTest(`${program} ${option}`);
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
