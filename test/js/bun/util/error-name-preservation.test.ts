// Verifies that user-visible error names, codes, and messages from the
// native error paths are preserved across the per-crate Error enum refactor.
// These pin the exact strings the runtime hands to JS; any drift in a
// crate's `Error::name()` / `#[error("...")]` / errno routing surfaces here.

import { Database, SQLiteError } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { isPosix, tempDir } from "harness";
import { closeSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("native error name/code preservation", () => {
  test("fs ENOENT code and syscall survive the errno path", () => {
    let err: any;
    try {
      readFileSync("/this/path/definitely/does/not/exist/anywhere");
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect({ code: err.code, syscall: err.syscall, path: err.path }).toEqual({
      code: "ENOENT",
      syscall: "open",
      path: "/this/path/definitely/does/not/exist/anywhere",
    });
  });

  test("fs ENOTDIR code survives the errno path", () => {
    using dir = tempDir("err-name", { "file.txt": "x" });
    let err: any;
    try {
      readdirSync(`${dir}/file.txt`);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe("ENOTDIR");
  });

  test("fetch connection-refused message is preserved verbatim", async () => {
    // 1 is never listening; IPv4 literal so this is a pure connect error
    // on every platform without touching DNS.
    let err: any;
    try {
      await fetch("http://127.0.0.1:1/");
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    // The exact message string from the fetch error match arm (was a
    // ~40-arm `e if e == err!(X)` guard chain, now a real match).
    expect({ code: err.code, message: String(err.message) }).toEqual({
      code: "ECONNREFUSED",
      message: "ECONNREFUSED: Unable to connect. Is the computer able to access the url?",
    });
  });
});

// The native function that builds the system errors of node:fs also builds
// the errors of Bun.file, Bun.write, Bun.spawn and fetch. Their own properties
// are configurable, like the node:* ones checked in
// test/js/node/errors/system-error-configurable.test.ts, and so are those of
// SQLiteError and S3Error.
describe("own properties of a native error are configurable", () => {
  const systemErrorKeys = ["code", "path", "dest", "fd", "syscall", "hostname", "errno"];

  function thrownBy(fn: () => unknown): any {
    try {
      fn();
    } catch (e) {
      return e;
    }
  }

  const descriptorsOf = (object: object, keys: string[]) =>
    Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(object, key)]));
  const notDeleted = (object: object, keys: string[]) =>
    keys.filter(key => !Reflect.deleteProperty(object, key) || Object.hasOwn(object, key));

  // [label, the keys this case is here to cover besides code and errno, how to get the error]
  const cases: [string, string[], (missing: string) => unknown][] = [
    // Node has no `fd` on this error.
    ["fs.closeSync", isPosix ? ["fd"] : [], () => thrownBy(() => closeSync(1 << 20))],
    [
      "Bun.file().text()",
      ["path"],
      missing =>
        Bun.file(missing)
          .text()
          .catch(e => e),
    ],
    ["Bun.write", ["path"], missing => Bun.write(join(missing, "a", "b"), "x", { createPath: false }).catch(e => e)],
    ["Bun.spawn", [], missing => thrownBy(() => Bun.spawn([missing]))],
    ["fetch", [], () => fetch("http://127.0.0.1:1/").catch(e => e)],
  ];

  test.each(cases)("%s", async (_label, covers, produce) => {
    using dir = tempDir("err-props", {});
    const err: any = await produce(join(String(dir), "missing"));
    expect(err).toBeInstanceOf(Error);

    const keys = systemErrorKeys.filter(key => Object.hasOwn(err, key));
    expect(keys).toEqual(expect.arrayContaining(["code", "errno", ...covers]));
    expect(descriptorsOf(err, keys)).toEqual(
      Object.fromEntries(
        keys.map(key => [key, { value: err[key], writable: true, enumerable: true, configurable: true }]),
      ),
    );
    expect(notDeleted(err, keys)).toEqual([]);
  });

  test("SQLiteError code, errno and byteOffset stay read-only and can be deleted", () => {
    using db = new Database(":memory:");
    const err = thrownBy(() => db.run("selecx 1"));
    expect(err).toBeInstanceOf(SQLiteError);

    const keys = ["code", "errno", "byteOffset"];
    expect(descriptorsOf(err, keys)).toEqual(
      Object.fromEntries(
        keys.map(key => [key, { value: err[key], writable: false, enumerable: true, configurable: true }]),
      ),
    );
    expect(notDeleted(err, keys)).toEqual([]);
  });

  test("S3Error code and path can be deleted", async () => {
    const options = { accessKeyId: "test", secretAccessKey: "test", endpoint: "http://127.0.0.1:1" };
    // The source has no bucket. With one from the environment, nothing listens on port 1.
    const err: any = await Bun.write(
      Bun.s3.file("to.txt", { ...options, bucket: "bucket" }),
      Bun.s3.file("from.txt", options),
    ).catch(e => e);
    expect({ name: err?.name, path: err?.path }).toEqual({ name: "S3Error", path: "from.txt" });

    const keys = ["code", "path"];
    expect(keys.filter(key => !Object.getOwnPropertyDescriptor(err, key)?.configurable)).toEqual([]);
    expect(notDeleted(err, keys)).toEqual([]);
  });
});
