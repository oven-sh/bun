import { createSocketPair } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isPosix, isWindows, nodeExe, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { exec } from "node:child_process";
import { closeSync, constants, openSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

test.concurrent("pipe does the right thing", async () => {
  // Note: Bun.spawnSync uses memfd_create on Linux for pipe, which means we see
  // it as a file instead of a tty
  const result = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(typeof process.stdin.ref)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });

  expect((await new Response(result.stdout).text()).trim()).toBe("function");
  expect(await result.exited).toBe(0);
});

test.concurrent("file does the right thing", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(typeof process.stdin.ref)"],
    stdin: Bun.file(import.meta.path),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(await result.stdout.text()).toMatchInlineSnapshot(`
    "undefined
    "
  `);
  expect(await result.stderr.text()).toMatchInlineSnapshot(`""`);
  expect(await result.exited).toBe(0);
});

test.concurrent("stdin with 'readable' event handler should receive data when paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const handleReadable = () => {
        let chunk;
        while ((chunk = process.stdin.read())) {
          console.log("got chunk", JSON.stringify(chunk));
        }
      };
      
      process.stdin.on("readable", handleReadable);
      process.stdin.pause();
      
      setTimeout(() => {
        process.exit(1);
      }, 1000);
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("abc\n");
  proc.stdin.write("def\n");
  proc.stdin.end();

  await proc.exited;

  expect(await proc.stdout.text()).toMatchInlineSnapshot(`
    "got chunk {"type":"Buffer","data":[97,98,99,10,100,101,102,10]}
    "
  `);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
  expect(proc.exitCode).toBe(1);
});

test.concurrent("stdin with 'data' event handler should NOT receive data when paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const handleData = chunk => {
        console.log("got chunk");
      };
      
      process.stdin.on("data", handleData);
      process.stdin.pause();
      
      setTimeout(() => {
        process.exit(1);
      }, 1000);
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("abc\n");
  proc.stdin.write("def\n");
  proc.stdin.end();

  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

  expect(stdout).toMatchInlineSnapshot(`""`);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
  // Reusing the already-consumed stdout stream now rejects (the stream is disturbed).
  await expect(proc.stdout.text()).rejects.toThrow("ReadableStream has already been used");
  expect(exitCode).toBe(1);
});

// Drains the child; its stderr joins the comparison only when it failed, so a
// crash shows up in the diff without asserting stderr empty on success (debug
// builds write benign noise there).
type StdioResult = { stdout: string; exitCode: number; stderr?: string };
async function stdioResult(proc: Bun.Subprocess<"pipe", "pipe", "pipe">): Promise<StdioResult> {
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, exitCode, stderr: exitCode === 0 ? undefined : stderr };
}

test.concurrent("paused mode read(n) returns the buffered remainder at EOF", async () => {
  // 8 bytes pulled 3 at a time: the final read(3) must return the 2 byte tail
  // once EOF is reached, and 'end' must mark readableEnded.
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const chunks = [];
      process.stdin.on("readable", () => {
        let chunk;
        while ((chunk = process.stdin.read(3)) !== null) chunks.push(chunk.toString());
      });
      process.stdin.on("end", () => {
        console.log(JSON.stringify({ chunks, readableEnded: process.stdin.readableEnded }));
      });`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({
    stdout: JSON.stringify({ chunks: ["abc", "def", "gh"], readableEnded: true }) + "\n",
    exitCode: 0,
  });
});

test.concurrent("explicit read(n) with no 'readable' listener still pulls from stdin", async () => {
  // read() must start the underlying stdin reader even when no 'readable'
  // listener or resume() ever ran.
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const chunks = [];
      process.stdin.on("end", () => {
        console.log(JSON.stringify({ chunks, readableEnded: process.stdin.readableEnded }));
      });
      let spins = 0;
      function poll() {
        let chunk;
        while ((chunk = process.stdin.read(3)) !== null) chunks.push(chunk.toString());
        if (process.stdin.readableEnded) return;
        // Bounded so a regression fails with output instead of spinning forever.
        if (++spins > 20000) {
          console.log(JSON.stringify({ chunks, readableEnded: false }));
          process.exit(1);
        }
        setImmediate(poll);
      }
      poll();`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({
    stdout: JSON.stringify({ chunks: ["abc", "def", "gh"], readableEnded: true }) + "\n",
    exitCode: 0,
  });
});

test.concurrent("a read() that throws does not keep the process alive", async () => {
  // stdin stays open for the child's whole lifetime: it only exits if the
  // failed read did not start (and ref) the native stdin reader.
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let code = "";
      try {
        process.stdin.read(2 ** 31);
      } catch (err) {
        code = err.code;
      }
      process.on("exit", () => console.log(code));`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const result = await stdioResult(proc);
  proc.stdin.end();
  expect(result).toEqual({ stdout: "ERR_OUT_OF_RANGE\n", exitCode: 0 });
});

test.concurrent("touching stdin again after 'end' does not keep the process alive", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.stdin.on("data", () => {});
      process.stdin.on("end", () => {
        console.log("END");
        process.stdin.resume();
        process.stdin.ref();
        process.stdin.on("readable", () => {});
      });
      process.on("exit", () => console.log("EXIT"));`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({ stdout: "END\nEXIT\n", exitCode: 0 });
});

