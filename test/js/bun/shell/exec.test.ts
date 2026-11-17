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

  test("bad options get the same message captured and on a file descriptor", async () => {
    const unsupported = "unsupported option, please open a GitHub issue -- ";
    const expected = {
      "cat -": "cat: illegal option -- -\n",
      "cat -zq": "cat: illegal option -- q\n",
      "cat -n f": `cat: ${unsupported}-n\n`,
      "cp -zq a b": "cp: illegal option -- zq\n",
      "cp -f a b": `cp: ${unsupported}-f\n`,
      "cp -p a b": `cp: ${unsupported}-P\n`,
      "ls -a@": "ls: illegal option -- a\n",
      "mkdir -pzq a": "mkdir: illegal option -- q\n",
      "mkdir -pm 1 a": `mkdir: ${unsupported}-m \n`,
      "mkdir --mode": `mkdir: ${unsupported}--mode\n`,
      "mv -z a b": "mv: illegal option -- -\n",
      "rm -fz a": "rm: illegal option -- fz\n",
      "rm -- a": "rm: illegal option -- -\n",
      "rm -fi a": 'rm: "-i" is not supported yet',
      "rm -if": "usage: rm [-f | -i] [-dIPRrvWx] file ...\n       unlink [--] file\n",
      "seq -s": "seq: option requires an argument -- s\n",
      "touch -z": "touch: illegal option -- \n",
      "touch -a f": `touch: ${unsupported}-a\n`,
      "touch --time": `touch: ${unsupported}--reference=FILE\n`,
    };
    const script = `
      const seen = {};
      for (const raw of ${JSON.stringify(Object.keys(expected))}) {
        const captured = await Bun.$\`\${{ raw }}\`.quiet().nothrow();
        const redirected = await Bun.$\`\${{ raw }} 2> err\`.quiet().nothrow();
        seen[raw] = [captured.exitCode, captured.stderr.toString(), redirected.exitCode, await Bun.file("err").text()];
      }
      console.log(JSON.stringify(seen));
    `;
    using dir = tempDir("bad-options", {});
    await using proc = Bun.spawn({
      cmd: [BUN, "-e", script],
      env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
      cwd: String(dir),
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual(
      Object.fromEntries(Object.entries(expected).map(([raw, message]) => [raw, [1, message, 1, message]])),
    );
    expect(exitCode).toBe(0);
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
