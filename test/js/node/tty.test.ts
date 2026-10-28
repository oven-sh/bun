import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExeAtLeast, tempDir } from "harness";
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { join } from "node:path";
import { WriteStream } from "node:tty";

describe("ReadStream.prototype.setRawMode", () => {
  // Regression: on Windows, the `fd === 0` branch returned early on success
  // without ever reaching `this.isRaw = flag`, so `process.stdin.isRaw` stayed
  // `false` after a successful `setRawMode(true)`. On POSIX this already
  // worked; the test runs on both to lock the behaviour in.
  test("updates isRaw on process.stdin after a successful call", async () => {
    let output = "";
    const decoder = new TextDecoder();
    const done = Promise.withResolvers<void>();
    const eof = Promise.withResolvers<void>();

    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          let err;
          process.stdin.on("error", e => (err = String(e)));
          const isTTY = process.stdin.isTTY;
          const before = process.stdin.isRaw;
          const ret = process.stdin.setRawMode(true);
          const afterTrue = process.stdin.isRaw;
          process.stdin.setRawMode(false);
          const afterFalse = process.stdin.isRaw;
          process.stdout.write(
            "RESULT " +
              JSON.stringify({
                isTTY,
                before,
                afterTrue,
                afterFalse,
                returnsThis: ret === process.stdin,
                ...(err ? { err } : {}),
              }),
          );
          process.exit(0);
        `,
      ],
      env: bunEnv,
      terminal: {
        // Wide enough that ConPTY does not hard-wrap the RESULT line.
        cols: 200,
        rows: 24,
        data(_t, chunk: Uint8Array) {
          output += decoder.decode(chunk, { stream: true });
          if (output.includes("RESULT ") && output.includes("}")) done.resolve();
        },
        exit() {
          eof.resolve();
        },
      },
    });

    await Promise.race([done.promise, eof.promise]);
    proc.kill();
    await proc.exited;
    proc.terminal?.close();
    output += decoder.decode();

    // ConPTY injects VT escape sequences and CR around the payload; strip
    // them so the RESULT JSON can be matched regardless of where the
    // terminal emulator decides to park the cursor.
    const stripped = Bun.stripANSI(output).replace(/[\r\n]/g, "");

    // Bun.Terminal always gives the child a TTY stdin (openpty / ConPTY). If
    // RESULT is missing for any reason, surface the raw terminal output
    // rather than a bare null match.
    const match = stripped.match(/RESULT (\{[^}]*\})/);
    if (!match) {
      throw new Error("child did not emit RESULT; terminal output was: " + JSON.stringify(output));
    }
    expect(JSON.parse(match[1])).toEqual({
      isTTY: true,
      before: false,
      afterTrue: true,
      afterFalse: false,
      returnsThis: true,
    });
  });

  // Raw mode is per-stream in libuv (each uv_tty_t holds its own mode and its
  // own saved termios), so a second tty.ReadStream on the same fd must not be
  // able to restore the terminal out from under the stream that raw'd it.
  // Bun used to keep one process-wide mode + termios snapshot, which turned
  // `setRawMode(false)` on a never-raw stream into a real tcsetattr.
  test.skipIf(isWindows)("a second ReadStream's setRawMode does not disturb process.stdin", async () => {
    const ICANON = process.platform === "darwin" ? 0x100 : 0x2;
    const ECHO = 0x8;

    const decoder = new TextDecoder();
    let buffer = "";
    const waiters: { marker: string; resolve: () => void }[] = [];

    await using terminal = new Bun.Terminal({
      data(_terminal, chunk: Uint8Array) {
        buffer += decoder.decode(chunk, { stream: true });
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (buffer.includes(waiters[i].marker)) {
            waiters[i].resolve();
            waiters.splice(i, 1);
          }
        }
      },
    });

    const isRaw = () => (terminal.localFlags & (ICANON | ECHO)) === 0;
    const observed: Record<string, boolean> = { beforeSpawn: isRaw() };

    // Each phase announces itself, then blocks on stdin so the parent can read
    // termios while the child is still alive, and releases on the ack byte.
    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const tty = require("node:tty");
          const { TTY } = process.binding("tty_wrap");
          const say = s => process.stdout.write(s + "\\n");
          const ack = () => new Promise(resolve => process.stdin.once("data", () => resolve()));
          (async () => {
            process.stdin.resume();
            process.stdin.setRawMode(true);
            say("P1"); await ack();

            const second = new tty.ReadStream(0);
            second.setRawMode(false); // never raw: must be a no-op
            say("P2"); await ack();

            second.setRawMode(true);
            second.setRawMode(false); // restores its own snapshot, which was already raw
            say("P3"); await ack();

            new TTY(0).setRawMode(0); // same, through the tty_wrap binding
            say("P4"); await ack();

            process.stdin.setRawMode(false); // the stream that raw'd it restores cooked
            say("P5"); await ack();
            process.exit(0);
          })();
        `,
      ],
      env: bunEnv,
      terminal,
    });

    // A child that dies early must reject the phase waits rather than hang them.
    const exitedEarly = proc.exited.then(code => {
      throw new Error(`child exited early with code ${code}; terminal output: ${JSON.stringify(buffer)}`);
    });
    exitedEarly.catch(() => {});

    const phase = (marker: string) => {
      const seen = buffer.includes(marker)
        ? Promise.resolve()
        : new Promise<void>(resolve => waiters.push({ marker, resolve }));
      return Promise.race([seen, exitedEarly]);
    };

    await phase("P1");
    observed.afterStdinRaw = isRaw();
    terminal.write("\n");

    await phase("P2");
    observed.afterSecondStreamCooked = isRaw();
    terminal.write("\n");

    await phase("P3");
    observed.afterSecondStreamRoundTrip = isRaw();
    terminal.write("\n");

    await phase("P4");
    observed.afterTTYWrapCooked = isRaw();
    terminal.write("\n");

    await phase("P5");
    observed.afterStdinCooked = isRaw();
    terminal.write("\n");

    expect(observed).toEqual({
      beforeSpawn: false,
      afterStdinRaw: true,
      afterSecondStreamCooked: true,
      afterSecondStreamRoundTrip: true,
      afterTTYWrapCooked: true,
      afterStdinCooked: false,
    });
    expect(await proc.exited).toBe(0);
  });

  // What the pty is set to, read from its master: "cooked" has ICANON and ECHO, "raw" has neither and still
  // post-processes output (OPOST), "io" is cfmakeraw(), which turns OPOST off as well.
  function modeOf(terminal: Bun.Terminal) {
    const OPOST = 0x1;
    const ICANON = process.platform === "darwin" ? 0x100 : 0x2;
    const ECHO = 0x8;
    const line = terminal.localFlags & (ICANON | ECHO);
    const opost = (terminal.outputFlags & OPOST) !== 0;
    if (line === (ICANON | ECHO) && opost) return "cooked";
    if (line === 0) return opost ? "raw" : "io";
    return `lflag ${terminal.localFlags.toString(16)}, oflag ${terminal.outputFlags.toString(16)}`;
  }

  // Runs `apply(input)` for each input in a child on a pty. After each call the child prints a marker and waits
  // for a byte on stdin, so the mode of the pty is read here while the child is alive. Resolves to a row of
  // [input, mode of the pty, what apply() returned] per input.
  async function eachStepOnPty(cmd: string[], inputs: readonly unknown[], apply: string) {
    const decoder = new TextDecoder();
    let buffer = "";
    let wake = () => {};
    await using terminal = new Bun.Terminal({
      data(_terminal, chunk: Uint8Array) {
        buffer += decoder.decode(chunk, { stream: true });
        wake();
      },
    });
    const before = modeOf(terminal);

    const proc = Bun.spawn({
      cmd: [
        ...cmd,
        "-e",
        `
          const stdin = process.stdin;
          const stop = text =>
            new Promise(resolve => {
              stdin.once("data", resolve);
              process.stdout.write(text + "\\n");
            });
          (async () => {
            stdin.resume();
            const apply = ${apply};
            const inputs = ${JSON.stringify(inputs)};
            const results = [];
            for (let i = 0; i < inputs.length; i++) {
              results.push(apply(inputs[i]));
              await stop("<" + i + ">");
            }
            await stop("RESULT " + JSON.stringify(results) + " END");
            process.exit(0);
          })();
        `,
      ],
      env: bunEnv,
      terminal,
    });
    let exitCode: number | undefined;
    proc.exited.then(code => {
      exitCode = code;
      wake();
    });
    // A child that dies early must fail the wait rather than hang it.
    const stopped = async (marker: string) => {
      while (!buffer.includes(marker)) {
        if (exitCode !== undefined) {
          throw new Error(`child exited with code ${exitCode} before ${marker}; output: ${JSON.stringify(buffer)}`);
        }
        await new Promise<void>(resolve => (wake = resolve));
      }
    };

    const modes: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      await stopped(`<${i}>`);
      modes.push(modeOf(terminal));
      terminal.write("\n");
    }
    await stopped(" END");
    const results = JSON.parse(buffer.slice(buffer.indexOf("RESULT ") + "RESULT ".length, buffer.indexOf(" END")));
    terminal.write("\n");
    expect(await proc.exited).toBe(0);
    return { before, rows: inputs.map((input, i) => [input, modes[i], results[i]]) };
  }

  // Runs `body`, the body of a function, in a child whose stdin is a terminal, on every platform, and resolves
  // to what it returns. The result goes through a file: ConPTY re-renders what a child prints.
  async function resultOnTerminal(cmd: string[], body: string) {
    using dir = tempDir("tty-set-raw-mode", {});
    const resultPath = join(String(dir), "result.json");
    let output = "";
    const decoder = new TextDecoder();
    const done = Promise.withResolvers<void>();
    const eof = Promise.withResolvers<void>();

    const proc = Bun.spawn({
      cmd: [
        ...cmd,
        "-e",
        `
          const result = (() => {${body}})();
          require("node:fs").writeFileSync(process.env.TTY_TEST_RESULT, JSON.stringify(result));
          process.stdout.write("DONE");
          process.exit(0);
        `,
      ],
      env: { ...bunEnv, TTY_TEST_RESULT: resultPath },
      terminal: {
        cols: 200,
        rows: 24,
        data(_t, chunk: Uint8Array) {
          output += decoder.decode(chunk, { stream: true });
          if (output.includes("DONE")) done.resolve();
        },
        exit() {
          eof.resolve();
        },
      },
    });

    await Promise.race([done.promise, eof.promise]);
    proc.kill();
    await proc.exited;
    proc.terminal?.close();

    const file = Bun.file(resultPath);
    if (!(await file.exists())) {
      throw new Error("child did not write its result; terminal output was: " + JSON.stringify(output));
    }
    return await file.json();
  }

  // Node v26.8 (nodejs/node#64140) made `mode` boolean | "raw" | "io". "raw" is the mode `true` selects, "io" is
  // libuv's binary-safe UV_TTY_MODE_IO, and every other string throws before the stream or the terminal is
  // touched. `rawMode` says which of the three modes the stream is in. The tables below are what Node v26.12.1
  // answers. Where PATH has a Node with that change, the same children run under it as well.
  describe.each([
    ["bun", bunExe()],
    ["node", nodeExeAtLeast("26.8.0")],
  ])("as Node v26.8 does, on %s", (runtime, exe) => {
    // Node warns about process.binding(), and about the localStorage that Bun's copy of test/common reads.
    const cmd = runtime === "node" ? [exe!, "--no-warnings"] : [exe!];

    test.skipIf(!exe)("takes 'raw' and 'io', rejects every other string, and reports rawMode", async () => {
      const rejected = ["false", "off", "0", "", "true", "RAW", "IO", "io ", "raw-vt"];
      const result = await resultOnTerminal(
        cmd,
        `
          const stdin = process.stdin;
          const errors = [];
          stdin.on("error", e => errors.push({ code: e.code, errno: e.errno, syscall: e.syscall, message: e.message }));
          const state = () => ({ isRaw: stdin.isRaw, rawMode: stdin.rawMode });
          const outcome = fn => {
            try {
              return { returnsThis: fn() === stdin, ...state() };
            } catch (e) {
              return { thrown: e.name + " [" + e.code + "]: " + e.message, ...state() };
            }
          };
          const setRawMode = mode => outcome(() => stdin.setRawMode(mode));
          const accepted = {};
          for (const [label, mode] of [
            ["true", true],
            ['"raw"', "raw"],
            ["1", 1],
            ["{}", {}],
            ['Object("io")', Object("io")],
            ["false", false],
            ["0", 0],
            ["null", null],
            ["undefined", undefined],
          ]) {
            accepted[label] = setRawMode(mode);
            stdin.setRawMode(false);
          }
          const result = {
            isTTY: stdin.isTTY,
            initial: state(),
            descriptor: Object.getOwnPropertyDescriptor(stdin, "rawMode"),
            keys: Object.keys(stdin).filter(key => key === "isRaw" || key === "rawMode" || key === "isTTY"),
            accepted,
            rejected: ${JSON.stringify(rejected)}.map(setRawMode),
            rejectedWhileRaw: (stdin.setRawMode(true), setRawMode("false")),
            anyReceiver: (stdin.setRawMode(false), outcome(() => stdin.setRawMode.call(undefined, "a"))),
            throughReadline: outcome(() =>
              require("node:readline").Interface.prototype._setRawMode.call({ input: stdin }, "bogus"),
            ),
            io: setRawMode("io"),
            errors,
          };
          stdin.setRawMode(false);
          return result;
        `,
      );

      const cooked = { isRaw: false, rawMode: false };
      const raw = { isRaw: true, rawMode: "raw" };
      const thrown = (mode: string) =>
        `TypeError [ERR_INVALID_ARG_VALUE]: The argument 'mode' must be true, false, 'raw', or 'io'. Received '${mode}'`;
      expect(result).toEqual({
        isTTY: true,
        initial: cooked,
        descriptor: { value: false, writable: true, enumerable: true, configurable: true },
        keys: ["isRaw", "rawMode", "isTTY"],
        accepted: {
          "true": { returnsThis: true, ...raw },
          '"raw"': { returnsThis: true, ...raw },
          "1": { returnsThis: true, ...raw },
          "{}": { returnsThis: true, ...raw },
          // Only a primitive string names a mode. Every other value goes by its truthiness.
          'Object("io")': { returnsThis: true, ...raw },
          "false": { returnsThis: true, ...cooked },
          "0": { returnsThis: true, ...cooked },
          "null": { returnsThis: true, ...cooked },
          "undefined": { returnsThis: true, ...cooked },
        },
        rejected: rejected.map(mode => ({ thrown: thrown(mode), ...cooked })),
        rejectedWhileRaw: { thrown: thrown("false"), ...raw },
        // The check comes before anything reads the receiver.
        anyReceiver: { thrown: thrown("a"), ...cooked },
        throughReadline: { thrown: thrown("bogus"), ...cooked },
        // libuv has no UV_TTY_MODE_IO on Windows: uv_tty_set_mode() answers UV_ENOTSUP, which Node emits as 'error'.
        io: isWindows ? { returnsThis: true, ...cooked } : { returnsThis: true, isRaw: true, rawMode: "io" },
        errors: isWindows
          ? [{ code: "ENOTSUP", errno: -4049, syscall: "setRawMode", message: "setRawMode ENOTSUP" }]
          : [],
      });
    });

    // The binding takes its mode with Int32Value(), so `true` is 1 and no argument is 0:
    // https://github.com/nodejs/node/blob/v26.12.1/src/tty_wrap.cc#L135-L136
    // Bun threw a TypeError for both. This runs on Windows too, where libuv has no UV_TTY_MODE_IO.
    test.skipIf(!exe)("tty_wrap TTY#setRawMode coerces its mode", async () => {
      // [arguments, what the call returns]
      const expected = [
        [[true], 0],
        [[], 0],
        [[2], isWindows ? -4049 /* UV_ENOTSUP */ : 0],
        // 7 is none of libuv's modes. libuv answers UV_EINVAL for it on Windows, and on POSIX since v1.53.0
        // (libuv/libuv#5174). Node v26.12.1 has libuv 1.52.1, which aborts on POSIX. On POSIX this binding has
        // always answered a failure as a positive errno.
        ...(isWindows ? [[[7], -4071 /* UV_EINVAL */]] : runtime === "bun" ? [[[7], constants.errno.EINVAL]] : []),
        [[0], 0],
      ];
      const returned = await resultOnTerminal(
        cmd,
        `
          const tty = new (process.binding("tty_wrap").TTY)(0);
          return ${JSON.stringify(expected.map(row => row[0]))}.map(args => {
            try {
              return tty.setRawMode(...args);
            } catch (e) {
              return String(e);
            }
          });
        `,
      );
      expect(expected.map((row, i) => [row[0], returned[i]])).toEqual(expected);
    });

    // Bun turned "io" into `true`: the call returned with isRaw set and the terminal in plain raw mode, so a
    // program that asked for binary-safe output still had every "\n" it wrote turned into "\r\n".
    test.skipIf(!exe || isWindows)("'io' turns output processing off, 'raw' and true leave it on", async () => {
      // [mode, the pty after the call, rawMode after the call]
      const expected = [
        ["nope", "cooked", "ERR_INVALID_ARG_VALUE, still false"],
        ["io", "io", "io"],
        ["nope", "io", "ERR_INVALID_ARG_VALUE, still io"],
        ["raw", "raw", "raw"],
        ["nope", "raw", "ERR_INVALID_ARG_VALUE, still raw"],
        [false, "cooked", false],
        [true, "raw", "raw"],
        ["io", "io", "io"],
        [false, "cooked", false],
      ];
      const { before, rows } = await eachStepOnPty(
        cmd,
        expected.map(row => row[0]),
        `mode => {
          try {
            stdin.setRawMode(mode);
            return stdin.rawMode;
          } catch (e) {
            return e.code + ", still " + stdin.rawMode;
          }
        }`,
      );
      expect(before).toBe("cooked");
      expect(rows).toEqual(expected);
    });

    // Node's tty.js hands UV_TTY_MODE_RAW_VT (3) to the handle for raw mode, and libuv folds it into
    // UV_TTY_MODE_RAW on POSIX. Bun's setter had no arm for 3: the call answered 0 and left the terminal cooked.
    test.skipIf(!exe || isWindows)("tty_wrap TTY#setRawMode takes libuv's mode numbers", async () => {
      // [arguments, the pty after the call, what the call returned]
      const expected = [
        [[3], "raw", 0],
        [[2], "io", 0],
        [[3], "raw", 0],
        // Bun only: Node v26.12.1 aborts on a mode that is none of libuv's (see the test above).
        ...(runtime === "bun"
          ? [
              [[7], "raw", constants.errno.EINVAL],
              [[-1], "raw", constants.errno.EINVAL],
            ]
          : []),
        [[0], "cooked", 0],
        [[true], "raw", 0],
        [[], "cooked", 0],
        [["3"], "raw", 0],
        [[{}], "cooked", 0],
      ];
      const { before, rows } = await eachStepOnPty(
        cmd,
        expected.map(row => row[0]),
        `(tty => args => {
          try {
            return tty.setRawMode(...args);
          } catch (e) {
            return String(e);
          }
        })(new (process.binding("tty_wrap").TTY)(0))`,
      );
      expect(before).toBe("cooked");
      expect(rows).toEqual(expected);
    });

    // Node's own test for nodejs/node#64140, unedited. Node's harness (tools/pseudo-tty.py) runs it on a pty that
    // has ONLCR and ECHOCTL off and compares what it prints with the .out file. From that start raw mode turns
    // ONLCR on and "io" leaves it off, which is the half of the difference that modeOf() does not look at.
    test.skipIf(!exe || isWindows || !Bun.which("stty"))(
      "node's test/pseudo-tty/test-set-raw-mode-modes.js",
      async () => {
        const ONLCR = process.platform === "darwin" ? 0x2 : 0x4;
        const ECHOCTL = process.platform === "darwin" ? 0x40 : 0x200;
        const file = join(import.meta.dir, "test", "pseudo-tty", "test-set-raw-mode-modes.js");
        const decoder = new TextDecoder();
        let output = "";
        const ended = Promise.withResolvers<void>();
        await using terminal = new Bun.Terminal({
          data(_terminal, chunk: Uint8Array) {
            output += decoder.decode(chunk, { stream: true });
            if (/^exit \d+$/m.test(output.replaceAll("\r", ""))) ended.resolve();
          },
        });
        terminal.outputFlags &= ~ONLCR;
        terminal.localFlags &= ~ECHOCTL;

        // Output can arrive after the child has exited. The shell prints one more line behind it, so all of the
        // test's output is here once that line is.
        const proc = Bun.spawn({
          cmd: ["sh", "-c", '"$@"; echo "exit $?"', "sh", ...cmd, file],
          env: bunEnv,
          terminal,
        });
        await ended.promise;
        await proc.exited;

        const lines = (text: string) =>
          text
            .replaceAll("\r", "")
            .split("\n")
            .filter(line => line !== "");
        expect(lines(output)).toEqual([...lines(await Bun.file(file.replace(/\.js$/, ".out")).text()), "exit 0"]);
      },
    );
  });
});

