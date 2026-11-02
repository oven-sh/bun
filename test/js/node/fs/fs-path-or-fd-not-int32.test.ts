/**
 * Where node:fs takes a path or a file descriptor, Node decides which one a
 * number is with `isFd = isInt32`, a test on the value. Only an int32 is a
 * file descriptor. Every other number goes to the path validation, which
 * throws TypeError ERR_INVALID_ARG_TYPE. Bun took every number for a file
 * descriptor and threw RangeError ERR_OUT_OF_RANGE about "fd":
 * https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L196
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/validators.js#L46-L48
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * Node.js, which is where the expected values come from. It cannot import from
 * "harness" at the top for the same reason, so it manages its own temporary
 * directory.
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const notInt32 = [5.5, -0.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32, -(2 ** 31) - 1, 1e100];
const invalidPath = { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" };
const noop = () => {};
const asDouble = (value: number) => new Float64Array([value])[0];

const throwing: [name: string, call: (value: any) => unknown][] = [
  ["readFileSync", value => fs.readFileSync(value)],
  ["writeFileSync", value => fs.writeFileSync(value, "x")],
  ["appendFileSync", value => fs.appendFileSync(value, "x")],
  ["truncateSync", value => fs.truncateSync(value)],
  ["readFile", value => fs.readFile(value, noop)],
  ["writeFile", value => fs.writeFile(value, "x", noop)],
  ["appendFile", value => fs.appendFile(value, "x", noop)],
  ["truncate", value => fs.truncate(value, noop)],
  ["openAsBlob", value => fs.openAsBlob(value)],
];
const rejecting: [name: string, call: (value: any) => Promise<unknown>][] = [
  ["promises.readFile", value => fs.promises.readFile(value)],
  ["promises.writeFile", value => fs.promises.writeFile(value, "x")],
  ["promises.writeFile of an iterable", value => fs.promises.writeFile(value, ["x"])],
  ["promises.appendFile", value => fs.promises.appendFile(value, "x")],
  ["promises.truncate", value => fs.promises.truncate(value)],
];

describe("a number that is not an int32 is an invalid path", () => {
  for (const [name, call] of throwing) {
    test(`${name} throws`, () => {
      for (const value of notInt32) {
        assert.throws(() => call(value), invalidPath, `${name}(${value})`);
      }
    });
  }

  for (const [name, call] of rejecting) {
    test(`${name} rejects`, async () => {
      for (const value of notInt32) {
        // The call itself must not throw: the promise delivers the error.
        const promise = call(value);
        assert.ok(promise instanceof Promise, `${name}(${value}) returns a promise`);
        await assert.rejects(promise, invalidPath, `${name}(${value})`);
      }
    });
  }
});

describe("an int32 is a file descriptor", () => {
  let dir: string;
  let file: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-path-or-fd-"));
    file = path.join(dir, "file.txt");
    fs.writeFileSync(file, "contents");
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("an integer stored as a double", () => {
    const fd = fs.openSync(file, "r");
    try {
      assert.strictEqual(fs.readFileSync(asDouble(fd)).toString(), "contents");
    } finally {
      fs.closeSync(fd);
    }
  });

  test("2 ** 31 - 1", () => {
    // Nothing is open there, so the system refuses it: the number was not a path.
    assert.throws(() => fs.readFileSync(2 ** 31 - 1), { code: "EBADF" });
  });

  // Node throws this RangeError from these three functions. From its other
  // functions a negative int32 gives EBADF (writeFileSync, appendFileSync), a
  // throw on a later tick (readFile), or the TypeError of a function that takes
  // no file descriptor (truncate, openAsBlob, fs.promises). Bun throws the
  // RangeError from all of them, so only these three rows also pass in Node.
  const negative: [name: string, call: (value: any) => unknown][] = [
    ["readFileSync", value => fs.readFileSync(value)],
    ["writeFile", value => fs.writeFile(value, "x", noop)],
    ["appendFile", value => fs.appendFile(value, "x", noop)],
  ];
  for (const [name, call] of negative) {
    test(`${name} throws for a negative one`, () => {
      for (const value of [-1, -(2 ** 31), asDouble(-1)]) {
        assert.throws(() => call(value), {
          name: "RangeError",
          code: "ERR_OUT_OF_RANGE",
          message: `The value of "fd" is out of range. It must be >= 0 && <= 2147483647. Received ${value}`,
        });
      }
    });
  }

  test("promises.readFile rejects for a closed FileHandle, whose fd is -1", async () => {
    const handle = await fs.promises.open(file, "r");
    await handle.close();
    await assert.rejects(fs.promises.readFile(handle), {
      name: "RangeError",
      code: "ERR_OUT_OF_RANGE",
      message: 'The value of "fd" is out of range. It must be >= 0 && <= 2147483647. Received -1',
    });
  });
});

// Only in Bun: the rows that need the harness or that Node.js does not have,
// and the run of this file in Node.js, which must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, bunExe, nodeExeAtLeast, tempDir } = await import("harness");

  describe("in Bun", () => {
    test("-0 is file descriptor 0", async () => {
      using dir = tempDir("fs-negative-zero-fd", { "stdin.txt": "from stdin" });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `process.stdout.write(require("node:fs").readFileSync(-0))`],
        env: bunEnv,
        stdin: Bun.file(path.join(String(dir), "stdin.txt")),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ stdout, stderr, exitCode }, { stdout: "from stdin", stderr: "", exitCode: 0 });
    });

    // Bun keeps the file descriptor form of fs.truncate that Node.js v24 removed.
    // Its callback form has the parser of the other two forms.
    test("fs.truncate(fd, len, callback) checks len like fs.truncateSync(fd, len)", async () => {
      using dir = tempDir("fs-truncate-fd-callback", { "file.txt": "hello world" });
      const file = path.join(String(dir), "file.txt");
      const fd = fs.openSync(file, "r+");
      try {
        const truncate = (...args: unknown[]) => {
          const { promise, resolve, reject } = Promise.withResolvers<void>();
          (fs.truncate as Function)(fd, ...args, (err: Error | null) => (err ? reject(err) : resolve()));
          return promise;
        };
        await truncate(5);
        assert.strictEqual(fs.readFileSync(file, "utf8"), "hello");
        // A negative len is 0, down to the least safe integer.
        await truncate(-(2 ** 53) + 1);
        assert.strictEqual(fs.statSync(file).size, 0);

        fs.writeFileSync(file, "hello world");
        await truncate();
        assert.strictEqual(fs.statSync(file).size, 0);

        const outOfRange = (received: string) =>
          `RangeError [ERR_OUT_OF_RANGE]: The value of "len" is out of range. It must be >= -9007199254740991 && <= 9007199254740991. Received ${received}`;
        const notAnInteger = (received: string) =>
          `RangeError [ERR_OUT_OF_RANGE]: The value of "len" is out of range. It must be an integer. Received ${received}`;
        const notANumber = (received: string) =>
          `TypeError [ERR_INVALID_ARG_TYPE]: The "len" argument must be of type number. Received ${received}`;
        const refused: [len: unknown, error: string][] = [
          [2 ** 53, outOfRange("9_007_199_254_740_992")],
          [-(2 ** 53), outOfRange("-9_007_199_254_740_992")],
          [1.5, notAnInteger("1.5")],
          [NaN, notAnInteger("NaN")],
          ["5", notANumber("type string ('5')")],
          [null, notANumber("null")],
        ];
        const thrownBy = (call: () => unknown) => {
          try {
            call();
          } catch (e: any) {
            return `${e.name} [${e.code}]: ${e.message}`;
          }
          return "did not throw";
        };
        assert.deepStrictEqual(
          refused.map(([len]) => [len, thrownBy(() => fs.truncate(fd as any, len as any, noop))]),
          refused,
        );
        assert.deepStrictEqual(
          refused.map(([len]) => [len, thrownBy(() => fs.truncateSync(fd as any, len as any))]),
          refused,
        );
      } finally {
        fs.closeSync(fd);
      }
    });
  });

  // Before v24.0.0 fs.truncate and fs.truncateSync took every number for a file descriptor.
  const node = nodeExeAtLeast("24.0.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
