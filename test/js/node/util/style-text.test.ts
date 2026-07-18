// Bun-side coverage of util.styleText. The node-parity assertions live in
// styletext.test.ts (which also runs under node) and in the ported
// test/js/node/test/parallel/test-util-styletext.js.
// https://nodejs.org/api/util.html#utilstyletextformat-text-options
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { Writable } from "node:stream";
import util from "node:util";

// styleText only emits escape codes when the target stream can show them, so
// every in-process case has to name a stream or opt out of the check. The
// default-stream behavior is covered by subprocesses further down.
const raw = { validateStream: false } as const;

function colorCapableStream() {
  const stream: any = new Writable();
  stream.isTTY = true;
  stream.getColorDepth = () => 24;
  return stream;
}

// FORCE_COLOR short-circuits the stream check, so the in-process cases below
// would answer to the ambient environment rather than to the stream they pass.
const ambientForceColor = process.env.FORCE_COLOR;
beforeAll(() => {
  delete process.env.FORCE_COLOR;
});
afterAll(() => {
  if (ambientForceColor !== undefined) process.env.FORCE_COLOR = ambientForceColor;
});

describe("util.styleText", () => {
  test("wraps the text in the format's open and close codes", () => {
    expect(util.styleText("red", "test", raw)).toBe("\u001b[31mtest\u001b[39m");
    expect(util.styleText("bold", "test", raw)).toBe("\u001b[1mtest\u001b[22m");
  });

  test("applies an array of formats from the outside in", () => {
    expect(util.styleText(["bold", "red"], "test", raw)).toBe("\u001b[1m\u001b[31mtest\u001b[39m\u001b[22m");
    expect(util.styleText(["bold", "red"], "test", raw)).toBe(
      util.styleText("bold", util.styleText("red", "test", raw), raw),
    );
  });

  test("accepts the color aliases", () => {
    expect(util.styleText("grey", "t", raw)).toBe(util.styleText("gray", "t", raw));
    expect(util.styleText("bgGrey", "t", raw)).toBe(util.styleText("bgGray", "t", raw));
    expect(util.styleText("blackBright", "t", raw)).toBe(util.styleText("gray", "t", raw));
    expect(util.styleText("faint", "t", raw)).toBe(util.styleText("dim", "t", raw));
  });

  test("the 'none' format leaves the text untouched", () => {
    expect(util.styleText("none", "test")).toBe("test");
    expect(util.styleText(["none"], "test", raw)).toBe("test");
    expect(util.styleText(["none", "red"], "test", raw)).toBe("\u001b[31mtest\u001b[39m");
  });

  test("rejects an unknown format", () => {
    expect(() => util.styleText("invalid", "text")).toThrowWithCode(TypeError, "ERR_INVALID_ARG_VALUE");
    expect(() => util.styleText(["invalid"], "text")).toThrowWithCode(TypeError, "ERR_INVALID_ARG_VALUE");
    expect(() => util.styleText(["red", "invalid"], "text")).toThrowWithCode(TypeError, "ERR_INVALID_ARG_VALUE");
  });

  test.each([undefined, null, false, 5n, 5, Symbol("s"), () => {}, {}])("rejects %p as a format", invalid => {
    expect(() => util.styleText(invalid as any, "test")).toThrowWithCode(TypeError, "ERR_INVALID_ARG_VALUE");
  });

  test.each([undefined, null, false, 5n, 5, Symbol("s"), () => {}, {}])("rejects %p as text", invalid => {
    expect(() => util.styleText("red", invalid as any)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
  });

  test("validates the options object", () => {
    expect(() => util.styleText("red", "x", 5 as any)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
    expect(() => util.styleText("red", "x", null as any)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
    expect(() => util.styleText("red", "x", { validateStream: "yes" } as any)).toThrowWithCode(
      TypeError,
      "ERR_INVALID_ARG_TYPE",
    );
  });

  describe("options.stream", () => {
    test("colorizes when the stream supports colors", () => {
      expect(util.styleText("red", "x", { stream: colorCapableStream() })).toBe("\u001b[31mx\u001b[39m");
      expect(util.styleText(["red"], "x", { stream: colorCapableStream() })).toBe("\u001b[31mx\u001b[39m");
    });

    test("leaves the text alone when the stream is not a TTY", () => {
      expect(util.styleText("red", "x", { stream: new Writable() })).toBe("x");
    });

    // https://github.com/oven-sh/bun/issues/25736
    test("honors a bare isTTY flag on a stream with no getColorDepth", () => {
      const tty: any = new Writable();
      tty.isTTY = true;
      const notTty: any = new Writable();
      notTty.isTTY = false;
      expect(util.styleText("bgYellow", "TTY", { stream: tty })).toBe("\u001b[43mTTY\u001b[49m");
      expect(util.styleText("bgYellow", "No TTY", { stream: notTty })).toBe("No TTY");
    });

    test("accepts web streams", () => {
      expect(util.styleText("red", "x", { stream: new WritableStream() as any })).toBe("x");
      expect(util.styleText("red", "x", { stream: new ReadableStream() as any })).toBe("x");
    });

    test("rejects anything that is not a stream", () => {
      expect(() => util.styleText("red", "x", { stream: {} as any })).toThrowWithCode(
        TypeError,
        "ERR_INVALID_ARG_TYPE",
      );
      expect(() => util.styleText("red", "x", { stream: 1 as any })).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
    });

    test("skips the stream check entirely when validateStream is false", () => {
      expect(util.styleText("red", "x", { stream: {} as any, validateStream: false })).toBe("\u001b[31mx\u001b[39m");
    });
  });

  // The enclosing color resumes after a nested styleText closes, rather than the
  // nested reset leaving the rest of the string unstyled.
  test("restores the outer format after a nested one closes", () => {
    const nested = "A" + util.styleText("blue", "B", raw) + "C";
    expect(util.styleText("red", nested, raw)).toBe("\u001b[31mA\u001b[34mB\u001b[31mC\u001b[39m");
  });

  // https://github.com/oven-sh/bun/issues/20129
  describe("the color environment variables", () => {
    // A stream that claims to be a TTY and defers to the real color detection,
    // so the env vars are the only thing deciding the outcome.
    const script = `
      const { Writable } = require("node:stream");
      const stream = new Writable();
      stream.isTTY = true;
      stream.getColorDepth = require("node:tty").WriteStream.prototype.getColorDepth;
      process.stdout.write(JSON.stringify(require("util").styleText("cyan", "hi", { stream })));
    `;
    const cleared = { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: undefined, NODE_DISABLE_COLORS: undefined };
    const colorized = JSON.stringify("\u001b[36mhi\u001b[39m");

    test.concurrent.each([
      ["NO_COLOR", { NO_COLOR: "1" }, `"hi"`],
      ["NODE_DISABLE_COLORS", { NODE_DISABLE_COLORS: "1" }, `"hi"`],
      ["FORCE_COLOR", { FORCE_COLOR: "1" }, colorized],
    ])("%s decides whether a TTY stream gets colors", async (_name, env, expected) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...cleared, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr: stderr.trim(), exitCode }).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
    });
  });

  describe("the default stream is process.stdout", () => {
    const script = `process.stdout.write(JSON.stringify(require("util").styleText("red", "test")));`;

    test.concurrent("a piped stdout gets no escape codes", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr: stderr.trim(), exitCode }).toEqual({ stdout: `"test"`, stderr: "", exitCode: 0 });
    });

    test.concurrent("FORCE_COLOR turns the codes back on", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, FORCE_COLOR: "1", NO_COLOR: undefined },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr: stderr.trim(), exitCode }).toEqual({
        stdout: JSON.stringify("\u001b[31mtest\u001b[39m"),
        stderr: "",
        exitCode: 0,
      });
    });
  });
});
