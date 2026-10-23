/**
 * All tests in this file run in both Bun and Node.js, except the "Only in Bun" group at the end:
 * `bun test` runs them here, and the last test runs this same file under Node.js.
 *
 * A pair is a stage of pipeline() or compose() that has a web `readable` and a web `writable` and
 * is not an instance of TransformStream. Node classifies a stage with isTransformStream(), which
 * is a duck type, and a sink with isWritableStream(), which is one too:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/streams/utils.js#L90-L106
 *
 * Node takes any object as the `writable` of a pair. Bun takes only a WritableStream, native or
 * userland. The results for an object that only looks like a pair are in the group for Bun.
 */
import assert from "node:assert";
import { getEventListeners, once } from "node:events";
import { createReadStream, createWriteStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as nodeStream from "node:stream";
import { Duplex, PassThrough, Readable, Stream, Transform, Writable } from "node:stream";
import * as streamPromises from "node:stream/promises";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// The types of these functions do not accept a pair.
const pipeline: (...streams: any[]) => any = nodeStream.pipeline;
const pipelineP: (...streams: any[]) => Promise<void> = streamPromises.pipeline;
const compose: (...streams: any[]) => Duplex = (nodeStream as any).compose;
const addAbortSignal: (signal: AbortSignal, stream: any) => any = nodeStream.addAbortSignal;

type Change = (text: string) => string;
const upper: Change = text => text.toUpperCase();
const exclaim: Change = text => text + "!";

const webTransform = (change: Change) =>
  new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(Buffer.from(change(String(Buffer.from(chunk)))));
    },
  });

class Fields {
  readable: ReadableStream;
  writable: WritableStream;
  constructor({ readable, writable }: TransformStream) {
    this.readable = readable;
    this.writable = writable;
  }
}

// Each entry makes a pair that passes every chunk through `change`. `fromPromiseJob` is the error
// of a pipeline() into a destroyed destination when a promise job makes the call.
const pairs: [kind: string, make: (change: Change) => any, fromPromiseJob: string][] = [
  ["a class with two fields", change => new Fields(webTransform(change)), "ERR_STREAM_PREMATURE_CLOSE"],
  [
    "an object literal",
    change => {
      const { readable, writable } = webTransform(change);
      return { readable, writable };
    },
    "ERR_STREAM_PREMATURE_CLOSE",
  ],
  [
    "the result of Duplex.toWeb()",
    change =>
      Duplex.toWeb(
        new Transform({
          transform(chunk, encoding, callback) {
            let changed;
            try {
              changed = change(String(chunk));
            } catch (err) {
              return callback(err as Error);
            }
            callback(null, changed);
          },
        }),
      ),
    "ABORT_ERR",
  ],
];

const source = () => Readable.from([Buffer.from("hello")]);

function sink() {
  const chunks: Buffer[] = [];
  const written = Promise.withResolvers<void>();
  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(chunk);
      written.resolve();
      callback();
    },
  });
  return { stream, written: written.promise, text: () => Buffer.concat(chunks).toString() };
}

async function text(iterable: AsyncIterable<any>) {
  let out = "";
  for await (const chunk of iterable) out += Buffer.from(chunk);
  return out;
}

function callback() {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  return { promise, done: (err?: Error | null) => (err ? reject(err) : resolve()) };
}

const settled = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    err => err,
  );

const locks = (pair: any) => ({ readable: pair.readable.locked, writable: pair.writable.locked });

// What a web streams polyfill gives: the streams are not native ones.
function userlandPair() {
  const { readable, writable } = webTransform(upper);
  const reader = readable.getReader();
  const writer = writable.getWriter();
  return {
    readable: {
      getReader: () => reader,
      cancel: (reason: unknown) => reader.cancel(reason),
      pipeThrough() {},
      [Symbol.asyncIterator]: () => ({ next: () => reader.read(), return: async () => ({ done: true }) }),
    },
    writable: { getWriter: () => writer, abort: (reason: unknown) => writer.abort(reason) },
  };
}

function userlandSink() {
  const chunks: Buffer[] = [];
  const writer = new WritableStream({
    write(chunk) {
      chunks.push(Buffer.from(chunk));
    },
  }).getWriter();
  return {
    stream: { getWriter: () => writer, abort: (reason: unknown) => writer.abort(reason) },
    text: () => Buffer.concat(chunks).toString(),
  };
}

