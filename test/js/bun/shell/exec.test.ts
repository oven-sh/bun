import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
import { chmodSync, realpathSync } from "node:fs";
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

  // One plain command runs in place of `bun exec`, as `sh -c` does, so the
  // program is the process a parent signals and waits for.
  test.skipIf(isWindows)("a single plain command replaces the bun exec process", async () => {
    const script = `${BUN} -e "console.log(process.ppid)"`;
    await using proc = Bun.spawn({ cmd: [BUN, "exec", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(Number(stdout.trim())).toBe(process.pid);
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("a VAR=value prefix reaches the program that replaces the process", async () => {
    const script = `EXEC_PREFIX=set ${BUN} -e "console.log(process.env.EXEC_PREFIX, process.ppid)"`;
    await using proc = Bun.spawn({ cmd: [BUN, "exec", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(`set ${process.pid}`);
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("a PATH= prefix applies to the lookup of the command", async () => {
    // `cat` exists on the inherited PATH too: the prefixed one must win.
    using dir = tempDir("exec-path-prefix", { "bin/cat": "#!/bin/sh\necho from-prefix-path\n" });
    chmodSync(join(String(dir), "bin", "cat"), 0o755);
    const script = `PATH=${join(String(dir), "bin")} cat`;
    await using proc = Bun.spawn({ cmd: [BUN, "exec", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("from-prefix-path\n");
    expect(exitCode).toBe(0);
  });

  test("PWD is the working directory of bun exec", async () => {
    using dir = tempDir("exec-pwd", {});
    const script = `${BUN} -e "console.log(process.env.PWD)"`;
    await using proc = Bun.spawn({
      cmd: [BUN, "exec", script],
      cwd: String(dir),
      env: { ...bunEnv, PWD: "/elsewhere" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(realpathSync(stdout.trim())).toBe(realpathSync(String(dir)));
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("the program that replaces the process gets the default SIGPIPE", async () => {
    // Bun ignores SIGPIPE. A program spawned by a shell does not inherit that.
    const probe = `${BUN} exec 'cat /dev/zero' | head -c 4 >/dev/null; echo \${PIPESTATUS[0]}`;
    await using proc = Bun.spawn({ cmd: ["bash", "-c", probe], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // 128 + SIGPIPE(13): cat died of the signal, it did not see EPIPE.
    expect(stdout.trim()).toBe("141");
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("a script with more than one command keeps the bun exec process", async () => {
    const script = `true && ${BUN} -e "console.log(process.ppid)"`;
    await using proc = Bun.spawn({ cmd: [BUN, "exec", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(Number(stdout.trim())).toBe(proc.pid);
    expect(exitCode).toBe(0);
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
