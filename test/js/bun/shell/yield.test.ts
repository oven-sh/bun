import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { createTestBuilder } from "./test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("yield", async () => {
  const array = Array(10000).fill("a");
  TestBuilder.command`echo -n ${array} > myfile.txt`
    .exitCode(0)
    .fileEquals("myfile.txt", array.join(" "))
    .runAsTest("doesn't stackoverflow");

  // A synchronously failing write (/dev/full, Linux-only: write(2) gives ENOSPC)
  // used to re-enter the `Yield::run` trampoline from `IOWriter::on_error`, one
  // nesting level per failing command, tripping the interpreter's re-entrancy
  // guard. Spawn a subprocess so the aborting child stays contained.
  async function expectShellOutput(script: string, expected: { stdout: string; exitCode: number }) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { $ } from "bun";
        $.nothrow();
        const r = await $\`${script}\`.quiet();
        console.log(JSON.stringify({ stdout: r.stdout.toString(), exitCode: r.exitCode }));
        `,
        // If the child does crash, skip the debug build's slow symbolized
        // backtrace so the failure is the panic message, not a test timeout.
        "--debug-crash-handler-use-trace-string",
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ result: stdout.trim(), stderr, exitCode }).toEqual({
      result: JSON.stringify(expected),
      stderr: expect.any(String),
      exitCode: 0,
    });
  }

  // Each nested command substitution opens its own /dev/full fd, and every
  // level's error completion used to start one more nested trampoline. The
  // `|| echo` only runs if the outer write really got ENOSPC.
  test.if(isLinux)("synchronous write errors in nested command substitutions", async () => {
    await expectShellOutput(
      "echo $(echo $(echo $(echo a > /dev/full) > /dev/full) > /dev/full) > /dev/full || echo outer_write_failed",
      { stdout: "outer_write_failed\n", exitCode: 0 },
    );
  });

  // Same without any nesting: each statement's error completion used to start
  // the next statement from inside one more nested trampoline. Every `|| echo`
  // branch runs only if its /dev/full write failed.
  test.if(isLinux)("synchronous write errors in sequential statements", async () => {
    await expectShellOutput(
      "echo a > /dev/full || echo f1; echo b > /dev/full || echo f2; echo c > /dev/full || echo f3; echo d > /dev/full || echo f4",
      { stdout: "f1\nf2\nf3\nf4\n", exitCode: 0 },
    );
  });

  test.if(isLinux)("builtin cat completing on a synchronous write error leaves the shell usable", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { $ } from "bun";
        $.nothrow();
        const results = [];
        for (const run of [
          () => $\`echo hello | cat > /dev/full || echo write_failed\`,
          () => $\`echo again | cat > /dev/full || echo write_failed_again\`,
          () => $\`echo next | cat\`,
        ]) {
          const r = await run().quiet();
          results.push({ stdout: r.stdout.toString(), exitCode: r.exitCode });
        }
        console.log(JSON.stringify(results));
        `,
        "--debug-crash-handler-use-trace-string",
      ],
      env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ result: stdout.trim(), stderr, exitCode }).toEqual({
      result: JSON.stringify([
        { stdout: "write_failed\n", exitCode: 0 },
        { stdout: "write_failed_again\n", exitCode: 0 },
        { stdout: "next\n", exitCode: 0 },
      ]),
      stderr: "",
      exitCode: 0,
    });
  });
});