for (const [kind, make, fromPromiseJob] of pairs) {
  describe(`a pair, ${kind}`, () => {
    describe("pipeline()", () => {
      test("as a middle stage", async () => {
        const pair = make(upper);
        const out = sink();
        const { promise, done } = callback();
        assert.strictEqual(pipeline(source(), pair, out.stream, done), out.stream);
        assert.deepStrictEqual(locks(pair), { readable: true, writable: true });
        await promise;
        assert.strictEqual(out.text(), "HELLO");
      });

      test("as a middle stage, with the streams in an array", async () => {
        const out = sink();
        const { promise, done } = callback();
        pipeline([source(), make(upper), out.stream], done);
        await promise;
        assert.strictEqual(out.text(), "HELLO");
      });

      test("as the first stage: pipeline() takes the readable side only", async () => {
        const pair = make(upper);
        const out = sink();
        const { promise, done } = callback();
        pipeline(pair, out.stream, done);
        assert.deepStrictEqual(locks(pair), { readable: true, writable: false });
        const writer = pair.writable.getWriter();
        await writer.write(Buffer.from("hello"));
        await writer.close();
        await promise;
        assert.strictEqual(out.text(), "HELLO");
      });

      test("as the last stage: pipeline() takes the writable side only and returns the pair", async () => {
        const pair = make(upper);
        const { promise, done } = callback();
        assert.strictEqual(pipeline(source(), pair, done), pair);
        assert.deepStrictEqual(locks(pair), { readable: false, writable: true });
        assert.strictEqual(await text(pair.readable), "HELLO");
        await promise;
      });

      test("before and after a TransformStream", async () => {
        const out = sink();
        await pipelineP(source(), new TransformStream(), make(upper), new TransformStream(), out.stream);
        assert.strictEqual(out.text(), "HELLO");
      });

      test("before a second pair", async () => {
        const out = sink();
        await pipelineP(source(), make(upper), make(exclaim), out.stream);
        assert.strictEqual(out.text(), "HELLO!");
      });

      test("between a ReadableStream and a WritableStream", async () => {
        let got = "";
        await pipelineP(
          new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.from("hello"));
              controller.close();
            },
          }),
          make(upper),
          new WritableStream({
            write(chunk) {
              got += Buffer.from(chunk);
            },
          }),
        );
        assert.strictEqual(got, "HELLO");
      });

      test("after a generator function", async () => {
        const out = sink();
        await pipelineP(
          async function* () {
            yield Buffer.from("hello");
          },
          make(upper),
          out.stream,
        );
        assert.strictEqual(out.text(), "HELLO");
      });

      test("before a generator function", async () => {
        const out = sink();
        await pipelineP(
          source(),
          make(upper),
          async function* (chunks: AsyncIterable<Buffer>) {
            for await (const chunk of chunks) yield chunk;
          },
          out.stream,
        );
        assert.strictEqual(out.text(), "HELLO");
      });

      test("as the return value of the last function stage", async () => {
        const pair = make(upper);
        const { promise, done } = callback();
        let pumped: Promise<void> | undefined;
        const output = pipeline(
          source(),
          (chunks: AsyncIterable<Buffer>) => {
            const writer = pair.writable.getWriter();
            pumped = (async () => {
              for await (const chunk of chunks) await writer.write(chunk);
              await writer.close();
            })();
            return pair;
          },
          done,
        );
        assert.strictEqual(await text(output), "HELLO");
        await Promise.all([promise, pumped]);
      });

      test("before a userland WritableStream", async () => {
        const out = userlandSink();
        await pipelineP(source(), make(upper), out.stream);
        assert.strictEqual(out.text(), "HELLO");
      });

      // 64 KiB is the highWaterMark of the stage before the pair.
      test("delivers four 64 KiB chunks in order to a slow destination", async () => {
        const chunks = Array.from({ length: 4 }, (_, index) => Buffer.alloc(65536, 97 + index));
        const got: Buffer[] = [];
        const slow = new Writable({
          highWaterMark: 1,
          write(chunk, encoding, callback) {
            got.push(chunk);
            setImmediate(callback);
          },
        });
        await pipelineP(
          Readable.from(chunks),
          make(text => text),
          slow,
        );
        assert.ok(Buffer.concat(got).equals(Buffer.concat(chunks)));
      });
    });

    describe("promises.pipeline()", () => {
      test("as a middle stage", async () => {
        const out = sink();
        assert.strictEqual(await pipelineP(source(), make(upper), out.stream), undefined);
        assert.strictEqual(out.text(), "HELLO");
      });

      // The last argument can be the options object. A pair is not that.
      for (const [count, between] of [
        ["two", () => []],
        ["three", () => [new PassThrough()]],
      ] as const) {
        test(`as the last of ${count} streams`, async () => {
          const pair = make(upper);
          const [, got] = await Promise.all([pipelineP(source(), ...between(), pair), text(pair.readable)]);
          assert.strictEqual(got, "HELLO");
        });
      }

      test("through util.promisify(pipeline)", async () => {
        const out = sink();
        await promisify(pipeline)(source(), make(upper), out.stream);
        assert.strictEqual(out.text(), "HELLO");
      });

      test("rejects with an AbortError when the signal is already aborted", async () => {
        const promise = pipelineP(source(), make(upper), sink().stream, { signal: AbortSignal.abort() });
        await assert.rejects(promise, { name: "AbortError", code: "ABORT_ERR" });
      });

      test("rejects with an AbortError when the signal aborts after a chunk", async () => {
        const controller = new AbortController();
        const idle = new Readable({ read() {} });
        const out = sink();
        const promise = pipelineP(idle, make(upper), out.stream, { signal: controller.signal });
        idle.push(Buffer.from("hello"));
        await Promise.race([out.written, promise]);
        controller.abort();
        await assert.rejects(promise, { name: "AbortError", code: "ABORT_ERR" });
        assert.strictEqual(out.text(), "HELLO");
      });

      test("rejects with the error of a source that fails", async () => {
        const boom = new Error("boom");
        const failing = Readable.from(
          (async function* () {
            yield Buffer.from("hello");
            throw boom;
          })(),
        );
        assert.strictEqual(await settled(pipelineP(failing, make(upper), sink().stream)), boom);
      });

      test("rejects with the error of the pair when it fails", async () => {
        const boom = new Error("boom");
        const failing = make(() => {
          throw boom;
        });
        assert.strictEqual(await settled(pipelineP(source(), failing, sink().stream)), boom);
      });

      // pipeline() queues a tick that reports the 'close' of the destroyed destination. For a
      // caller in a tick it runs before the first chunk. For a caller in a promise job it runs
      // after the source has ended, and the teardown of a Duplex.toWeb() pair then replaces the
      // premature close with its AbortError.
      for (const [caller, schedule, code] of [
        ["a tick", (run: () => void) => process.nextTick(run), "ERR_STREAM_PREMATURE_CLOSE"],
        ["a promise job", (run: () => void) => queueMicrotask(run), fromPromiseJob],
      ] as const) {
        test(`rejects when the destination is destroyed, called from ${caller}`, async () => {
          const out = sink();
          const { promise, resolve } = Promise.withResolvers<any>();
          schedule(() => {
            out.stream.destroy();
            resolve(settled(pipelineP(source(), make(upper), out.stream)));
          });
          assert.strictEqual((await promise).code, code);
        });
      }
    });

    describe("compose()", () => {
      test("as the last member", async () => {
        assert.strictEqual(await text(compose(source(), make(upper))), "HELLO");
      });

      test("as the first member", async () => {
        const composed = compose(make(upper), new PassThrough());
        assert.deepStrictEqual(
          { readable: composed.readable, writable: composed.writable },
          { readable: true, writable: true },
        );
        composed.end(Buffer.from("hello"));
        assert.strictEqual(await text(composed), "HELLO");
      });

      test("after a node stream", async () => {
        const composed = compose(new PassThrough(), make(upper));
        composed.end(Buffer.from("hello"));
        assert.strictEqual(await text(composed), "HELLO");
      });

      test("before a second pair", async () => {
        const composed = compose(make(upper), make(exclaim));
        composed.end(Buffer.from("hello"));
        assert.strictEqual(await text(composed), "HELLO!");
      });

      for (const [name, destination] of [
        ["a Writable", sink],
        ["a userland WritableStream", userlandSink],
      ] as const) {
        test(`between a source and ${name}`, async () => {
          const out = destination();
          const composed = compose(source(), make(upper), out.stream);
          assert.deepStrictEqual(
            { readable: composed.readable, writable: composed.writable },
            { readable: false, writable: false },
          );
          await once(composed, "close");
          assert.strictEqual(out.text(), "HELLO");
        });
      }

      for (const [name, options] of [
        ["no options", () => []],
        ["a signal", () => [{ signal: new AbortController().signal }]],
      ] as const) {
        test(`in Readable.prototype.compose() with ${name}`, async () => {
          assert.strictEqual(await text((source() as any).compose(make(upper), ...options())), "HELLO");
        });
      }
    });
  });
}