test.concurrent("resume() after 'end' does not reset readableEnded", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const stdin = process.stdin;
      let ends = 0;
      stdin.on("data", () => {});
      stdin.on("end", () => {
        ends++;
        stdin.pause();
        stdin.resume();
        // One macrotask later the 'resume' event has run.
        setImmediate(() => {
          console.log(JSON.stringify({ ends, readableEnded: stdin.readableEnded, destroyed: stdin.destroyed }));
        });
      });`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({
    stdout: JSON.stringify({ ends: 1, readableEnded: true, destroyed: true }) + "\n",
    exitCode: 0,
  });
});

test.concurrent("'end' is not emitted when the buffer is never drained, and the process still exits", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.stdin.on("readable", () => {});
      process.stdin.on("end", () => console.log("END"));
      process.on("exit", () => console.log("EXIT " + process.stdin.readableLength));`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({ stdout: "EXIT 8\n", exitCode: 0 });
});

test.concurrent("resuming after EOF is buffered behind unread data still delivers the data and 'end'", async () => {
  // The child reads nothing until push(null) has run, then switches to flowing mode.
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const stdin = process.stdin;
      const result = { buffered: 0, data: "", end: false };
      stdin.on("readable", function onReadable() {
        // EOF always emits 'readable'.
        if (!stdin._readableState.ended) return;
        result.buffered = stdin.readableLength;
        stdin.removeListener("readable", onReadable);
        stdin.on("data", chunk => (result.data += chunk));
        stdin.on("end", () => (result.end = true));
      });
      process.on("exit", () => console.log(JSON.stringify({ ...result, readableEnded: stdin.readableEnded })));`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({
    stdout: JSON.stringify({ buffered: 8, data: "abcdefgh", end: true, readableEnded: true }) + "\n",
    exitCode: 0,
  });
});

// A consumer that pauses in 'data' with a part of the chunk unread, while the chunk and EOF
// arrive together. After a pause() and a resume() in different turns, a second read is in
// flight, and it pushes EOF while the stream is paused (endedAtResume). A 'resume' listener
// that called _undestroy() then cleared that state, and 'end' was lost.
describe.skipIf(isWindows)("pause() in 'data', EOF, then resume()", () => {
  const pairs = {
    "in one turn": [`stdin.pause(); stdin.resume(); setImmediate(ready);`, false],
    "in two turns": [`stdin.pause(); setImmediate(() => { stdin.resume(); setImmediate(ready); });`, true],
  } as const;
  test.concurrent.each(
    (["in one turn", "in two turns"] as const).flatMap(pair =>
      (["process.nextTick", "setImmediate"] as const).map(schedule => [pair, schedule] as const),
    ),
  )("after a pause() and resume() %s, resume() from %s still emits 'end'", async (pair, schedule) => {
    const [prelude, endedAtResume] = pairs[pair];
    using dir = tempDir("stdin-pause-eof", {});
    const gate = join(String(dir), "gate");
    const [childEnd, parentEnd] = createSocketPair();
    let writeEnd: number | undefined = parentEnd;
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const fs = require("node:fs");
          const stdin = process.stdin;
          const result = { data: "", endedAtResume: false, end: false };
          let first = true;
          stdin.on("data", chunk => {
            if (!first) return void (result.data += chunk);
            first = false;
            result.data += chunk.subarray(0, 4);
            stdin.pause();
            stdin.unshift(chunk.subarray(4));
            ${schedule}(() => {
              result.endedAtResume = stdin._readableState.ended;
              stdin.resume();
            });
          });
          stdin.on("end", () => (result.end = true));
          function ready() {
            fs.writeSync(1, "READY\\n");
            // Blocks this thread until the chunk and EOF are both in the socket.
            while (!fs.existsSync(${JSON.stringify(gate)})) {}
          }
          setImmediate(() => {
            ${prelude}
          });
          process.on("exit", () => fs.writeSync(1, JSON.stringify(result) + "\\n"));`,
        ],
        stdin: childEnd,
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });
      const stderr = proc.stderr.text();
      const decoder = new TextDecoder();
      let stdout = "";
      for await (const chunk of proc.stdout) {
        stdout += decoder.decode(chunk, { stream: true });
        if (writeEnd !== undefined && stdout.includes("READY\n")) {
          writeSync(writeEnd, "abcdefgh");
          closeSync(writeEnd);
          writeEnd = undefined;
          writeFileSync(gate, "");
        }
      }
      const exitCode = await proc.exited;
      const result: StdioResult = { stdout, exitCode, stderr: exitCode === 0 ? undefined : await stderr };
      expect(result).toEqual({
        stdout: "READY\n" + JSON.stringify({ data: "abcdefgh", endedAtResume, end: true }) + "\n",
        exitCode: 0,
      });
    } finally {
      closeSync(childEnd);
      if (writeEnd !== undefined) closeSync(writeEnd);
    }
  });
});

