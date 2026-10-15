// A namespace import: a build without the decoder then fails only the tests that use it.
import * as internals from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { run } from "node:test";

const encoder = new TextEncoder();
const bytes = (...parts: (string | Uint8Array)[]) =>
  Buffer.concat(parts.map(part => (typeof part === "string" ? encoder.encode(part) : part)));
const asText = (...parts: (string | Uint8Array)[]) => new TextDecoder().decode(bytes(...parts));

// The frame of one event, built by hand: 0xFF, the tag, the payload length in
// four big-endian bytes, the payload, 0xFE.
const header = (length: number) =>
  bytes(
    Uint8Array.of(0xff),
    "bun:test:run",
    Uint8Array.of(length >>> 24, (length >>> 16) & 255, (length >>> 8) & 255, length & 255),
  );
const frameOf = (payload: string | Uint8Array) => {
  const body = bytes(payload);
  return bytes(header(body.length), body, Uint8Array.of(0xfe));
};
const frame = (type: string, data: unknown) => frameOf(JSON.stringify({ type, data }));
// A line that holds this marker and JSON after it was an event before run()
// framed events in bytes.
const marker = (type: string, data: unknown) => "\0bun:test:run\0" + JSON.stringify({ type, data });
const neverRan = { name: "never ran", nesting: 0 };