describe("a pair between file streams", () => {
  for (const [name, stages, expected] of [
    ["a class with two fields", () => [new Fields(webTransform(upper))], "HELLO"],
    ["an object literal", () => [(({ readable, writable }) => ({ readable, writable }))(webTransform(upper))], "HELLO"],
    ["Duplex.toWeb(new PassThrough())", () => [Duplex.toWeb(new PassThrough())], "hello"],
    [
      "the class, with a signal",
      () => [new Fields(webTransform(upper)), { signal: new AbortController().signal }],
      "HELLO",
    ],
  ] as const) {
    test(name, async () => {
      const dir = mkdtempSync(join(tmpdir(), "node-stream-pair-"));
      try {
        writeFileSync(join(dir, "in.txt"), "hello");
        const [pair, ...options] = stages();
        await pipelineP(
          createReadStream(join(dir, "in.txt")),
          pair,
          createWriteStream(join(dir, "out.txt")),
          ...options,
        );
        assert.strictEqual(readFileSync(join(dir, "out.txt"), "utf8"), expected);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe("what counts as a pair", () => {
  for (const [side, options] of [
    ["readable", () => ({ readable: new ReadableStream() })],
    ["writable", () => ({ writable: new WritableStream() })],
  ] as const) {
    test(`not an object with a ${side} side alone: it is the options of promises.pipeline()`, async () => {
      const out = sink();
      await pipelineP(source(), out.stream, options());
      assert.strictEqual(out.text(), "hello");
    });
  }

  test("an object with a WritableStream and a node Readable, as a middle stage", async () => {
    const readable = new Readable({ read() {} });
    const writable = new WritableStream({
      write(chunk) {
        readable.push(String(Buffer.from(chunk)).toUpperCase());
      },
      close() {
        readable.push(null);
      },
    });
    const out = sink();
    await pipelineP(source(), { readable, writable }, out.stream);
    assert.strictEqual(out.text(), "HELLO");
  });

  test("an object with a null readable side, as the last stage", async () => {
    let got = "";
    const { promise, done } = callback();
    const writable = new WritableStream({
      write(chunk) {
        got += Buffer.from(chunk);
      },
    });
    pipeline(source(), { readable: null, writable }, done);
    await promise;
    assert.strictEqual(got, "hello");
  });

  test("not a node stream, whatever its readable and writable are", () => {
    // A legacy stream has pipe() and on(), and nothing else.
    const legacy: any = new Stream();
    legacy.readable = new ReadableStream();
    legacy.writable = new WritableStream();
    assert.throws(() => compose(legacy, new PassThrough()), {
      code: "ERR_INVALID_ARG_VALUE",
      message: /^The argument 'streams\[0\]' must be readable\./,
    });
  });

  for (const stage of [null, undefined]) {
    test(`not ${stage}: pipeline() throws ERR_INVALID_ARG_TYPE`, () => {
      assert.throws(() => pipeline(source(), stage, () => {}), { code: "ERR_INVALID_ARG_TYPE" });
    });
  }

  test("a userland pair, in pipeline()", async () => {
    const out = sink();
    await pipelineP(source(), userlandPair(), out.stream);
    assert.strictEqual(out.text(), "HELLO");
  });

  for (const [name, between] of [
    ["a ReadableStream", () => []],
    ["a ReadableStream and a TransformStream", () => [new TransformStream()]],
  ] as const) {
    test(`a userland pair, in pipeline() after ${name}`, async () => {
      const web = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("hello"));
          controller.close();
        },
      });
      const out = sink();
      await pipelineP(web, ...between(), userlandPair(), out.stream);
      assert.strictEqual(out.text(), "HELLO");
    });
  }

  test("a userland pair, in pipeline() before a generator function", async () => {
    const out = sink();
    await pipelineP(
      source(),
      userlandPair(),
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) yield chunk;
      },
      out.stream,
    );
    assert.strictEqual(out.text(), "HELLO");
  });

  test("a userland pair, in pipeline() as the first stage", async () => {
    const pair = userlandPair();
    const out = sink();
    const done = pipelineP(pair, out.stream);
    const writer = pair.writable.getWriter();
    await writer.write(Buffer.from("hello"));
    await writer.close();
    await done;
    assert.strictEqual(out.text(), "HELLO");
  });

  test("a userland pair, in pipeline() as the return value of the last function stage", async () => {
    const pair = userlandPair();
    const { promise, done } = callback();
    let pumped: Promise<void> | undefined;
    const output = pipeline(
      source(),
      (chunks: AsyncIterable<Buffer>) => {
        const writer = pair.writable.getWriter();
        pumped = (async () => {
          for await (const chunk of chunks) await writer.write(chunk);
          await writer.close();
        })();
        return pair;
      },
      done,
    );
    assert.strictEqual(await text(output), "HELLO");
    await Promise.all([promise, pumped]);
  });

  test("a userland pair, in compose()", async () => {
    assert.strictEqual(await text(compose(source(), userlandPair())), "HELLO");
  });

  test("a userland pair, in compose() as the first member", async () => {
    const composed = compose(userlandPair(), new PassThrough());
    composed.end(Buffer.from("hello"));
    assert.strictEqual(await text(composed), "HELLO");
  });

  test("a middle stage whose readable side has its own source: the stage before it goes to the writable side", async () => {
    let fed = "";
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("own"));
        controller.close();
      },
    });
    const writable = new WritableStream({
      write(chunk) {
        fed += Buffer.from(chunk);
      },
    });
    const out = sink();
    await pipelineP(source(), { readable, writable }, out.stream);
    assert.deepStrictEqual({ fed, out: out.text() }, { fed: "hello", out: "own" });
  });

  // Node asks for an object as the `writable` side.
  test("not an object whose writable side is a function: it is the options of promises.pipeline()", async () => {
    const { writable } = new TransformStream();
    const callable = Object.assign(function () {}, {
      getWriter: () => writable.getWriter(),
      abort: (reason: unknown) => writable.abort(reason),
    });
    const out = sink();
    await pipelineP(source(), out.stream, { signal: new AbortController().signal, readable: null, writable: callable });
    assert.strictEqual(out.text(), "hello");
    await assert.rejects(pipelineP(source(), { readable: new ReadableStream(), writable: callable }), {
      code: "ERR_MISSING_ARGS",
    });
  });

  test("addAbortSignal() treats a pair as it treats a TransformStream", () => {
    const outcome = (stream: unknown) => {
      const { signal } = new AbortController();
      let code = "no error";
      try {
        addAbortSignal(signal, stream);
      } catch (err: any) {
        code = err.code;
      }
      return { code, abortListeners: getEventListeners(signal, "abort").length };
    };
    for (const [kind, make] of pairs) {
      const forPair = outcome(make(upper));
      assert.strictEqual(forPair.code, "ERR_INVALID_ARG_TYPE", kind);
      assert.deepStrictEqual(forPair, outcome(new TransformStream()), kind);
    }
  });
});

