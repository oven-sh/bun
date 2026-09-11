import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
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

  // A state can throw a JS error (here: a `${value}` redirect target the command
  // cannot use, or a failed write of a "command not found" message). When the
  // command is not the first thing the script runs, the trampoline is driven
  // by an event-loop callback (a process exit, a thread-pool task, a pipe
  // write), not by the `.run()` host call. The promise must still reject with
  // the error, nothing may stay pending on the VM, a GC afterwards must be
  // safe, and the process must exit on its own.
  describe("a state that throws a JS error rejects the shell promise", () => {
    function child(body: string) {
      return [
        bunExe(),
        "-e",
        `
        import { $ } from "bun";
        import { heapStats } from "bun:jsc";
        import { readdirSync } from "node:fs";
        const settle = p => p.then(r => "resolved " + r.exitCode, e => "rejected " + e.constructor.name + ": " + e.message);
        const bun = process.execPath;
        ${body}
        `,
        "--debug-crash-handler-use-trace-string",
      ];
    }

    async function expectRejection(shell: string, rejection: string) {
      await using proc = Bun.spawn({
        cmd: child(`
          const out = [await settle(${shell})];
          Bun.gc(true);
          // The VM is still usable: no exception was left pending on it.
          out.push(await settle($\`echo ok\`.quiet()));
          Bun.gc(true);
          console.log(JSON.stringify(out));
        `),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ result: stdout.trim(), stderr, exitCode }).toEqual({
        result: JSON.stringify([rejection, "resolved 0"]),
        stderr: "",
        exitCode: 0,
      });
    }

    const external = "rejected TypeError: Blobs are immutable, and cannot be used for stdout/stderr";
    const builtin = "rejected Error: Cannot redirect stdout/stderr to an immutable blob. Expected a file";

    test.concurrent("external command after another command", async () => {
      await expectRejection("$`${bun} --version; ${bun} --version > ${new Response('r')}`.quiet().nothrow()", external);
    });

    test.concurrent("builtin after another command", async () => {
      await expectRejection("$`${bun} --version; echo hi > ${new Blob(['x'])}`.quiet().nothrow()", builtin);
    });

    test.concurrent("builtin after a builtin that ran on the thread pool", async () => {
      await expectRejection("$`ls .; echo hi > ${new Blob(['x'])}`.quiet().nothrow()", builtin);
    });

    test.concurrent("in an && chain after another command", async () => {
      await expectRejection("$`${bun} --version && echo hi > ${new Blob(['x'])} && echo no`.quiet()", builtin);
    });

    test.concurrent("last member of a pipeline", async () => {
      await expectRejection(
        "$`${bun} --version | ${bun} --version > ${new Response('r')}`.quiet().nothrow()",
        external,
      );
    });

    // This one always rejected (the error comes straight out of `.run()`), but
    // the interpreter was never finished and kept the event loop alive forever.
    test.concurrent("first command, and the process still exits", async () => {
      await expectRejection("$`echo hi > ${new Blob(['x'])}; echo no`.quiet().nothrow()", builtin);
    });

    // No misuse of the API here: the shell's own stderr is full, so the write
    // of "bun: command not found" fails, and that failure is thrown.
    test.concurrent.if(isLinux)("a failed write of the command-not-found message", async () => {
      await using proc = Bun.spawn({
        cmd: child(`
          const out = [await settle($\`\${bun} --version > /dev/null; command-that-does-not-exist-xyz\`)];
          Bun.gc(true);
          out.push(await settle($\`echo ok\`.quiet()));
          console.log(JSON.stringify(out));
        `),
        env: bunEnv,
        stdout: "pipe",
        stderr: Bun.file("/dev/full"),
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect({ result: stdout.trim(), exitCode }).toEqual({
        result: JSON.stringify(["rejected Error: No space left on device", "resolved 0"]),
        exitCode: 0,
      });
    });

    // Once every member of a failed script has exited, the interpreter must
    // become collectable, not stay pinned until the process exits.
    test.concurrent("failed scripts are collected", async () => {
      await using proc = Bun.spawn({
        cmd: child(`
          let rejected = 0;
          for (let i = 0; i < 10; i++) {
            await $\`ls .; echo hi > \${new Blob(["x"])}\`.quiet().then(() => {}, () => rejected++);
            await $\`\${bun} --version | echo hi > \${new Blob(["x"])}\`.quiet().then(() => {}, () => rejected++);
          }
          let live;
          for (let i = 0; i < 10; i++) {
            Bun.gc(true);
            live = heapStats().objectTypeCounts.ShellInterpreter ?? 0;
            if (live <= 3) break;
            await new Promise(resolve => setImmediate(resolve));
          }
          console.log(JSON.stringify({ rejected, collected: live <= 3 ? true : live }));
        `),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ result: stdout.trim(), stderr, exitCode }).toEqual({
        result: JSON.stringify({ rejected: 20, collected: true }),
        stderr: "",
        exitCode: 0,
      });
    });

    // When the member that throws is part of a pipeline, the members that
    // already run must stop and the members after it must never start. Until
    // that happened, a producer that wrote more than the pipe buffer blocked
    // on a pipe end nobody closed, and the process never exited.
    describe("the other members of the pipeline stop", () => {
      // 1 MiB: more than the pipe buffer, so the write blocks until the read end closes.
      const producer = "${bun} -e ${'process.stdout.write(Buffer.alloc(1 << 20, \"a\"))'}";
      const sleeper = "${bun} -e ${'setTimeout(() => {}, 100_000)'}";
      const bad = "${bun} --version > ${new Response('r')}";

      test.concurrent("a producer that writes more than the pipe buffer", async () => {
        await expectRejection(`$\`${producer} | ${bad}\`.quiet().nothrow()`, external);
      });

      test.concurrent("a member that never touches the pipe is killed", async () => {
        await expectRejection(`$\`${sleeper} | ${bad}\`.quiet().nothrow()`, external);
      });

      test.concurrent("the members after the failed one never start", async () => {
        await expectRejection(`$\`${producer} | ${bad} | ${sleeper} | \${bun} --version\`.quiet().nothrow()`, external);
      });

      test.concurrent("the failed member is the first one", async () => {
        await expectRejection(`$\`${bad} | ${sleeper}\`.quiet().nothrow()`, external);
      });

      // The glob runs on the thread pool. When it completes, the member must
      // not spawn its command.
      test.concurrent("a member whose glob expansion completes after the failure", async () => {
        await expectRejection(`$\`${sleeper} * | ${bad}\`.quiet().nothrow()`, external);
      });

      test.concurrent("a member inside a subshell is killed", async () => {
        await expectRejection(`$\`(${sleeper}; echo no) | ${bad}\`.quiet().nothrow()`, external);
      });

      test.concurrent("a command substitution in another member is stopped", async () => {
        await expectRejection(`$\`echo $(${sleeper}) | ${bad}\`.quiet().nothrow()`, external);
      });

      // The thread-pool task of `ls` completes after the failure and writes
      // to a pipe whose read end is closed by then.
      test.concurrent("a builtin producer on the thread pool", async () => {
        await expectRejection(
          `$\`ls ${"${" + JSON.stringify(import.meta.dir) + "}"} | ${bad}\`.quiet().nothrow()`,
          external,
        );
      });

      test.concurrent("nothing more of the script runs", async () => {
        using dir = tempDir("shell-failed-pipeline", {});
        await using proc = Bun.spawn({
          cmd: child(`
            const out = [await settle($\`(${sleeper}; touch a) | ${bad}; touch b\`.quiet().nothrow())];
            out.push(JSON.stringify(readdirSync(".")));
            console.log(JSON.stringify(out));
          `),
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });

        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect({ result: stdout.trim(), stderr, exitCode }).toEqual({
          result: JSON.stringify([external, "[]"]),
          stderr: "",
          exitCode: 0,
        });
      });
    });
  });
});
