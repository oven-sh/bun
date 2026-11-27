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

// [platform, function, arguments, result]. See fixtures/record.cjs.
const nodeResults = readFileSync(path.join(import.meta.dir, "fixtures", "node-path-results.jsonl"), "utf8")
  .trim()
  .split(/\r?\n/)
  .map(line => JSON.parse(line));

test.each(
  Object.entries({
    "8-bit strings where possible": text =>
      /[^\0-\xff]/.test(text) ? text : Buffer.from(text, "latin1").toString("latin1"),
    "16-bit strings": text => ("\u65e5" + text).slice(1),
    "ropes": text => text.slice(0, text.length >> 1) + text.slice(text.length >> 1),
    "long names": text => text,
  }),
)("returns the results recorded from Node.js, with %s", (kind, form) => {
  expect(nodeResults).toHaveLength(2372);
  const { cwd, env } = process;
  const different = [];
  const long = Buffer.alloc(600, "n").toString();
  try {
    process.env = { "=D:": "D:\\work", "=d:": "d:\\work", "=Z:": "Y:\\elsewhere" };
    for (let [platform, name, operands, expected] of nodeResults) {
      process.cwd = () => (platform === "posix" ? "/home/me" : "C:\\Users\\me");
      if (kind === "long names") {
        // "foo" has no special meaning, so a name that exceeds the stack buffers can replace it.
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

// Paths are built on the stack up to 512 8-bit units in the fast path, and up to 1024 bytes otherwise.
describe.each(["posix", "win32"])("path.%s around the sizes of the stack buffers", platform => {
  const p = path[platform];
  const root = platform === "posix" ? "/" : "C:\\";
  test.each([
    ["8-bit", length => Buffer.alloc(length, "a").toString()],
    ["16-bit", length => Buffer.alloc(2 * length, "\u65e5", "utf16le").toString("utf16le")],
  ])("with %s names", (_, createName) => {
    const different = [];
    for (const size of [512, 1024]) {
      for (let length = size - 12; length <= size + 2; length++) {
        const name = createName(length);
        const results = {
          normalize: [p.normalize(`${name}//`), name + p.sep],
          normalizeDots: [p.normalize(`x/../${name}/.`), name],
          normalizeColon: [p.normalize(`${name}:`), (platform === "posix" ? "" : ".\\") + name + ":"],
          normalizeShare: [p.normalize(`//s/${name}`), platform === "posix" ? `/s/${name}` : `\\\\s\\${name}\\`],
          joinFirst: [p.join(name, "b"), name + p.sep + "b"],
          joinLast: [p.join("b", name), "b" + p.sep + name],
          joinEmpty: [p.join("", name, ""), name],
          joinSlash: [p.join(name, "/"), name + p.sep],
          joinColon: [p.join("b", `${name}:`), (platform === "posix" ? "" : ".\\") + "b" + p.sep + name + ":"],
          resolveFirst: [p.resolve(root + name, "b"), root + name + p.sep + "b"],
          resolveLast: [p.resolve(root, "b", name), root + "b" + p.sep + name],
          resolveSlash: [p.resolve(`${root}${name}/`), root + name],
          relativeTo: [p.relative(`${root}b`, `${root}./${name}`), ".." + p.sep + name],
          relativeFrom: [p.relative(`${root}./${name}`, `${root}b`), ".." + p.sep + "b"],
        };
        for (const [call, [actual, expected]] of Object.entries(results)) {
          if (actual !== expected) different.push({ call, length });
        }
      }
    }
    expect(different).toEqual([]);
  });
});

describe.each(["posix", "win32"])("path.%s calls the functions that a script has replaced", platform => {
  const p = path[platform];
  const { join, relative, resolve, toNamespacedPath } = p;
  const root = platform === "posix" ? "/" : "C:\\";

  /** The result of `run`, followed by its reads and calls of `process.cwd`, `normalize` and `resolve`. */
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

  test("resolve() calls process.cwd() only if it needs it", () => {
    const cwd = () => root + "x";
    const inCwd = (...names) => [[root + "x", ...names].join(p.sep), "cwd", "cwd()"];
    expect(observe(() => resolve(), { cwd })).toEqual(inCwd());
    expect(observe(() => resolve("a"), { cwd })).toEqual(inCwd("a"));
    expect(observe(() => resolve("a", ""), { cwd })).toEqual(inCwd("a"));
    expect(observe(() => resolve("a", "b", "c"), { cwd })).toEqual(inCwd("a", "b", "c"));
    expect(observe(() => resolve("a", "b", "c", "d", "e"), { cwd })).toEqual(inCwd("a", "b", "c", "d", "e"));
    // What win32 returns for these depends on the host.
    if (p === path.posix) {
      expect(observe(() => resolve("."), { cwd: () => "/a//b/" })).toEqual(["/a//b/", "cwd", "cwd()"]);
      expect(observe(() => resolve(), { cwd: () => "a" })).toEqual(["a", "cwd", "cwd()", "cwd", "cwd()"]);
    }
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

  test("relative() looks resolve() up again for its second argument", () => {
    const { cwd } = process;
    process.cwd = () => {
      p.resolve = text => `${root}c${p.sep}replaced${p.sep}${text}`;
      return root + "c";
    };
    try {
      expect(relative("a", "b")).toBe(["..", "replaced", "b"].join(p.sep));
    } finally {
      process.cwd = cwd;
      p.resolve = resolve;
    }
  });

  test.each([
    ["process.cwd", process, "cwd", () => resolve("a")],
    [`${platform}.normalize`, p, "normalize", () => join("a", "b")],
    [`${platform}.resolve`, p, "resolve", () => relative("a", "b")],
  ])("%s throws, or is not a function", (description, holder, name, run) => {
    const original = Object.getOwnPropertyDescriptor(holder, name);
    const fails = () => {
      throw new RangeError("from the script");
    };
    const errors = [{ value: fails }, { get: fails }, { value: undefined }, { value: {} }].map(replacement => {
      Object.defineProperty(holder, name, { ...replacement, configurable: true });
      try {
        return run();
      } catch (error) {
        return String(error);
      } finally {
        Object.defineProperty(holder, name, original);
      }
    });
    expect(errors).toEqual([
      "RangeError: from the script",
      "RangeError: from the script",
      `TypeError: ${description} is not a function`,
      `TypeError: ${description} is not a function`,
    ]);
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

test("path.win32.resolve() reads the cwd of a drive from a replaced process.env", () => {
  const original = Object.getOwnPropertyDescriptor(process, "env");
  const { cwd } = process;
  const fails = () => {
    throw new RangeError("from the script");
  };
  const results = [
    { value: { "=Q:": "Q:\\env" } },
    { value: { "=Q:": "" } },
    { value: { "=Q:": "R:\\other" } },
    { value: Object.defineProperty({}, "=Q:", { get: fails }) },
    { get: fails },
    { value: undefined },
    { value: null },
  ].map(replacement => {
    Object.defineProperty(process, "env", { ...replacement, configurable: true });
    process.cwd = () => "q:\\cwd";
    try {
      return path.win32.resolve("Q:a");
    } catch (error) {
      return String(error);
    } finally {
      Object.defineProperty(process, "env", original);
      process.cwd = cwd;
    }
  });
  expect(results).toEqual([
    "Q:\\env\\a",
    "Q:\\cwd\\a",
    "Q:\\a",
    "RangeError: from the script",
    "RangeError: from the script",
    "TypeError: Cannot read properties of undefined (reading '=Q:')",
    "TypeError: Cannot read properties of null (reading '=Q:')",
  ]);
});

test("path.win32.resolve() ignores what is written to the process.env of the process", () => {
  const { cwd } = process;
  process.cwd = () => "q:\\cwd";
  process.env["=Q:"] = "Q:\\written";
  try {
    expect(path.win32.resolve("Q:a")).toBe("Q:\\cwd\\a");
  } finally {
    delete process.env["=Q:"];
    process.cwd = cwd;
  }
});

test.concurrent("path.win32.resolve() reads the cwd of a drive from the process.env of a Worker", async () => {
  const script = `
const { Worker, SHARE_ENV } = require("node:worker_threads");
const inWorker = String.raw\`
  const { win32 } = require("node:path");
  process.cwd = () => "q:/cwd";
  const before = win32.resolve("Q:a");
  process.env["=Q:"] = "Q:/written";
  require("node:worker_threads").parentPort.postMessage([before, win32.resolve("Q:a")].join());\`;
(async () => {
  for (const env of [undefined, { "=Q:": "Q:/given" }, SHARE_ENV]) {
    console.log(await new Promise(resolve => new Worker(inWorker, { eval: true, env }).once("message", resolve)));
  }
})();`;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ lines: stdout.trim().split(/\r?\n/), stderr }).toEqual({
    lines: ["Q:\\cwd\\a,Q:\\written\\a", "Q:\\given\\a,Q:\\written\\a", "Q:\\cwd\\a,Q:\\cwd\\a"],
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("does not depend on built-ins that a script can change after the module is loaded", async () => {
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
  // On Windows the first line is the same, but the second depends on the real cwd of drive C.
  expect({
    lines: stdout.trim().split(/\r?\n/).toSpliced(1, +isWindows),
    stderr,
  }).toEqual({
    lines: ["/real/a/b/c/d", "C:\\real\\a\\b\\c\\d", "a/b/c/d", "\\\\?\\UNC\\a\\b\\c", "../b"].toSpliced(1, +isWindows),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("throws a RangeError for a result that exceeds the maximum string length", async () => {
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

test.concurrent("resolve() notices each way to replace process.cwd", async () => {
  const script = `
const path = require("path");
const { spyOn } = require("bun:test");
const { cwd } = process;
const made = () => path.sep + "made";
const ask = () => {
  const answers = [["x"], ["x", ""], ["\\u65e5", "..", "x"], ["a", "..", "", "x"]].map(names => {
    try {
      return path.resolve(...names);
    } catch (error) {
      return error.name;
    }
  });
  return [...new Set(answers)].join().replace(cwd(), "real").replace(path.sep, "/").replace(path.sep, "/");
};
const restore = () => Object.defineProperty(process, "cwd", { value: cwd, writable: true, enumerable: true, configurable: true });
const ways = {
  assigned: () => (process.cwd = made),
  getter: () => Object.defineProperty(process, "cwd", { get: () => made, configurable: true }),
  spied: () => spyOn(process, "cwd").mockImplementation(made),
  native: () => (process.cwd = Object),
  deleted: () => delete process.cwd,
  moved: () => delete process.cwd && (process.moved = cwd),
  inherited: () => delete process.cwd && (Object.getPrototypeOf(process).cwd = made),
};
for (const more of [0, 200, 600]) {
  for (let i = 0; i < more; i++) process["more" + i] = i;
  for (let i = 0; i < more; i += 2) delete process["more" + i];
  const said = [];
  for (const way in ways) {
    const before = ask() + ask();
    ways[way]();
    said.push(before === "real/xreal/x" ? ask() : before);
    delete process.moved;
    delete Object.getPrototypeOf(process).cwd;
    restore();
  }
  console.log(said.join(" "));
}`;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const line = "/made/x /made/x /made/x [object Object]/x TypeError TypeError /made/x\n";
  expect({ stdout, stderr }).toEqual({ stdout: line + line + line, stderr: "" });
  expect(exitCode).toBe(0);
});

test.concurrent("join() and relative() notice each way to replace normalize and resolve", async () => {
  const script = `
const { posix, win32 } = require("path");
const { spyOn } = require("bun:test");
const made = name => "/made/" + name.slice(-1);
for (const more of [0, 1, 200, 600]) {
  for (const [p, name, ask] of [
    [posix, "normalize", posix.join.bind(null, "a", "..", "b")],
    [win32, "normalize", win32.join.bind(null, "a", "..", "b")],
    [posix, "resolve", posix.relative.bind(null, "/made/x/a", "/made/b")],
    [win32, "resolve", win32.relative.bind(null, "C:/made/x/a", "C:/made/b")],
  ]) {
    for (let i = 0; i < more; i++) p["more" + i] = i;
    for (let i = 1; i < more; i += 2) delete p["more" + i];
    const own = p[name];
    const ways = {
      assigned: () => (p[name] = made),
      getter: () => Object.defineProperty(p, name, { get: () => made, configurable: true }),
      spied: () => spyOn(p, name).mockImplementation(made),
      deleted: () => delete p[name],
      moved: () => delete p[name] && (p.moved = own),
      inherited: () => delete p[name] && (Object.prototype[name] = made),
    };
    const said = [ask()];
    for (const way in ways) {
      ways[way]();
      try {
        said.push(ask());
      } catch (error) {
        said.push(error.name);
      }
      delete p.moved;
      delete Object.prototype[name];
      Object.defineProperty(p, name, { value: own, writable: true, enumerable: true, configurable: true });
      if (ask() !== said[0]) said.push("not restored");
    }
    console.log(said.join(" ").replaceAll(win32.sep, "/"));
  }
}`;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const joined = "b /made/b /made/b /made/b TypeError TypeError /made/b\n";
  const related = "../../b ../b ../b ../b TypeError TypeError ../b\n";
  const once = joined + joined + related + "../../" + joined;
  expect({ stdout, stderr }).toEqual({
    stdout: Buffer.alloc(4 * once.length, once).toString(),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("a replacement that recurses without end throws a RangeError", async () => {
  const script = `
const { posix, win32 } = require("path");
for (const p of [posix, win32]) {
  const { join, relative, resolve } = p;
  for (const [holder, name, call] of [
    [process, "cwd", () => resolve("a")],
    [process, "cwd", () => resolve()],
    [p, "normalize", () => join("a", "b")],
    [p, "resolve", () => relative("a", "b")],
  ]) {
    const own = holder[name];
    holder[name] = call;
    try {
      call();
    } catch (error) {
      console.log(error.name);
    }
    holder[name] = own;
  }
}`;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: Array(8).fill("RangeError\n").join(""), stderr: "" });
  expect(exitCode).toBe(0);
});

test("a ShadowRealm has its own module", async () => {
  const realm = new ShadowRealm();
  const posix = `process.getBuiltinModule("node:path").posix`;
  realm.evaluate(`${posix}.normalize = () => "of the realm"; 0`);
  expect([realm.evaluate(`${posix}.join("a", "b")`), path.posix.join("a", "b")]).toEqual(["of the realm", "a/b"]);
});

test.concurrent("arguments stay intact when process.cwd() runs the GC", async () => {
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
