// What Python sees of the values of JavaScript.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import _js from "python:_js";
import {
  KeyError,
  RuntimeError,
  StopIteration,
  TypeError as PyTypeError,
  ValueError,
  dict,
  exec,
  getattr,
  isinstance,
  iter,
  len,
  list,
  next,
  tuple,
  type,
} from "python:builtins";
import abc from "python:collections.abc";
import copy from "python:copy";
import functools from "python:functools";
import heapq from "python:heapq";
import { contains, delitem, getitem, setitem } from "python:operator";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

/** The globals of a piece of Python. */
function python(code: string) {
  const globals = dict();
  exec(code, globals);
  return globals;
}

describe("len()", () => {
  test("is length or size", () => {
    expect(len(new Set([1, 2]))).toBe(2);
    expect(len(new Map([[1, 2]]))).toBe(1);
    expect(len(new Uint8Array(3))).toBe(3);
    expect(len({ length: 4 })).toBe(4);
  });

  test("is the number of properties of an object", () => {
    expect(len({ a: 1, b: 2 })).toBe(2);
    expect(len({})).toBe(0);
  });

  test("of what can only be iterated over is an error", () => {
    function* three() {
      yield* [1, 2, 3];
    }
    expect(() => len(three())).toThrow(PyTypeError);
    expect(() => len(three())).toThrow("object of type '_js.JSGenerator' has no len()");
    expect(() => len([1][Symbol.iterator]())).toThrow(PyTypeError);
    expect(() => len({ [Symbol.iterator]: three })).toThrow(PyTypeError);
    // which is how heapq finds out that it has to count for itself
    expect(heapq.nlargest(2, three())).toEqual([3, 2]);
    expect(heapq.nsmallest(2, three())).toEqual([1, 2]);
  });
});

describe("a Map", () => {
  const key = tuple([1, 2]);

  test("has its entries for items", () => {
    const map = new Map<any, any>([
      ["a", 1],
      [key, "b"],
    ]);
    expect(getitem(map, "a")).toBe(1);
    expect(getitem(map, key)).toBe("b");
    expect(() => getitem(map, "size")).toThrow(KeyError);
    expect(contains(map, "a")).toBe(true);
    expect(contains(map, "get")).toBe(false);
    setitem(map, "c", 3);
    expect(map.get("c")).toBe(3);
    delitem(map, "a");
    expect(map.has("a")).toBe(false);
    expect(() => delitem(map, "a")).toThrow(KeyError);
  });

  test("makes a dict", () => {
    const made = dict(
      new Map<any, any>([
        ["a", 1],
        [key, "b"],
      ]),
    );
    expect(len(made)).toBe(2);
    expect(getitem(made, "a")).toBe(1);
    expect(getitem(made, key)).toBe("b");
  });

  test("keeps its methods", () => {
    expect(python("def size(m): return m.size, m.get('a'), m.has('b')").size(new Map([["a", 1]]))).toEqual(
      tuple([1, 1, false]),
    );
  });
});

test("`in` asks a Set", () => {
  expect(contains(new Set([1, "a"]), "a")).toBe(true);
  expect(contains(new Set([1, "a"]), "add")).toBe(false);
});

describe("an iterator", () => {
  test("is one", () => {
    const iterator = [1, 2][Symbol.iterator]();
    expect(type(iterator)).toBe(_js.JSIterator);
    expect(isinstance(iterator, _js.JSObject)).toBe(true);
    expect(isinstance(iterator, abc.Iterator)).toBe(true);
    expect(iter(iterator)).toBe(iterator);
    expect(next(iterator)).toBe(1);
    expect(next(iterator)).toBe(2);
    expect(() => next(iterator)).toThrow(StopIteration);
    expect(next(iterator, "end")).toBe("end");
  });

  test.each([
    ["of a Map", () => new Map([[1, 2]]).keys()],
    ["of a Set", () => new Set([1]).values()],
    ["of a string", () => "1"[Symbol.iterator]()],
    ["of matches", () => "1".matchAll(/1/g)],
    ["made by a helper", () => [0].values().map(x => x + 1)],
    ["wrapped", () => Iterator.from({ next: () => ({ done: false, value: 1 }) })],
  ])("%s", (_, make) => {
    expect(type(make())).toBe(_js.JSIterator);
    expect(String(next(make()))).toBe("1");
  });

  test("can be what __iter__ returns", () => {
    const { Numbers } = python(`
class Numbers:
    def __init__(self, make): self.make = make
    def __iter__(self): return self.make()
`);
    expect(list(Numbers(() => [1, 2].values()))).toEqual([1, 2]);
    expect(
      list(
        Numbers(function* () {
          yield 3;
        }),
      ),
    ).toEqual([3]);
  });
});

