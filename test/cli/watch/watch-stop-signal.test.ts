import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { closeSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";

function streamWaiter(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  return {
    /** Reads until the output has `text`. */
    waitFor: async (text: string) => {
      while (!output.includes(text)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream closed, output so far: ${JSON.stringify(output)}`);
        output += decoder.decode(value, { stream: true });
      }
    },
    /** Reads to the end of the stream. */
    end: async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return output;
        output += decoder.decode(value, { stream: true });
      }
    },
    output: () => output,
  };
}

// Once a SIGINT or a SIGTERM from outside the process has been dispatched, the watcher starts
// nothing again and leaves when nothing is left to run, as `node --watch` does: its watcher
// signals the child, watches no more and exits with the child. Before, a script with a listener
// for the signal waited for a file change forever.
//
// Not on Windows: the keep-alive loop never runs dry there, and Ctrl+C ends the manager process
// that `--watch` runs the script under.
describe.skipIf(isWindows).concurrent("a stop signal ends the watcher", () => {
  // Up to 20 of these run at once, and 20 debug builds can take more than the default 5 seconds to start.
  const slow = { timeout: isDebug ? 30_000 : undefined };

  // A test that times out never reaches the end of its `await using`.
  const running = new Set<Subprocess>();
  afterAll(() => {
    for (const proc of running) proc.kill("SIGKILL");
  });

  function watching(
    files: Record<string, string>,
    args: string[],
    options: { stdin?: "pipe"; stderr?: "pipe"; detached?: boolean } = {},
  ) {
    const dir = tempDir("watch-stop-signal", files);
    const proc = spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: options.stderr ?? "inherit",
      stdin: options.stdin ?? "ignore",
      detached: options.detached,
      // Some scripts here catch SIGTERM.
      killSignal: "SIGKILL",
    });
    running.add(proc);
    return {
      dir: String(dir),
      proc,
      stdout: streamWaiter(proc.stdout),
      async [Symbol.asyncDispose]() {
        await proc[Symbol.asyncDispose]();
        running.delete(proc);
        dir[Symbol.dispose]();
      },
    };
  }

  function isRunning(pid: number) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  const serve = `const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("still here") });`;
  // An uncaught error ends the event loop of the run. The watcher reports it and goes on.
  const uncaughtError = `setTimeout(() => { throw new Error("boom"); }, 1);`;
  // The code of a child of the script. It ends by itself, should a failed test leave it behind.
  const sleeper = `"setTimeout(() => {}, 30_000)"`;

  describe.each(["--watch", "--hot"])("%s", flag => {
    it.each(["SIGINT", "SIGTERM"] as const)("exits after a %s listener leaves nothing to run", slow, async signal => {
      await using run = watching(
        {
          "main.js": `
            ${serve}
            process.once("${signal}", () => {
              server.stop(true);
              console.log("stopped");
            });
            console.log("ready");
          `,
        },
        [flag, "main.js"],
      );
      await run.stdout.waitFor("ready");
      run.proc.kill(signal);
      expect(await run.stdout.end()).toBe("ready\nstopped\n");
      expect(await run.proc.exited).toBe(0);
      expect(run.proc.signalCode).toBeNull();
    });

    it("leaves on the normal exit path: beforeExit, exit, process.exitCode", slow, async () => {
      await using run = watching(
        {
          "main.js": `
            ${serve}
            process.on("SIGINT", async () => {
              await server.stop();
              process.exitCode = 3;
              console.log("stopped");
            });
            process.on("beforeExit", code => console.log("beforeExit " + code));
            process.on("exit", code => console.log("exit " + code));
            console.log("ready");
          `,
        },
        [flag, "main.js"],
      );
      await run.stdout.waitFor("ready");
      run.proc.kill("SIGINT");
      expect(await run.stdout.end()).toBe("ready\nstopped\nbeforeExit 3\nexit 3\n");
      expect(await run.proc.exited).toBe(3);
    });

    // An idle script gets `beforeExit` each time the watcher finds nothing to run: at least once before
    // the signal, and once more after the listener.
    it("emits beforeExit after the listener of a script that had nothing to run", slow, async () => {
      await using run = watching(
        {
          "main.js": `
            process.once("SIGINT", () => console.log("stopped"));
            process.on("beforeExit", () => console.log("beforeExit"));
            console.log("ready");
          `,
        },
        [flag, "main.js"],
      );
      await run.stdout.waitFor("ready\nbeforeExit\n");
      run.proc.kill("SIGINT");
      expect(await run.stdout.end()).toMatch(/^ready\n(beforeExit\n)+stopped\nbeforeExit\n$/);
      expect(await run.proc.exited).toBe(0);
    });

    it.each([
      ["", "ready"],
      [" and an earlier uncaught error", "boom"],
    ])("keeps running after a listener that leaves the server up%s", slow, async (_, started) => {
      await using run = watching(
        {
          "main.js": `
            ${serve}
            process.on("SIGINT", () => console.log("got SIGINT"));
            ${started === "boom" ? uncaughtError : ""}
            console.log(server.port + " ready");
          `,
        },
        [flag, "main.js"],
        { stderr: "pipe" },
      );
      await run.stdout.waitFor(" ready\n");
      if (started === "boom") await streamWaiter(run.proc.stderr).waitFor("boom");
      const url = `http://127.0.0.1:${parseInt(run.stdout.output())}/`;
      run.proc.kill("SIGINT");
      await run.stdout.waitFor("got SIGINT");
      // Two requests: the first one alone could still be answered on the way out.
      expect(await (await fetch(url)).text()).toBe("still here");
      expect(await (await fetch(url)).text()).toBe("still here");
    });

    // This one passes without the change too: I/O is driven while the watcher waits. It pins that
    // the exit after a stop signal does not cut the listener off once an error was counted.
    it("finishes a cleanup that awaits I/O after an earlier uncaught error", slow, async () => {
      await using run = watching(
        {
          "main.js": `
            ${serve}
            process.on("SIGINT", async () => {
              console.log("cleanup start");
              await (await fetch(server.url)).text();
              await server.stop();
              console.log("cleanup done");
              process.exit(0);
            });
            ${uncaughtError}
            console.log("ready");
          `,
        },
        [flag, "main.js"],
        { stderr: "pipe" },
      );
      await run.stdout.waitFor("ready");
      await streamWaiter(run.proc.stderr).waitFor("boom");
      run.proc.kill("SIGINT");
      expect(await run.stdout.end()).toBe("ready\ncleanup start\ncleanup done\n");
      expect(await run.proc.exited).toBe(0);
    });

    it("exits with code 1 after an earlier uncaught error", slow, async () => {
      await using run = watching(
        {
          "main.js": `
            ${serve}
            process.once("SIGINT", () => {
              server.stop(true);
              console.log("stopped");
            });
            ${uncaughtError}
            console.log("ready");
          `,
        },
        [flag, "main.js"],
        { stderr: "pipe" },
      );
      await run.stdout.waitFor("ready");
      await streamWaiter(run.proc.stderr).waitFor("boom");
      run.proc.kill("SIGINT");
      expect(await run.stdout.end()).toBe("ready\nstopped\n");
      expect(await run.proc.exited).toBe(1);
    });

    // No save starts the script again after the signal, so the error ends the process, as without a watcher.
    it("ends with exit code 1 when the listener throws", slow, async () => {
      await using run = watching(
        {
          "main.js": `
            ${serve}
            process.on("SIGINT", () => {
              throw new Error("cleanup failed");
            });
            process.on("exit", code => console.log("exit " + code));
            console.log("ready");
          `,
        },
        [flag, "main.js"],
        { stderr: "pipe" },
      );
      await run.stdout.waitFor("ready");
      run.proc.kill("SIGINT");
      const [stdout, stderr] = await Promise.all([run.stdout.end(), streamWaiter(run.proc.stderr).end()]);
      expect(stderr).toContain("cleanup failed");
      expect(stdout).toBe("ready\nexit 1\n");
      expect(await run.proc.exited).toBe(1);
    });

    it("does not start the script again for a change during the cleanup", slow, async () => {
      const script = (load: number) => `
        ${serve}
        process.once("SIGINT", async () => {
          console.log("cleanup start");
          await Bun.sleep(500);
          console.log("cleanup done");
          server.stop(true);
        });
        console.log("ready ${load}");
      `;
      await using run = watching({ "main.js": script(1) }, [flag, "main.js"]);
      await run.stdout.waitFor("ready 1");
      run.proc.kill("SIGINT");
      await run.stdout.waitFor("cleanup start");
      await Bun.write(join(run.dir, "main.js"), script(2));
      expect(await run.stdout.end()).toBe("ready 1\ncleanup start\ncleanup done\n");
      expect(await run.proc.exited).toBe(0);
    });
  });

  // The issue's script: its listener only ends the children, and their exit leaves nothing to run.
  it("--watch exits after a listener that ends the children of the script (#13539)", slow, async () => {
    await using run = watching(
      {
        "main.js": `
          const children = [0, 1].map(() =>
            Bun.spawn([process.execPath, "-e", ${sleeper}], { stdio: ["inherit", "inherit", "inherit"] }),
          );
          function kill() {
            for (const child of children) child.kill();
          }
          process.on("SIGINT", kill);
          process.on("exit", kill);
          console.log("ready " + children.map(child => child.pid).join(" "));
        `,
      },
      ["--watch", "main.js"],
    );
    await run.stdout.waitFor("ready ");
    await run.stdout.waitFor("\n");
    const pids = run.stdout.output().trim().split(" ").slice(1).map(Number);
    run.proc.kill("SIGINT");
    expect(await run.proc.exited).toBe(0);
    expect(pids.map(pid => isRunning(pid))).toEqual([false, false]);
  });

  // The signal is delivered while the script is busy, and the listener is gone when it is dispatched.
  it.each([
    ["--hot", "SIGINT"],
    ["--hot", "SIGTERM"],
    ["--watch", "SIGTERM"],
  ] as const)("%s exits after a %s whose listener was removed before the dispatch", slow, async (flag, signal) => {
    await using run = watching(
      {
        "main.js": `
          const { readSync, writeSync } = require("fs");
          const listener = () => {};
          process.on("${signal}", listener);
          writeSync(1, "ready\\n");
          // Until the test has sent the signal.
          readSync(0, Buffer.alloc(1));
          process.off("${signal}", listener);
        `,
      },
      [flag, "main.js"],
      { stdin: "pipe" },
    );
    await run.stdout.waitFor("ready");
    run.proc.kill(signal);
    run.proc.stdin.write("\n");
    run.proc.stdin.end();
    expect(await run.proc.exited).toBe(0);
  });

  // The script talks to itself: nobody asked the watcher to stop. `--hot` reloads on the JS thread, so
  // a process that was wrongly on its way out could not print the second line.
  it("--hot keeps watching after signals that are not a request to stop", slow, async () => {
    const script = (load: number) => `
      for (const signal of ["SIGUSR2", "SIGWINCH", "SIGTERM"]) process.on(signal, () => console.log(signal + " ${load}"));
      process.kill(process.pid, "SIGTERM");
      console.log("ready ${load}");
    `;
    await using run = watching({ "main.js": script(1) }, ["--hot", "main.js"]);
    await run.stdout.waitFor("SIGTERM 1");
    for (const signal of ["SIGUSR2", "SIGWINCH"] as const) {
      run.proc.kill(signal);
      await run.stdout.waitFor(signal + " 1");
    }
    await Bun.write(join(run.dir, "main.js"), script(2));
    await run.stdout.waitFor("ready 2");
  });

  it("--hot exits after a SIGTERM from outside that follows one the script sent to itself", slow, async () => {
    await using run = watching(
      {
        "main.js": `
          ${serve}
          let sigterms = 0;
          process.on("SIGTERM", () => {
            if (++sigterms === 1) return console.log("from the script");
            server.stop(true);
            console.log("stopped");
          });
          process.kill(process.pid, "SIGTERM");
        `,
      },
      ["--hot", "main.js"],
    );
    await run.stdout.waitFor("from the script");
    run.proc.kill("SIGTERM");
    expect(await run.stdout.end()).toBe("from the script\nstopped\n");
    expect(await run.proc.exited).toBe(0);
  });

  // What signal-exit does: the listener removes itself and sends the signal again, for its default action.
  it("--hot ends by the signal that a listener sends again", slow, async () => {
    await using run = watching(
      {
        "main.js": `
          ${serve}
          process.on("SIGTERM", function listener() {
            process.removeListener("SIGTERM", listener);
            console.log("cleanup");
            process.kill(process.pid, "SIGTERM");
          });
          console.log("ready");
        `,
      },
      ["--hot", "main.js"],
    );
    await run.stdout.waitFor("ready");
    run.proc.kill("SIGTERM");
    expect(await run.stdout.end()).toBe("ready\ncleanup\n");
    await run.proc.exited;
    expect(run.proc.signalCode).toBe("SIGTERM");
  });

  // The listener sends the signal on, which is not a signal of the script to itself.
  it.each([
    ["child.kill()", `child.kill("SIGINT")`],
    ["the pid of the child", `process.kill(child.pid, "SIGINT")`],
    ["the process group of the child", `process.kill(-child.pid, "SIGINT")`],
  ])("--hot exits after a listener that sends the SIGINT on to %s", slow, async (_, sendOn) => {
    await using run = watching(
      {
        "main.js": `
          const child = Bun.spawn([process.execPath, "-e", ${sleeper}], {
            stdio: ["inherit", "inherit", "inherit"],
            detached: true,
          });
          process.on("SIGINT", () => ${sendOn});
          child.exited.then(() => console.log("child exited"));
          console.log("ready");
        `,
      },
      ["--hot", "main.js"],
    );
    await run.stdout.waitFor("ready");
    run.proc.kill("SIGINT");
    expect(await run.stdout.end()).toBe("ready\nchild exited\n");
    expect(await run.proc.exited).toBe(0);
  });

  it("--hot exits after a SIGINT that the script sent to its process group", slow, async () => {
    await using run = watching(
      {
        "main.js": `
          ${serve}
          process.once("SIGINT", () => {
            server.stop(true);
            console.log("stopped");
          });
          process.kill(0, "SIGINT");
        `,
      },
      ["--hot", "main.js"],
      // A process group of its own.
      { detached: true },
    );
    expect(await run.stdout.end()).toBe("stopped\n");
    expect(await run.proc.exited).toBe(0);
  });

  // A reload keeps the listeners of every load, so both take the one signal.
  it("--hot exits after a SIGINT that comes after a reload", slow, async () => {
    const script = (load: number) => `
      const timer = setInterval(() => {}, 1000);
      process.once("SIGINT", () => {
        clearInterval(timer);
        console.log("stopped ${load}");
      });
      console.log("ready ${load}");
    `;
    await using run = watching({ "main.js": script(1) }, ["--hot", "main.js"]);
    await run.stdout.waitFor("ready 1");
    // One write in place, of the same length, is one reload. A write that truncates first can be two, and
    // the SIGINT could then come while the second one loads: its listener is not there yet.
    const fd = openSync(join(run.dir, "main.js"), "r+");
    writeSync(fd, script(2));
    closeSync(fd);
    await run.stdout.waitFor("ready 2");
    run.proc.kill("SIGINT");
    expect(await run.stdout.end()).toBe("ready 1\nready 2\nstopped 1\nstopped 2\n");
    expect(await run.proc.exited).toBe(0);
  });

  describe("bun test --watch", () => {
    // stdout starts with the `bun test v1.x (sha)` line.
    const afterVersionLine = (stdout: string) => stdout.slice(stdout.indexOf("\n") + 1);

    it("exits after the cleanup of a listener, for a SIGINT while it waits for a change", slow, async () => {
      await using run = watching(
        {
          "stop.test.js": `
            import { test } from "bun:test";
            process.on("SIGINT", async () => {
              await Bun.sleep(20);
              console.log("cleanup done");
            });
            test("runs", () => {});
          `,
        },
        ["test", "--watch", "stop.test.js"],
        { stderr: "pipe" },
      );
      await streamWaiter(run.proc.stderr).waitFor("Ran 1 test");
      run.proc.kill("SIGINT");
      expect(afterVersionLine(await run.stdout.end())).toBe("cleanup done\n");
      expect(await run.proc.exited).toBe(0);
    });

    it("exits at the end of the run, for a SIGINT that a test waits for", slow, async () => {
      await using run = watching(
        {
          "stop.test.js": `
            import { test } from "bun:test";
            test("waits for SIGINT", async () => {
              const signalled = new Promise(resolve => process.once("SIGINT", resolve));
              console.log("in the test");
              await signalled;
              console.log("got SIGINT");
            });
          `,
        },
        ["test", "--watch", "stop.test.js"],
      );
      await run.stdout.waitFor("in the test");
      run.proc.kill("SIGINT");
      expect(afterVersionLine(await run.stdout.end())).toBe("in the test\ngot SIGINT\n");
      expect(await run.proc.exited).toBe(0);
    });

    it("exits with the code of the run", slow, async () => {
      await using run = watching(
        {
          "stop.test.js": `
            import { expect, test } from "bun:test";
            process.once("SIGINT", () => console.log("stopped"));
            test("fails", () => {
              expect(1).toBe(2);
            });
          `,
        },
        ["test", "--watch", "stop.test.js"],
        { stderr: "pipe" },
      );
      await streamWaiter(run.proc.stderr).waitFor("Ran 1 test");
      run.proc.kill("SIGINT");
      expect(afterVersionLine(await run.stdout.end())).toBe("stopped\n");
      expect(await run.proc.exited).toBe(1);
    });

    it("reports the error of a cleanup that fails in its last step", slow, async () => {
      await using run = watching(
        {
          "stop.test.js": `
            import { test } from "bun:test";
            process.once("SIGINT", async () => {
              await Bun.sleep(20);
              throw new Error("cleanup failed");
            });
            test("runs", () => {});
          `,
        },
        ["test", "--watch", "stop.test.js"],
        { stderr: "pipe" },
      );
      const stderr = streamWaiter(run.proc.stderr);
      await stderr.waitFor("Ran 1 test");
      run.proc.kill("SIGINT");
      expect(await stderr.end()).toContain("cleanup failed");
      await run.proc.exited;
    });

    // Passes without the change too, as the `--watch` and `--hot` form of it above.
    it("finishes a cleanup that awaits I/O after an earlier uncaught error", slow, async () => {
      await using run = watching(
        {
          "stop.test.js": `
            import { test } from "bun:test";
            ${serve}
            process.on("SIGINT", async () => {
              console.log("cleanup start");
              await (await fetch(server.url)).text();
              await server.stop();
              console.log("cleanup done");
              process.exit(0);
            });
            test("leaves an uncaught error behind", async () => {
              ${uncaughtError}
              await Bun.sleep(20);
            });
          `,
        },
        ["test", "--watch", "stop.test.js"],
        { stderr: "pipe" },
      );
      await streamWaiter(run.proc.stderr).waitFor("Ran 1 test");
      run.proc.kill("SIGINT");
      expect(afterVersionLine(await run.stdout.end())).toBe("cleanup start\ncleanup done\n");
      expect(await run.proc.exited).toBe(0);
    });
  });
});
