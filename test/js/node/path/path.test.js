import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

// Inputs longer than the native implementation's on-stack scratch space.
describe("path long inputs", () => {
  const segment = "/segment_name";
  const long = Buffer.alloc(segment.length * 400, segment).toString(); // 5200 characters
  const longWin = long.replaceAll("/", "\\");

  test("posix", () => {
    expect(path.posix.normalize(long + "/./x/../")).toBe(long + "/");
    expect(path.posix.join(long, "..", "y")).toBe(long.slice(0, -segment.length) + "/y");
    expect(path.posix.resolve(long, "a/../b")).toBe(long + "/b");
    expect(path.posix.relative(long, long + "/child/leaf")).toBe("child/leaf");
    expect(path.posix.relative(long + "/a", long + "/b")).toBe("../b");
    expect(path.posix.dirname(long)).toBe(long.slice(0, -segment.length));
    expect(path.posix.basename(long + "/file.txt", ".txt")).toBe("file");
    expect(path.posix.parse(long + "/file.txt")).toEqual({
      root: "/",
      dir: long,
      base: "file.txt",
      ext: ".txt",
      name: "file",
    });
    // UTF-16 variant
    const wide = long + "/日本語";
    expect(path.posix.normalize(wide + "/./")).toBe(wide + "/");
    expect(path.posix.join(wide, "ファイル.txt")).toBe(wide + "/ファイル.txt");
  });

  test("win32", () => {
    expect(path.win32.normalize("C:" + long + "/./x/../")).toBe("C:" + longWin + "\\");
    expect(path.win32.join("C:\\", long, "..", "y")).toBe("C:" + longWin.slice(0, -segment.length) + "\\y");
    expect(path.win32.resolve("C:" + long, "a/../b")).toBe("C:" + longWin + "\\b");
    expect(path.win32.relative("C:" + long, "C:" + long + "/child/leaf")).toBe("child\\leaf");
    expect(path.win32.relative("C:" + longWin + "\\İ", "C:" + longWin + "\\İ\\x")).toBe("x");
    expect(path.win32.toNamespacedPath("C:" + long)).toBe("\\\\?\\C:" + longWin);
    expect(path.win32.toNamespacedPath("\\\\server\\share" + longWin)).toBe("\\\\?\\UNC\\server\\share" + longWin);
    expect(path.win32.dirname("C:" + longWin)).toBe("C:" + longWin.slice(0, -segment.length));
    expect(path.win32.parse("C:" + longWin + "\\file.txt")).toEqual({
      root: "C:\\",
      dir: "C:" + longWin,
      base: "file.txt",
      ext: ".txt",
      name: "file",
    });
  });

  test("many arguments", () => {
    const parts = Array.from({ length: 40 }, (_, i) => `p${i}`);
    expect(path.posix.join(...parts)).toBe(parts.join("/"));
    expect(path.win32.join(...parts)).toBe(parts.join("\\"));
    expect(path.posix.resolve("/root", ...parts)).toBe("/root/" + parts.join("/"));
    expect(path.win32.resolve("C:\\root", ...parts)).toBe("C:\\root\\" + parts.join("\\"));
    // Validation happens from the last argument backwards and stops at the first absolute path.
    expect(path.posix.resolve(1, "/abs", "x")).toBe("/abs/x");
    expect(() => path.posix.resolve("/abs", 1, "x")).toThrow('The "paths[1]" argument must be of type string');
    expect(path.win32.resolve(1, "C:\\abs", "x")).toBe("C:\\abs\\x");
    expect(() => path.win32.resolve(1, "\\abs", "x")).toThrow('The "paths[0]" argument must be of type string');
  });

  // The limit is lowered (its floor is 1 MiB) so that the inputs stay small. It applies to
  // the strings the implementation builds, not to inputs it slices or hands back unchanged.
  // The assertions run after the limit is restored so that a failure can be rendered.
  test("results past the string length limit throw ERR_STRING_TOO_LONG", () => {
    const limit = 2 * 1024 * 1024;
    const root = "/c/" + Buffer.alloc(limit - 6, "a").toString(); // limit - 3 characters
    const over = root + "/bcd"; // limit + 1 characters
    const outcome = fn => {
      let result;
      try {
        result = fn();
      } catch (e) {
        return `${e.code}: ${e.message}`;
      }
      if (result === root) return "equal to root";
      if (result === over) return "equal to over";
      return result.length > 100 ? `some other string of ${result.length} characters` : result;
    };
    const results = {};
    const previousLimit = setSyntheticAllocationLimitForTesting(limit);
    try {
      for (const name of ["posix", "win32"]) {
        const ns = path[name];
        results[name] = {
          join: outcome(() => ns.join(root, "bcd")),
          resolve: outcome(() => ns.resolve(root, "bcd")),
          relative: outcome(() => ns.relative("/c/x/y/z", root)), // "../../.." followed by the a's
          normalize: outcome(() => ns.normalize(over)),
          dirname: outcome(() => ns.dirname(over)),
          basename: outcome(() => ns.basename(over)),
        };
      }
    } finally {
      setSyntheticAllocationLimitForTesting(previousLimit);
    }
    const tooLong = `ERR_STRING_TOO_LONG: Cannot create a string longer than ${limit} characters`;
    expect(results).toEqual({
      posix: {
        join: tooLong,
        resolve: tooLong,
        relative: tooLong,
        normalize: "equal to over",
        dirname: "equal to root",
        basename: "bcd",
      },
      win32: {
        join: tooLong,
        resolve: tooLong,
        relative: tooLong,
        normalize: tooLong, // the separators change, so a new string is needed
        dirname: "equal to root",
        basename: "bcd",
      },
    });
  });
});

