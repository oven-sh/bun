import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { Console } from "node:console";

import { Writable } from "node:stream";

function writable() {
  let intoString = "";
  const { promise, resolve } = Promise.withResolvers();
  const stream = new Writable({
    write(chunk) {
      intoString += chunk.toString();
    },
    destroy() {
      resolve(intoString);
    },
    autoDestroy: true,
  });

  (stream as any).write = (chunk: any) => {
    intoString += Buffer.from(chunk).toString("utf-8");
  };

  return [stream, () => promise] as const;
}

describe("console.Console", () => {
  test("global instanceof Console", () => {
    expect(global.console).toBeInstanceOf(Console);
  });

  test("new Console instanceof Console", () => {
    const c = new Console({ stdout: process.stdout, stderr: process.stderr });
    expect(c).toBeInstanceOf(Console);
  });

  test("it can write to a stream", async () => {
    console.log();
    const [stream, value] = writable();
    const c = new Console({ stdout: stream, stderr: stream, colorMode: false });
    c.log("hello");
    c.log({ foo: "bar" });
    stream.end();
    expect(await value()).toBe("hello\n{ foo: 'bar' }\n");
  });

  test("can enable colors", async () => {
    const [stream, value] = writable();
    const c = new Console({ stdout: stream, stderr: stream, colorMode: true });
    c.log("hello");
    c.log({ foo: "bar" });
    stream.end();
    expect(await value()).toBe("hello\n{ foo: \u001B[32m'bar'\u001B[39m }\n");
  });

  // For the programs below: a stream that writes at once. It needs no `process` for that, and a `PassThrough` does.
  const head = `
    const { Console } = require("node:console");
    const { EventEmitter } = require("node:events");
    const streamInto = (written, properties) =>
      Object.assign(new EventEmitter(), properties, { write: chunk => void written.push(chunk) });
    const logged = properties => {
      const written = [];
      new Console(streamInto(written, properties)).log({ a: 1 });
      const text = written.join("");
      return text === "{ a: 1 }\\n" ? "plain" : text === "{ a: \\x1b[33m1\\x1b[39m }\\n" ? "colors" : text;
    };`;

  // Node's `shouldColorize(stream)`: `FORCE_COLOR` decides if it is set, and the stream if it is not.
  describe.concurrent("without a colorMode", () => {
    // `process.stdout` and `process.stderr` listen for SIGWINCH if they are a terminal. The decision needs neither.
    // Not on Windows: ConPTY adds its own sequences to what the terminal gets, so the output is not only the answer.
    test.skipIf(isWindows)("FORCE_COLOR=0 means no colors, also in a terminal", async () => {
      const program = `${head}
        const streams = () => process.listenerCount("SIGWINCH");
        const before = streams();
        const text = logged() + (streams() === before ? "" : " and a stream of the process");
        process.stdout.write(text);`;
      const inTerminal = async (FORCE_COLOR: string) => {
        const decoder = new TextDecoder();
        let output = "";
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", program],
          env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR },
          terminal: { data: (_terminal, chunk) => void (output += decoder.decode(chunk, { stream: true })) },
        });
        const exitCode = await proc.exited;
        return { logged: output, exitCode };
      };
      expect(await Promise.all([inTerminal("0"), inTerminal("1")])).toEqual([
        { logged: "plain", exitCode: 0 },
        { logged: "colors", exitCode: 0 },
      ]);
    });

    test("FORCE_COLOR has the values of Node, and is read from the `env` that `process` has now", async () => {
      const program = `${head}
        const { getColorDepth } = require("node:tty").WriteStream.prototype;
        const seen = {};
        const real = process;
        const env = real.env;
        for (const value of ["0", "1", "2", "3", "true", "", "false", "4"]) {
          real.env = { FORCE_COLOR: value };
          seen[JSON.stringify(value)] = logged();
        }
        real.env = {};
        seen.unset = logged();
        real.env = env;
        env.FORCE_COLOR = "1";
        seen["set later"] = logged();
        // Without a \`process\` it's the environment of the process. With NO_COLOR, nothing can warn.
        env.NO_COLOR = "1";
        globalThis.process = undefined;
        seen["no process"] = logged();
        // Then a terminal decides from that environment too.
        delete env.FORCE_COLOR;
        seen["no process, a terminal with NO_COLOR"] = logged({ isTTY: true, getColorDepth });
        delete env.NO_COLOR;
        seen["no process, a terminal"] = logged({ isTTY: true, getColorDepth });
        globalThis.process = real;
        process.stdout.write(JSON.stringify(seen));`;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", program],
        // With TMUX, a terminal that is not dumb has colors on every platform.
        env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: "xterm", TMUX: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ seen: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
        seen: {
          '"0"': "plain",
          '"1"': "colors",
          '"2"': "colors",
          '"3"': "colors",
          '"true"': "colors",
          '""': "colors",
          '"false"': "plain",
          '"4"': "plain",
          unset: "plain",
          "set later": "colors",
          "no process": "colors",
          "no process, a terminal with NO_COLOR": "plain",
          "no process, a terminal": "colors",
        },
        stderr: "",
        exitCode: 0,
      });
    });

    test("FORCE_COLOR=1 with NO_COLOR warns once, and a lone string is logged without a decision", async () => {
      const program = `${head}
        const warnings = [];
        const warned = new Promise(resolve => process.on("warning", it => (warnings.push(it.message), resolve())));
        let reads = 0;
        const { FORCE_COLOR, NO_COLOR } = process.env;
        process.env = { NO_COLOR, get FORCE_COLOR() { reads++; return FORCE_COLOR; } };
        new Console(streamInto([])).log("a string");
        const afterString = reads;
        // Without a \`process\` nothing can warn, and the warning waits for the next decision.
        const real = process;
        globalThis.process = undefined;
        const withoutProcess = logged();
        globalThis.process = real;
        const both = [logged(), logged()];
        const seen = () => ({ afterString, decides: reads > afterString, withoutProcess, both, warnings });
        warned
          // A second warning would be one tick behind the first.
          .then(() => new Promise(resolve => setImmediate(resolve)))
          .then(() => process.stdout.write(JSON.stringify(seen())));`;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", program],
        env: { ...bunEnv, NO_COLOR: "1", FORCE_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ seen: stdout && JSON.parse(stdout), exitCode }).toEqual({
        seen: {
          afterString: 0,
          decides: true,
          withoutProcess: "colors",
          both: ["colors", "colors"],
          warnings: ["The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set."],
        },
        exitCode: 0,
      });
      expect(stderr).toContain("Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.");
    });
  });

  test.concurrent("clear() reads TERM from the `env` that `process` has now", async () => {
    const program = `${head}
      const cleared = () => {
        const written = [];
        new Console(streamInto(written, { isTTY: true })).clear();
        return written.length > 0;
      };
      const seen = {};
      const real = process;
      const env = real.env;
      real.env = { TERM: "dumb" };
      seen.dumb = cleared();
      real.env = { TERM: "xterm" };
      seen.xterm = cleared();
      real.env = env;
      globalThis.process = undefined;
      seen["no process"] = cleared();
      globalThis.process = real;
      process.stdout.write(JSON.stringify(seen));`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", program],
      env: { ...bunEnv, TERM: "xterm" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ seen: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      seen: { dumb: false, xterm: true, "no process": true },
      stderr: "",
      exitCode: 0,
    });
  });

  test("stderr and stdout are separate", async () => {
    const [out, outValue] = writable();
    const [err, errValue] = writable();
    const c = new Console({ stdout: out, stderr: err });
    c.log("hello world!");
    c.error("uh oh!");
    out.end();
    err.end();
    expect(await outValue()).toBe("hello world!\n");
    expect(await errValue()).toBe("uh oh!\n");
  });
});

test("console._stdout", () => {
  // @ts-ignore
  expect(console._stdout).toBe(process.stdout);

  expect(Object.getOwnPropertyDescriptor(console, "_stdout")).toEqual({
    value: process.stdout,
    writable: true,
    enumerable: false,
    configurable: true,
  });
});

test("console._stderr", () => {
  // @ts-ignore
  expect(console._stderr).toBe(process.stderr);

  expect(Object.getOwnPropertyDescriptor(console, "_stderr")).toEqual({
    value: process.stderr,
    writable: true,
    enumerable: false,
    configurable: true,
  });
});
