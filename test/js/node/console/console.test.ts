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

  // Node's `shouldColorize(stream)`: `FORCE_COLOR` decides if it is set, and the stream if it is not.
  describe("without a colorMode", () => {
    const head = `
      const { Console } = require("node:console");
      const { PassThrough } = require("node:stream");
      const logged = () => {
        const captured = new PassThrough();
        new Console(captured).log({ a: 1 });
        const text = String(captured.read());
        return text === "{ a: 1 }\\n" ? "plain" : text === "{ a: \\x1b[33m1\\x1b[39m }\\n" ? "colors" : text;
      };`;

    // `process.stdout` and `process.stderr` listen for SIGWINCH if they are a terminal. The decision needs neither.
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
        globalThis.process = real;
        process.stdout.write(JSON.stringify(seen));`;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", program],
        env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: undefined },
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
        new Console(new PassThrough()).log("a string");
        const afterString = reads;
        const both = [logged(), logged()];
        warned
          // A second warning would be one tick behind the first.
          .then(() => new Promise(resolve => setImmediate(resolve)))
          .then(() => process.stdout.write(JSON.stringify({ afterString, decides: reads > afterString, both, warnings })));`;
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
          both: ["colors", "colors"],
          warnings: ["The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set."],
        },
        exitCode: 0,
      });
      expect(stderr).toContain("Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.");
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
