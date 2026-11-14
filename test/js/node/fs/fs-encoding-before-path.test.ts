/**
 * readFile, writeFile, appendFile, readdir, readlink, realpath, mkdtemp and
 * watch read their options before they check the path. With an invalid path
 * and an invalid encoding, Bun reported the path. Node runs getOptions(), which
 * asserts the encoding, before getValidatedPath(), so it reports the encoding:
 * https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/utils.js#L407-L428 (getOptions)
 * https://github.com/nodejs/node/blob/v26.12.1/lib/fs.js#L2250-L2251 (readlinkSync)
 * https://github.com/nodejs/node/blob/v26.12.1/lib/fs.js#L3155-L3166 (watch)
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from. It cannot
 * import from "harness" for the same reason.
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const anyFs = fs as any;
const noop = () => {};

const encodingError = { code: "ERR_INVALID_ARG_VALUE", name: "TypeError", namesTheEncoding: true };
const describeError = (err: any) => ({
  code: err.code,
  name: err.name,
  // A NUL byte in the path is ERR_INVALID_ARG_VALUE too. Only the message tells them apart.
  namesTheEncoding: String(err.message).includes("encoding"),
});

const throwing: Record<string, (path: any, options: any) => unknown> = {
  "readFileSync": (p, o) => fs.readFileSync(p, o),
  "writeFileSync": (p, o) => fs.writeFileSync(p, "x", o),
  "appendFileSync": (p, o) => fs.appendFileSync(p, "x", o),
  "readdirSync": (p, o) => fs.readdirSync(p, o),
  "readlinkSync": (p, o) => fs.readlinkSync(p, o),
  "realpathSync": (p, o) => fs.realpathSync(p, o),
  "realpathSync.native": (p, o) => fs.realpathSync.native(p, o),
  "mkdtempSync": (p, o) => fs.mkdtempSync(p, o),
  "mkdtempDisposableSync": (p, o) => anyFs.mkdtempDisposableSync(p, o),
  "watch": (p, o) => fs.watch(p, o, noop).close(),
  // The callback forms throw an argument error. They do not pass it to the callback.
  "readFile": (p, o) => fs.readFile(p, o, noop),
  "writeFile": (p, o) => fs.writeFile(p, "x", o, noop),
  "appendFile": (p, o) => fs.appendFile(p, "x", o, noop),
  "readdir": (p, o) => fs.readdir(p, o, noop),
  "readlink": (p, o) => fs.readlink(p, o, noop),
  "realpath": (p, o) => fs.realpath(p, o, noop),
  "realpath.native": (p, o) => fs.realpath.native(p, o, noop),
  "mkdtemp": (p, o) => fs.mkdtemp(p, o, noop),
};
const rejecting: Record<string, (path: any, options: any) => Promise<unknown>> = {
  "promises.readFile": (p, o) => fs.promises.readFile(p, o),
  "promises.writeFile": (p, o) => fs.promises.writeFile(p, "x", o),
  "promises.appendFile": (p, o) => fs.promises.appendFile(p, "x", o),
  "promises.readdir": (p, o) => fs.promises.readdir(p, o),
  "promises.readlink": (p, o) => fs.promises.readlink(p, o),
  "promises.realpath": (p, o) => fs.promises.realpath(p, o),
  "promises.mkdtemp": (p, o) => fs.promises.mkdtemp(p, o),
  "promises.mkdtempDisposable": (p, o) => anyFs.promises.mkdtempDisposable(p, o),
};
const everyCall = [...Object.keys(throwing), ...Object.keys(rejecting)];

// What a call throws, or what its promise rejects with.
async function outcomeOf(name: string, path: any, options: any, summarize: (err: any) => unknown) {
  if (name in rejecting) return rejecting[name](path, options).then(() => "did not reject", summarize);
  try {
    throwing[name](path, options);
    return "did not throw";
  } catch (err) {
    return summarize(err);
  }
}

describe("an invalid encoding is reported before an invalid path", () => {
  let dir: string;
  let file: string;
  let entries: string;
  let closedFileHandle: fs.promises.FileHandle;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-encoding-before-path-"));
    file = path.join(dir, "file.txt");
    fs.writeFileSync(file, "6869");
    entries = path.join(dir, "entries");
    fs.mkdirSync(entries);
    fs.writeFileSync(path.join(entries, "entry.txt"), "");
    closedFileHandle = await fs.promises.open(file, "r");
    await closedFileHandle.close();
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const invalidPaths = (): [label: string, path: any][] => [
    ["bigint", 123n],
    ["object", {}],
    ["null", null],
    ["undefined", undefined],
    ["boolean", true],
    ["symbol", Symbol("path")],
    ["string with a NUL byte", "a\0b"],
    ["String object with a NUL byte", new String("a\0b")],
    ["http: URL", new URL("http://example.com/x")],
    ["file: URL with a host", new URL("file://host/x")],
    ["file: URL with an encoded NUL byte", new URL("file:///tmp/a%00b")],
    ["file: URL with an encoded slash", new URL("file:///tmp/a%2Fb")],
    ["file: URL whose path is not UTF-8", new URL("file:///tmp/%FF")],
    ["empty Buffer", Buffer.alloc(0)],
    ["Buffer with a NUL byte", Buffer.from("a\0b")],
    ["string longer than any path", Buffer.alloc(200000, "a").toString()],
    ["Buffer longer than any path", Buffer.alloc(200000, "a")],
    ["negative number", -1],
    ["fraction", 1.5],
    ["number above int32", 2 ** 31],
    ["closed FileHandle", closedFileHandle],
  ];
  const invalidOptions: [label: string, options: any][] = [
    ["'bogus'", "bogus"],
    ["{ encoding: 'bogus' }", { encoding: "bogus" }],
  ];

  for (const name of everyCall) {
    test(name, async () => {
      const actual: Record<string, unknown> = {};
      const expected: Record<string, unknown> = {};
      for (const [pathLabel, invalidPath] of invalidPaths()) {
        for (const [optionsLabel, options] of invalidOptions) {
          const label = `${pathLabel}, ${optionsLabel}`;
          expected[label] = encodingError;
          actual[label] = await outcomeOf(name, invalidPath, options, describeError);
        }
      }
      assert.deepStrictEqual(actual, expected);
    });
  }

  // fs.watch validates more options than the other calls. Node reports the
  // encoding before each of them too, with a valid path or an invalid one.
  test("watch, with a second invalid option", () => {
    const otherOptions = { persistent: 1, recursive: 1, verbose: 1, signal: 1, ignore: 5 };
    const actual: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const [pathLabel, watched] of [
      ["valid path", dir],
      ["bigint", 123n],
    ] as [string, any][]) {
      for (const [name, value] of Object.entries(otherOptions)) {
        const label = `${pathLabel}, { encoding: 'bogus', ${name}: ${value} }`;
        expected[label] = encodingError;
        try {
          fs.watch(watched, { encoding: "bogus", [name]: value } as any, noop).close();
          actual[label] = "did not throw";
        } catch (err) {
          actual[label] = describeError(err);
        }
      }
    }
    assert.deepStrictEqual(actual, expected);
  });

  // fs.watch converts a "file:" string to a path. This one has a host, which POSIX refuses.
  test("watch, with a 'file:' string", async () => {
    const actual: unknown[] = [];
    for (const [, options] of invalidOptions)
      actual.push(await outcomeOf("watch", "file://host/x", options, describeError));
    assert.deepStrictEqual(actual, [encodingError, encodingError]);
  });

  // A listener in the options slot means the defaults: nothing is read from it or for it.
  test("watch, with a listener in the options slot", () => {
    const inherited = Object.getOwnPropertyDescriptor(Object.prototype, "encoding");
    Object.defineProperty(Object.prototype, "encoding", { value: "bogus", configurable: true, writable: true });
    let validPath: unknown;
    let invalidPath: unknown;
    try {
      try {
        fs.watch(dir, noop).close();
        validPath = "did not throw";
      } catch (err) {
        validPath = describeError(err);
      }
      try {
        fs.watch(123n as any, noop).close();
        invalidPath = "did not throw";
      } catch (err) {
        invalidPath = describeError(err);
      }
    } finally {
      if (inherited) Object.defineProperty(Object.prototype, "encoding", inherited);
      else delete (Object.prototype as any).encoding;
    }
    assert.deepStrictEqual(
      { validPath, invalidPath },
      {
        validPath: "did not throw",
        invalidPath: { code: "ERR_INVALID_ARG_TYPE", name: "TypeError", namesTheEncoding: false },
      },
    );
  });

  test("an error from the encoding getter is reported before an invalid path", async () => {
    const actual: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const name of everyCall) {
      const options = {
        get encoding() {
          throw new RangeError("from the encoding getter");
        },
      };
      expected[name] = "from the encoding getter";
      actual[name] = await outcomeOf(name, 123n, options, err => err.message);
    }
    assert.deepStrictEqual(actual, expected);
  });

  // The type error for a prefix describes the value, which reads its `constructor`.
  test("a refused prefix is not inspected when the encoding is invalid", async () => {
    const actual: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const name of everyCall.filter(name => name.includes("mkdtemp"))) {
      let inspected = 0;
      const prefix = {
        get constructor() {
          inspected++;
          return Object;
        },
      };
      expected[name] = { error: encodingError, inspected: 0 };
      actual[name] = { error: await outcomeOf(name, prefix, "bogus", describeError), inspected };
    }
    assert.deepStrictEqual(actual, expected);
  });

  // getOptions() takes an encoding name from a primitive string only. A String
  // object is an options object, and a function means the defaults.
  describe("a value that is not an encoding name", () => {
    const notEncodingNames: [label: string, make: (name: string) => any][] = [
      ["String object", name => new String(name)],
      ["function", name => Object.assign(() => {}, { encoding: name })],
    ];

    test("leaves the path error in place", async () => {
      const pathError = { code: "ERR_INVALID_ARG_VALUE", name: "TypeError", namesTheEncoding: false };
      const actual: Record<string, unknown> = {};
      const expected: Record<string, unknown> = {};
      for (const [optionsLabel, make] of notEncodingNames) {
        for (const name of everyCall) {
          const label = `${name}, ${optionsLabel}`;
          expected[label] = pathError;
          actual[label] = await outcomeOf(name, "a\0b", make("bogus"), describeError);
        }
      }
      assert.deepStrictEqual(actual, expected);
    });

    test("does not select an encoding", async () => {
      const kind = (value: unknown) => (Buffer.isBuffer(value) ? "Buffer" : typeof value);
      const written = (options: any) => {
        const target = path.join(dir, "written.txt");
        fs.writeFileSync(target, "6869", options);
        return fs.readFileSync(target, "latin1");
      };
      const actual: Record<string, unknown> = {};
      const expected: Record<string, unknown> = {};
      for (const [label, make] of notEncodingNames) {
        expected[label] = {
          readFileSync: "Buffer",
          "promises.readFile": "Buffer",
          readdirSync: ["string"],
          "promises.readdir": ["string"],
          "realpathSync.native": "string",
          writeFileSync: "6869",
        };
        actual[label] = {
          readFileSync: kind(fs.readFileSync(file, make("utf8"))),
          "promises.readFile": kind(await fs.promises.readFile(file, make("utf8"))),
          readdirSync: fs.readdirSync(entries, make("buffer")).map(kind),
          "promises.readdir": (await fs.promises.readdir(entries, make("buffer"))).map(kind),
          "realpathSync.native": kind(fs.realpathSync.native(file, make("buffer"))),
          writeFileSync: written(make("hex")),
        };
      }
      assert.deepStrictEqual(actual, expected);
    });

    test("a callback is not read as an options object", async () => {
      const target = path.join(dir, "callback.txt");
      fs.writeFileSync(target, "hello");
      const reads: string[] = [];
      const watched = <T extends Function>(callback: T): T => {
        for (const key of ["encoding", "flag", "mode", "signal", "flush"]) {
          Object.defineProperty(callback, key, { get: () => void reads.push(key) });
        }
        return callback;
      };

      const read = Promise.withResolvers<unknown>();
      fs.readFile(
        target,
        watched((err: Error | null, data: unknown) => (err ? read.reject(err) : read.resolve(data))),
      );
      assert.strictEqual(Buffer.isBuffer(await read.promise), true);

      const write = Promise.withResolvers<void>();
      fs.writeFile(
        target,
        "written",
        watched((err: Error | null) => (err ? write.reject(err) : write.resolve())),
      );
      await write.promise;
      assert.strictEqual(fs.readFileSync(target, "utf8"), "written");

      assert.deepStrictEqual(reads, []);
    });
  });

  // opendir is the exception: Node validates the path first there.
  // https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/dir.js#L378-L379
  test.todo("opendirSync reports an invalid path before an invalid encoding", () => {
    assert.throws(() => fs.opendirSync(123n as any, "bogus" as any), { code: "ERR_INVALID_ARG_TYPE" });
  });
});
