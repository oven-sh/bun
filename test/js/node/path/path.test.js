import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import assert from "node:assert";
import path from "node:path";

describe("path", () => {
  test("errors", () => {
    // Test thrown TypeErrors
    const typeErrorTests = [true, false, 7, null, {}, undefined, [], NaN];

    function fail(fn) {
      const args = Array.from(arguments).slice(1);

      assert.throws(
        () => {
          fn.apply(null, args);
        },
        { code: "ERR_INVALID_ARG_TYPE", name: "TypeError" },
      );
    }

    for (const test of typeErrorTests) {
      for (const namespace of [path.posix, path.win32]) {
        fail(namespace.join, test);
        fail(namespace.resolve, test);
        fail(namespace.normalize, test);
        fail(namespace.isAbsolute, test);
        fail(namespace.relative, test, "foo");
        fail(namespace.relative, "foo", test);
        fail(namespace.parse, test);
        fail(namespace.dirname, test);
        fail(namespace.basename, test);
        fail(namespace.extname, test);

        // Undefined is a valid value as the second argument to basename
        if (test !== undefined) {
          fail(namespace.basename, "foo", test);
        }
      }
    }
  });

  test("path.sep", () => {
    // path.sep tests
    // windows
    assert.strictEqual(path.win32.sep, "\\");
    // posix
    assert.strictEqual(path.posix.sep, "/");
  });

  test("path.delimiter", () => {
    // path.delimiter tests
    // windows
    assert.strictEqual(path.win32.delimiter, ";");
    // posix
    assert.strictEqual(path.posix.delimiter, ":");

    if (isWindows) assert.strictEqual(path, path.win32);
    else assert.strictEqual(path, path.posix);
  });

  // Node operates on JS strings (potentially ill-formed UTF-16) directly, so
  // unpaired surrogates must pass through every path function unchanged.
  describe.each([
    ["lone high surrogate", "\uD800"],
    ["lone low surrogate", "\uDC00"],
  ])("preserves unpaired surrogates (%s)", (_, lone) => {
    const loneExt = `.${lone}`;

    test("posix", () => {
      expect(path.posix.normalize(`/${lone}/./x`)).toBe(`/${lone}/x`);
      expect(path.posix.basename(`/a/${lone}`)).toBe(lone);
      expect(path.posix.basename(`/a/${lone}${loneExt}`, loneExt)).toBe(lone);
      // suffix coming from an 8-bit string while path is 16-bit
      expect(path.posix.basename(`/a/${lone}.txt`, ".txt")).toBe(lone);
      expect(path.posix.dirname(`/${lone}/x`)).toBe(`/${lone}`);
      expect(path.posix.extname(`/a/b${loneExt}`)).toBe(loneExt);
      expect(path.posix.join("a", lone, "b")).toBe(`a/${lone}/b`);
      expect(path.posix.resolve("/a", lone)).toBe(`/a/${lone}`);
      expect(path.posix.relative(`/${lone}/a`, `/${lone}/b`)).toBe("../b");
      expect(path.posix.relative(`/${lone}`, `/${lone}x`)).toBe(`../${lone}x`);
      expect(path.posix.format({ dir: `/${lone}`, base: "x" })).toBe(`/${lone}/x`);
      expect(path.posix.format({ root: "/", name: lone, ext: loneExt })).toBe(`/${lone}${loneExt}`);
      expect(path.posix.parse(`/${lone}/x${loneExt}`)).toEqual({
        root: "/",
        dir: `/${lone}`,
        base: `x${loneExt}`,
        ext: loneExt,
        name: "x",
      });
      expect(path.posix.isAbsolute(`/${lone}`)).toBe(true);
    });

    test("win32", () => {
      expect(path.win32.normalize(`C:\\${lone}\\.\\x`)).toBe(`C:\\${lone}\\x`);
      expect(path.win32.basename(`C:\\a\\${lone}`)).toBe(lone);
      expect(path.win32.basename(`C:\\a\\${lone}${loneExt}`, loneExt)).toBe(lone);
      expect(path.win32.dirname(`C:\\${lone}\\x`)).toBe(`C:\\${lone}`);
      expect(path.win32.extname(`C:\\a\\b${loneExt}`)).toBe(loneExt);
      expect(path.win32.join("a", lone, "b")).toBe(`a\\${lone}\\b`);
      expect(path.win32.resolve("C:\\a", lone)).toBe(`C:\\a\\${lone}`);
      expect(path.win32.relative(`C:\\${lone}\\a`, `C:\\${lone}\\b`)).toBe("..\\b");
      expect(path.win32.relative(`C:\\${lone}`, `C:\\${lone}x`)).toBe(`..\\${lone}x`);
      expect(path.win32.format({ dir: `C:\\${lone}`, base: "x" })).toBe(`C:\\${lone}\\x`);
      expect(path.win32.parse(`C:\\${lone}\\x${loneExt}`)).toEqual({
        root: "C:\\",
        dir: `C:\\${lone}`,
        base: `x${loneExt}`,
        ext: loneExt,
        name: "x",
      });
      expect(path.win32.toNamespacedPath(`C:\\${lone}\\x`)).toBe(`\\\\?\\C:\\${lone}\\x`);
    });
  });

  // path.format reads five properties; a Proxy/getter can allocate and GC
  // between reads. The field values must stay alive across all five lookups.
  test("format with Proxy getters returning fresh strings", () => {
    const vals = { root: "/", dir: "/\uD800", base: "x.y", name: "x", ext: ".y" };
    const pathObject = new Proxy(
      {},
      {
        get(_, key) {
          Bun.gc(true);
          // fresh, non-interned string not stored on the target
          return Buffer.alloc(1, "_").toString() + vals[key];
        },
      },
    );
    expect(path.posix.format(pathObject)).toBe("_/\uD800/_x.y");
    expect(path.win32.format({ ...vals, dir: "C:\\a" })).toBe("C:\\a\\x.y");
  });

  // Valid non-BMP code points (surrogate *pairs*) must also survive — they
  // share the 16-bit code path with the unpaired case.
  test("preserves surrogate pairs", () => {
    const pair = "\u{1F600}";
    expect(path.posix.normalize(`/${pair}/./x`)).toBe(`/${pair}/x`);
    expect(path.posix.basename(`/a/${pair}.txt`, ".txt")).toBe(pair);
    expect(path.posix.join("a", pair, "b")).toBe(`a/${pair}/b`);
    expect(path.win32.toNamespacedPath(`C:\\${pair}\\x`)).toBe(`\\\\?\\C:\\${pair}\\x`);
  });
});

test.if(isWindows)("Bun.which skips PATH segments longer than the Windows wide-path buffer", async () => {
  // A single PATH segment longer than the fixed 32767-element wide-character
  // path buffer must be skipped instead of being transcoded into it, and the
  // remaining segments must still be searched. Run in a subprocess so the
  // assertion is on the child's output and exit code.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const path = require("node:path");
const dir = path.dirname(process.execPath);
const name = path.basename(process.execPath, ".exe");
const oversized = Buffer.alloc(70000, "a").toString();
console.log(Bun.which(name, { PATH: oversized }));
const found = Bun.which(name, { PATH: oversized + ";" + dir });
console.log(found !== null && path.basename(found).toLowerCase() === (name + ".exe").toLowerCase());`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  assert.strictEqual(stdout.split(/\r?\n/).filter(Boolean).join("\n"), "null\ntrue");
  assert.strictEqual(exitCode, 0);
});
