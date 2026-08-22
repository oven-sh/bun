import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, tempDir } from "harness";
import { closeSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestBuilder } from "./test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe.if(isPosix)("IOWriter epipe", () => {
  TestBuilder.command`yes | head`
    .exitCode(0)
    .stdout("y\ny\ny\ny\ny\ny\ny\ny\ny\ny\n")
    .runAsTest("builtin pipe to command");

  test("concurrent", async () => {
    const promises = Array(100)
      .fill(0)
      .map(() => Bun.$`yes | head`.text());

    const results = await Promise.all(promises);
    for (const result of results) {
      expect(result).toBe("y\ny\ny\ny\ny\ny\ny\ny\ny\ny\n");
    }
  });
});

// A command whose output the shell cannot write exits 1, the status bash
// builtins and coreutils use for a write error. EPIPE (nothing reads the
// output anymore, which kills an external command through SIGPIPE without a
// message) is silent; any other errno is reported on stderr. Before, every
// builtin derived its own status from the errno (echo: 65504, the negated
// errno as u16; ls, mkdir -v, rm -v: 0; an external command: the errno in
// place of its own status) and none of them printed anything.
describe.if(isPosix)("exit status when the command's output cannot be written", () => {
  const builtins = ["echo", "pwd", "which", "seq", "basename", "dirname", "export", "yes", "ls", "cat", "mkdir", "rm"];

  // Runs write-error-fixture.ts with the given fd 1 and returns what it
  // recorded for each command: `[exitCode, stderr]`. The shell also echoes
  // each command's stderr to the fixture's own stderr, so that has to be
  // exactly the recorded reports and nothing else.
  async function runFixture(stdout: "pipe" | number): Promise<Record<string, unknown>> {
    using dir = tempDir("shell-write-error", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "write-error-fixture.ts")],
      cwd: String(dir),
      // Makes `cat` a builtin on POSIX too.
      env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
      stdin: "ignore",
      stdout,
      stderr: "pipe",
    });
    if (stdout === "pipe") {
      await proc.stdout.cancel();
    } else {
      closeSync(stdout);
    }
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(exitCode, stderr).toBe(0);
    const results: Record<string, unknown> = JSON.parse(readFileSync(join(String(dir), "results.json"), "utf8"));
    const echoed = Object.values(results)
      .filter(Array.isArray)
      .map(([, commandStderr]) => commandStderr)
      .join("");
    expect(stderr).toBe(echoed);
    return results;
  }

  test.concurrent("EPIPE: every command exits 1 and reports nothing", async () => {
    expect(await runFixture("pipe")).toEqual({
      true: [0, ""],
      ...Object.fromEntries(builtins.map(name => [name, [1, ""]])),
      external: [1, ""],
      "mkdir created dir": true,
      "rm removed file": true,
    });
  });

  test.concurrent.skipIf(!isLinux)("ENOSPC: every builtin exits 1 and reports the write error", async () => {
    expect(await runFixture(openSync("/dev/full", "w"))).toEqual({
      true: [0, ""],
      ...Object.fromEntries(builtins.map(name => [name, [1, `${name}: write error: No space left on device\n`]])),
      external: [1, ""],
      "mkdir created dir": true,
      "rm removed file": true,
    });
  });

  describe.if(isLinux)("redirected to /dev/full", () => {
    // `ls . .` lists twice: the second listing is rejected by the writer the
    // first one killed, and the error is still reported once.
    for (const [name, command] of [
      ["echo", "echo hi"],
      ["ls", "ls . ."],
      ["mkdir", "mkdir -v dir"],
      ["rm", "rm -v file"],
    ]) {
      TestBuilder.command`${{ raw: command }} > /dev/full`
        .ensureTempDir()
        .file("file", "")
        .exitCode(1)
        .stderr(`${name}: write error: No space left on device\n`)
        .runAsTest(command);
    }

    TestBuilder.command`echo hi &> /dev/full`
      .exitCode(1)
      .stderr("")
      .runAsTest("the report of the error goes to the same dead stream");

    TestBuilder.command`echo hi > /dev/full || echo recovered`
      .stdout("recovered\n")
      .stderr("echo: write error: No space left on device\n")
      .exitCode(0)
      .runAsTest("the status is visible to ||");
  });
});
