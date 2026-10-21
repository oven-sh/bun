import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { closeSync, constants, existsSync, openSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

      // A ShellPromise starts when `then` is called. `expect().rejects` does
      // not call it, so await the promise here.
      async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
        try {
          await promise;
        } catch (e) {
          return e;
        }
        throw new Error("the shell promise resolved");
      }

      // The member that does not touch the pipe writes its pid first, and the
      // failing member waits for that file in a command substitution before it
      // throws. So the sleeper is alive when the script fails, and the test
      // can check that it is killed and reaped afterwards.
      test.concurrent("the killed member is gone after the rejection", async () => {
        using dir = tempDir("shell-failed-pipeline-pid", {});
        const bun = process.execPath;
        // By its full path: `dir` is nobody's working directory, which Windows does not let go of until some time
        // after `kill(pid, 0)` stops finding the process.
        const pidFile = join(String(dir), "pid");
        const writePid = `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 100_000)`;
        // For its content: the file is there before the pid is in it.
        const waitForPid = `const pid = () => { try { return require("fs").readFileSync(${JSON.stringify(pidFile)}, "utf8"); } catch { return ""; } }; while (!pid()) Bun.sleepSync(5); process.stdout.write("--version")`;
        expect(
          await rejectionOf(
            $`${bun} -e ${writePid} | ${bun} $(${bun} -e ${waitForPid}) > ${new Response("r")}`.quiet(),
          ),
        ).toMatchObject({ message: "Blobs are immutable, and cannot be used for stdout/stderr" });
        const pid = Number(await Bun.file(pidFile).text());
        expect(pid).toBeGreaterThan(0);
        // The kill is sent before the promise rejects. The shell reaps the
        // child when its exit reaches the event loop, so poll for that.
        const alive = () => {
          try {
            process.kill(pid, 0);
            return true;
          } catch (e) {
            expect(e).toMatchObject({ code: "ESRCH" });
            return false;
          }
        };
        for (let i = 0; i < 1000 && alive(); i++) await Bun.sleep(10);
        expect(alive()).toBe(false);
      });

      test.concurrent("two members fail: the first error rejects, the shell stays usable", async () => {
        expect(await rejectionOf($`echo a > ${new Blob(["x"])} | echo b > ${new Blob(["x"])}`.quiet())).toMatchObject({
          message: "Cannot redirect stdout/stderr to an immutable blob. Expected a file",
        });
        expect((await $`echo ok`.quiet().text()).trim()).toBe("ok");
      });

      test.concurrent("not quiet: the promise rejects and the shell stays usable", async () => {
        const bun = process.execPath;
        expect(
          await rejectionOf($`${bun} -e ${"setTimeout(() => {}, 100_000)"} | ${bun} --version > ${new Response("r")}`),
        ).toMatchObject({ message: "Blobs are immutable, and cannot be used for stdout/stderr" });
        expect((await $`echo ok`.text()).trim()).toBe("ok");
      });

      // A builtin runs in the shell's own process, so there is no child to
      // kill. It is stopped in place: it leaves the reader it listens on, its
      // queued output is dropped, and the pool work it has out ends it when
      // that work is back. Before, the failed script lasted as long as the
      // builtin did: until stdin ended for `cat`, and forever for `yes`.
      describe("a builtin that still runs is stopped", () => {
        // The builtin `cat` is the default on Windows only.
        const env = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };
        const failing = "echo hi > ${new Blob(['x'])}";
        /** `value` as a `${...}` interpolation in the child's script. */
        const js = (value: string) => "${" + JSON.stringify(value) + "}";

        /** A child that runs each script of `shapes` in turn and prints how each one settled. */
        function settleEach(shapes: Record<string, string>) {
          return child(`
            const out = {};
            ${Object.entries(shapes)
              .map(([name, shell]) => `out[${JSON.stringify(name)}] = await settle(${shell});`)
              .join("\n")}
            console.log(JSON.stringify(out));
          `);
        }

        /** Reads `stream` up to its first newline. `rest()` reads what follows, to the end. */
        async function firstLine(stream: ReadableStream<Uint8Array>) {
          const reader = stream.getReader();
          const decoder = new TextDecoder();
          let text = "";
          const read = async () => {
            const { value, done } = await reader.read();
            if (!done) text += decoder.decode(value, { stream: true });
            return !done;
          };
          while (!text.includes("\n") && (await read()));
          const end = text.includes("\n") ? text.indexOf("\n") : text.length;
          return {
            line: text.slice(0, end),
            async rest() {
              while (await read());
              return text.slice(end + 1);
            },
          };
        }

        // The child's stdin is a pipe that stays open and idle, so nothing ends
        // a `cat` that reads it, and the child has to exit all the same. Not on
        // Windows: a read the shell has started on stdin cannot be taken back
        // there, and the process waits for it.
        describe.skipIf(isWindows)("cat on a stdin that stays open", () => {
          /** Runs the scripts of `shapes` in turn, in one child whose stdin stays open. */
          async function settledWithStdinOpen(shapes: Record<string, string>) {
            await using proc = Bun.spawn({
              cmd: settleEach(shapes),
              env,
              stdin: "pipe",
              stdout: "pipe",
              stderr: "pipe",
            });

            const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

            return { result: JSON.parse(stdout || "null"), stderr, exitCode };
          }

          // A child for each place, so that a script that never settles names its place.
          test.concurrent.each([
            ["as a member", `cat | ${failing}`, builtin],
            ["as two members", `cat | cat | ${failing}`, builtin],
            ["next to an external command that throws", `cat | ${bad}`, external],
            ["in a subshell", `(cat; echo no) | ${failing}`, builtin],
            ["in an if", `if true; then cat; fi | ${failing}`, builtin],
            ["in a command substitution", `echo $(cat) | ${failing}`, builtin],
          ])("%s", async (place, script, rejection) => {
            expect(await settledWithStdinOpen({ [place]: `$\`${script}\`.quiet().nothrow()` })).toEqual({
              result: { [place]: rejection },
              stderr: "",
              exitCode: 0,
            });
          });

          // The member that throws runs a command substitution first, and the
          // `cat` in it is over before its start returns: epoll does not take
          // a regular file, and the reader reports that at once. (kqueue takes
          // the file, so this is for Linux.) The failure is then handled under
          // the trampoline that is still starting the pipeline, and that one
          // names the pipeline again afterwards: a stop that reported the first
          // `cat` at once would free the pipeline under it.
          test.concurrent.if(isLinux)("when the failure is handled under the start of the pipeline", async () => {
            const throws = `echo $(cat ${js(import.meta.path)}) > \${new Blob(["x"])}`;
            const shapes = {
              "after a cat": `$\`cat | ${throws}\`.quiet().nothrow()`,
              // No other member is left in these: reporting the failed one
              // there would end the pipeline under the trampoline that starts it.
              "as the first member": `$\`${throws} | cat\`.quiet().nothrow()`,
              "as the last member": `$\`true | ${throws}\`.quiet().nothrow()`,
            };

            expect(await settledWithStdinOpen(shapes)).toEqual({
              result: Object.fromEntries(Object.keys(shapes).map(name => [name, builtin])),
              stderr: "",
              exitCode: 0,
            });
          });

          // What arrives on stdin after the failure is not the stopped `cat`'s to read.
          test.concurrent("stdin is left to the process", async () => {
            await using proc = Bun.spawn({
              cmd: child(`
                const rejection = await settle($\`cat | ${failing}\`.quiet().nothrow());
                // The stopped builtins are reported on the next turn of the event loop.
                await new Promise(resolve => setImmediate(resolve));
                console.log(rejection);
                console.log(JSON.stringify(await Bun.stdin.text()));
              `),
              env,
              stdin: "pipe",
              stdout: "pipe",
              stderr: "pipe",
            });

            const stdout = await firstLine(proc.stdout);
            proc.stdin.write("after\n");
            await proc.stdin.end();
            const [rest, stderr, exitCode] = await Promise.all([stdout.rest(), proc.stderr.text(), proc.exited]);

            expect({ rejection: stdout.line, stdin: rest.trim(), stderr, exitCode }).toEqual({
              rejection: builtin,
              stdin: JSON.stringify("after\n"),
              stderr: "",
              exitCode: 0,
            });
          });

          // Two `cat`s read the script's stdin, each in a command substitution.
          // When stdin ends, the reader tells the first one, whose member then
          // throws, while the reader still has the second one to tell. That one
          // is stopped in between and gets the end of stdin all the same.
          test.concurrent("a cat that is stopped while its reader is reporting", async () => {
            await using proc = Bun.spawn({
              cmd: settleEach({
                "both read stdin": `$\`echo $(cat) > \${new Blob(["x"])} | echo $(cat)\`.quiet().nothrow()`,
                "the shell is usable": "$`echo ok`.quiet()",
              }),
              env,
              stdin: "pipe",
              stdout: "pipe",
              stderr: "pipe",
            });
            await proc.stdin.end();

            const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

            expect({ result: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
              result: { "both read stdin": builtin, "the shell is usable": "resolved 0" },
              stderr: "",
              exitCode: 0,
            });
          });
        });

        // `expect().resolves` turns the event loop where it stands, here inside
        // the catch block. The promise used to be rejected under the shell's
        // own frames, so that turn ran the exit of the killed member, or the
        // report of a stopped builtin, under them: the frames then named nodes
        // that were freed. The rejection now comes from a task of the event
        // loop. The child reports before its stdin ends (see the next test).
        test.concurrent("a catch block that turns the event loop", async () => {
          await using proc = Bun.spawn({
            cmd: child(`
              import { expect } from "bun:test";
              const idle = "setTimeout(() => {}, 100_000)";
              // The pipeline starts from the exit of the command before it: a callback of the event loop's poll.
              const scripts = {
                "a subprocess": () => $\`\${bun} --version; \${bun} -e \${idle} | ${failing}\`.quiet(),
                "a builtin": () => $\`\${bun} --version; cat | ${failing}\`.quiet(),
              };
              const out = {};
              for (const [name, script] of Object.entries(scripts)) {
                try {
                  await script();
                  out[name] = "resolved";
                } catch (error) {
                  // Long enough for the exit of the killed member to be there.
                  await expect(Bun.sleep(50).then(() => "turned")).resolves.toBe("turned");
                  out[name] = "rejected " + error.constructor.name + ": " + error.message;
                }
              }
              console.log(JSON.stringify(out));
            `),
            env,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
          });

          const stdout = await firstLine(proc.stdout);
          await proc.stdin.end();
          const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

          expect({ result: JSON.parse(stdout.line || "null"), stderr, exitCode }).toEqual({
            result: { "a subprocess": builtin, "a builtin": builtin },
            stderr: "",
            exitCode: 0,
          });
        });

        // Each failed script has to finish, not only let the process go: the
        // interpreter of one that does not is never collected. The child
        // reports before its stdin ends, so this one holds on Windows too.
        test.concurrent("the failed scripts finish while cat's stdin is still open", async () => {
          await using proc = Bun.spawn({
            cmd: child(`
              let rejected = 0;
              for (let i = 0; i < 10; i++) {
                await $\`cat | ${failing}\`.quiet().then(() => {}, () => rejected++);
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
            env,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
          });

          const stdout = await firstLine(proc.stdout);
          await proc.stdin.end();
          const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

          expect({ result: stdout.line, stderr, exitCode }).toEqual({
            result: JSON.stringify({ rejected: 10, collected: true }),
            stderr: "",
            exitCode: 0,
          });
        });

        // Both ends of the FIFO are held open here, so it never reports EOF.
        test.concurrent.skipIf(isWindows)("cat on a FIFO nobody writes to", async () => {
          using dir = tempDir("shell-stop-fifo", {});
          const fifo = join(String(dir), "fifo");
          await using mkfifo = Bun.spawn({ cmd: [Bun.which("mkfifo")!, fifo], env: bunEnv });
          expect(await mkfifo.exited).toBe(0);
          const holder = openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);
          try {
            const shapes = {
              "as an operand": `$\`cat ${js(fifo)} | ${failing}\`.quiet().nothrow()`,
              "as a redirect": `$\`cat < ${js(fifo)} | ${failing}\`.quiet().nothrow()`,
            };
            await using proc = Bun.spawn({ cmd: settleEach(shapes), env, stdout: "pipe", stderr: "pipe" });

            const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

            expect({ result: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
              result: { "as an operand": builtin, "as a redirect": builtin },
              stderr: "",
              exitCode: 0,
            });
          } finally {
            closeSync(holder);
          }
        });

        // No flag here: these are builtins on every platform. Nothing ends
        // `yes`, whose output is captured, so it runs from a task of the event
        // loop. `ls` has a pool task out per operand, and the output of those
        // would go to the pipe the failed member closed.
        //
        // A `yes` that is not stopped grows without bound, so the child does
        // not wait for the runner's timeout: it exits when the scripts are
        // still not collected after a few turns.
        test.concurrent("yes, and ls with pool tasks out", async () => {
          using dir = tempDir("shell-stop-ls", { "d1/a": "", "d2/b": "", "d3/c": "", "d4/d": "" });
          await using proc = Bun.spawn({
            cmd: child(`
              let rejected = 0;
              for (let i = 0; i < 10; i++) {
                await $\`yes 1>&2 | ${failing}\`.quiet().then(() => {}, () => rejected++);
              }
              const ls = await settle($\`ls d1 d2 d3 d4 | ${failing}\`.quiet().nothrow());
              let live;
              for (let i = 0; i < 10; i++) {
                Bun.gc(true);
                live = heapStats().objectTypeCounts.ShellInterpreter ?? 0;
                if (live <= 3) break;
                await new Promise(resolve => setImmediate(resolve));
              }
              console.log(JSON.stringify({ rejected, ls, collected: live <= 3 ? true : live }));
              if (live > 3) process.exit(1);
            `),
            env: bunEnv,
            cwd: String(dir),
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect({ result: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
            result: { rejected: 10, ls: builtin, collected: true },
            stderr: "",
            exitCode: 0,
          });
        });

        // These have pool tasks out too when the script fails, and each one
        // is over when its tasks are back. `rm -v` hands over, from the pool,
        // the names of what it removed before the stop. (`env`: `cp` is a
        // builtin by default on Windows only.)
        test.concurrent("mkdir, touch, cp and rm -v with pool tasks out", async () => {
          const files = ["from/x", "from/y", "to/keep", "scratch/a", "scratch/sub/b"];
          using dir = tempDir("shell-stop-pool", Object.fromEntries(files.map(file => [file, ""])));
          const shapes = {
            mkdir: `$\`mkdir -p m1/a m2/b m3/c | ${failing}\`.quiet().nothrow()`,
            touch: `$\`touch t1 t2 t3 | ${failing}\`.quiet().nothrow()`,
            cp: `$\`cp from/x from/y to | ${failing}\`.quiet().nothrow()`,
            "rm -v": `$\`rm -rfv scratch | ${failing}\`.quiet().nothrow()`,
          };
          await using proc = Bun.spawn({
            cmd: settleEach(shapes),
            env,
            cwd: String(dir),
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect({ result: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
            result: Object.fromEntries(Object.keys(shapes).map(name => [name, builtin])),
            stderr: "",
            exitCode: 0,
          });
        });

        // `mv` is still asking the thread pool what its target is when the
        // script fails. When the answer is back, nothing moves, and the
        // directory that the answer opened is closed again.
        test.concurrent("mv moves nothing", async () => {
          using dir = tempDir("shell-stop-mv", { a: "", b: "", c: "", "dest/keep": "" });
          await using proc = Bun.spawn({
            cmd: child(`
              const openFds = () => (process.platform === "linux" ? readdirSync("/proc/self/fd").length : 0);
              // What every script opens once is open before the count is taken.
              await $\`ls . | \${bun} --version\`.quiet();
              const before = openFds();
              const mv = await settle($\`mv a b c dest | ${failing}\`.quiet().nothrow());
              let leaked;
              for (let i = 0; i < 400; i++) {
                leaked = Math.max(0, openFds() - before);
                if (leaked === 0) break;
                await Bun.sleep(5);
              }
              console.log(JSON.stringify({ mv, leaked }));
            `),
            env: bunEnv,
            cwd: String(dir),
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect({ result: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
            result: { mv: builtin, leaked: 0 },
            stderr: "",
            exitCode: 0,
          });
          expect({
            here: readdirSync(String(dir)).sort(),
            dest: readdirSync(join(String(dir), "dest")),
          }).toEqual({ here: ["a", "b", "c", "dest"], dest: ["keep"] });
        });

        // The builtins below work on the thread pool, and nothing makes that
        // work wait for the failure. So the child's pool has two threads, and
        // each one is parked in a read of a FIFO that the child holds open for
        // writing: what the builtins put on the pool starts after the script
        // has failed, and has to do nothing. `rm` leaves both operands alone
        // (the directory and the file), `mkdir`, `touch` and `cp` make
        // nothing, and neither `ls -R` nor a glob reads a directory. Windows
        // has no FIFO to park the pool with.
        test.concurrent.skipIf(isWindows)("pool work that starts after the failure does nothing", async () => {
          const files = ["tree/f1", "tree/f2", "tree/sub/f3", "lone", "listed/a", "listed/sub/b", "globbed/c"];
          using dir = tempDir("shell-stop-parked", Object.fromEntries(files.map(file => [file, ""])));
          await using mkfifo = Bun.spawn({
            cmd: [Bun.which("mkfifo")!, "park1", "park2"],
            env: bunEnv,
            cwd: String(dir),
          });
          expect(await mkfifo.exited).toBe(0);
          const shapes = {
            rm: `$\`rm -rf tree lone | ${failing}\`.quiet().nothrow()`,
            ls: `$\`ls -R listed | ${failing}\`.quiet().nothrow()`,
            mkdir: `$\`mkdir -p made/sub | ${failing}\`.quiet().nothrow()`,
            touch: `$\`touch touched | ${failing}\`.quiet().nothrow()`,
            cp: `$\`cp lone copied | ${failing}\`.quiet().nothrow()`,
            // Not quiet: a glob that was cut short must not report "no matches found".
            glob: `$\`echo globbed/* | ${failing}\`.nothrow()`,
          };
          await using proc = Bun.spawn({
            cmd: child(`
              import { closeSync, openSync } from "node:fs";
              import { readFile } from "node:fs/promises";
              const parked = ["park1", "park2"].map(fifo => readFile(fifo));
              // open() for writing returns once a reader is in its own open(): a pool thread, which then waits in read().
              const writers = ["park1", "park2"].map(fifo => openSync(fifo, "w"));
              const out = {};
              ${Object.entries(shapes)
                .map(([name, shell]) => `out[${JSON.stringify(name)}] = await settle(${shell});`)
                .join("\n")}
              writers.forEach(fd => closeSync(fd));
              await Promise.all(parked);
              console.log(JSON.stringify(out));
            `),
            env: { ...env, UV_THREADPOOL_SIZE: "2" },
            cwd: String(dir),
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect({ result: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
            result: Object.fromEntries(Object.keys(shapes).map(name => [name, builtin])),
            stderr: "",
            exitCode: 0,
          });
          // A directory that was read since its entries were made has a later
          // access time than modification time. Only Linux is asked: elsewhere
          // an indexer can read the directory too.
          const unread = (path: string) => {
            const { atimeMs, mtimeMs } = statSync(join(String(dir), path));
            return !isLinux || atimeMs <= mtimeMs;
          };
          const tree = join(String(dir), "tree");
          expect({
            tree: existsSync(tree) ? readdirSync(tree, { recursive: true }).sort() : [],
            made: ["lone", "made", "touched", "copied"].filter(name => existsSync(join(String(dir), name))),
            unread: ["listed", "listed/sub", "globbed"].filter(unread),
          }).toEqual({
            tree: ["f1", "f2", "sub", "sub/f3"],
            made: ["lone"],
            unread: ["listed", "listed/sub", "globbed"],
          });
        });

        // The child's stderr is a pipe that nobody reads until the child is
        // gone (`lazy`). The chunk the builtin has queued on it when the script
        // fails is given up: `yes` always has one more, and the one of `seq` is
        // larger than the pipe. Windows: a write that is already out cannot be
        // taken back there.
        test.concurrent.skipIf(isWindows)("with a chunk queued on a pipe nobody drains", async () => {
          const shapes = {
            yes: `$\`yes 1>&2 | ${failing}\`.nothrow()`,
            seq: `$\`seq 1 100000 1>&2 | ${failing}\`.nothrow()`,
          };
          await using proc = Bun.spawn({
            cmd: settleEach(shapes),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
            lazy: true,
          });

          const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
          const stderr = await proc.stderr.text();

          expect({ result: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
            result: { yes: builtin, seq: builtin },
            stderr: "",
            exitCode: 0,
          });
        });

        // Here the script is not over with the stop: the member in the middle
        // is a process, and its exit arrives later. Until then the writer is
        // still there, so a chunk of the stopped builtin that was left on it
        // would complete and name a builtin that was reported already. The
        // pipe stays unread (`lazy`), so a `yes` that is not stopped waits on
        // it. Windows: see above.
        test.concurrent.skipIf(isWindows)(
          "with a chunk queued while another member is still being killed",
          async () => {
            const shapes = {
              yes: `$\`yes 1>&2 | ${sleeper} | ${failing}\`.nothrow()`,
              seq: `$\`seq 1 1000 1>&2 | ${sleeper} | ${failing}\`.nothrow()`,
            };
            await using proc = Bun.spawn({
              cmd: settleEach(shapes),
              env: bunEnv,
              stdout: "pipe",
              stderr: "pipe",
              lazy: true,
            });

            const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
            const stderr = await proc.stderr.text();

            expect({ result: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
              result: { yes: builtin, seq: builtin },
              stderr: "",
              exitCode: 0,
            });
          },
        );

        // `Bun.ModuleGraph#dispose()` stops a script from outside too: before,
        // only the subprocesses of the graph's scripts ended with it. It
        // settles no promise of the graph, so the scripts report nothing.
        // The child bounds itself, for its `yes` (see above).
        test.concurrent("under a Bun.ModuleGraph that is disposed", async () => {
          using dir = tempDir("shell-stop-dispose", { file: "" });
          await using proc = Bun.spawn({
            cmd: child(`
              const graph = new Bun.ModuleGraph();
              const settled = () => console.log("settled");
              graph.run(() => {
                for (let i = 0; i < 10; i++) $\`yes\`.quiet().then(settled, settled);
                // A subprocess is killed with the graph, as before.
                $\`\${bun} -e \${"setInterval(() => {}, 100_000)"}\`.quiet().then(settled, settled);
                // This command is still expanding its glob on the thread pool. It does not start afterwards.
                $\`\${bun} -e \${'require("fs").writeFileSync("started", "")'} *\`.quiet().then(settled, settled);
                // Its stdin stays open and idle (see "cat on a stdin that stays open").
                if (process.platform !== "win32") $\`cat\`.quiet().then(settled, settled);
              });
              graph.dispose();
              console.log("disposed");
              let live;
              for (let i = 0; i < 10; i++) {
                Bun.gc(true);
                live = heapStats().objectTypeCounts.ShellInterpreter ?? 0;
                if (live <= 3) break;
                await new Promise(resolve => setImmediate(resolve));
              }
              if (live > 3) {
                console.log("still live: " + live);
                process.exit(1);
              }
            `),
            env,
            cwd: String(dir),
            stdin: isWindows ? "ignore" : "pipe",
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect({ stdout, stderr, exitCode, started: existsSync(join(String(dir), "started")) }).toEqual({
            stdout: "disposed\n",
            stderr: "",
            exitCode: 0,
            started: false,
          });
        });

        // A microtask that the graph queued runs once after the dispose. The
        // script it starts is armed in a graph that is already disposed, so
        // not even its first command runs.
        test.concurrent("started by a Bun.ModuleGraph that is already disposed", async () => {
          using dir = tempDir("shell-stop-disposed", {});
          await using proc = Bun.spawn({
            cmd: child(`
              const graph = new Bun.ModuleGraph();
              const settled = () => console.log("settled");
              graph.run(() => {
                queueMicrotask(() => {
                  $\`echo x > started\`.quiet().then(settled, settled);
                });
              });
              graph.dispose();
              console.log("disposed");
            `),
            env: bunEnv,
            cwd: String(dir),
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect({ stdout, stderr, exitCode, started: existsSync(join(String(dir), "started")) }).toEqual({
            stdout: "disposed\n",
            stderr: "",
            exitCode: 0,
            started: false,
          });
        });
      });
    });
  });
});
