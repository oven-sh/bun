import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { readdirSync } from "node:fs";
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
        const settle = p => p.then(r => "resolved " + r.exitCode, e => "rejected " + e.constructor.name + ": " + e.message);
        const bun = process.execPath;
        // Writes more than a pipe holds: blocks in write() until its reader reads or closes.
        const big = 'process.stdout.write(Buffer.alloc(1 << 20, "a"))';
        // Uses neither end of its pipe: only a signal ends it.
        const forever = "setInterval(() => {}, 1000)";
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

    // Without a pipeline nothing else is in flight when the command fails, so
    // the interpreter must become collectable, not stay pinned until exit.
    test.concurrent("failed scripts are collected", async () => {
      await using proc = Bun.spawn({
        cmd: child(`
          let rejected = 0;
          for (let i = 0; i < 10; i++) {
            await $\`ls .; echo hi > \${new Blob(["x"])}\`.quiet().then(() => {}, () => rejected++);
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
        result: JSON.stringify({ rejected: 10, collected: true }),
        stderr: "",
        exitCode: 0,
      });
    });

    // When a pipeline member fails, the members before it run and the members
    // after it did not start. The script is over: the pipe ends of the failed
    // member and of the members that did not start must close, the members
    // that run must end, nothing more of the script may run, and the
    // interpreter must be released once the last member is gone.
    describe("in a pipeline", () => {
      const fails = "${bun} --version > ${new Response('r')}";

      test.concurrent("a producer that blocks on the pipe to the failed member", async () => {
        await expectRejection("$`${bun} -e ${big} | " + fails + "`.quiet()", external);
      });

      test.concurrent("a member that uses neither end of its pipe", async () => {
        await expectRejection("$`${bun} -e ${forever} | " + fails + "`.quiet()", external);
      });

      test.concurrent("a builtin producer that never stops", async () => {
        await expectRejection("$`yes | " + fails + "`.quiet()", external);
      });

      test.concurrent("every member that runs, and the shell's own stdout and stderr", async () => {
        await expectRejection("$`${bun} -e ${forever} | ${bun} -e ${big} | " + fails + "`", external);
      });

      test.concurrent("the members after the failed one", async () => {
        await expectRejection("$`${bun} -e ${big} | " + fails + " | ${bun} -e ${forever}`.quiet()", external);
      });

      test.concurrent("a pipeline inside a pipeline member", async () => {
        await expectRejection(
          "$`${bun} -e ${forever} | (${bun} -e ${big} | " + fails + ") | ${bun} -e ${forever}`.quiet()",
          external,
        );
      });

      test.concurrent("a pipeline inside a command substitution", async () => {
        await expectRejection("$`echo $(${bun} -e ${forever} | " + fails + " ; true)`.quiet()", external);
      });

      // `ls` reads the directory on the thread pool. The interpreter must not be
      // collected while that task can still call back into it.
      test.concurrent("a builtin with a thread-pool task in flight, with a GC before it completes", async () => {
        using dir = tempDir("shell-failed-pipeline-ls", {
          ...Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`file${i}.txt`, ""])),
        });
        await using proc = Bun.spawn({
          cmd: child(`
            const pending = settle($\`ls -R . | ${fails}\`.quiet());
            for (let i = 0; i < 5; i++) {
              Bun.gc(true);
              await new Promise(resolve => setImmediate(resolve));
            }
            const out = [await pending];
            Bun.gc(true);
            out.push(await settle($\`echo ok\`.quiet()));
            Bun.gc(true);
            console.log(JSON.stringify(out));
          `),
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });

        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect({ result: stdout.trim(), stderr, exitCode }).toEqual({
          result: JSON.stringify([external, "resolved 0"]),
          stderr: "",
          exitCode: 0,
        });
      });

      test.concurrent("nothing more of the script runs", async () => {
        using dir = tempDir("shell-failed-pipeline-rest", {});
        await using proc = Bun.spawn({
          cmd: child(`
            console.log(await settle($\`(\${bun} -e \${forever}; touch in-member) | ${fails}; touch after-pipeline\`.quiet()));
          `),
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });

        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect({ result: stdout.trim(), stderr, exitCode, files: readdirSync(String(dir)) }).toEqual({
          result: external,
          stderr: "",
          exitCode: 0,
          files: [],
        });
      });

      test.concurrent("failed pipelines are collected once their members are gone", async () => {
        await using proc = Bun.spawn({
          cmd: child(`
            let rejected = 0;
            const count = () => rejected++;
            for (let i = 0; i < 3; i++) {
              await $\`\${bun} -e \${forever} | ${fails} | yes\`.quiet().then(() => {}, count);
              await $\`yes | yes | ${fails}\`.quiet().then(() => {}, count);
              await $\`${fails} | yes\`.quiet().then(() => {}, count);
            }
            // The killed members report from the event loop, after the rejection.
            let live;
            for (const deadline = performance.now() + 30_000; performance.now() < deadline; ) {
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
          result: JSON.stringify({ rejected: 9, collected: true }),
          stderr: "",
          exitCode: 0,
        });
      });
    });
  });
});