describe("the result of Duplex.toWeb() for a Duplex that has ended with data in its buffer", () => {
  test("as the first stage of pipeline()", async () => {
    const duplex = new PassThrough();
    duplex.end("hello");
    const out = sink();
    const { promise, done } = callback();
    pipeline(Duplex.toWeb(duplex), out.stream, done);
    await promise;
    assert.strictEqual(out.text(), "hello");
  });
});

// compose() writes to its first member, so the composed stream is writable and stays open until
// end(), also when the readable side of the pair has its own source.
describe("compose() with a pair whose readable side has its own source as the first member", () => {
  test("is writable, and delivers what the readable side gives", async () => {
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("hello"));
        controller.close();
      },
    });
    const out = sink();
    const composed = compose({ readable, writable: new WritableStream() }, out.stream);
    assert.deepStrictEqual(
      { readable: composed.readable, writable: composed.writable },
      { readable: false, writable: true },
    );
    await once(out.stream, "finish");
    assert.strictEqual(out.text(), "hello");
  });
});

describe("a userland WritableStream as the last stage", () => {
  test("of pipeline()", async () => {
    const out = userlandSink();
    const { promise, done } = callback();
    assert.strictEqual(pipeline(source(), out.stream, done), out.stream);
    await promise;
    assert.strictEqual(out.text(), "hello");
  });

  for (const [name, before, after, expected] of [
    ["two streams", () => [], () => [], "hello"],
    ["three streams", () => [new PassThrough()], () => [], "hello"],
    ["an options object", () => [], () => [{ signal: new AbortController().signal }], "hello"],
    ["a TransformStream before it", () => [webTransform(upper)], () => [], "HELLO"],
    ["a userland pair before it", () => [userlandPair()], () => [], "HELLO"],
    [
      "a generator function before it",
      () => [
        async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) yield chunk;
        },
      ],
      () => [],
      "hello",
    ],
  ] as const) {
    test(`of promises.pipeline() with ${name}`, async () => {
      const out = userlandSink();
      await pipelineP(source(), ...before(), out.stream, ...after());
      assert.strictEqual(out.text(), expected);
    });
  }

  test("of promises.pipeline() after a ReadableStream", async () => {
    const out = userlandSink();
    const web = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("hello"));
        controller.close();
      },
    });
    await pipelineP(web, out.stream);
    assert.strictEqual(out.text(), "hello");
  });

  test("of compose()", async () => {
    const out = userlandSink();
    const composed = compose(source(), out.stream);
    assert.deepStrictEqual(
      { readable: composed.readable, writable: composed.writable },
      { readable: false, writable: false },
    );
    await once(composed, "close");
    assert.strictEqual(out.text(), "hello");
  });

  for (const [position, members, message] of [
    ["first", () => [userlandSink().stream, new PassThrough()], /^The argument 'streams\[0\]' must be readable\./],
    [
      "middle",
      () => [source(), userlandSink().stream, new PassThrough()],
      /^The argument 'streams\[1\]' must be readable\./,
    ],
  ] as const) {
    test(`not as the ${position} member of compose(): it is not readable`, () => {
      assert.throws(() => compose(...members()), { code: "ERR_INVALID_ARG_VALUE", message });
    });
  }

  test("not a node stream that has getWriter() and abort(): compose() asks for a writable member", () => {
    const readable = Object.assign(new Readable({ read() {} }), { getWriter() {}, abort() {} });
    assert.throws(() => compose(new PassThrough(), readable), {
      code: "ERR_INVALID_ARG_VALUE",
      message: /^The argument 'streams\[1\]' must be writable\./,
    });
  });

  test("an options object with getWriter() and abort() is a stream, not the options", async () => {
    const options = { signal: new AbortController().signal, getWriter() {}, abort() {} };
    await assert.rejects(pipelineP(source(), sink().stream, options), { code: "ERR_INVALID_ARG_TYPE" });
  });

  for (const method of ["getWriter", "abort"]) {
    test(`an object with ${method}() alone is the options of promises.pipeline()`, async () => {
      const out = sink();
      await pipelineP(source(), out.stream, { [method]() {} });
      assert.strictEqual(out.text(), "hello");
    });
  }
});

