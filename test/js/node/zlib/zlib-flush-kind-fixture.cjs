// Calls flush(kind, callback) on a Gzip, a Brotli and a Zstd stream in each stream state, with kinds that Node.js
// refuses and kinds that it takes. Node.js checks `kind` since v26.5.0 (nodejs/node#63746), before it looks at the
// stream. This file passes under that Node.js and under Bun.
const assert = require("node:assert");
const zlib = require("node:zlib");

// `upper` is the highest flush kind of the codec. The lowest is 0.
const codecs = [
  { codec: "Gzip", create: zlib.createGzip, upper: zlib.constants.Z_BLOCK },
  { codec: "Brotli", create: zlib.createBrotliCompress, upper: zlib.constants.BROTLI_OPERATION_EMIT_METADATA },
  { codec: "Zstd", create: zlib.createZstdCompress, upper: zlib.constants.ZSTD_e_end },
];

// `taken` is what the callback receives when flush() takes the kind.
const states = [
  { name: "after write()", enter: stream => stream.write("hello"), taken: [null] },
  { name: "after end()", enter: stream => stream.end("hello"), taken: [] },
  { name: "after 'finish'", enter: stream => new Promise(done => stream.once("finish", done).end("hello")), taken: [] },
  { name: "after destroy()", enter: stream => stream.destroy(), taken: ["ERR_STREAM_DESTROYED"] },
];

// A kind that is not a number, and how the error names it.
const notNumbers = [
  ["2", "type string ('2')"],
  ["5", "type string ('5')"],
  ["none", "type string ('none')"],
  [2n, "type bigint (2n)"],
  [[2], "an instance of Array"],
  [new Number(2), "an instance of Number"],
  [new String("2"), "an instance of String"],
  [{ toString: () => assert.fail("flush() converted the kind to a string") }, "an instance of Object"],
  [null, "null"],
];

let step = "start";
process.on("exit", () => {
  if (step !== "done") {
    console.error(`stopped at: ${step}`);
    process.exitCode = 1;
  }
});

const notCalled = () => assert.fail(`${step}: the callback ran`);
const typeError = received => ({
  type: TypeError,
  code: "ERR_INVALID_ARG_TYPE",
  message: `The "kind" argument must be of type number. Received ${received}`,
});

// A caller tells the class of the error with instanceof, so that is checked as well as the name.
function refuses(stream, args, { type, code, message }) {
  const { pendingcb } = stream._writableState;
  const endListeners = stream.listenerCount("end");
  assert.throws(
    () => stream.flush(...args),
    error => {
      assert(error instanceof type, `${step}: the error is not an instance of ${type.name}`);
      assert.deepStrictEqual(
        { name: error.name, code: error.code, message: error.message },
        { name: type.name, code, message },
        step,
      );
      return true;
    },
    step,
  );
  assert.strictEqual(stream._writableState.pendingcb, pendingcb, `${step}: pendingcb`);
  assert.strictEqual(stream.listenerCount("end"), endListeners, `${step}: 'end' listeners`);
}

async function main() {
  for (const { codec, create, upper } of codecs) {
    for (const { name, enter, taken } of states) {
      const stream = create();
      stream.resume();
      await enter(stream);
      const at = `${codec}, ${name}`;

      for (const [kind, received] of notNumbers) {
        step = `${at}: flush(${received})`;
        refuses(stream, [kind, notCalled], typeError(received));
      }
      // The kind is checked before the callback is looked at.
      step = `${at}: flush("2") with no callback`;
      refuses(stream, ["2"], typeError("type string ('2')"));
      step = `${at}: flush("2", {})`;
      refuses(stream, ["2", {}], typeError("type string ('2')"));
      for (const [kind, must] of [
        [-1, `>= 0 and <= ${upper}`],
        [upper + 1, `>= 0 and <= ${upper}`],
        [Infinity, "a finite number"],
      ]) {
        step = `${at}: flush(${kind})`;
        refuses(stream, [kind, notCalled], {
          type: RangeError,
          code: "ERR_OUT_OF_RANGE",
          message: `The value of "kind" is out of range. It must be ${must}. Received ${kind}`,
        });
      }

      // The refused calls left the stream as it was: flush() still takes every kind that Node.js takes.
      for (const kind of [0, upper, undefined, NaN]) {
        step = `${at}: flush(${kind})`;
        const args = await new Promise(done => stream.flush(kind, (...args) => done(args)));
        assert.deepStrictEqual(
          args.map(arg => (arg instanceof Error ? arg.code : arg)),
          taken,
          step,
        );
      }
      stream.destroy();
    }
  }
  step = "done";
  console.log("ok");
}
main();