describe("WriteStream end()", () => {
  // The parent does not read the child's stdout until the child has called
  // end(), so most of the 1 MiB sits in the stream's sink at that point. The
  // callback must wait for it, or process.exit truncates the output.
  //
  // Windows: a write to an inherited stdout pipe blocks until the reader
  // drains it (every write() returns true), so the child never reaches end()
  // while the parent waits, and there is no backlog to flush.
  it.skipIf(isWindows)("fires the callback after the backlog is flushed", async () => {
    const child = spawn(
      bunExe(),
      [
        "-e",
        `const { WriteStream } = require("node:tty");
         const out = new WriteStream(1);
         const chunk = Buffer.alloc(256 * 1024, 120);
         for (let i = 0; i < 4; i++) out.write(chunk);
         out.end(() => process.exit(0));
         process.send("ending");`,
      ],
      { env: bunEnv, stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    let received = 0;
    let reading = false;
    // 'exit' is the fallback for a child that dies before it sends "ending".
    const read = () => {
      if (reading) return;
      reading = true;
      child.stdout!.on("data", d => (received += d.length));
    };
    child.on("message", read);
    child.on("exit", read);
    const stderr = new Promise<string>(resolve => {
      let err = "";
      child.stderr!.on("data", d => (err += d));
      child.stderr!.on("end", () => resolve(err));
    });
    const { promise: ended, resolve: onEnd } = Promise.withResolvers<void>();
    child.stdout!.on("end", onEnd);
    const exited = new Promise<number | null>(resolve => child.on("exit", resolve));

    await ended;
    expect(await stderr).toBe("");
    expect(received).toBe(4 * 256 * 1024);
    expect(await exited).toBe(0);
  });
});

describe("WriteStream.prototype.getColorDepth", () => {
  const getColorDepth = (env: Record<string, string>) => WriteStream.prototype.getColorDepth.call(undefined, env);

  // Expected values come from running the same env objects through Node
  // v26.3.0. On Windows the OS build number decides instead of TERM/CI/
  // COLORTERM, so the env matrix is only meaningful on POSIX.
  const cases: [env: Record<string, string>, depth: number][] = [
    [{ TERM: "dumb" }, 1],
    [{ TERM: "dumb", COLORTERM: "truecolor" }, 1],
    [{ NO_COLOR: "1", COLORTERM: "24bit" }, 1],
    [{ NO_COLOR: "", COLORTERM: "24bit" }, 24],
    [{ NO_COLOR: "", TERM: "xterm-256color" }, 8],
    [{ NODE_DISABLE_COLORS: "1", TERM: "color" }, 1],
    [{ NODE_DISABLE_COLORS: "", TERM: "xterm" }, 4],
    [{ FORCE_COLOR: "" }, 4],
    [{ FORCE_COLOR: "1" }, 4],
    [{ FORCE_COLOR: "true" }, 4],
    [{ FORCE_COLOR: "2" }, 8],
    [{ FORCE_COLOR: "3" }, 24],
    [{ FORCE_COLOR: "0" }, 1],
    [{ FORCE_COLOR: "junk" }, 1],
    [{ NO_COLOR: "1", FORCE_COLOR: "2" }, 8],
    [{ NODE_DISABLE_COLORS: "1", FORCE_COLOR: "3" }, 24],
    [{ COLORTERM: "24bit", FORCE_COLOR: "" }, 4],
    [{ TMUX: "1" }, 24],
    [{ TMUX: "1", COLORTERM: "truecolor" }, 24],
    [{ TMUX: "1", TERM: "tmux-256color" }, 24],
    [{ TF_BUILD: "1", AGENT_NAME: "x" }, 4],
    [{ TF_BUILD: "1" }, 1],
    [{ CI: "1" }, 1],
    [{ CI: "" }, 1],
    [{ CI: "1", APPVEYOR: "1" }, 8],
    [{ CI: "1", BUILDKITE: "1" }, 8],
    [{ CI: "1", CIRCLECI: "1" }, 24],
    [{ CI: "1", DRONE: "1" }, 8],
    [{ CI: "1", GITEA_ACTIONS: "1" }, 24],
    [{ CI: "1", GITHUB_ACTIONS: "1" }, 24],
    [{ CI: "1", GITLAB_CI: "1" }, 8],
    [{ CI: "1", TRAVIS: "1" }, 8],
    [{ CI: "1", CI_NAME: "codeship" }, 8],
    [{ TEAMCITY_VERSION: "9.0.5 (build 32523)" }, 1],
    [{ TEAMCITY_VERSION: "9.1.0 (build 32523)" }, 4],
    [{ TERM_PROGRAM: "iTerm.app" }, 8],
    [{ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "2.1" }, 8],
    [{ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.2" }, 24],
    [{ TERM_PROGRAM: "HyperTerm" }, 24],
    [{ TERM_PROGRAM: "MacTerm" }, 24],
    [{ TERM_PROGRAM: "Apple_Terminal" }, 8],
    [{ COLORTERM: "truecolor" }, 24],
    [{ COLORTERM: "24bit" }, 24],
    [{ COLORTERM: "1" }, 4],
    [{ TERM: "xterm" }, 4],
    [{ TERM: "xterm", COLORTERM: "truecolor" }, 24],
    [{ TERM: "xterm-256" }, 8],
    [{ TERM: "xterm-256color" }, 8],
    [{ TERM: "xterm-kitty" }, 24],
    [{ TERM: "xterm-direct" }, 4],
    [{ TERM: "screen.xterm-truecolor" }, 24],
    [{ TERM: "rxvt-unicode-24bit" }, 24],
    [{ TERM: "rxvt" }, 4],
    [{ TERM: "vt100" }, 4],
    [{ TERM: "vt220" }, 4],
    [{ TERM: "konsole" }, 4],
    [{ TERM: "KONSOLE" }, 4],
    [{ TERM: "mosh" }, 24],
    [{ TERM: "terminator" }, 24],
    [{ TERM: "st" }, 4],
    [{ TERM: "linux" }, 4],
    [{ TERM: "ansi" }, 4],
    [{ TERM: "ANSI" }, 4],
    [{ TERM: "color" }, 4],
    [{ TERM: "con132x25" }, 4],
    [{ TERM: "fail" }, 1],
    [{ TERM: "" }, 1],
    [{ COLORTERM: "ansi256" }, 4],
  ];

  it.skipIf(isWindows)("matches Node across the TERM/COLORTERM/CI env matrix", () => {
    const results = cases.map(([env, expected]) => ({ env, expected, actual: getColorDepth(env) }));
    expect(results.filter(r => r.actual !== r.expected)).toEqual([]);
  });

  // Bun recognizes these truecolor terminals on top of Node's list.
  it.skipIf(isWindows)("reports 24-bit color for ghostty and WezTerm", () => {
    expect(getColorDepth({ TERM_PROGRAM: "ghostty" })).toBe(24);
    expect(getColorDepth({ TERM_PROGRAM: "WezTerm" })).toBe(24);
  });

  it("iTerm ancient", () => {
    expect(
      WriteStream.prototype.getColorDepth.call(undefined, {
        TERM_PROGRAM: "iTerm.app",
      }),
    ).toBe(isWindows ? 24 : 8);
  });

  it("iTerm modern", () => {
    expect(
      WriteStream.prototype.getColorDepth.call(undefined, {
        TERM_PROGRAM: "iTerm.app",
        TERM_PROGRAM_VERSION: 3,
      }),
    ).toBe(24);
  });

  it("empty", () => {
    expect(WriteStream.prototype.getColorDepth.call(undefined, {})).toBe(isWindows ? 24 : 1);
  });
});