describe("node:test run() frames", () => {
  const createDecoder: typeof internals.nodeTestRunFrames.createRunOutputDecoder = (...callbacks) =>
    internals.nodeTestRunFrames.createRunOutputDecoder(...callbacks);

  // What the decoder hands on for `input`, fed in reads of `chunkSize` bytes:
  // each line of text and each event in order, how many of them were there
  // before the stream ended, and how many frames it found cut.
  function decode(input: Uint8Array, chunkSize = input.length) {
    const out: unknown[] = [];
    let damaged = 0;
    const decoder = createDecoder(
      message => out.push(message),
      event => out.push({ type: event.type, name: event.data.name }),
      () => damaged++,
    );
    for (let i = 0; i < input.length; i += chunkSize) decoder.write(input.subarray(i, i + chunkSize));
    const early = out.length;
    decoder.end();
    return { out, early, damaged };
  }

  const ran = { type: "test:pass", name: "ran" };
  const real = frame("test:pass", { name: "ran", nesting: 0 });
  // The frame of that event with a payload of `length` bytes.
  const sized = (length: number) => {
    const pad = length - JSON.stringify({ type: "test:pass", data: { name: "ran", nesting: 0, pad: "" } }).length;
    return frame("test:pass", { name: "ran", nesting: 0, pad: Buffer.alloc(pad, "p").toString() });
  };
  const failed = frame("test:fail", {
    name: "big failure",
    nesting: 0,
    error: { message: Buffer.alloc(256, "E").toString() },
  });
  // What another writer of the same stdout can print into a frame that is half
  // written: text that closes the JSON its own way and pads to the frame's end.
  const printedInto = (tail: string) => {
    const at = failed.length - 100;
    return bytes(failed.subarray(0, at), tail + Buffer.alloc(256, " ").toString(), failed.subarray(at));
  };

  type Case = { input: Uint8Array; out: unknown[]; late?: number; damaged?: number };
  // Bytes that are not an event come out as one line of text, and the frame
  // behind them as an event.
  const text = (damaged: number, ...parts: (string | Uint8Array)[]): Case => ({
    input: bytes(...parts, "\n", real),
    out: [asText(...parts, "\n"), ran],
    damaged,
  });

  const cases: Record<string, Case> = {
    "lines": { input: bytes("a\nb\n"), out: ["a\n", "b\n"] },
    "empty lines": { input: bytes("\n\na\n\n", real, "\n"), out: ["a\n", ran] },
    "a frame": { input: real, out: [ran] },
    "frames back to back": {
      input: bytes(real, failed, real),
      out: [ran, { type: "test:fail", name: "big failure" }, ran],
    },
    "a line, then a frame": { input: bytes("line\n", real), out: ["line\n", ran] },
    "an open line is closed before the event": { input: bytes("open", real, "rest\n"), out: ["open\n", ran, "rest\n"] },
    "an open line keeps its spaces": { input: bytes("open  ", real, "  ", real), out: ["open  \n", ran, "  \n", ran] },
    "an open line keeps its carriage return": { input: bytes("open\r", real), out: ["open\r\n", ran] },
    "an open line at the end": { input: bytes(real, "open"), out: [ran, "open\n"], late: 1 },
    // The two bytes are the start of a character of three. It ends with its line, not with the text after the event.
    "an open line that ends inside a character": {
      input: bytes("open", Uint8Array.of(0xe2, 0x82), real, Uint8Array.of(0xac), "rest\n"),
      out: ["open\ufffd\n", ran, "\ufffdrest\n"],
    },
    "a byte order mark is text, also after an event": {
      input: bytes("\ufeffa\n", real, "\ufeffb\n"),
      out: ["\ufeffa\n", ran, "\ufeffb\n"],
    },
    "text in more than one byte per character": {
      input: bytes(
        "h\u00e9llo \u{1f600}\n",
        frame("test:pass", { name: "n\u00e4me \u{1f600}", nesting: 0 }),
        "\u4e2d\u6587\n",
      ),
      out: ["h\u00e9llo \u{1f600}\n", { type: "test:pass", name: "n\u00e4me \u{1f600}" }, "\u4e2d\u6587\n"],
    },
    // The length field of these two holds the lead byte and the end byte.
    "a payload of 255 bytes": { input: sized(255), out: [ran] },
    "a payload of 254 bytes": { input: sized(254), out: [ran] },
    "an error with causes": {
      input: frame("test:fail", {
        name: "ran",
        nesting: 0,
        error: { message: "a", cause: { message: "b", cause: { message: "c" } } },
      }),
      out: [{ type: "test:fail", name: "ran" }],
    },

    "the text marker of older builds": text(0, marker("test:pass", neverRan)),
    "the tag without the lead byte": text(0, "bun:test:run", real.subarray(13)),
    "a frame that went through a text decoder": text(0, asText(frame("test:pass", neverRan))),
    "a frame that went through a text encoder": text(0, frame("test:pass", neverRan).toString("latin1")),
    "a lead byte and other bytes": text(0, Uint8Array.of(0xff), "abc"),
    "a payload that is not JSON": text(0, frameOf("abc")),
    "a payload that is not UTF-8": text(
      0,
      frameOf(bytes('{"type":"test:pass","data":{"name":"', Uint8Array.of(0xc3, 0x28), '"}}')),
    ),
    "an event named end": text(0, frame("end", {})),
    "an event named close": text(0, frame("close", {})),
    "an event named error": text(0, frame("error", {})),
    "an event named data": text(0, frame("data", {})),
    "an event named test:summary": text(0, frame("test:summary", { counts: {} })),
    "no type": text(0, frameOf(JSON.stringify({ data: neverRan }))),
    "a payload that is null": text(0, frameOf("null")),
    "data that is null": text(0, frame("test:pass", null)),
    "data that is an array": text(0, frame("test:pass", [])),
    "data that is a string": text(0, frame("test:pass", "never ran")),
    "nesting that is not a number": text(0, frame("test:pass", { ...neverRan, nesting: { valueOf: 1, toString: 1 } })),
    "an error that is null": text(0, frame("test:fail", { ...neverRan, error: null })),
    "an error that is a string": text(0, frame("test:fail", { ...neverRan, error: "made up" })),
    "a cause that is null": text(0, frame("test:fail", { ...neverRan, error: { message: "made up", cause: null } })),
    "a cause of a cause that is null": text(
      0,
      frame("test:fail", { ...neverRan, error: { message: "a", cause: { message: "b", cause: null } } }),
    ),
    // A lead byte and the tag are the start of a frame. What follows them here
    // is not one, so each of these counts as a frame that is not whole.
    "a length over the bound": text(1, header(64 * 1024 * 1024 + 1), "abc"),
    "a length over the bound, with no frame behind it": {
      input: bytes(header(64 * 1024 * 1024 + 1), "abc\n"),
      out: [asText(header(64 * 1024 * 1024 + 1), "abc\n")],
      damaged: 1,
    },
    "a length no frame has": text(1, header(0xffffffff), "abc"),
    // These headers announce a payload that would hold the frame behind them:
    // all of it, more than is there, and one header after the other.
    "a header around a real frame": text(1, header(real.length + 4), "abc"),
    "a header for more than is there": text(1, header(real.length + 100), "abc"),
    "headers back to back": text(64, ...Array.from({ length: 64 }, () => header(4 * 1024 * 1024))),

    // A frame that another writer cut is text, and it is counted: without the
    // end byte these four were a pass, a todo, a skip and a failure of another test.
    "text printed into a frame: a pass": text(1, printedInto('"}},"type":"test:pass"}')),
    "text printed into a frame: a todo": text(1, printedInto('"},"todo":true}}')),
    "text printed into a frame: a skip": text(1, printedInto('"},"skip":true}}')),
    "text printed into a frame: another name": text(1, printedInto('"},"name":"another test"}}')),
    "a frame without its end byte": text(1, real.subarray(0, real.length - 1)),
    "a frame without its end byte, with its keys in another order": text(
      1,
      frameOf(JSON.stringify({ data: { name: "ran", nesting: 0 }, type: "test:pass" })).subarray(0, -1),
    ),
    "a frame that ends with the lead byte": text(1, real.subarray(0, real.length - 1), Uint8Array.of(0xff)),
    "text printed into the tag of a frame": text(1, real.subarray(0, 7), "printed", real.subarray(7)),
    "text printed into the length of a frame": text(1, real.subarray(0, 14), "printed", real.subarray(14)),
    // The lead byte and three bytes of the tag are not yet the start of a frame.
    "text printed after four bytes of a frame": text(0, real.subarray(0, 4), "printed", real.subarray(4)),
    "a frame inside a frame": {
      input: bytes(failed.subarray(0, 40), real, failed.subarray(40)),
      out: [asText(failed.subarray(0, 40)) + "\n", ran, asText(failed.subarray(40)) + "\n"],
      late: 1,
      damaged: 1,
    },
    "a frame cut off at the end": {
      input: bytes("a\n", real.subarray(0, 30)),
      out: ["a\n", asText(real.subarray(0, 30)) + "\n"],
      late: 1,
      damaged: 1,
    },
    "a header and nothing after it at the end": {
      input: bytes("a\n", header(16)),
      out: ["a\n", asText(header(16)) + "\n"],
      late: 1,
      damaged: 1,
    },
    "a header cut off at the end": {
      input: bytes("a\n", header(10).subarray(0, 9)),
      out: ["a\n", "\ufffdbun:test\n"],
      late: 1,
      damaged: 1,
    },
    "four bytes of a frame at the end": {
      input: bytes("a\n", header(10).subarray(0, 4)),
      out: ["a\n", "\ufffdbun\n"],
      late: 1,
    },
    "a lead byte at the end": { input: bytes("a\n", Uint8Array.of(0xff)), out: ["a\n", "\ufffd\n"], late: 1 },
  };

  test.each(Object.keys(cases))("%s", name => {
    const { input, out, late = 0, damaged = 0 } = cases[name];
    // A read can end anywhere: inside the tag, the length, the payload or a
    // character. Only what the last read left open waits for the end.
    for (const chunkSize of [input.length, 1, 2, 7, 17, 64]) {
      expect(decode(input, chunkSize)).toEqual({ out, early: out.length - late, damaged });
    }
  });

  test("a frame is read by its own properties", () => {
    const inherited = { error: "x", cause: null, nesting: "x", type: "end" };
    const input = bytes(real, frame("test:fail", { name: "failed", nesting: 0, error: { message: "boom" } }));
    let decoded;
    Object.assign(Object.prototype, inherited);
    try {
      decoded = decode(input);
    } finally {
      for (const key of Object.keys(inherited)) delete (Object.prototype as Record<string, unknown>)[key];
    }
    expect(decoded).toEqual({ out: [ran, { type: "test:fail", name: "failed" }], early: 2, damaged: 0 });
  });

  test("a chain of causes is followed as far as the child writes it", () => {
    // The child writes an error and eight causes; what the last one names as its cause is not read.
    let error: Record<string, unknown> = { message: "cause 8", cause: null };
    for (let depth = 7; depth >= 0; depth--) error = { message: "cause " + depth, cause: error };
    const events: { data: Record<string, any> }[] = [];
    const decoder = createDecoder(
      message => expect.unreachable(message),
      event => events.push(event),
      () => expect.unreachable("damaged"),
    );
    decoder.write(frame("test:fail", { name: "deep", nesting: 0, error }));
    decoder.end();
    const messages: unknown[] = [];
    for (let cause = events[0]?.data.error; cause !== undefined; cause = cause.cause) messages.push(cause.message);
    expect(messages).toEqual(Array.from({ length: 9 }, (_, depth) => "cause " + depth));
  });
});

