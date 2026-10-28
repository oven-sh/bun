import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows } from "harness";
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
});

test("String-object arguments whose toPrimitive triggers GC do not corrupt earlier arguments", async () => {
  // Converting argument N+1 runs user JS that GCs; the string produced for
  // argument N must still be intact when the native side reads it.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const path = require("node:path");
const long = "/dir/" + Buffer.alloc(16000, "seg_").toString();
const first = () => Object.assign(new String("x"), {
  [Symbol.toPrimitive]() { return long.slice(1).padStart(long.length, "/"); },
});
const second = value => Object.assign(new String("y"), {
  [Symbol.toPrimitive]() {
    Bun.gc(true);
    const keep = [];
    for (let i = 0; i < 200; i++) keep.push(Buffer.alloc(50000 + i, "Q").toString());
    globalThis.keep = keep;
    Bun.gc(true);
    return value;
  },
});
const results = [];
for (const ns of ["posix", "win32"]) {
  const p = path[ns];
  const cases = {
    join: () => [p.join(first(), second("tail")), p.join(long, "tail")],
    resolve: () => [p.resolve(first(), second("tail")), p.resolve(long, "tail")],
    relative: () => [p.relative(first(), second(long + "/x")), p.relative(long, long + "/x")],
    basename: () => [p.basename(first(), second("_")), p.basename(long, "_")],
  };
  for (const [name, fn] of Object.entries(cases)) {
    for (let r = 0; r < 3; r++) {
      const [got, want] = fn();
      results.push(ns + "." + name + "[" + r + "]=" + (got === want ? "OK" : "MISMATCH"));
    }
  }
}
console.log(results.join("\\n"));`,
    ],
    // Malloc=1 lets ASan builds see the freed JSC string; bmalloc has no SystemHeap on Windows.
    env: isWindows ? bunEnv : { ...bunEnv, Malloc: "1", ASAN_OPTIONS: "detect_leaks=0" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const expected = [];
  for (const ns of ["posix", "win32"])
    for (const name of ["join", "resolve", "relative", "basename"])
      for (let r = 0; r < 3; r++) expected.push(`${ns}.${name}[${r}]=OK`);
  expect({ lines: stdout.trim().split("\n"), stderr }).toEqual({ lines: expected, stderr: "" });
  expect(exitCode).toBe(0);
});

describe("functions with a fixed number of operands, called with 65536 or more arguments", () => {
  const surplus = new Array(65535).fill("");
  const expected = {
    posix: {
      basename: "b.txt",
      dirname: "/a",
      extname: ".txt",
      isAbsolute: true,
      normalize: "/b",
      parse: { root: "/", dir: "/a", base: "b.txt", ext: ".txt", name: "b" },
      format: "/a/b.txt",
      toNamespacedPath: "C:\\a\\b",
      basenameWithExt: "b",
      relative: "../c",
    },
    win32: {
      basename: "b.txt",
      dirname: "/a",
      extname: ".txt",
      isAbsolute: true,
      normalize: "\\b",
      parse: { root: "/", dir: "/a", base: "b.txt", ext: ".txt", name: "b" },
      format: "/a\\b.txt",
      toNamespacedPath: "\\\\?\\C:\\a\\b",
      basenameWithExt: "b",
      relative: "..\\c",
    },
  };
  for (const ns of ["posix", "win32"]) {
    test(ns, () => {
      const p = path[ns];
      expect({
        // 65536 arguments
        basename: p.basename("/a/b.txt", ...surplus),
        dirname: p.dirname("/a/b", ...surplus),
        extname: p.extname("/a/b.txt", ...surplus),
        isAbsolute: p.isAbsolute("/a", ...surplus),
        normalize: p.normalize("/a/../b", ...surplus),
        parse: p.parse("/a/b.txt", ...surplus),
        format: p.format({ dir: "/a", base: "b.txt" }, ...surplus),
        toNamespacedPath: p.toNamespacedPath("C:\\a\\b", ...surplus),
        // 65537 arguments
        basenameWithExt: p.basename("/a/b.txt", ".txt", ...surplus),
        relative: p.relative("/a/b", "/a/c", ...surplus),
      }).toEqual(expected[ns]);
    });
  }
});

// join() and resolve() copy their arguments when one is a String object. `BUN_JSC_maxSingleAllocationSize` makes a WTF
// allocation above the cap fail. It exists in debug builds only.
test.skipIf(!isDebug)("a call throws when the copy of its arguments cannot be allocated", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const path = require("node:path");
const rest = new Array(40000).fill("b");
const underTheCap = rest.slice(0, 20000);
const outcome = fn => {
  try {
    return fn();
  } catch (e) {
    return e.name + ": " + e.message;
  }
};
const length = string => "returned a string of length " + string.length;
const results = {};
for (const ns of ["posix", "win32"]) {
  for (const fn of ["join", "resolve"]) {
    results[ns + "." + fn] = outcome(() => length(path[ns][fn](new String("a"), ...rest)));
  }
  // Under the cap, so the copy is made.
  results[ns + ".join, 20001 arguments, is the joined path"] = outcome(
    () => path[ns].join(new String("a"), ...underTheCap) === ["a", ...underTheCap].join(path[ns].sep),
  );
}
// The copy fails before the last argument, so that argument is not converted.
let conversions = 0;
const last = Object.assign(new String("c"), {
  [Symbol.toPrimitive]() {
    conversions++;
    return "c";
  },
});
results["join, a String object last"] = outcome(() => length(path.posix.join(new String("a"), ...rest, last)));
results.conversions = conversions;
console.log(JSON.stringify(results));`,
    ],
    env: { ...bunEnv, BUN_JSC_maxSingleAllocationSize: "400000" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const outOfMemory = "RangeError: Out of memory";
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({
      "posix.join": outOfMemory,
      "posix.resolve": outOfMemory,
      "posix.join, 20001 arguments, is the joined path": true,
      "win32.join": outOfMemory,
      "win32.resolve": outOfMemory,
      "win32.join, 20001 arguments, is the joined path": true,
      "join, a String object last": outOfMemory,
      conversions: 0,
    }),
    stderr: "",
    exitCode: 0,
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