// On pipe, socket and TTY stdin, destroy() releases the native reader whatever listeners
// exist, and nothing takes the reader back. Unless a case sends EOF, the parent holds the
// writer of fd 0 open until the child is gone, so a child that exits did so because stdin
// let go of the event loop and not because of EOF.
describe("destroy()", () => {
  // "pipe" is what Bun.spawn gives: a socket pair on POSIX. "shell pipe" is an anonymous
  // pipe, as in `cmd | bun`.
  type Kind = "pipe" | "shell pipe" | "tty" | "file";
  const kinds: Kind[] = ["pipe", "file", "tty", ...(isPosix ? ["shell pipe" as const] : [])];
  type Io = { feed: (data: string) => void; end: () => void; proc: Bun.Subprocess };
  // When the child prints the marker, the parent runs the action. The steps run in order.
  type Step = [marker: string, action: (io: Io) => void];
  type Report = { events: string[]; destroyed: boolean; fd0: boolean; exitCode: number | null; signalCode: unknown };

  // The child reports once, when it exits. It calls done() after the last step of its case.
  function child(body: string) {
    return `
      const stdin = process.stdin;
      const events = [];
      const onData = () => events.push("data");
      const onReadable = () => events.push("readable");
      const onClose = () => events.push("close");
      process.on("uncaughtException", err => events.push("uncaught " + err.message));
      process.on("exit", () => {
        let fd0 = true;
        try {
          require("node:fs").fstatSync(0);
        } catch {
          fd0 = false;
        }
        console.log("RESULT " + JSON.stringify({ events, destroyed: stdin.destroyed, fd0 }));
      });
      // From here the child must exit by itself. A timer that is due runs even when it is
      // unref'd, so only a loop that something still holds counts as alive.
      function done() {
        setTimeout(() => {
          if (typeof Bun === "object" && !require("bun:internal-for-testing").getEventLoopStats().loopActive) return;
          events.push("STILL_ALIVE");
          process.exit(1);
        }, 1500).unref();
      }
      ${body}
    `;
  }

  function report(output: string, stderr: string, exitCode: number | null, signalCode: unknown): Report {
    const result = output.match(/RESULT (\{[^}]*\})/);
    // A child that did not report shows its raw output in the diff.
    return { ...(result ? JSON.parse(result[1]) : { output, stderr }), exitCode, signalCode };
  }

  function ignoreEpipe(err: any) {
    if (err?.code !== "EPIPE") throw err;
  }

  async function run(kind: Kind, body: string, steps: Step[] = [], exe = bunExe()): Promise<Report> {
    const script = child(body);
    let next = 0;
    const advance = (output: string, io: Io) => {
      while (next < steps.length && output.includes(steps[next][0])) steps[next++][1](io);
    };
    const decoder = new TextDecoder();
    let output = "";

    if (kind === "tty") {
      const reported = Promise.withResolvers<void>();
      await using proc = Bun.spawn({
        cmd: [exe, "-e", script],
        env: bunEnv,
        terminal: {
          // Wide enough that ConPTY does not wrap the RESULT line.
          cols: 200,
          rows: 24,
          data(terminal, chunk) {
            output += decoder.decode(chunk, { stream: true });
            // Ctrl-D at the start of a line is EOF on a POSIX terminal.
            advance(output, { feed: data => void terminal.write(data), end: () => void terminal.write("\x04"), proc });
            if (/RESULT \{[^}]*\}/.test(Bun.stripANSI(output))) reported.resolve();
          },
          exit() {
            reported.resolve();
          },
        },
      });
      await Promise.all([reported.promise, proc.exited]);
      proc.terminal?.close();
      // The terminal puts CR LF, and on Windows VT sequences, around the line.
      return report(Bun.stripANSI(output).replace(/[\r\n]/g, ""), "", proc.exitCode, proc.signalCode);
    }

    using dir = tempDir("stdin-destroy", { "input.txt": "hello\n" });
    // The shell waits for cat, and cat waits for the parent to close its end.
    const cmd =
      kind === "shell pipe"
        ? ["sh", "-c", `cat | { "$0" -e "$1"; echo "EXIT $?"; }`, exe, script]
        : [exe, "-e", script];
    await using proc = Bun.spawn({
      cmd,
      stdin: kind === "file" ? Bun.file(join(String(dir), "input.txt")) : "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const sink = kind === "file" ? undefined : (proc.stdin as Bun.FileSink);
    let ended = false;
    const io: Io = {
      feed(data) {
        try {
          Promise.resolve(sink?.write(data)).catch(ignoreEpipe);
          Promise.resolve(sink?.flush()).catch(ignoreEpipe);
        } catch (err) {
          ignoreEpipe(err);
        }
      },
      end() {
        if (ended) return;
        ended = true;
        try {
          Promise.resolve(sink?.end()).catch(ignoreEpipe);
        } catch (err) {
          ignoreEpipe(err);
        }
      },
      proc,
    };
    const drain = async () => {
      for await (const chunk of proc.stdout) {
        output += decoder.decode(chunk, { stream: true });
        advance(output, io);
        if (kind === "shell pipe" && /EXIT \d+/.test(output)) io.end();
      }
    };
    const [stderr] = await Promise.all([proc.stderr.text(), drain(), proc.exited]);
    const shellExit = output.match(/EXIT (\d+)/);
    return report(output, stderr, shellExit ? Number(shellExit[1]) : proc.exitCode, proc.signalCode);
  }

  const arming = {
    "on('data')": `stdin.on("data", onData);`,
    "on('readable')": `stdin.on("readable", onReadable);`,
    "resume()": `stdin.resume();`,
    "ref()": `stdin.ref();`,
    "read(n)": `stdin.read(1);`,
  };
  const held = kinds.filter(kind => kind !== "file");
  // [title, stdin kinds, code, events]
  const releases: [string, readonly Kind[], string, string[]][] = [
    [
      "on('data') then destroy()",
      kinds,
      `stdin.on("close", onClose); stdin.on("data", onData); stdin.destroy(); done();`,
      ["close"],
    ],
  ];
  for (const [name, arm] of Object.entries(arming)) {
    // Each way to take the reader runs on a pipe. The other kinds share that JavaScript.
    const armKinds = name === "on('data')" ? kinds : (["pipe"] as const);
    releases.push([
      `${name} then destroy(err)`,
      armKinds,
      `${arm} stdin.destroy(new Error("mine")); done();`,
      ["uncaught mine"],
    ]);
  }
  releases.push(
    [
      "on('data'), then removeAllListeners() and destroy() in a later turn",
      held,
      `stdin.on("data", onData); setImmediate(() => { stdin.removeAllListeners(); stdin.destroy(); done(); });`,
      [],
    ],
    [
      "on('data'), destroy() then removeAllListeners()",
      kinds,
      `stdin.on("data", onData); stdin.destroy(); stdin.removeAllListeners(); done();`,
      [],
    ],
    [
      "destroy(err) with an 'error' listener that throws",
      ["pipe"],
      `stdin.on("error", () => { throw new Error("from error listener"); });
       stdin.on("data", onData);
       stdin.destroy(new Error("mine"));
       done();`,
      ["uncaught from error listener"],
    ],
    [
      "destroy() with a 'close' listener that throws",
      ["pipe"],
      `stdin.prependListener("close", () => { throw new Error("from close listener"); });
       stdin.on("data", onData);
       stdin.destroy();
       done();`,
      ["uncaught from close listener"],
    ],
    [
      "destroy(err) in a later turn",
      ["pipe"],
      `stdin.on("data", onData); setImmediate(() => { stdin.destroy(new Error("mine")); done(); });`,
      ["uncaught mine"],
    ],
    [
      "on('data'), removeAllListeners('end') then push(null)",
      ["pipe"],
      `stdin.on("data", onData); stdin.removeAllListeners("end"); stdin.push(null); done();`,
      [],
    ],
    [
      "push(null) then push(chunk)",
      ["pipe"],
      `stdin.on("data", onData); stdin.push(null); stdin.push("x"); done();`,
      ["uncaught stream.push() after EOF"],
    ],
    [
      "on('data'), emit('end') then destroy()",
      ["pipe"],
      `stdin.on("data", onData); stdin.emit("end"); stdin.destroy(); done();`,
      [],
    ],
    // The listener that starts the flow, and the four ways to take the native reader.
    [
      "destroy(), then on('data'), resume(), ref(), read(n) and on('readable')",
      ["pipe"],
      `stdin.on("resume", () => events.push("resume"));
       stdin.destroy();
       stdin.on("data", onData);
       events.push("flowing=" + stdin.readableFlowing);
       setImmediate(() => { stdin.resume(); stdin.ref(); stdin.read(5); stdin.on("readable", onReadable); done(); });`,
      ["flowing=null"],
    ],
  );
  const rows = releases.flatMap(([title, rowKinds, body, events]) =>
    rowKinds.map(kind => [kind, title, body, events] as const),
  );
  const released = (events: readonly string[]): Report => ({
    events: [...events],
    destroyed: true,
    fd0: true,
    exitCode: 0,
    signalCode: null,
  });

  test.concurrent.each(rows)("%s stdin: %s lets the process exit", async (kind, _title, body, events) => {
    expect(await run(kind, body)).toEqual(released(events));
  });

  // Node's resume() returns for a destroyed stream since v26.1.
  const node = nodeExe();
  const [nodeMajor, nodeMinor] = node
    ? Bun.spawnSync([node, "-p", "process.versions.node"]).stdout.toString().split(".").map(Number)
    : [0, 0];
  test.skipIf(nodeMajor < 26 || (nodeMajor === 26 && nodeMinor < 1))("node gives the same reports", async () => {
    // Newer versions of Node close fd 0 when a file stream is destroyed.
    const reports = await Promise.all(rows.map(([kind, , body]) => run(kind, body, [], node!)));
    expect(reports.map(({ fd0, ...rest }) => rest)).toEqual(
      rows.map(([, , , events]) => {
        const { fd0, ...rest } = released(events);
        return rest;
      }),
    );
  });

  test.concurrent("destroy(err) with no 'error' listener and no uncaughtException handler is fatal", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdin.on("data", () => {});
        process.stdin.destroy(new Error("mine"));
        process.on("exit", code => console.log("exit " + code));`,
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("exit 1\n");
    expect(stderr).toContain("error: mine");
    expect(exitCode).toBe(1);
    expect(proc.signalCode).toBeNull();
  });

  test.concurrent("emit('close') by the user does not destroy stdin", async () => {
    const body = `
      stdin.on("data", chunk => {
        events.push("data " + chunk + " destroyed=" + stdin.destroyed);
        stdin.destroy();
        done();
      });
      stdin.emit("close");
      console.log("READY");
    `;
    expect(await run("pipe", body, [["READY", io => io.feed("hello")]])).toEqual(
      released(["data hello destroyed=false"]),
    );
  });

  // A prompt that ends on Ctrl-D emits 'end' by hand, and the next prompt reads again.
  test.concurrent.skipIf(!isPosix)("emit('end') by the user does not destroy stdin", async () => {
    const body = `
      function prompt(tag) {
        return new Promise(resolve => {
          stdin.setRawMode(true);
          stdin.resume();
          let line = "";
          const onData = chunk => {
            const end = chunk.indexOf(4);
            line += chunk.subarray(0, end === -1 ? chunk.length : end);
            if (end !== -1) stdin.emit("end");
          };
          stdin.on("data", onData);
          stdin.once("end", () => {
            stdin.removeListener("data", onData);
            stdin.setRawMode(false);
            stdin.pause();
            resolve(line);
          });
          console.log("READY" + tag);
        });
      }
      (async () => {
        events.push("first " + (await prompt(1)));
        await new Promise(resolve => setImmediate(resolve));
        events.push("second " + (await prompt(2)));
        done();
      })();
    `;
    const steps: Step[] = [
      ["READY1", io => io.feed("abc\x04")],
      ["READY2", io => io.feed("def\x04")],
    ];
    expect(await run("tty", body, steps)).toEqual({ ...released(["first abc", "second def"]), destroyed: false });
  });

  // Node gives the terminal back in destroy(), and setRawMode() on a destroyed stream does not touch it.
  test.concurrent.skipIf(!isPosix)("destroy() leaves raw mode, and setRawMode() cannot enter it again", async () => {
    const body = `
      const { execSync } = require("node:child_process");
      const cooked = () => /(^|\\s)icanon/.test(execSync("stty -a", { stdio: ["inherit", "pipe", "ignore"] }).toString());
      stdin.setRawMode(true);
      events.push("cooked=" + cooked());
      stdin.destroy();
      events.push("destroyed: cooked=" + cooked());
      stdin.setRawMode(true);
      events.push("setRawMode(true): cooked=" + cooked() + " isRaw=" + stdin.isRaw);
      done();
    `;
    expect(await run("tty", body)).toEqual(
      released(["cooked=false", "destroyed: cooked=true", "setRawMode(true): cooked=true isRaw=true"]),
    );
  });

  // With a construct step, the first read waits on a listener that removeAllListeners() drops.
  test.concurrent.each([
    ["pipe", "on('data')", `stdin.on("data", chunk => events.push("data " + chunk));`],
    [
      "pipe",
      "on('readable')",
      `stdin.on("readable", () => { const chunk = stdin.read(); if (chunk) events.push("data " + chunk); });`,
    ],
    ...(isPosix ? ([["tty", "on('data')", `stdin.on("data", chunk => events.push("data " + chunk));`]] as const) : []),
  ] as const)("%s stdin: removeAllListeners() in the first turn, then %s, still reads", async (kind, _arm, arm) => {
    const body = `
      stdin.removeAllListeners();
      ${arm}
      stdin.on("end", () => events.push("end"));
      console.log("READY");
    `;
    // A terminal in cooked mode gives the line with its newline, and echoes it.
    const line = kind === "tty" ? "hello\n" : "hello";
    const steps: Step[] = [
      ["READY", io => io.feed(line)],
      // The echo of the line shows that the terminal has taken it.
      [kind === "tty" ? "hello\r\n" : "READY", io => io.end()],
    ];
    expect(await run(kind, body, steps)).toEqual(released(["data " + line, "end"]));
  });

  // finished() and pipeline() settle on 'end', before stdin is destroyed, and do not depend on 'close'.
  test.concurrent.each(["pipe", "file"] as const)(
    "%s stdin: finished() and pipeline() settle at EOF when a later 'end' listener throws",
    async kind => {
      const body = `
        const { finished, pipeline, Writable } = require("node:stream");
        const sink = new Writable({ write(chunk, encoding, callback) { callback(); } });
        finished(stdin, err => events.push("finished destroyed=" + stdin.destroyed + " error=" + (err?.code ?? null)));
        pipeline(stdin, sink, err => events.push("pipeline error=" + (err?.code ?? null)));
        let closed = false;
        stdin.on("close", () => { closed = true; });
        stdin.on("end", () => { throw new Error("from end listener"); });
        events.push("autoClose=" + stdin.autoClose);
        process.prependListener("exit", () => events.push("close=" + closed));
        console.log("READY");
      `;
      const steps: Step[] = [["READY", io => (io.feed("hello"), io.end())]];
      // The throw keeps autoDestroy from running on a pipe. Bun destroys file stdin from a
      // listener of its own, which Node does not have, and 'close' follows.
      const file = kind === "file";
      expect(await run(kind, body, steps)).toEqual({
        ...released([
          "autoClose=" + !file,
          "finished destroyed=false error=null",
          "uncaught from end listener",
          "pipeline error=null",
          "close=" + file,
        ]),
        destroyed: file,
      });
    },
  );

  test.concurrent("EOF destroys stdin after removeAllListeners('end')", async () => {
    const body = `
      stdin.on("close", onClose);
      stdin.on("data", onData);
      stdin.removeAllListeners("end");
      console.log("READY");
    `;
    expect(await run("pipe", body, [["READY", io => (io.feed("hello"), io.end())]])).toEqual(
      released(["data", "close"]),
    );
  });

  test.concurrent("destroy() after a read leaves Bun.stdin.stream() unlocked", async () => {
    const body = `
      stdin.on("data", () => {
        stdin.destroy();
        events.push("locked=" + Bun.stdin.stream().locked);
        done();
      });
      console.log("READY");
    `;
    expect(await run("pipe", body, [["READY", io => io.feed("hello")]])).toEqual(released(["locked=false"]));
  });

  // The native source is shared with Bun.stdin.stream(). destroy() stops it, and a reader
  // that comes later does not start it again.
  test.concurrent("destroy() on a stdin that never read also stops Bun.stdin.stream()", async () => {
    const body = `
      stdin.removeAllListeners();
      stdin.destroy();
      Bun.stdin.stream().getReader().read().then(({ value }) => events.push("read " + Buffer.from(value)));
      console.log("READY");
      done();
    `;
    expect(await run("pipe", body, [["READY", io => io.feed("hello")]])).toEqual(released([]));
  });

  test.concurrent("process.stdin is an instance of an fs.ReadStream that the program replaced", async () => {
    using dir = tempDir("stdin-replaced", { "input.txt": "hello" });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const fs = require("node:fs");
        fs.ReadStream = class extends fs.ReadStream {};
        process.stdin.on("data", chunk => {
          console.log(JSON.stringify({ replaced: process.stdin instanceof fs.ReadStream, data: String(chunk) }));
        });`,
      ],
      stdin: Bun.file(join(String(dir), "input.txt")),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    expect(await stdioResult(proc)).toEqual({
      stdout: JSON.stringify({ replaced: true, data: "hello" }) + "\n",
      exitCode: 0,
    });
  });

  // Node's test/pseudo-tty/test-readable-tty-keepalive.js: it ends stdin with push(null) and must then exit.
  test.concurrent("test-readable-tty-keepalive.js exits", async () => {
    const exited = Promise.withResolvers<void>();
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "..", "test", "pseudo-tty", "test-readable-tty-keepalive.js")],
      env: bunEnv,
      terminal: {
        data() {},
        exit() {
          exited.resolve();
        },
      },
    });
    await Promise.all([exited.promise, proc.exited]);
    proc.terminal?.close();
    expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 0, signalCode: null });
  });

  // A FIFO as the stdin of a child timed out on macOS in CI, so these run on Linux.
  describe.skipIf(!isLinux)("bytes written after destroy() stay in the pipe", () => {
    // The child reopens its stdin by path, two turns of the loop after the bytes were written:
    // a reader that still watched fd 0 has taken them by then.
    const left = `
      const fs = require("node:fs");
      // The process outlives its stdin, as a server does. It gives up if the signal never comes.
      const alive = setTimeout(() => process.exit(2), 20_000);
      process.on("SIGUSR2", () => {
        setImmediate(() => setImmediate(() => {
          const fd = fs.openSync(process.env.STDIN_FIFO, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
          const buffer = Buffer.alloc(16);
          try {
            events.push("left " + buffer.toString("utf8", 0, fs.readSync(fd, buffer)));
          } catch (err) {
            events.push("left " + err.code);
          }
          clearTimeout(alive);
          done();
        }));
      });
    `;
    test.concurrent.each([
      [
        "destroy(err) of a stdin that read",
        `${left}
        stdin.on("data", chunk => {
          events.push("data " + chunk);
          stdin.destroy(new Error("mine"));
          console.log("READY2");
        });
        console.log("READY1");`,
        ["data first", "uncaught mine", "left later"],
      ],
      [
        "destroy() of a stdin that never read, after a read through Bun.stdin.stream()",
        `${left}
        const reader = Bun.stdin.stream().getReader();
        reader.read().then(({ value }) => {
          events.push("read " + Buffer.from(value));
          reader.releaseLock();
          stdin.destroy();
          console.log("READY2");
        });
        console.log("READY1");`,
        ["read first", "left later"],
      ],
    ] as const)("%s", async (_title, body, events) => {
      using dir = tempDir("stdin-destroy-fifo", {});
      const fifo = join(String(dir), "fifo");
      mkfifo(fifo);
      // Non-blocking, so that the open does not wait for a writer.
      const readEnd = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
      const writeEnd = openSync(fifo, "w");
      try {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", child(body)],
          stdin: readEnd,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...bunEnv, STDIN_FIFO: fifo },
        });
        const stderr = proc.stderr.text();
        const decoder = new TextDecoder();
        let output = "";
        let step = 0;
        for await (const chunk of proc.stdout) {
          output += decoder.decode(chunk, { stream: true });
          if (step === 0 && output.includes("READY1")) {
            step = 1;
            writeSync(writeEnd, "first");
          }
          if (step === 1 && output.includes("READY2")) {
            step = 2;
            writeSync(writeEnd, "later");
            proc.kill("SIGUSR2");
          }
        }
        await proc.exited;
        expect(report(output, await stderr, proc.exitCode, proc.signalCode)).toEqual(released(events));
      } finally {
        closeSync(readEnd);
        closeSync(writeEnd);
      }
    });
  });
});