// These are TransformStream instances to Bun's class check, and pairs to Node.
describe("the web transforms that have their own class", () => {
  for (const [name, stages] of [
    ["TextDecoderStream", () => [source(), new TextDecoderStream()]],
    ["TextEncoderStream", () => [Readable.from(["hello"]), new TextEncoderStream()]],
    [
      "CompressionStream and DecompressionStream",
      () => [source(), new CompressionStream("gzip"), new DecompressionStream("gzip")],
    ],
  ] as const) {
    test(name, async () => {
      const out = sink();
      await pipelineP(...stages(), out.stream);
      assert.strictEqual(out.text(), "hello");
    });
  }
});

// Only in Bun: the results that are Bun's own, and the run of this file under Node.js, which must
// not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, bunExe, nodeExe } = await import("harness");

  describe("Only in Bun", () => {
    // Node has the duck type only. Bun keeps the class check in front of it, so that a
    // TransformStream stage costs no getter call.
    test("a TransformStream counts by its class: its readable and writable are not read", async () => {
      class Guarded extends TransformStream {
        get readable(): ReadableStream {
          throw new Error("readable was read");
        }
        get writable(): WritableStream {
          throw new Error("writable was read");
        }
      }
      // promises.pipeline() classifies its last argument. Then the stage before it is not readable.
      await assert.rejects(pipelineP(source(), sink().stream, new Guarded()), { code: "ERR_INVALID_ARG_TYPE" });
    });

    // Node adds its abort listener first, and then eos() rejects the stream. A later abort runs the
    // listener, which throws. With a signal that has aborted, Node throws a TypeError.
    test("addAbortSignal() rejects a pair and a TransformStream before it uses the signal", () => {
      for (const stream of [pairs[0][1](upper), new TransformStream()]) {
        const { signal } = new AbortController();
        assert.throws(() => addAbortSignal(signal, stream), { code: "ERR_INVALID_ARG_TYPE" });
        assert.strictEqual(getEventListeners(signal, "abort").length, 0);
        assert.throws(() => addAbortSignal(AbortSignal.abort(), stream), { code: "ERR_INVALID_ARG_TYPE" });
      }
    });

    // eos() takes a native stream only. Node throws a TypeError with no code at the same point.
    test("compose() of a writable first member and a userland last member throws ERR_INVALID_ARG_TYPE", () => {
      for (const last of [userlandSink().stream, userlandPair()]) {
        const first = new PassThrough();
        assert.throws(() => compose(first, last), { code: "ERR_INVALID_ARG_TYPE" });
        first.end();
      }
    });

    // An object whose `writable` is not a WritableStream only looks like a pair. Node takes it for
    // one, calls getWriter() on the `writable`, and the TypeError is an unhandled rejection of a
    // pipeline that never settles. Bun does not take it for a pair.
    describe("an object that only looks like a pair", () => {
      for (const [sides, options] of [
        ["null sides", () => ({ readable: null, writable: null })],
        ["plain objects as sides", () => ({ signal: new AbortController().signal, readable: {}, writable: {} })],
      ] as const) {
        test(`with ${sides} is the options of promises.pipeline()`, async () => {
          const out = sink();
          await pipelineP(source(), out.stream, options());
          assert.strictEqual(out.text(), "hello");
        });
      }

      test("with a plain object as the writable side is not a stage of pipeline()", async () => {
        const stage = () => ({ readable: new ReadableStream(), writable: {} });
        await assert.rejects(pipelineP(source(), stage(), sink().stream), { code: "ERR_INVALID_ARG_TYPE" });
        // Node reads the readable side of a first stage. The same test serves compose(), which
        // writes to its first member.
        await assert.rejects(pipelineP(stage(), sink().stream), { code: "ERR_INVALID_ARG_TYPE" });
      });

      test("with two node streams is a member of compose(), through Duplex.from()", async () => {
        const readable = new PassThrough();
        readable.end("hello");
        const composed = compose({ readable, writable: new PassThrough() }, new PassThrough());
        assert.strictEqual(composed.writable, false);
        assert.strictEqual(await text(composed), "hello");
      });

      // The `readable` of a Subprocess is its stdout stream. Its `writable` is its stdin FileSink,
      // which is not a WritableStream. These results change when `writable` becomes one.
      test("a Subprocess with piped stdio is rejected with ERR_INVALID_ARG_TYPE, not with an unhandled TypeError", async () => {
        const spawn = () => Bun.spawn({ cmd: [bunExe(), "--version"], env: bunEnv, stdin: "pipe", stdout: "pipe" });
        await using inPipeline = spawn();
        await using first = spawn();
        await using inCompose = spawn();
        await assert.rejects(pipelineP(source(), inPipeline, sink().stream), { code: "ERR_INVALID_ARG_TYPE" });
        await assert.rejects(pipelineP(first, sink().stream), { code: "ERR_INVALID_ARG_TYPE" });
        assert.throws(() => compose(inCompose, new PassThrough()), { code: "ERR_INVALID_ARG_TYPE" });
      });
    });

    // The expected results were recorded from Node.js v26.3.0. Node.js 23 and older cannot parse
    // the `await using` above.
    const node = nodeExe();
    const nodeMajor = node
      ? Number(Bun.spawnSync({ cmd: [node, "-p", "process.versions.node.split('.')[0]"], env: bunEnv }).stdout)
      : 0;

    (nodeMajor >= 24 ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