describe("a generator", () => {
  test("is one", () => {
    function* empty() {}
    expect(type(empty())).toBe(_js.JSGenerator);
    expect(isinstance(empty(), _js.JSIterator)).toBe(true);
    expect(isinstance(empty(), abc.Generator)).toBe(true);
  });

  test("send()", () => {
    function* echo(): Generator<string, string, string> {
      let said = yield "ready";
      while (said != "stop") said = yield `${said}!`;
      return "stopped";
    }
    const { drive } = python(`
def drive(g):
    heard = [next(g), g.send("a"), g.send("b")]
    try:
        g.send("stop")
    except StopIteration as stop:
        heard.append(stop.value)
    return heard
`);
    expect(drive(echo())).toEqual(["ready", "a!", "b!", "stopped"]);
  });

  test("throw()", () => {
    const caught: unknown[] = [];
    function* catches() {
      try {
        yield 1;
      } catch (error) {
        caught.push(error);
        yield 2;
      }
      yield 3;
    }
    const { throws } = python(`
def throws(g, exception):
    next(g)
    return g.throw(exception)
`);
    const error = ValueError("thrown in");
    expect(throws(catches(), error)).toBe(2);
    expect(caught).toEqual([error]);
    expect(caught[0]).toBe(error);

    function* lets() {
      yield 1;
    }
    let thrown;
    try {
      throws(lets(), error);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(error);
    // A class is instantiated, as by `raise`.
    expect(() => throws(lets(), ValueError)).toThrow(ValueError);
  });

  test("close()", () => {
    const log: string[] = [];
    function* cleans() {
      try {
        yield 1;
      } finally {
        log.push("closed");
      }
    }
    const { close } = python(`
def close(g):
    next(g)
    return g.close()
`);
    expect(close(cleans())).toBeUndefined();
    expect(log).toEqual(["closed"]);

    function* goesOn() {
      try {
        yield 1;
      } finally {
        yield 2;
      }
    }
    expect(() => close(goesOn())).toThrow(RuntimeError);
    expect(() => close(goesOn())).toThrow("generator ignored GeneratorExit");
  });

  test("yield from", () => {
    function* inner(): Generator<number, string, number> {
      const sent = yield 1;
      yield sent * 2;
      return "result";
    }
    const { outer } = python(`
def outer(g, results):
    results.append((yield from g))
`);
    const results: string[] = [];
    const generator = outer(inner(), results);
    expect(generator.next().value).toBe(1);
    expect(generator.next(21).value).toBe(42);
    expect(generator.next().done).toBe(true);
    expect(results).toEqual(["result"]);
  });
});

describe("a function", () => {
  function named() {}

  test("has a name", () => {
    expect(getattr(named, "__name__")).toBe("named");
    expect(getattr(named, "__qualname__")).toBe("named");
    expect(getattr(() => {}, "__name__")).toBe("");
    expect(functools.wraps(named)(python("def other(): pass").other).__name__).toBe("named");
    expect(functools.lru_cache(named).__name__).toBe("named");
  });

  test("is copied as a function of Python is: not at all", () => {
    expect(copy.copy(named)).toBe(named);
    expect(copy.deepcopy(named)).toBe(named);
    const deep = copy.deepcopy(dict([["key", [named]]]));
    expect(deep.key[0]).toBe(named);
  });
});

test.concurrent("os.chdir() moves JavaScript too", async () => {
  using dir = tempDir("python-chdir", {
    "sub/data.txt": "here",
    "sub/found.js": "module.exports = 'found';",
    "main.js": `
      const os = require("python:os");
      const path = require("node:path");
      process.cwd();
      os.chdir("sub");
      console.log(path.basename(process.cwd()), process.cwd() === os.getcwd());
      console.log(require("node:fs").readFileSync("data.txt", "utf8"));
      console.log(path.relative(process.cwd(), Bun.resolveSync("./found.js", process.cwd())));
      const fd = os.open("..", os.O_RDONLY);
      os.fchdir(fd);
      os.close(fd);
      console.log(process.cwd() === os.getcwd(), require("node:fs").existsSync("main.js"));
      process.chdir("sub");
      console.log(path.basename(os.getcwd()));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("sub true\nhere\nfound.js\ntrue true\nsub\n");
  expect(exitCode).toBe(0);
});

// macOS refuses such names, and Windows has none.
test.concurrent.skipIf(!isLinux)("os.chdir() into a directory whose name JavaScript cannot spell", async () => {
  using dir = tempDir("python-chdir-bytes", {
    "main.py": String.raw`
import os, sys, js
from node import fs
for name in ("\u00e6".encode(), b"\xe7w\xf0"):
    os.mkdir(name)
    with open(name + b"/data.txt", "w") as f:
        f.write("here")
    os.chdir(name)
    print(os.getcwdb()[-len(name):], js.process.cwd().rpartition("/")[2].encode("utf-8"), fs.readFileSync("data.txt", "utf8"))
    sys.modules.pop("colorsys", None)
    import colorsys
    try:
        import nothing_of_that_name
    except ModuleNotFoundError as e:
        print(e)
    os.chdir("..")
    print(js.process.cwd() == os.getcwd(), fs.existsSync("main.py"))
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.py"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.split("\n")).toEqual([
    String.raw`b'\xc3\xa6' b'\xc3\xa6' here`,
    "No module named 'nothing_of_that_name'",
    "True True",
    String.raw`b'\xe7w\xf0' b'\xef\xbf\xbdw\xef\xbf\xbd' here`,
    "No module named 'nothing_of_that_name'",
    "True True",
    "",
  ]);
  expect(exitCode).toBe(0);
});
