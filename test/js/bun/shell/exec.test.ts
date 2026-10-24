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

  TestBuilder.command`${BUN} exec ${'FOO=bar; echo ${FOO} "${FOO}" ${FOO}baz'}`
    .env(bunEnv)
    .stdout("bar bar barbaz\n")
    .runAsTest("expands ${NAME}");

  TestBuilder.command`${BUN} exec ${'FOO=bar; echo ${FOO:-none} ${NONE:-"a  b"} ${FOO:+set}; echo ${NONE:=made} $NONE'}`
    .env(bunEnv)
    .stdout("bar a  b set\nmade made\n")
    .runAsTest("expands ${NAME<op>word}");

  TestBuilder.command`${BUN} exec ${'true "${NONE:?need NONE}" && echo RAN'}`
    .env(bunEnv)
    .stderr("bun: NONE: need NONE\n")
    .exitCode(1)
    .runAsTest("${NAME:?word} fails the command when NAME is not set");

  TestBuilder.command`${BUN} exec ${"ENV=${NONE:?} echo cmd"}`
    .env(bunEnv)
    .stderr("bun: NONE: parameter null or not set\n")
    .exitCode(1)
    .runAsTest("${NAME:?word} in an assignment before a command");

  TestBuilder.command`${BUN} script.sh`
    .file("script.sh", "ENV=${NONE:?need NONE}\n")
    .env(bunEnv)
    .stderr("bun: NONE: need NONE\n")
    .exitCode(1)
    .runAsTest("${NAME:?word} in an assignment in a .sh file");

  TestBuilder.command`${BUN} script.sh`
    .file("script.sh", 'FOO=bar\necho ${FOO} "${FOO}" ${FOO}baz ${NONE:-é ${FOO:+ü}}\n')
    .env(bunEnv)
    .stdout("bar bar barbaz é ü\n")
    .runAsTest("expands ${NAME} and ${NAME<op>word} in a .sh file");

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
