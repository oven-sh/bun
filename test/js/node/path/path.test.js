import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import assert from "node:assert";
import { readFileSync } from "node:fs";
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

// Each line has the platform, the function, its arguments and what Node.js v26.12.1 answers.
const answersOfNode = readFileSync(path.join(import.meta.dir, "fixtures", "answers-of-node.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map(line => JSON.parse(line));

test.each(
  Object.entries({
    "as narrow as it can be": text => (/[^\0-\xff]/.test(text) ? text : Buffer.from(text, "latin1").toString("latin1")),
    "in 16 bits": text => ("\u65e5" + text).slice(1),
    "a rope": text => text.slice(0, text.length >> 1) + text.slice(text.length >> 1),
    "behind a long name": text => text,
  }),
)("answers what Node.js answers, each operand %s", (kind, form) => {
  const { cwd, env } = process;
  const different = [];
  const long = Buffer.alloc(600, "n").toString();
  try {
    process.env = { "=D:": "D:\\work", "=d:": "d:\\work", "=Z:": "Y:\\elsewhere" };
    for (let [platform, name, operands, expected] of answersOfNode) {
      process.cwd = () => (platform === "posix" ? "/home/me" : "C:\\Users\\me");
      if (kind === "behind a long name") {
        // "foo" means nothing, so a name that no short buffer holds does in its place.
        if (name === "basename" && operands.length > 1) continue;
        const longer = text => (typeof text === "string" ? text.replace(/foo/gi, found => found + long) : text);
        operands = operands.map(longer);
        expected = Array.isArray(expected) ? expected.map(longer) : longer(expected);
      }
      let answer = path[platform][name](...operands.map(form));
      if (name === "parse") answer = [answer.root, answer.dir, answer.base, answer.ext, answer.name];
      if (!Bun.deepEquals(answer, expected)) different.push({ platform, name, operands, expected, answer });
    }
  } finally {
    Object.assign(process, { cwd, env });
  }
  expect(different).toEqual([]);
});

describe.each(["posix", "win32"])("path.%s calls what a script has replaced", platform => {
  const p = path[platform];
  const { join, relative, resolve, toNamespacedPath } = p;
  const root = platform === "posix" ? "/" : "C:\\";

  /** What `run` answers, and what it has read and called of `process.cwd`, `normalize` and `resolve`. */
  function observe(run, replaced = {}) {
    const log = [];
    const restore = [
      [process, "cwd"],
      [p, "normalize"],
      [p, "resolve"],
    ].map(([holder, name]) => {
      const original = Object.getOwnPropertyDescriptor(holder, name);
      const replacement =
        name in replaced &&
        function (...operands) {
          log.push(`${name}(${operands})${this === holder ? "" : " of something else"}`);
          return replaced[name](...operands);
        };
      Object.defineProperty(holder, name, {
        configurable: true,
        get: () => (log.push(name), replacement || original.value),
      });
      return () => Object.defineProperty(holder, name, original);
    });
    try {
      return [run(), ...log];
    } finally {
      for (const undo of restore) undo();
    }
  }

  test("resolve() asks process.cwd() if it has to", () => {
    const cwd = () => root + "x";
    const inCwd = (...names) => [[root + "x", ...names].join(p.sep), "cwd", "cwd()"];
    expect(observe(() => resolve(), { cwd })).toEqual(inCwd());
    expect(observe(() => resolve("a"), { cwd })).toEqual(inCwd("a"));
    expect(observe(() => resolve("a", ""), { cwd })).toEqual(inCwd("a"));
    expect(observe(() => resolve("a", "b", "c"), { cwd })).toEqual(inCwd("a", "b", "c"));
    expect(observe(() => resolve("a", "b", "c", "d", "e"), { cwd })).toEqual(inCwd("a", "b", "c", "d", "e"));
    expect(observe(() => resolve(root + "a"), { cwd })).toEqual([root + "a"]);
    expect(observe(() => resolve("a", root + "b"), { cwd })).toEqual([root + "b"]);
    expect(observe(() => resolve(root, "a", "..", "b"), { cwd })).toEqual([root + "b"]);
    const fails = () => {
      throw new RangeError("from process.cwd()");
    };
    expect(() => observe(() => resolve("a"), { cwd: fails })).toThrow("from process.cwd()");
    expect(() => observe(() => resolve(5, "a"), { cwd: fails })).toThrow('The "paths[0]" argument');
  });

  test("join() calls normalize()", () => {
    const normalize = text => `<${text}>`;
    for (const names of [["a"], ["a", ".."], ["a", "", "."], ["a", "b", "c", "d", "e"]]) {
      const joined = names.filter(Boolean).join(p.sep);
      expect(observe(() => join(...names), { normalize })).toEqual([
        `<${joined}>`,
        "normalize",
        `normalize(${joined})`,
      ]);
    }
    expect(observe(() => join("a", "..", "b"))).toEqual(["b", "normalize"]);
    expect(observe(() => join(), { normalize })).toEqual(["."]);
    expect(observe(() => join("", ""), { normalize })).toEqual(["."]);
  });

  test("relative() calls resolve()", () => {
    const replaced = { resolve: text => resolve(root + "r", text.toLowerCase().slice(-1)) };
    expect(observe(() => relative(root + "xa", root + "yb"), replaced)).toEqual([
      `..${p.sep}b`,
      "resolve",
      `resolve(${root}xa)`,
      "resolve",
      `resolve(${root}yb)`,
    ]);
    expect(observe(() => relative(root + "a", root + "b"))).toEqual([`..${p.sep}b`, "resolve", "resolve"]);
    expect(observe(() => relative("a", "a"), replaced)).toEqual([""]);
    expect(() => observe(() => relative("a", "b"), { resolve: text => (text === "a" ? null : "/") })).toThrow(
      TypeError,
    );
  });

  test("toNamespacedPath() calls resolve() on Windows", () => {
    expect(observe(() => toNamespacedPath("a"), { resolve: () => "E:\\b" })).toEqual(
      platform === "posix" ? ["a"] : ["\\\\?\\E:\\b", "resolve", "resolve(a)"],
    );
  });

  test("format() reads its argument in the order of Node.js", () => {
    const read = object => {
      const log = [];
      return [p.format(new Proxy(object, { get: (target, key) => (log.push(key), target[key]) })), log.join()];
    };
    expect(read({ dir: "d", base: "b" })).toEqual([`d${p.sep}b`, "dir,base,root"]);
    expect(read({ root: "r", name: "n", ext: "e" })).toEqual(["rn.e", "dir,root,base,name,ext,root"]);
    expect(read({ base: 7 })).toEqual([7, "dir,root,base"]);
    expect(read({ dir: 5, name: 6, ext: 7 })).toEqual([`5${p.sep}6.7`, "dir,base,name,ext,root"]);
  });
});

test.concurrent("does not depend on built-ins that a script can change", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { posix, win32 } = require("node:path");
const real = process;
real.cwd = () => "/real";
globalThis.process = { cwd: () => "/fake", env: {} };
const changed = () => { throw new Error("changed"); };
for (const prototype of [String.prototype, Function.prototype, Array.prototype])
  for (const key of ["charCodeAt", "slice", "substr", "substring", "toLowerCase", "call", "apply", "bind", "push", "join"])
    prototype[key] = changed;
Object.defineProperty(Array.prototype, "0", { get: changed, set: changed });
Array.prototype[Symbol.iterator] = changed;
console.log(posix.resolve("a", "b", "c", "d"));
console.log(win32.resolve("C:a", "b", "c", "d"));
console.log(posix.join("a", "b", "c", "d"));
console.log(win32.toNamespacedPath("//a/b/c"));
console.log(posix.relative("a", "b"));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    lines: stdout
      .trim()
      .split(/\r?\n/)
      .slice(isWindows ? 2 : 0),
    stderr,
  }).toEqual({
    lines: ["/real/a/b/c/d", "C:\\real\\a\\b\\c\\d", "a/b/c/d", "\\\\?\\UNC\\a\\b\\c", "../b"].slice(isWindows ? 2 : 0),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("an answer that is longer than a string can be", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { posix, win32 } = require("node:path");
require("bun:internal-for-testing").setSyntheticAllocationLimitForTesting(1 << 20);
for (const unit of ["a", "\\u65e5"]) {
  const half = Buffer.alloc(1 << 20, unit, "utf16le").toString("utf16le");
  const deep = Buffer.alloc(800_000, "/a").toString();
  for (const run of [
    () => posix.join(half, half),
    () => win32.join(half, half),
    () => posix.resolve("/", half, half),
    () => win32.resolve("C:/", half, half),
    () => posix.relative(deep, "/" + unit),
    () => win32.relative("C:" + deep, "C:/" + unit),
  ]) {
    try {
      console.log(run().length);
    } catch (error) {
      console.log(error.name, error.message);
    }
  }
  process.cwd = () => "C:/x";
  console.log(win32.resolve(half, half, half, "/a"), posix.resolve(half, half, half, "/a"));
}`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ lines: stdout.trim().split(/\r?\n/), stderr }).toEqual({
    lines: Array(2)
      .fill([...Array(6).fill("RangeError Invalid string length"), "C:\\a /a"])
      .flat(),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("operands outlive a process.cwd() that collects garbage", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const path = require("node:path");
const long = "dir/" + Buffer.alloc(16000, "seg_").toString();
const fresh = () => ("<" + long.slice(1).padStart(long.length, "d") + ">").slice(1, -1);
let collects = false;
process.cwd = () => {
  if (collects) {
    Bun.gc(true);
    globalThis.keep = Array.from({ length: 50 }, (_, i) => Buffer.alloc(16000 + i, "Q").toString());
    Bun.gc(true);
  }
  return ("/cwd/" + long).slice(0, 9000);
};
const results = [];
for (const ns of ["posix", "win32"]) {
  const p = path[ns];
  const cases = {
    resolve1: () => p.resolve(fresh()),
    resolve2: () => p.resolve(fresh(), fresh()),
    resolve3: () => p.resolve(fresh(), fresh(), fresh()),
    resolve5: () => p.resolve(fresh(), fresh(), fresh(), fresh(), fresh()),
    relative: () => p.relative(fresh(), fresh() + "/" + fresh()),
  };
  for (const [name, run] of Object.entries(cases)) {
    collects = false;
    const want = run();
    collects = true;
    results.push(ns + "." + name + "=" + (run() === want ? "OK" : "MISMATCH"));
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
    for (const name of ["resolve1", "resolve2", "resolve3", "resolve5", "relative"]) expected.push(`${ns}.${name}=OK`);
  expect({ lines: stdout.trim().split("\n"), stderr }).toEqual({ lines: expected, stderr: "" });
  expect(exitCode).toBe(0);
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