test.concurrent("stdin should allow process to exit when paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        process.stdin.on("data", () => {});
        process.stdin.pause();
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  await proc.exited;
  expect(await proc.stdout.text()).toMatchInlineSnapshot(`""`);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
  expect(proc.exitCode).toBe(0);
});

test.concurrent("stdin should not allow process to exit when not paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.stdin.on("data", () => {});
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  await Bun.sleep(1000);
  expect(proc.exitCode).toBe(null);
  proc.kill();
  await proc.exited;
  expect(await proc.stdout.text()).toMatchInlineSnapshot(`""`);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
});

// unref() drops stdin's hold on the event loop and ref() takes it back: after
// the pair the child has nothing else pending and must still receive every
// later byte up to EOF.
test.concurrent("stdin.ref() after unref() keeps the process alive until EOF", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let total = 0;
      process.stdin.on("data", chunk => {
        if (total === 0) {
          process.stdin.unref();
          process.stdin.ref();
          process.stdout.write("ready\\n");
        }
        total += chunk.length;
      });
      process.stdin.on("end", () => {
        process.stdout.write("TOTAL " + total + "\\n");
      });
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  proc.stdin.write("x");
  while (!stdout.includes("ready\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value);
  }
  // The child is idle again with only stdin to wait for; these bytes must still reach it.
  const rest = Buffer.alloc(64 * 1024, "y");
  proc.stdin.write(rest);
  await proc.stdin.end();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value);
  }
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(`ready\nTOTAL ${1 + rest.length}\n`);
  expect(exitCode).toBe(0);
});