describe.concurrent("node:test run() events", () => {
  // Each test starts a `bun test` child, and a debug or ASAN build takes seconds to start one.
  const timeout = isDebug || isASAN ? 60_000 : undefined;

  // What a script that calls run() sees, in order: the lines the file printed
  // and the verdict of each test.
  async function runFile(dir: string, file: string) {
    const log: string[] = [];
    const events: Record<string, any> = {};
    let counts: unknown;
    let fileSummaries = 0;
    const stream = run({ files: [file], cwd: dir, env: bunEnv });
    for await (const { type, data } of stream as AsyncIterable<{ type: string; data: any }>) {
      if (type === "test:stdout") {
        // The child's own first line names the build.
        if (!data.message.startsWith("bun test v")) log.push("stdout " + data.message);
      } else if (type === "test:pass" || type === "test:fail") {
        log.push(type.slice(5) + " " + data.name);
        events[data.name] = data;
      } else if (type === "test:summary") {
        if (data.file === undefined) counts = data.counts;
        else fileSummaries++;
      }
    }
    return { log, events, counts, fileSummaries };
  }
  const counts = (tests: number, failed: number) => ({
    tests,
    failed,
    passed: tests - failed,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    topLevel: 1,
    suites: 0,
  });
  // What the child sends in place of an error it cannot read or encode.
  const standIn = (why: string) => [
    "The error of this test could not be reported: " + why,
    "ERR_TEST_FAILURE",
    "testCodeFailure",
  ];

  test(
    "an error or a label that the child cannot send still comes with its verdict",
    async () => {
      using dir = tempDir("node-test-run-errors", {
        "errors.test.mjs": `
          import test from "node:test";

          test("a chain of causes", () => {
            throw new Error("outer", { cause: new Error("middle", { cause: new TypeError("inner") }) });
          });
          test("a message that has no string form", () => {
            throw Object.assign(new Error(), { message: { toString: 1, valueOf: 1 } });
          });
          test("a value that cannot be read", () => {
            throw Object.create(null);
          });
          test("a value JSON cannot hold", () => {
            throw Object.assign(new Error("a code"), { code: 1n });
          });
          test("a label JSON cannot hold", { expectFailure: { label: 1n } }, () => {
            throw new Error("as expected");
          });
          test("a label JSON cannot hold, and no failure", { expectFailure: { label: 1n } }, () => {});
          const check = () => {
            throw Object.assign(new Error("from the check"), { code: 1n });
          };
          test("a label, and an error JSON cannot hold", { expectFailure: { label: "known", match: check } }, () => {
            throw new Error("any");
          });
        `,
      });
      const { log, events, counts: seen } = await runFile(String(dir), "errors.test.mjs");
      const error = (name: string) => events[name]?.details.error;
      const sent = (name: string) => [error(name)?.message, error(name)?.code, error(name)?.failureType];
      const causes = error("a chain of causes");
      expect({
        log,
        counts: seen,
        causes: [causes?.message, causes?.cause?.message, causes?.cause?.cause?.message, causes?.cause?.cause?.name],
        object: error("a message that has no string form")?.message,
        unreadable: sent("a value that cannot be read"),
        bigint: sent("a value JSON cannot hold"),
        labels: [
          events["a label JSON cannot hold"]?.expectFailure,
          events["a label JSON cannot hold, and no failure"]?.expectFailure,
          // The label went, the error of the test stayed.
          error("a label JSON cannot hold, and no failure")?.message,
          // The error went, the label stayed.
          events["a label, and an error JSON cannot hold"]?.expectFailure,
          ...sent("a label, and an error JSON cannot hold"),
        ],
      }).toEqual({
        log: [
          "fail a chain of causes",
          "fail a message that has no string form",
          "fail a value that cannot be read",
          "fail a value JSON cannot hold",
          "pass a label JSON cannot hold",
          "fail a label JSON cannot hold, and no failure",
          "fail a label, and an error JSON cannot hold",
        ],
        counts: counts(7, 6),
        causes: ["outer", "middle", "inner", "TypeError"],
        object: { toString: 1, valueOf: 1 },
        unreadable: standIn("reading it threw"),
        bigint: standIn("it has no JSON form"),
        labels: [true, true, "test was expected to fail but passed", "known", ...standIn("it has no JSON form")],
      });
    },
    timeout,
  );

  // The child makes the JSON of 64 MiB for this, which takes a debug or ASAN build over 20 s.
  test.skipIf(isDebug || isASAN)("an error over 64 MiB comes as a stand-in", async () => {
    using dir = tempDir("node-test-run-large", {
      "large.test.mjs": `
        import test from "node:test";

        test("an error over 64 MiB", () => {
          throw Object.defineProperty(new Error("large"), "failureType", {
            value: Buffer.alloc(64 * 1024 * 1024 + 1, "x").toString(),
          });
        });
      `,
    });
    const { log, events, counts: seen } = await runFile(String(dir), "large.test.mjs");
    const error = events["an error over 64 MiB"]?.details.error;
    expect({ log, counts: seen, error: [error?.message, error?.code, error?.failureType] }).toEqual({
      log: ["fail an error over 64 MiB"],
      counts: counts(1, 1),
      error: standIn("it is larger than 64 MiB"),
    });
  });

  // The frame of a failed test without its end byte, as it is when another
  // writer of the same stdout printed inside it.
  const cut = frame("test:fail", { name: "lost", nesting: 0, error: { message: "lost" } }).subarray(0, -1);
  const arrived = (count: number, how: string) =>
    `${count} test result${count > 1 ? "s" : ""} of this file did not arrive: ` +
    `another writer of its stdout printed inside the result, or its process ended while writing it (${how})`;

  test.each([1, 2])(
    "a file with %d cut results is a file that failed",
    async count => {
      using dir = tempDir("node-test-run-cut", {
        "cut.test.mjs": `
          import test from "node:test";
          import fs from "node:fs";

          test("passes", () => {
            const cut = Buffer.from("${cut.toString("base64")}", "base64");
            for (let i = 0; i < ${count}; i++) fs.writeSync(1, Buffer.concat([cut, Buffer.from("\\n")]));
          });
        `,
      });
      const { log, events, counts: seen, fileSummaries } = await runFile(String(dir), "cut.test.mjs");
      expect({ log, counts: seen, fileSummaries, error: events["cut.test.mjs"]?.details.error.message }).toEqual({
        log: [
          ...Array.from({ length: count }, () => "stdout " + asText(cut, "\n")),
          "pass passes",
          "fail cut.test.mjs",
        ],
        counts: counts(2, 1),
        fileSummaries: 0,
        error: arrived(count, "exit code 0"),
      });
    },
    timeout,
  );

  test.each([
    ["exit code 3", "process.exit(3)"],
    ...(isWindows ? [] : [["SIGKILL", 'process.kill(process.pid, "SIGKILL")']]),
  ])(
    "a file whose process ended inside a result says how it ended: %s",
    async (how, end) => {
      using dir = tempDir("node-test-run-ended", {
        "ended.test.mjs": `
          import test from "node:test";
          import fs from "node:fs";

          test("ends inside a result", () => {
            fs.writeSync(2, "on stderr before the end\\n");
            fs.writeSync(1, Buffer.from("${cut.subarray(0, 40).toString("base64")}", "base64"));
            ${end};
          });
        `,
      });
      const { log, events, counts: seen } = await runFile(String(dir), "ended.test.mjs");
      const error = events["ended.test.mjs"]?.details.error;
      expect({ log, counts: seen, error: error?.message, cause: error?.cause }).toEqual({
        log: ["stdout " + asText(cut.subarray(0, 40)) + "\n", "fail ended.test.mjs"],
        counts: counts(1, 1),
        error: arrived(1, how),
        cause: expect.stringContaining("on stderr before the end"),
      });
    },
    timeout,
  );

  test(
    "a child of run() writes frames, and NODE_TEST_CONTEXT alone does not turn that on",
    async () => {
      using dir = tempDir("node-test-run-wire", {
        "wire.test.mjs": `
          import test from "node:test";

          test("passes", () => {});
          test("fails \\u00ff\\u00fe", () => {
            throw new Error("m\\u00e9ssage \\u00ff\\u00fe end");
          });
        `,
      });
      const stdoutOf = async (env: Record<string, string>) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "test", "wire.test.mjs"],
          cwd: String(dir),
          env: { ...bunEnv, ...env },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
        return Buffer.from(stdout);
      };
      // node sets NODE_TEST_CONTEXT in the processes of its own runner, which does not read these frames.
      const plain = await stdoutOf({ NODE_TEST_CONTEXT: "child-v8" });
      const framed = await stdoutOf({ NODE_TEST_CONTEXT: "child-v8", BUN_NODE_TEST_RUN_FRAMES: "1" });

      // The bytes of each frame, read by hand.
      const events: { type: string; data: Record<string, any> }[] = [];
      const start = framed.indexOf(0xff);
      let rebuilt = framed.subarray(0, start);
      for (let at = start; at !== -1 && at < framed.length;) {
        const length = framed.readUInt32BE(at + 13);
        const payload = framed.subarray(at + 17, at + 17 + length);
        events.push(JSON.parse(payload.toString()));
        rebuilt = bytes(rebuilt, frameOf(payload));
        at += 17 + length + 1;
      }
      const event = (type: string, name: string, rest?: object) => ({
        type,
        data: { name, nesting: 0, testNumber: 0, duration_ms: expect.any(Number), tags: [], ...rest },
      });
      expect({ plain: plain.toString(), whole: rebuilt.equals(framed), events }).toEqual({
        // Only the line that names the build.
        plain: framed.subarray(0, start).toString(),
        whole: true,
        events: [
          event("test:pass", "passes"),
          event("test:fail", "fails \u00ff\u00fe", {
            error: {
              message: "m\u00e9ssage \u00ff\u00fe end",
              stack: expect.stringContaining("m\u00e9ssage \u00ff\u00fe end"),
              name: "Error",
            },
          }),
        ],
      });

      // The decoder takes these bytes, and counts the last frame when its end byte is missing.
      const decode = (input: Uint8Array) => {
        const names: string[] = [];
        let damaged = 0;
        const decoder = internals.nodeTestRunFrames.createRunOutputDecoder(
          () => {},
          event => names.push(event.data.name),
          () => damaged++,
        );
        decoder.write(input);
        decoder.end();
        return { names, damaged };
      };
      expect([decode(framed), decode(framed.subarray(0, -1))]).toEqual([
        { names: ["passes", "fails \u00ff\u00fe"], damaged: 0 },
        { names: ["passes"], damaged: 1 },
      ]);
    },
    timeout,
  );

  test.each([
    ["a stream of its own", "new Writable({ write: (chunk, encoding, done) => done() })"],
    // A stream that has a sink of its own, for fd 2.
    ["process.stderr", "process.stderr"],
  ])(
    "a file that replaced process.stdout with %s still reports",
    async (_, replacement) => {
      using dir = tempDir("node-test-run-replaced", {
        "replaced.test.mjs": `
          import test from "node:test";
          import { Writable } from "node:stream";

          Object.defineProperty(process, "stdout", { value: ${replacement} });

          test("writes to the replacement", () => {
            process.stdout.write("taken\\n");
            console.log("printed");
          });
          test("fails", () => {
            throw new Error("after the replacement");
          });
        `,
      });
      const { log, events, counts: seen } = await runFile(String(dir), "replaced.test.mjs");
      expect({ log, counts: seen, error: events.fails?.details.error.message }).toEqual({
        log: ["stdout printed\n", "pass writes to the replacement", "fail fails"],
        counts: counts(2, 1),
        error: "after the replacement",
      });
    },
    timeout,
  );

  test(
    "a file that used process.stdout and then replaced it reports a large failure whole",
    async () => {
      // fd 1 does not block once process.stdout existed, and the frame is larger than the pipe.
      using dir = tempDir("node-test-run-used-replaced", {
        "used.test.mjs": `
          import test from "node:test";
          import { Writable } from "node:stream";

          process.stdout.write("from the stream of the process\\n");
          Object.defineProperty(process, "stdout", { value: new Writable({ write: (chunk, encoding, done) => done() }) });

          test("fails with a 1 MiB error", () => {
            throw new Error(Buffer.alloc(1024 * 1024, "x").toString());
          });
        `,
      });
      const { log, events, counts: seen } = await runFile(String(dir), "used.test.mjs");
      expect({ log, counts: seen, error: events["fails with a 1 MiB error"]?.details.error.message.length }).toEqual({
        log: ["stdout from the stream of the process\n", "fail fails with a 1 MiB error"],
        counts: counts(1, 1),
        error: 1024 * 1024,
      });
    },
    timeout,
  );

  test(
    "a file that replaced what a reporter could call still reports",
    async () => {
      using dir = tempDir("node-test-run-stubs", {
        "stubs.test.mjs": `
          import test from "node:test";

          test("replaces methods of the builtins", () => {
            TextEncoder.prototype.encode = () => undefined;
            String.prototype.charCodeAt = () => 0;
            Uint8Array.prototype.set = () => {};
            Array.prototype.slice = () => {
              throw new Error("slice");
            };
            Object.setPrototypeOf = () => {
              throw new Error("setPrototypeOf");
            };
          });
          test("fails after that", () => {
            throw new Error("after the methods changed");
          });
        `,
      });
      const { log, events, counts: seen } = await runFile(String(dir), "stubs.test.mjs");
      expect({ log, counts: seen, error: events["fails after that"]?.details.error.message }).toEqual({
        log: ["pass replaces methods of the builtins", "fail fails after that"],
        counts: counts(2, 1),
        error: "after the methods changed",
      });
    },
    timeout,
  );

  test(
    "a file that ended process.stdout still reports",
    async () => {
      // node fails such a file, and so did the text marker: the reporter wrote through the stream.
      using dir = tempDir("node-test-run-ended-stdout", {
        "ended-stdout.test.mjs": `
          import test from "node:test";

          test("ends process.stdout", () => {
            process.stdout.end();
          });
          test("passes after that", () => {});
        `,
      });
      const { log, counts: seen } = await runFile(String(dir), "ended-stdout.test.mjs");
      expect({ log, counts: seen }).toEqual({
        log: ["pass ends process.stdout", "pass passes after that"],
        counts: counts(2, 0),
      });
    },
    timeout,
  );

  test(
    "a failure behind queued output fails the file that exits with no code",
    async () => {
      using dir = tempDir("node-test-run-exit", {
        "exit.test.mjs": `
          import test, { after } from "node:test";

          after(() => process.exit());
          test("fails behind a megabyte", () => {
            const row = Buffer.alloc(64 * 1024 - 1, "m").toString() + "\\n";
            for (let i = 0; i < 16; i++) process.stdout.write(row);
            throw new Error("boom");
          });
        `,
      });
      const { log, counts: seen } = await runFile(String(dir), "exit.test.mjs");
      // The exit can drop the verdict with the rows that are still queued. Then the file is the failure.
      expect({ counts: seen, last: log.at(-1) }).toEqual({
        counts: counts(1, 1),
        last: expect.stringMatching(/^fail (fails behind a megabyte|exit\.test\.mjs)$/),
      });
    },
    timeout,
  );

  test.each([
    // A failure that did not go out fails the file, also when the file then exits with no code.
    ["fail", "throw new Error('boom');", 1],
    ["pass", "", 0],
  ])(
    "a %s that cannot be written is told on stderr",
    async (verdict, body, failed) => {
      using dir = tempDir("node-test-run-unwritable", {
        "unwritable.test.mjs": `
          import test, { after } from "node:test";

          // What process.stdout writes to, and a frame with it.
          const isSink = symbol => symbol.description === "kWriteStreamFastPath";
          const sink = process.stdout[Object.getOwnPropertySymbols(process.stdout).find(isSink)];
          Object.defineProperty(sink, "write", {
            value() {
              throw new Error("the sink is gone");
            },
          });

          test("the test", () => {
            ${body}
          });
          after(() => process.exit());
        `,
      });
      const stderr: string[] = [];
      const log: string[] = [];
      let seen: unknown;
      const stream = run({ files: ["unwritable.test.mjs"], cwd: String(dir), env: bunEnv });
      for await (const { type, data } of stream as AsyncIterable<{ type: string; data: any }>) {
        if (type === "test:stderr") stderr.push(data.message);
        else if (type === "test:pass" || type === "test:fail") log.push(type.slice(5) + " " + data.name);
        else if (type === "test:summary" && data.file === undefined) seen = data.counts;
      }
      const note = 'node:test: the result of test "the test" was not reported to run():';
      expect({
        log,
        counts: seen,
        notes: stderr.filter(line => line.startsWith(note)).length,
        why: stderr.includes("error: the sink is gone\n"),
      }).toEqual({
        log: [verdict + " unwritable.test.mjs"],
        counts: counts(1, failed),
        notes: 1,
        why: true,
      });
    },
    timeout,
  );
});
