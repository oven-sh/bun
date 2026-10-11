// A namespace import: a build without the decoder then fails only the tests that use it.
import * as internals from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, isASAN, isDebug, tempDir } from "harness";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
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
    "text in more than one byte per character": {
      input: bytes(
        "h\u00e9llo \u{1f600}\n",
        frame("test:pass", { name: "n\u00e4me \u{1f600}", nesting: 0 }),
        "\u4e2d\u6587\n",
      ),
      out: ["h\u00e9llo \u{1f600}\n", { type: "test:pass", name: "n\u00e4me \u{1f600}" }, "\u4e2d\u6587\n"],
    },
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
    "a length over the bound": text(0, header(64 * 1024 * 1024 + 1), "abc"),
    "a length over the bound, with no frame behind it": {
      input: bytes(header(64 * 1024 * 1024 + 1), "abc\n"),
      out: [asText(header(64 * 1024 * 1024 + 1), "abc\n")],
    },
    "a length no frame has": text(0, header(0xffffffff), "abc"),
    // These headers announce a payload that would hold the frame behind them:
    // all of it, more than is there, and one header after the other.
    "a made-up frame around a real one": text(0, header(real.length + 4), "abc"),
    "a made-up frame that never ends": text(0, header(real.length + 100), "abc"),
    "made-up headers back to back": text(0, ...Array.from({ length: 64 }, () => header(4 * 1024 * 1024))),

    // A frame that another writer cut is text, and it is counted: without the
    // end byte these four were a pass, a todo, a skip and a failure of another test.
    "text printed into a frame: a pass": text(1, printedInto('"}},"type":"test:pass"}')),
    "text printed into a frame: a todo": text(1, printedInto('"},"todo":true}}')),
    "text printed into a frame: a skip": text(1, printedInto('"},"skip":true}}')),
    "text printed into a frame: another name": text(1, printedInto('"},"name":"another test"}}')),
    "a frame without its end byte": text(1, real.subarray(0, real.length - 1)),
    "a frame that ends with the lead byte": text(1, real.subarray(0, real.length - 1), Uint8Array.of(0xff)),
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
    "a header cut off at the end": {
      input: bytes("a\n", header(10).subarray(0, 9)),
      out: ["a\n", "\ufffdbun:test\n"],
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
  async function collect(stream: ReturnType<typeof run>, form: "for await" | "listeners" = "for await") {
    const log: string[] = [];
    const errors: Record<string, any> = {};
    let counts: unknown;
    let ends = 0;
    const take = (type: string, data: any) => {
      if (type === "test:stdout") {
        // The child's own first line names the build.
        if (!data.message.startsWith("bun test v")) log.push("stdout " + data.message);
      } else if (type === "test:pass") {
        log.push("pass " + data.name);
      } else if (type === "test:fail") {
        log.push("fail " + data.name);
        errors[data.name] = data.details.error;
      } else if (type === "test:summary" && data.file === undefined) {
        counts = data.counts;
      }
    };
    if (form === "for await") {
      for await (const { type, data } of stream as AsyncIterable<{ type: string; data: any }>) take(type, data);
    } else {
      for (const type of ["test:stdout", "test:pass", "test:fail", "test:summary"]) {
        stream.on(type, data => take(type, data));
      }
      stream.on("end", () => ends++);
      stream.resume();
      await once(stream, "close");
    }
    return { log, errors, counts, ends };
  }
  const runFile = (dir: string, file: string, form?: "for await" | "listeners") =>
    collect(run({ files: [file], cwd: dir, env: bunEnv }), form);
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

  const printed = [
    marker("test:pass", neverRan),
    marker("test:fail", { ...neverRan, error: { message: "made up" } }),
    marker("test:fail", { ...neverRan, error: null }),
    marker("test:fail", { ...neverRan, error: { message: "made up", cause: null } }),
    marker("end", {}),
    marker("close", {}),
    marker("error", {}),
    marker("data", {}),
    "mid-line " + marker("test:pass", neverRan),
    // The frame run() reads now, held in a string: a text write encodes its lead and end bytes as two bytes each.
    frame("test:pass", neverRan).toString("latin1"),
    // The same frame after a text decoder, as a test prints it when it logs what a nested run wrote.
    asText(frame("test:pass", neverRan)),
  ];

  test(
    "a string a test prints is not an event",
    async () => {
      expect(printed.filter(text => text.includes("\n"))).toEqual([]);
      using dir = tempDir("node-test-run-prints", {
        "texts.json": JSON.stringify(printed),
        "prints.test.mjs": `
          import test from "node:test";
          import assert from "node:assert";
          import fs from "node:fs";
          import { once } from "node:events";
          import { spawn } from "node:child_process";

          const texts = JSON.parse(fs.readFileSync(new URL("./texts.json", import.meta.url), "utf8"));

          test("console.log", () => {
            for (const text of texts) console.log(text);
          });
          test("process.stdout.write", () => {
            for (const text of texts) process.stdout.write(text + "\\n");
          });
          test("fs.writeSync", () => {
            for (const text of texts) fs.writeSync(1, text + "\\n");
          });
          // A test's timeout ends the processes it started, and a debug build takes seconds to start.
          test("a child process", { timeout: 60_000 }, async () => {
            const script = "for (const text of JSON.parse(require('fs').readFileSync('texts.json', 'utf8'))) console.log(text);";
            const [code] = await once(spawn(process.execPath, ["-e", script], { stdio: "inherit" }), "exit");
            assert.strictEqual(code, 0);
          });
          test("an open line", () => {
            process.stdout.write("open: " + texts[0]);
          });
          test("fails", () => {
            assert.strictEqual(1, 2);
          });
          test("f\u00e4ils \u{1f600}", () => {
            throw new Error("h\u00e9llo \u{1f600}");
          });
          test("passes", () => {});
        `,
      });
      const lines = printed.map(text => "stdout " + text + "\n");
      expect(await runFile(String(dir), "prints.test.mjs")).toEqual({
        log: [
          ...lines,
          "pass console.log",
          ...lines,
          "pass process.stdout.write",
          ...lines,
          "pass fs.writeSync",
          ...lines,
          "pass a child process",
          "stdout open: " + printed[0] + "\n",
          "pass an open line",
          "fail fails",
          "fail f\u00e4ils \u{1f600}",
          "pass passes",
        ],
        errors: {
          "fails": expect.objectContaining({ code: "ERR_ASSERTION" }),
          "f\u00e4ils \u{1f600}": expect.objectContaining({ message: "h\u00e9llo \u{1f600}" }),
        },
        counts: counts(8, 2),
        ends: 0,
      });
    },
    timeout,
  );

  test(
    "a printed event name does not reach the listeners of the stream",
    async () => {
      using dir = tempDir("node-test-run-listeners", {
        "names.test.mjs": `
          import test from "node:test";

          test("prints", () => {
            for (const text of ${JSON.stringify(printed.slice(4, 8))}) console.log(text);
          });
          test("fails", () => {
            throw new Error("after the printed names");
          });
        `,
      });
      // A script that counts test:fail in a listener and stops at "end" missed this failure.
      expect(await runFile(String(dir), "names.test.mjs", "listeners")).toEqual({
        log: [...printed.slice(4, 8).map(text => "stdout " + text + "\n"), "pass prints", "fail fails"],
        errors: { fails: expect.objectContaining({ message: "after the printed names" }) },
        counts: counts(2, 1),
        ends: 1,
      });
    },
    timeout,
  );

  test(
    "a script that only prints is a file that passed",
    async () => {
      const text = marker("test:fail", { ...neverRan, error: { message: "made up" } });
      using dir = tempDir("node-test-run-script", { "script.mjs": `console.log(${JSON.stringify(text)});` });
      expect(await runFile(String(dir), "script.mjs")).toEqual({
        log: ["stdout " + text + "\n", "pass script.mjs"],
        errors: {},
        counts: counts(1, 0),
        ends: 0,
      });
    },
    timeout,
  );

  test(
    "verdicts arrive while the file runs, from a file that removed JSON and TextEncoder",
    async () => {
      using dir = tempDir("node-test-run-stream", {
        "stream.test.mjs": `
          import test from "node:test";
          import fs from "node:fs";

          globalThis.JSON = undefined;
          delete globalThis.TextEncoder;

          test("first", () => {});
          // Ends when the script that called run() has the verdict of the first test.
          test("second", { timeout: 10_000 }, async () => {
            while (!fs.existsSync(new URL("./seen", import.meta.url))) await new Promise(resolve => setTimeout(resolve, 5));
          });
        `,
      });
      const log: string[] = [];
      const stream = run({ files: ["stream.test.mjs"], cwd: String(dir), env: bunEnv });
      for await (const { type, data } of stream as AsyncIterable<{ type: string; data: any }>) {
        if (type !== "test:pass" && type !== "test:fail") continue;
        log.push(type.slice(5) + " " + data.name);
        if (data.name === "first") writeFileSync(join(String(dir), "seen"), "");
      }
      expect(log).toEqual(["pass first", "pass second"]);
    },
    timeout,
  );

  test(
    "a verdict goes out whole, after what its test printed",
    async () => {
      using dir = tempDir("node-test-run-order", {
        "order.test.mjs": `
          import test from "node:test";

          let ticks = 0;
          let logger;
          test("starts a logger", () => {
            logger = setInterval(() => console.log("tick " + ++ticks), 0);
          });
          test("fails with a 400 KB error", () => {
            console.log("before the failure");
            throw new Error(Buffer.alloc(400 * 1024, "x").toString());
          });
          test("the logger prints while that verdict is on its way", async () => {
            const seen = ticks;
            while (ticks < seen + 3) await new Promise(resolve => setImmediate(resolve));
            clearInterval(logger);
          });

          test("replaces process.stdout.write", () => {
            const { write } = process.stdout;
            const captured = [];
            process.stdout.write = chunk => (captured.push(chunk), true);
            globalThis.restoreWrite = () => {
              process.stdout.write = write;
              return captured;
            };
          });
          test("restores it", () => {
            console.log("captured " + globalThis.restoreWrite().length);
          });

          for (let i = 0; i < 8; i++) {
            test("line " + i, async () => {
              if (i % 2) console.log("line " + i);
              else process.stdout.write("line " + i + (i % 4 ? "\\n" : ""));
              if (i % 3 === 0) await 1;
            });
          }
          test("a megabyte through process.stdout", () => {
            const row = Buffer.alloc(64 * 1024 - 1, "m").toString();
            for (let i = 0; i < 16; i++) process.stdout.write(row + "\\n");
          });

          test("ends process.stdout", () => {
            process.stdout.end();
          });
          test("passes after that", () => {});
        `,
      });
      const { log, errors, counts: seen } = await runFile(String(dir), "order.test.mjs");
      const row = "stdout " + Buffer.alloc(64 * 1024 - 1, "m").toString() + "\n";
      expect({
        log: log
          .filter(entry => !entry.startsWith("stdout tick "))
          .map(entry => (entry === row ? "stdout (a row)" : entry)),
        counts: seen,
        message: errors["fails with a 400 KB error"]?.message.length,
      }).toEqual({
        log: [
          "pass starts a logger",
          "stdout before the failure\n",
          "fail fails with a 400 KB error",
          "pass the logger prints while that verdict is on its way",
          "pass replaces process.stdout.write",
          "stdout captured 0\n",
          "pass restores it",
          ...Array.from({ length: 8 }, (_, i) => [`stdout line ${i}\n`, `pass line ${i}`]).flat(),
          ...Array.from({ length: 16 }, () => "stdout (a row)"),
          "pass a megabyte through process.stdout",
          "pass ends process.stdout",
          "pass passes after that",
        ],
        counts: counts(16, 1),
        message: 400 * 1024,
      });
    },
    timeout,
  );

  test(
    "an error the child cannot send whole still comes with its verdict",
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
          test("an error over 64 MiB", () => {
            throw Object.defineProperty(new Error("large"), "failureType", {
              value: Buffer.alloc(64 * 1024 * 1024 + 1, "x").toString(),
            });
          });
        `,
      });
      const { log, errors, counts: seen } = await runFile(String(dir), "errors.test.mjs");
      // What the child sends in place of an error it cannot read or encode.
      const standIn = (why: string) => [
        "The error of this test could not be reported: " + why,
        "ERR_TEST_FAILURE",
        "testCodeFailure",
      ];
      const sent = (name: string) => [errors[name]?.message, errors[name]?.code, errors[name]?.failureType];
      const causes = errors["a chain of causes"];
      expect({
        log,
        counts: seen,
        causes: [causes?.message, causes?.cause?.message, causes?.cause?.cause?.message, causes?.cause?.cause?.name],
        object: errors["a message that has no string form"]?.message,
        unreadable: sent("a value that cannot be read"),
        bigint: sent("a value JSON cannot hold"),
        large: sent("an error over 64 MiB"),
      }).toEqual({
        log: [
          "fail a chain of causes",
          "fail a message that has no string form",
          "fail a value that cannot be read",
          "fail a value JSON cannot hold",
          "fail an error over 64 MiB",
        ],
        counts: counts(5, 5),
        causes: ["outer", "middle", "inner", "TypeError"],
        object: { toString: 1, valueOf: 1 },
        unreadable: standIn("reading it threw"),
        bigint: standIn("it has no JSON form"),
        large: standIn("it is larger than 64 MiB"),
      });
    },
    timeout,
  );

  test(
    "a verdict is not lost when the file exits right after it",
    async () => {
      using dir = tempDir("node-test-run-exit", {
        "exit.test.mjs": `
          import test, { after } from "node:test";

          after(() => process.exit());
          test("fails with a 4 MiB error", () => {
            throw new Error(Buffer.alloc(4 * 1024 * 1024, "x").toString());
          });
        `,
      });
      const { log, errors, counts: seen } = await runFile(String(dir), "exit.test.mjs");
      expect({ log, counts: seen, message: errors["fails with a 4 MiB error"]?.message.length }).toEqual({
        log: ["fail fails with a 4 MiB error"],
        counts: counts(1, 1),
        message: 4 * 1024 * 1024,
      });
    },
    timeout,
  );

  test(
    "another process that prints on the same stdout does not turn a failure into a pass or get ahead of a verdict",
    async () => {
      using dir = tempDir("node-test-run-second-writer", {
        // A row closes the JSON of a frame it lands in as a pass, and pads past the end of that frame.
        "printer.mjs": `
          import fs from "node:fs";

          const row = '"}},"type":"test:pass"}' + Buffer.alloc(64 * 1024, " ").toString() + "\\n";
          fs.writeSync(2, "ready");
          for (let i = 0; i < 300; i++) fs.writeSync(1, row);
        `,
        "second-writer.test.mjs": `
          import test from "node:test";
          import { once } from "node:events";
          import { spawn } from "node:child_process";

          // Made before the printer starts: the first use of process.stdout turns the stdout they
          // share non-blocking, and starting a process turns it back.
          process.stdout;

          let printer;
          // A test's timeout ends the processes it started, and a debug build takes seconds to start.
          test("starts a printer", { timeout: 60_000 }, async () => {
            printer = spawn(process.execPath, ["printer.mjs"], { stdio: ["ignore", "inherit", "pipe"] });
            await once(printer.stderr, "data");
          });
          test("big failure", () => {
            throw new Error(Buffer.alloc(80 * 1024, "E").toString());
          });
          for (let i = 0; i < 4; i++) {
            test("megabyte " + i, () => {
              // Nothing else prints the character a row ends with.
              const row = Buffer.alloc(64 * 1024 - 2, "m").toString() + "~\\n";
              for (let j = 0; j < 16; j++) process.stdout.write(row);
            });
          }
          test("waits for the printer", { timeout: 60_000 }, async () => {
            if (printer.exitCode === null) await once(printer, "exit");
          });
        `,
      });
      const verdicts: Record<string, string> = {};
      const rowsAtVerdict: number[] = [];
      let rows = 0;
      let fileError: string | undefined;
      const stream = run({ files: ["second-writer.test.mjs"], cwd: String(dir), env: bunEnv });
      for await (const { type, data } of stream as AsyncIterable<{ type: string; data: any }>) {
        if (type === "test:stdout") {
          if (data.message.includes("~")) rows++;
        } else if (type === "test:pass" || type === "test:fail") {
          verdicts[data.name] = type.slice(5);
          if (data.name.startsWith("megabyte ")) rowsAtVerdict.push(rows);
          if (data.name === "second-writer.test.mjs") fileError = data.details.error.message;
        }
      }
      // The printer can cut the frame of the failure. Then that verdict is lost, and the file says so.
      expect([
        "fail",
        "1 test result of this file did not arrive: " +
          "another writer of its stdout printed inside the result, or its process ended while writing it",
      ]).toContain(verdicts["big failure"] ?? fileError);
      // Each megabyte is all there when its verdict arrives.
      expect(rowsAtVerdict).toEqual([16, 32, 48, 64]);
    },
    timeout,
  );
});