test.concurrent("a throw from a 'data' listener is an uncaughtException, and stdin keeps reading", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const seen = [];
      process.on("uncaughtException", (e, origin) => seen.push("uncaughtException:" + e.message + ":" + origin));
      process.stdin.on("error", e => seen.push("stream-error:" + e.message));
      let n = 0;
      process.stdin.on("data", d => {
        seen.push("data:" + d.toString());
        if (++n === 1) { console.log("GOT1"); throw new Error("handler-throw"); }
      });
      process.stdin.on("end", () => {
        console.log(JSON.stringify({ seen, destroyed: process.stdin.destroyed }));
      });`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("one");
  await proc.stdin.flush();
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  for (let r; !(r = await reader.read()).done;) {
    stdout += decoder.decode(r.value, { stream: true });
    if (stdout.includes("GOT1")) break;
  }
  proc.stdin.write("two");
  await proc.stdin.end();
  for (let r; !(r = await reader.read()).done;) stdout += decoder.decode(r.value, { stream: true });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode, ...(exitCode === 0 ? {} : { stderr }) }).toEqual({
    stdout:
      "GOT1\n" +
      JSON.stringify({
        seen: ["data:one", "uncaughtException:handler-throw:uncaughtException", "data:two"],
        destroyed: false,
      }) +
      "\n",
    exitCode: 0,
  });
});

test.concurrent("a throw from a 'readable' listener is an uncaughtException, including the EOF emission", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const seen = [];
      process.on("uncaughtException", e => seen.push("uncaughtException:" + e.message));
      process.stdin.on("error", e => seen.push("stream-error:" + e.message));
      let n = 0;
      process.stdin.on("readable", () => {
        n++;
        let chunk;
        while ((chunk = process.stdin.read()) !== null) seen.push("readable:" + chunk.toString());
        throw new Error("readable-throw-" + n);
      });
      process.stdin.on("end", () => seen.push("end"));
      process.on("exit", () => console.log(JSON.stringify(seen)));`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("hello");
  await proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({
    stdout:
      JSON.stringify([
        "readable:hello",
        "uncaughtException:readable-throw-1",
        "end",
        "uncaughtException:readable-throw-2",
      ]) + "\n",
    exitCode: 0,
  });
});

