/**
 * fs.read()/fs.readSync(fd, buffer, offset, length) validated `offset` before
 * the type of `buffer`. With both arguments invalid, Bun threw ERR_OUT_OF_RANGE
 * (or ERR_INVALID_ARG_TYPE) for "offset". Node runs validateBuffer(buffer)
 * first, so the error names "buffer":
 * https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L622-L640 (read)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L709-L727 (readSync)
 *
 * fs.read() and fs.fstat() also took a callback that is not a function, ran
 * the operation, and failed later with an uncaught TypeError. Node throws
 * ERR_INVALID_ARG_TYPE for "cb" from the call: in fs.read() after the fd and
 * buffer checks and before the rest, in fs.fstat() before the fd check:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L600-L634 (read)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L1574-L1579 (fstat)
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values (including the exact error
 * messages) come from. It cannot import from "harness" for the same reason.
 */
import assert from "node:assert";
import fs from "node:fs";
import { after, before, describe, test } from "node:test";
import { promisify } from "node:util";

function invalidBuffer(received: string) {
  return {
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: `The "buffer" argument must be an instance of Buffer, TypedArray, or DataView. Received ${received}`,
  };
}

// [buffer, offset, what Node prints for the buffer]
const cases: [unknown, unknown, string][] = [
  ["not a buffer", -1, "type string ('not a buffer')"],
  [123, "bad", "type number (123)"],
  [null, -1, "null"],
  [{}, 1.5, "an instance of Object"],
  [[1, 2, 3], -1, "an instance of Array"],
];

describe("fs.read()/fs.readSync() check the buffer type before the offset", () => {
  let fd: number;

  before(() => {
    fd = fs.openSync(import.meta.filename, "r");
  });

  after(() => {
    fs.closeSync(fd);
  });

  test("readSync(fd, buffer, offset, length)", () => {
    for (const [buffer, offset, received] of cases) {
      assert.throws(() => (fs as any).readSync(fd, buffer as any, offset as any, 5), invalidBuffer(received));
    }
  });

  test("readSync(fd, buffer, { offset })", () => {
    assert.throws(() => fs.readSync(fd, "x" as any, { offset: -1 }), invalidBuffer("type string ('x')"));
  });

  test("read(fd, buffer, offset, length, position, callback) throws synchronously", () => {
    for (const [buffer, offset, received] of cases) {
      assert.throws(
        () => fs.read(fd, buffer as any, offset as any, 5, 0, () => assert.fail("the callback must not run")),
        invalidBuffer(received),
      );
    }
  });

  test("a valid buffer still gets the offset error", () => {
    const buffer = Buffer.alloc(4);
    assert.throws(() => (fs as any).readSync(fd, buffer, -1, 4), {
      name: "RangeError",
      code: "ERR_OUT_OF_RANGE",
      message: 'The value of "offset" is out of range. It must be >= 0 && <= 9007199254740991. Received -1',
    });
    assert.throws(() => (fs as any).readSync(fd, buffer, "bad" as any, 4), {
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: `The "offset" argument must be of type number. Received type string ('bad')`,
    });
  });

  test("a valid call still reads", () => {
    const buffer = Buffer.alloc(3);
    assert.strictEqual(fs.readSync(fd, buffer, 0, 3, 0), 3);
    assert.strictEqual(buffer.toString(), "/**");
  });
});

const read = fs.read as (...args: unknown[]) => void;
const fstat = fs.fstat as (...args: unknown[]) => void;

function invalidCallback(received: string) {
  return {
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: `The "cb" argument must be of type function. Received ${received}`,
  };
}

