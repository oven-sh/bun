import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

async function run(files: Record<string, string>) {
  using dir = tempDir("python-import-js", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.py"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const lines = (...all: string[]) => all.map(line => line + "\n").join("");

test.concurrent("Python imports JavaScript and TypeScript files", async () => {
  const result = await run({
    "helper.ts": `
      export const answer: number = 42;
      export function greet(name: string): string { return \`hello \${name}\`; }
      export class Point { constructor(public x: number, public y: number) {} norm() { return Math.hypot(this.x, this.y); } }
      export let counter = 0;
      export function bump() { counter++; }
      export const shared: number[] = [1, 2, 3];
      export default function theDefault() { return "default export"; }
    `,
    "cjs.cjs": `
      module.exports = function callable(x) { return x * 2; };
      module.exports.extra = "a property of the function";
    `,
    "both.py": `which = "the Python module comes first"`,
    "both.js": `export const which = "the JavaScript module";`,
    "pkg/__init__.py": `
from . import inner
from .inner import where
`,
    "pkg/inner.js": `export const where = "pkg/inner.js";`,
    "throws.js": `throw new TypeError("thrown while the module runs");`,
    "main.py": `
import sys
import helper
print(type(helper).__name__, helper.answer, helper.greet("python"))
from helper import Point, bump, shared, default
p = Point.new(3, 4)
print(p.x, p.norm(), default())
bump(); bump()
print(helper.counter)
shared.append(4)
print(type(shared).__name__, shared, helper.shared is shared, sys.modules["helper"] is helper)
import cjs
print(cjs(21), cjs.extra)
import both
print(both.which)
import pkg
print(pkg.where, pkg.inner.where, sys.modules["pkg.inner"] is pkg.inner)
try:
    import throws
except Exception as e:
    print(type(e).__name__, e, "throws" in sys.modules)
try:
    from helper import missing
except ImportError as e:
    print(type(e).__name__)
`,
  });
  expect(result).toEqual({
    stdout: lines(
      "JSObject 42 hello python",
      "3 5 default export",
      "2",
      "list [1, 2, 3, 4] True True",
      "42 a property of the function",
      "the Python module comes first",
      "pkg/inner.js pkg/inner.js True",
      "JSError TypeError: thrown while the module runs False",
      "ImportError",
    ),
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("Python imports packages from node_modules, and what is built in", async () => {
  const result = await run({
    "node_modules/left-pad/package.json": `{"name":"left-pad","version":"1.0.0","main":"index.js"}`,
    "node_modules/left-pad/index.js": `module.exports = function leftPad(s, n) { return String(s).padStart(n); };`,
    "node_modules/esm_pkg/package.json": `{"name":"esm_pkg","version":"1.0.0","type":"module","exports":{".":"./index.mjs","./sub":"./sub.mjs"}}`,
    "node_modules/esm_pkg/index.mjs": `export const kind = "esm package"; export default { a: 1 };`,
    "node_modules/esm_pkg/sub.mjs": `export const sub = "a subpath";`,
    "node_modules/@scope/thing/package.json": `{"name":"@scope/thing","version":"1.0.0"}`,
    "node_modules/@scope/thing/index.js": `exports.scoped = true;`,
    // Neither the name of a module of Node nor that of one the standard library should have is looked for here.
    "node_modules/readline/package.json": `{"name":"readline","version":"1.0.0"}`,
    "node_modules/readline/index.js": `exports.wrong = true;`,
    "local.js": `export const local = "beside the importer";`,
    "main.py": `
import importlib
import left_pad
print(repr(left_pad("x", 4)))
import esm_pkg
print(esm_pkg.kind, esm_pkg.default.a)
print(importlib.import_module("esm_pkg/sub").sub, importlib.import_module("@scope/thing").scoped)
from node import fs, path
print(path.join("a", "b"), fs.existsSync(__file__))
from node.os import EOL
print(repr(EOL))
import bun
from bun import version, sqlite
print(version == bun.version, type(bun.file).__name__, sqlite.Database is not None, bun.require("./local.js").local)
for name in "nothing_like_this", "readline", "_curses", "node.nothing", "fs":
    try:
        importlib.import_module(name)
        print(name, "was imported")
    except ModuleNotFoundError as e:
        print(e)
`,
  });
  expect(result).toEqual({
    stdout: lines(
      "'   x'",
      "esm package 1",
      "a subpath True",
      "a/b True",
      String.raw`'\n'`,
      "True JSFunction True beside the importer",
      "No module named 'nothing_like_this'",
      "No module named 'readline'",
      "No module named '_curses'",
      "No module named 'node.nothing'",
      "No module named 'fs'",
    ),
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("the path of a file is a module of JavaScript only if its suffix says so", async () => {
  const result = await run({
    "script.js": `exports.kind = "a script";`,
    "typed.ts": `export const kind: string = "typed";`,
    "plain": `exports.kind = "no suffix";`,
    "notes.txt": `some text`,
    "module.py": `kind = "python"`,
    "directory/index.js": `exports.kind = "the index of a directory";`,
    "main.py": `
import importlib, os
here = os.path.dirname(os.path.abspath(__file__))
for name in "script", "typed", "directory", "plain", "notes.txt", "module.py", "module", "missing":
    try:
        print(name, importlib.import_module(here + "/" + name).kind)
    except ModuleNotFoundError as e:
        print(name, str(e).replace(here, "<here>"))
`,
  });
  expect(result).toEqual({
    stdout: lines(
      "script a script",
      "typed typed",
      "directory the index of a directory",
      "plain No module named '<here>/plain'",
      "notes.txt No module named '<here>/notes'",
      "module.py No module named '<here>/module'",
      "module No module named '<here>/module'",
      "missing No module named '<here>/missing'",
    ),
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("a name that Python code tries to import is never looked up in the registry", async () => {
  const requests: string[] = [];
  using registry = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname);
      return new Response("{}", { status: 404 });
    },
  });
  // With -i, Bun installs what JavaScript imports and is not in node_modules.
  using dir = tempDir("python-import-no-install", {
    "package.json": JSON.stringify({ name: "app", imports: { "#dep": "mapped-to-a-package" } }),
    "node_modules/emptypkg/README": "a directory with nothing to resolve to",
    "node_modules/installedpkg/package.json": JSON.stringify({ name: "installedpkg", main: "index.js" }),
    "node_modules/installedpkg/index.js": "module.exports = 1;",
    "helper.ts": `import x from "imported-by-the-helper"; export default x;`,
    "main.py": `
import bun, importlib
for attempt in (
    lambda: __import__("not_installed"),
    lambda: bun.require("not-installed"),
    lambda: bun.require("#dep"),
    lambda: __import__("emptypkg"),
    lambda: importlib.import_module("installedpkg/missing-sub"),
    lambda: __import__("helper"),
):
    try:
        attempt()
    except Exception as e:
        print(type(e).__name__)
    else:
        print("imported")
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-i", "main.py"],
    env: { ...bunEnv, BUN_CONFIG_REGISTRY: registry.url.href, NPM_CONFIG_REGISTRY: registry.url.href },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode, requests }).toEqual({
    stdout: lines(
      "ModuleNotFoundError",
      "ModuleNotFoundError",
      "JSError",
      "ModuleNotFoundError",
      "ModuleNotFoundError",
      "JSError",
    ),
    stderr: "",
    exitCode: 0,
    requests: [],
  });
});

test.concurrent("calling a class of JavaScript makes an instance", async () => {
  const result = await run({
    "helper.js": `
      export class Point { constructor(x, y) { this.x = x; this.y = y; this.target = new.target === Point; } }
      export class Point3 extends Point { constructor(x, y, z) { super(x, y); this.z = z; } }
      export function plain(v) { return new.target ? "constructed" : "called with " + v; }
      export const bound = Point.bind(null, 1);
      export const boundPlain = plain.bind(undefined, 7);
    `,
    "main.py": `
import js
from helper import Point, Point3, plain, bound, boundPlain
p = Point(3, 4)
print(p.x, p.y, p.target, Point3(1, 2, 3).z, bound(2).y, Point.new(5, 6).x)
print(plain(1), boundPlain(), plain.new(1) is not None)
print(js.Map([[1, 2]]).get(1), js.URL("http://example.com/a").pathname, js.Date(0).getTime(), js.Response("x").status)
print(repr(js.String(12)), js.Number("3"), js.Boolean(0), type(js.Symbol("s")).__name__, js.BigInt(5), len(js.Array(3)))
print([url.host for url in map(js.URL, ["http://a.example/x"])], js.Error("message").message)
try:
    Point3()
    js.URL("nonsense")
except Exception as e:
    print(type(e).__name__)
`,
  });
  expect(result).toEqual({
    stdout: lines(
      "3 4 True 3 2 5",
      "called with 1 called with 7 True",
      "2 /a 0 200",
      "'12' 3 False JSSymbol 5 3",
      "['a.example'] message",
      "JSError",
    ),
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("iterators, async iterators and plain objects of JavaScript", async () => {
  const result = await run({
    "helper.js": `
      export function* naturals() { for (let i = 0; ; i++) yield i; }
      export async function* ticks(n) { for (let i = 0; i < n; i++) { await Bun.sleep(1); yield i * 10; } }
      export async function* failing() { yield 1; throw new RangeError("no more"); }
      export const config = { port: 3000, tags: ["a"], keys: undefined };
      delete config.keys;
      export const stream = () => new Response("streamed").body;
      export class Animal {}
      export class Cat extends Animal {}
    `,
    "main.py": `
import itertools, js
from helper import naturals, ticks, failing, config, stream, Animal, Cat
print(list(itertools.islice(naturals(), 3)), next(iter(naturals())), [x for x, _ in zip(naturals(), "ab")])
it = iter(js.Map([[1, 2]])); print(list(next(it)), next(it, "end"), next(it, "still the end"))
print([x async for x in ticks(3)])
try:
    async for x in failing(): print(x)
except Exception as e:
    print(type(e).__name__, e)
print(b"".join([bytes(chunk) async for chunk in stream()]))
print([x async for x in js.Set([1, js.Promise.resolve(2)])])
print(config.keys(), config.values(), config.items(), dict(config), {**config})
print(isinstance(Cat(), Animal), isinstance(Animal(), Cat), isinstance(1, Animal), isinstance(js.Map(), (int, js.Map)))
`,
  });
  expect(result).toEqual({
    stdout: lines(
      "[0, 1, 2] 0 [0, 1]",
      "[1, 2] end still the end",
      "[0, 10, 20]",
      "1",
      "JSError RangeError: no more",
      "b'streamed'",
      "[1, 2]",
      "['port', 'tags'] [3000, ['a']] [('port', 3000), ('tags', ['a'])] {'port': 3000, 'tags': ['a']} {'port': 3000, 'tags': ['a']}",
      "True False False True",
    ),
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("what JavaScript throws has a traceback of the calls it passed", async () => {
  const result = await run({
    "helper.js": `export function thrower() { throw new RangeError("out of range"); }`,
    "main.py": `
import traceback
from helper import thrower
def inner(): thrower()
def outer(): inner()
try:
    outer()
except Exception as e:
    print([(f.name, f.lineno) for f in traceback.extract_tb(e.__traceback__)], e.value.name, e.value.message)
outer()
`,
  });
  expect({ ...result, stderr: result.stderr.replace(/File ".*\//g, 'File "') }).toEqual({
    stdout: lines("[('<module>', 7), ('outer', 5), ('inner', 4), ('thrower', 1)] RangeError out of range"),
    stderr: lines(
      "Traceback (most recent call last):",
      '  File "main.py", line 10, in <module>',
      "    outer()",
      "    ~~~~~^^",
      '  File "main.py", line 5, in outer',
      "    def outer(): inner()",
      "                 ~~~~~^^",
      '  File "main.py", line 4, in inner',
      "    def inner(): thrower()",
      "                 ~~~~~~~^^",
      '  File "helper.js", line 1, in thrower',
      '    export function thrower() { throw new RangeError("out of range"); }',
      "_js.JSError: RangeError: out of range",
    ),
    exitCode: 1,
  });
});