test.concurrent("pause() and resume() churn while data is in flight never destroys stdin", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let total = 0;
      process.stdin.on("data", d => { total += d.length; });
      process.stdin.on("error", err => { console.log("ERROR " + (err?.code || err?.message)); process.exit(1); });
      process.stdin.on("end", () => { console.log("TOTAL " + total); });
      const churn = setInterval(() => { process.stdin.pause(); process.stdin.resume(); }, 5);
      churn.unref();
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  for (let i = 0; i < 20; i++) {
    proc.stdin.write("x".repeat(1024));
    await Bun.sleep(10);
  }
  await proc.stdin.end();
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe(`TOTAL ${20 * 1024}`);
  expect(exitCode).toBe(0);
});

// The native FileReader source over a pollable pipe used to drain the fd to
// EAGAIN regardless of JS demand, so an idle consumer still ingested the whole
// pipe into an internal buffer. The kernel pipe buffer filling up is the
// backpressure signal; these tests feed far more than that and check the
// child's resident set does not grow to match.
describe.skipIf(isWindows)("pipe backpressure", () => {
  const feedMB = 40;
  // With no backpressure the child buffers the whole feed (Vec growth roughly
  // doubles that in RSS). With backpressure only the highwater mark plus the
  // kernel pipe buffer are resident in the child.
  const maxDeltaMB = isASAN || isDebug ? 24 : 16;

  async function run(consumer: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", consumer],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    // The child exits under backpressure having accepted only a few KB, so
    // the queued writes here fail with EPIPE; that is the expected outcome.
    const chunk = Buffer.alloc(1024 * 1024, 0x78);
    const ignoreEpipe = (e: any) => {
      if (e?.code !== "EPIPE") throw e;
    };
    for (let i = 0; i < feedMB; i++) {
      const r = proc.stdin.write(chunk);
      if (r && typeof (r as any).then === "function") (r as Promise<number>).catch(ignoreEpipe);
    }
    Promise.resolve(proc.stdin.flush()).catch(ignoreEpipe);
    Promise.resolve(proc.stdin.end()).catch(ignoreEpipe);
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    expect(exitCode).toBe(0);
    return result;
  }

  test.concurrent("Bun.stdin.stream(): a single read does not ingest the whole pipe", async () => {
    const { first, deltaMB } = await run(`
      const rss = process.memoryUsage.rss;
      const rd = Bun.stdin.stream().getReader();
      const c = await rd.read();
      const base = rss();
      // Give the event loop time to (incorrectly) drain the pipe. The loop is
      // native (no JS on the no-pending path), so debug/ASAN overhead is small.
      await new Promise(r => setTimeout(r, 1500));
      const deltaMB = Math.round((rss() - base) / 1048576);
      process.stdout.write(JSON.stringify({ first: c.value?.length ?? 0, deltaMB }));
      process.exit(0);
    `);
    expect(first).toBeGreaterThan(0);
    expect(deltaMB).toBeLessThan(maxDeltaMB);
  });

  test.concurrent("process.stdin.pause() stops the fd from being read", async () => {
    const { bytesAfter, deltaMB } = await run(`
      const rss = process.memoryUsage.rss;
      let bytes = 0, pausedAt = 0;
      process.stdin.on("data", chunk => {
        bytes += chunk.length;
        if (!pausedAt && bytes >= 1 << 20) {
          pausedAt = bytes;
          process.stdin.pause();
          const base = rss();
          setTimeout(() => {
            const deltaMB = Math.round((rss() - base) / 1048576);
            process.stdout.write(JSON.stringify({ bytesAtPause: pausedAt, bytesAfter: bytes, deltaMB }));
            process.exit(0);
          }, 1500);
        }
      });
    `);
    expect(bytesAfter).toBeLessThan(feedMB * 1024 * 1024);
    expect(deltaMB).toBeLessThan(maxDeltaMB);
  });

  // Stopped at the backstop, the reader's one-shot poll is left unarmed until
  // the next read, so it can observe nothing (not even the writer going away)
  // and must not keep the event loop alive on its own. Node behaves the same:
  // readStop() at the highWaterMark leaves the handle inactive.
  test.concurrent("a reader stopped at the highwater backstop does not keep the process alive", async () => {
    const { first } = await run(`
      const rd = Bun.stdin.stream().getReader();
      const c = await rd.read();
      process.stdout.write(JSON.stringify({ first: (c.value?.length ?? 0) > 0 }));
      // No further read and no exit(): once the backstop engages nothing is pending.
    `);
    expect(first).toBe(true);
  });

  // The same over an anonymous pipe (the blocking-pipe read path; Bun.spawn
  // stdio above is a socketpair). The writer keeps the pipe full until the
  // reader is gone, so EOF can never be what lets the reader exit.
  test.concurrent("over a shell pipe, a reader stopped at the backstop does not keep the process alive", async () => {
    using dir = tempDir("stdin-backstop-pipe", {
      "writer.js": `
        const chunk = Buffer.alloc(65536, 0x78);
        process.stdout.on("error", () => process.exit(0));
        (function pump() {
          while (process.stdout.write(chunk)) {}
          process.stdout.once("drain", pump);
        })();
      `,
      "reader.js": `
        const reader = Bun.stdin.stream().getReader();
        const { value } = await reader.read();
        process.on("exit", () => console.log("EXIT"));
        console.log("FIRST " + (value.byteLength > 0));
      `,
    });
    const { promise, resolve } = Promise.withResolvers<{ err: Error | null; stdout: string; stderr: string }>();
    exec(
      `"${bunExe()}" writer.js | "${bunExe()}" reader.js`,
      { cwd: String(dir), env: bunEnv },
      (err, stdout, stderr) => resolve({ err, stdout, stderr }),
    );
    expect(await promise).toEqual({ err: null, stdout: "FIRST true\nEXIT\n", stderr: "" });
  });

  // Stopping unregisters a fired one-shot poll without a syscall, which leaves
  // its disarmed registration in the kernel. Cancelling the stream must still
  // take it out: fd 0 stays open, and the next poll on it would hit EEXIST.
  test.concurrent("a reader cancelled at the highwater backstop frees fd 0 for the next reader", async () => {
    const { second } = await run(`
      const { getEventLoopStats } = require("bun:internal-for-testing");
      // Not top-level await: an unsettled entry-module promise would keep the process alive by itself.
      (async () => {
        const reader = Bun.stdin.stream().getReader();
        await reader.read();
        // The parent keeps the pipe full, so the reader soon stops and lets go of the loop.
        while (getEventLoopStats().loopActive) await new Promise(resolve => setImmediate(resolve));
        await reader.cancel();
        const next = await Bun.file(0).stream().getReader().read();
        process.stdout.write(JSON.stringify({ second: (next.value?.length ?? 0) > 0 }));
        process.exit(0);
      })();
    `);
    expect(second).toBe(true);
  });

  test.concurrent("reading resumes after the highwater backstop", async () => {
    // Stop reading long enough for the backstop to engage, then drain to EOF
    // and make sure every byte written by the parent is delivered.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const rd = Bun.stdin.stream().getReader();
        await rd.read().then(c => { globalThis.total = c.value?.length ?? 0; });
        await new Promise(r => setTimeout(r, 200));
        while (true) {
          const { value, done } = await rd.read();
          if (value) total += value.length;
          if (done) break;
        }
        process.stdout.write(String(total));
        `,
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const chunk = Buffer.alloc(64 * 1024, 0x79);
    const n = 64;
    for (let i = 0; i < n; i++) proc.stdin.write(chunk);
    await proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(String(n * chunk.length));
    expect(exitCode).toBe(0);
  });
});

test("process.stdin over an anonymous pipe delivers each byte exactly once", async () => {
  const total = 10 * 1024 * 1024;
  using dir = tempDir("stdin-pipe-exactly-once", {
    "writer.js": `const chunk = Buffer.alloc(65536); let left = ${total}; (function pump() { while (left > 0) { left -= chunk.length; if (!process.stdout.write(chunk)) return process.stdout.once("drain", pump); } })();`,
    "reader.js": `const h = new Bun.CryptoHasher("sha1"); let n = 0; process.stdin.on("data", d => { n += d.length; h.update(d); }); process.stdin.on("close", () => process.stdout.write(n + " " + h.digest("hex")));`,
  });
  const { promise, resolve } = Promise.withResolvers<{ err: Error | null; stdout: string; stderr: string }>();
  exec(`"${bunExe()}" writer.js | "${bunExe()}" reader.js`, { cwd: String(dir), env: bunEnv }, (err, stdout, stderr) =>
    resolve({ err, stdout, stderr }),
  );
  const { err, stdout, stderr } = await promise;
  expect(stderr).toBe("");
  const expected = new Bun.CryptoHasher("sha1").update(Buffer.alloc(total)).digest("hex");
  expect(stdout).toBe(`${total} ${expected}`);
  expect(err).toBeNull();
});