// `String` objects are not strings for validateString().
test("String objects are rejected like any other non-string", () => {
  class MyString extends String {}
  for (const ns of [path.posix, path.win32]) {
    for (const value of [new String("/a/b.js"), new MyString("/a/b.js")]) {
      for (const fn of [
        "resolve",
        "normalize",
        "isAbsolute",
        "join",
        "relative",
        "dirname",
        "basename",
        "extname",
        "parse",
      ]) {
        expect(() => ns[fn](value, "x"), fn).toThrow(
          expect.objectContaining({
            code: "ERR_INVALID_ARG_TYPE",
            message: expect.stringContaining("Received an instance of "),
          }),
        );
      }
      expect(() => ns.basename("x", value)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
      // Non-strings pass through toNamespacedPath() untouched.
      expect(ns.toNamespacedPath(value)).toBe(value);
    }
  }
});

test("matchesGlob compiles patterns per platform", () => {
  // Same pattern string, different glob: `\\` is a separator for win32 only, so a
  // matcher cached by the posix call must not be reused by the win32 one.
  expect(path.posix.matchesGlob("dir\\a.js", "dir\\a.js")).toBe(false);
  expect(path.win32.matchesGlob("dir\\a.js", "dir\\a.js")).toBe(true);
});

// lib/path.js calls process.cwd(), so replacing it (e.g. with a test double) is
// observable through resolve()/relative().
test("path.resolve() and path.relative() use an overridden process.cwd()", () => {
  const originalCwd = process.cwd;
  try {
    const fake = process.platform === "win32" ? "C:\\fake\\dir" : "/fake/dir";
    process.cwd = () => fake;
    expect(path.resolve("x")).toBe(path.join(fake, "x"));
    expect(path.resolve()).toBe(fake);
    expect(path.relative("x/y", "x")).toBe("..");
    expect(path.posix.resolve("a")).toBe(path.posix.join(process.platform === "win32" ? "/fake/dir" : fake, "a"));
    // Handling of relative paths stays safe when process.cwd() fails.
    process.cwd = () => "";
    expect(path.posix.resolve()).toBe(".");
    expect(path.posix.resolve("a/..", "b")).toBe("b");
    expect(path.win32.resolve("a", "..")).toBe(".");
  } finally {
    process.cwd = originalCwd;
  }
  expect(path.resolve()).toBe(process.cwd());
});

describe("path module shape", () => {
  test("matches Node.js", () => {
    const keys = [
      "resolve",
      "normalize",
      "isAbsolute",
      "join",
      "relative",
      "toNamespacedPath",
      "dirname",
      "basename",
      "extname",
      "format",
      "parse",
      "matchesGlob",
      "sep",
      "delimiter",
      "win32",
      "posix",
      "_makeLong",
    ];
    expect(Object.keys(path.posix)).toEqual(keys);
    expect(Object.keys(path.win32)).toEqual(keys);
    for (const ns of [path.posix, path.win32]) {
      for (const key of keys.slice(0, 12)) {
        expect(typeof ns[key]).toBe("function");
        expect(ns[key].name).toBe(key === "format" ? "bound _format" : key);
      }
      expect(ns._makeLong).toBe(ns.toNamespacedPath);
    }
    expect(path.posix.resolve.length).toBe(0);
    expect(path.posix.join.length).toBe(0);
    expect(path.posix.relative.length).toBe(2);
    expect(path.posix.basename.length).toBe(2);
    expect(path.posix.format.length).toBe(1);
    expect(path.posix.matchesGlob.length).toBe(2);
    // Functions do not depend on `this`.
    const { join, basename } = path.win32;
    expect(join("a", "b")).toBe("a\\b");
    expect(basename("C:\\x\\y.z", ".z")).toBe("y");
  });
});

// process.chdir() on the main thread must invalidate a Worker's cached cwd
// (Node's does_own_process_state.js / worker_thread.js `cwdCounter`).
test.concurrent("path.resolve() and process.cwd() in a Worker follow the main thread's process.chdir()", async () => {
  using dir = tempDir("path-worker-cwd", { "sub/.keep": "" });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Worker } = require("worker_threads");
const path = require("path");
const w = new Worker(
  'const { parentPort } = require("worker_threads"); const path = require("path");' +
    'parentPort.on("message", () => parentPort.postMessage([path.basename(path.resolve("x", "..")), path.basename(process.cwd())]));',
  { eval: true },
);
let step = 0;
w.on("message", ([resolved, cwd]) => {
  console.log(resolved + " " + cwd);
  if (step++ === 0) {
    process.chdir("sub");
    w.postMessage(0);
  } else {
    w.terminate();
  }
});
w.postMessage(0);`,
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = stdout.trim().split(/\r?\n/);
  expect(lines[0].split(" ")[0]).toBe(lines[0].split(" ")[1]); // before: resolve agrees with cwd
  expect({ after: lines[1], stderr, exitCode }).toEqual({ after: "sub sub", stderr: "", exitCode: 0 });
});