describe("fs.read() and fs.fstat() with a callback that is not a function", () => {
  // [value, what Node prints for it]
  const notFunctions: [unknown, string][] = [
    [5, "type number (5)"],
    ["x", "type string ('x')"],
    [{}, "an instance of Object"],
    [[], "an instance of Array"],
    [true, "type boolean (true)"],
    [null, "null"],
    [undefined, "undefined"],
    [0, "type number (0)"],
  ];
  const head = fs.readFileSync(import.meta.filename, "utf8").slice(0, 4);

  // Runs `body` with a new descriptor of this file, at position 0.
  async function withFile<T>(body: (fd: number) => T | Promise<T>) {
    const fd = fs.openSync(import.meta.filename, "r");
    try {
      return await body(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  const readShapes: [string, (fd: number, buffer: Buffer, callback: unknown) => void][] = [
    ["(fd, buffer, offset, length, position, cb)", (fd, buffer, callback) => read(fd, buffer, 0, 4, 0, callback)],
    ["(fd, buffer, options, cb)", (fd, buffer, callback) => read(fd, buffer, { length: 4 }, callback)],
    ["(fd, buffer, cb)", (fd, buffer, callback) => read(fd, buffer, callback)],
    ["(fd, options, cb)", (fd, buffer, callback) => read(fd, { buffer }, callback)],
    ["(fd, cb)", (fd, _buffer, callback) => read(fd, callback)],
  ];

  for (const [shape, call] of readShapes) {
    test(`read${shape} throws and reads nothing`, () =>
      withFile(async fd => {
        const buffer = Buffer.alloc(4, ".");
        for (const [value, received] of notFunctions) {
          assert.throws(() => call(fd, buffer, value), invalidCallback(received));
        }

        // A read at the current position gets the first bytes of the file: no call above moved the position.
        const { promise, resolve } = Promise.withResolvers<[Error | null, number, Buffer]>();
        fs.read(fd, Buffer.alloc(4), 0, 4, null, (...results) => resolve(results));
        const [err, bytesRead, first] = await promise;
        assert.deepStrictEqual(
          { err, bytesRead, first: first.toString(), buffer: buffer.toString() },
          { err: null, bytesRead: 4, first: head, buffer: "...." },
        );
      }));
  }

  test("read() takes its sixth argument as the callback, whatever the argument count", () =>
    withFile(fd => {
      const buffer = Buffer.alloc(4);
      assert.throws(() => read(fd, buffer, 0, 4, 0), invalidCallback("undefined"));
      assert.throws(
        () => read(fd, buffer, 0, 4, () => assert.fail("this is `position`")),
        invalidCallback("undefined"),
      );
      assert.throws(
        () => read(fd, buffer, 0, 4, 0, 5, () => assert.fail("the seventh argument is not read")),
        invalidCallback("type number (5)"),
      );
    }));

  test("read() checks the callback before it converts `length` to a number", () =>
    withFile(fd => {
      let conversions = 0;
      const length = {
        valueOf() {
          conversions++;
          return 4;
        },
      };
      assert.throws(() => read(fd, Buffer.alloc(4), 0, length, 0, 5), invalidCallback("type number (5)"));
      assert.strictEqual(conversions, 0);
    }));

  test("read() still takes an async function, a bound function and a Proxy of a function", () =>
    withFile(async fd => {
      type Results = [Error | null, number, Buffer];
      const callables: ((resolve: (results: Results) => void) => unknown)[] = [
        resolve =>
          async (...results: Results) =>
            resolve(results),
        resolve => ((...results: Results) => resolve(results)).bind(null),
        resolve => new Proxy((...results: Results) => resolve(results), {}),
      ];
      for (const callable of callables) {
        const { promise, resolve } = Promise.withResolvers<Results>();
        read(fd, Buffer.alloc(4), 0, 4, 0, callable(resolve));
        assert.deepStrictEqual(await promise, [null, 4, Buffer.from(head)]);
      }
    }));

  test("fstat() throws", () =>
    withFile(fd => {
      // With two arguments the second one is `options`, and the callback is missing.
      assert.throws(() => fstat(fd), invalidCallback("undefined"));
      for (const [value] of notFunctions) {
        assert.throws(() => fstat(fd, value), invalidCallback("undefined"));
      }
      for (const [value, received] of notFunctions) {
        assert.throws(() => fstat(fd, { bigint: true }, value), invalidCallback(received));
      }
    }));

  test("fstat() checks the callback before the fd", () => {
    assert.throws(() => fstat(-1, 5), invalidCallback("undefined"));
    assert.throws(() => fstat("x", {}, 5), invalidCallback("type number (5)"));
  });

  test("util.promisify(fs.read) and util.promisify(fs.fstat) reject", () =>
    withFile(async fd => {
      // The callback of promisify comes after the value that read() and fstat() take as the callback.
      const notFunction = invalidCallback("type number (5)");
      await assert.rejects(promisify(read as Function)(fd, Buffer.alloc(4), 0, 4, 0, 5), notFunction);
      await assert.rejects(promisify(fstat as Function)(fd, {}, 5), notFunction);
    }));
});

// Node's order in fs.read(): fd, then options, then buffer, then the callback, then offset, length and position.
describe("fs.read() checks its arguments in Node's order", () => {
  const buffer = Buffer.alloc(4);
  const notFunction = invalidCallback("type number (5)");
  let fd: number;

  before(() => {
    fd = fs.openSync(import.meta.filename, "r");
  });

  after(() => {
    fs.closeSync(fd);
  });

  function fdOutOfRange(expected: string, received: string) {
    return {
      name: "RangeError",
      code: "ERR_OUT_OF_RANGE",
      message: `The value of "fd" is out of range. It must be ${expected}. Received ${received}`,
    };
  }

  function invalidFd(received: string) {
    return {
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: `The "fd" argument must be of type number. Received ${received}`,
    };
  }

  function invalidOptions(received: string) {
    return {
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: `The "options" argument must be of type object. Received ${received}`,
    };
  }

  test("the fd error comes first", () => {
    const range = ">= 0 && <= 2147483647";
    assert.throws(() => read(-1, buffer, 0, 4, 0, 5), fdOutOfRange(range, "-1"));
    assert.throws(() => read(2 ** 31, buffer, 0, 4, 0, 5), fdOutOfRange(range, "2147483648"));
    assert.throws(() => read(1.5, buffer, 0, 4, 0, 5), fdOutOfRange("an integer", "1.5"));
    assert.throws(() => read(NaN, buffer, 0, 4, 0, 5), fdOutOfRange("an integer", "NaN"));
    assert.throws(() => read("x", buffer, 0, 4, 0, 5), invalidFd("type string ('x')"));
    assert.throws(() => read(-1, buffer, { length: 4 }, 5), fdOutOfRange(range, "-1"));
    assert.throws(() => read(-1, { buffer }, 5), fdOutOfRange(range, "-1"));
    assert.throws(() => read(undefined, 5), invalidFd("undefined"));
    assert.throws(() => read(-1, "x", 0, 4, 0, 5), fdOutOfRange(range, "-1"));
  });

  test("a call without a callback gets the fd error", () => {
    assert.throws(() => read(), invalidFd("undefined"));
    assert.throws(() => read(null, buffer, 0, 1, 0), invalidFd("null"));
  });

  test("-0 is a valid fd", () => {
    assert.throws(() => read(-0, buffer, 0, 4, 0, 5), notFunction);
  });

  test("the fd error comes before the options error", () => {
    const range = ">= 0 && <= 2147483647";
    const neverCalled = () => assert.fail("the callback must not run");
    assert.throws(() => read(-1, buffer, "x", neverCalled), fdOutOfRange(range, "-1"));
    assert.throws(() => read(1.5, buffer, [], neverCalled), fdOutOfRange("an integer", "1.5"));
    assert.throws(() => read("x", buffer, 5, neverCalled), invalidFd("type string ('x')"));
    assert.throws(() => read(-1, 5, neverCalled), fdOutOfRange(range, "-1"));
    assert.throws(() => read(-1, buffer, 0, 5), fdOutOfRange(range, "-1"));
    assert.throws(() => read(-1, "x", 5), fdOutOfRange(range, "-1"));
  });

  test("the options error comes before the callback error", () => {
    assert.throws(() => read(fd, buffer, 0, 5), invalidOptions("type number (0)"));
    assert.throws(() => read(fd, "x", 5), invalidOptions("type string ('x')"));
  });

  test("the buffer error comes before the callback error", () => {
    assert.throws(() => read(fd, "x", 0, 4, 0, 5), invalidBuffer("type string ('x')"));
    assert.throws(() => read(fd, null, 0, 4, 0, 5), invalidBuffer("null"));
    assert.throws(() => read(fd, [1, 2, 3], 0, 4, 0, 5), invalidBuffer("an instance of Array"));
    assert.throws(() => read(fd, new ArrayBuffer(4), 0, 4, 0, 5), invalidBuffer("an instance of ArrayBuffer"));
    assert.throws(() => read(fd, { buffer: "x" }, 5), invalidBuffer("type string ('x')"));
    assert.throws(() => read(fd, { buffer: null }, 5), invalidBuffer("null"));
    // Five arguments: the function is `position`, and the callback is missing.
    assert.throws(
      () => read(fd, 4, 0, "utf-8", () => assert.fail("the callback must not run")),
      invalidBuffer("type number (4)"),
    );
  });

  test("an undefined buffer gets the buffer error", () => {
    assert.throws(() => read(fd, undefined, 0, 4, 0, 5), invalidBuffer("undefined"));
    assert.throws(() => read(fd, undefined, 0, 4, 0), invalidBuffer("undefined"));
    assert.throws(() => read(fd, undefined, {}, 5), invalidBuffer("undefined"));
  });

  test("the callback error comes before the offset, length and position errors", () => {
    assert.throws(() => read(fd, buffer, -1, 4, 0, 5), notFunction);
    assert.throws(() => read(fd, buffer, "x", 4, 0, 5), notFunction);
    assert.throws(() => read(fd, buffer, 0, 99, 0, 5), notFunction);
    assert.throws(() => read(fd, buffer, 0, -1, 0, 5), notFunction);
    assert.throws(() => read(fd, buffer, 0, 4, "x", 5), notFunction);
    assert.throws(() => read(fd, buffer, 0, 4, -2, 5), notFunction);
    assert.throws(() => read(fd, buffer, { offset: -1 }, 5), notFunction);
    assert.throws(() => read(fd, { buffer, length: 99 }, 5), notFunction);
  });

  test("the callback error comes before the empty buffer error and the zero-length shortcut", () => {
    assert.throws(() => read(fd, Buffer.alloc(0), 0, 4, 0, 5), notFunction);
    assert.throws(() => read(fd, buffer, 0, 0, 0, 5), notFunction);
    // A DataView is a valid buffer.
    assert.throws(() => read(fd, new DataView(new ArrayBuffer(4)), 0, 4, 0, 5), notFunction);
  });
});
