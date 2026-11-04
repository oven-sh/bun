// Packages and files of JavaScript and TypeScript, imported by Python.
import { program } from "./helpers";

const group = program();

const files = {
  "node_modules/cjs-pkg/package.json": `{"name":"cjs-pkg","version":"1.2.3","main":"lib/index.js"}`,
  "node_modules/cjs-pkg/lib/index.js": `
    const helper = require("./helper");
    module.exports = { add: (a, b) => a + b, helper, version: require("../package.json").version, get lazy() { return "computed"; } };
  `,
  "node_modules/cjs-pkg/lib/helper.js": `exports.name = "helper"; exports.dirname = __dirname.split("/").slice(-2).join("/");`,
  "node_modules/esm-pkg/package.json": `{"name":"esm-pkg","version":"1.0.0","type":"module","exports":{".":"./index.js","./feature":"./feature.js","./data.json":"./data.json"}}`,
  "node_modules/esm-pkg/index.js": `
    export default class Client {
      static defaults = { retries: 3 };
      constructor(options = {}) { this.options = options; }
      async get(path) { return { path, retries: this.options.retries ?? Client.defaults.retries }; }
    }
    export const VERSION = "1.0.0";
    export function configure({ a = 1, b = 2 } = {}) { return [a, b]; }
    export let live = 0;
    export const bump = () => ++live;
    export * as ns from "./feature.js";
  `,
  "node_modules/esm-pkg/feature.js": `export const feature = true; export default "feature default";`,
  "node_modules/esm-pkg/data.json": `{"k": [1, 2, {"n": null}]}`,
  "node_modules/@scope/pkg/package.json": `{"name":"@scope/pkg","version":"1.0.0","main":"main.js"}`,
  "node_modules/@scope/pkg/main.js": `module.exports = function main() { return "scoped"; }; module.exports.extra = 1;`,
  "node_modules/typed/package.json": `{"name":"typed","version":"1.0.0","main":"index.ts"}`,
  "node_modules/typed/index.ts": `
    export enum Color { Red, Green = 5 }
    export interface Unused { a: number }
    export const identity = <T,>(x: T): T => x;
    export namespace N { export const v = 1; }
  `,
  "node_modules/awaits/package.json": `{"name":"awaits","version":"1.0.0","type":"module","main":"index.js"}`,
  "node_modules/awaits/index.js": `await Promise.resolve(); export const value = "after an await at the top level";`,
  "conf.json": `{"a": 1}`,
  "conf.toml": `a = 1\n`,
  "note.txt": `hello text\n`,
  "entry.ts": `
    import { value } from "virtual:thing";
    import text from "./data.custom";
    export const out = value + ":" + text;
  `,
  "data.custom": `raw custom\n`,
  "mod.py": `
x = 41
def inc(): return x + 1
`,
  "local.mjs": `export const where = import.meta.url.split("/").pop(); export const dir = import.meta.dirname === process.cwd();`,
};

group("packages", { files, setup: "import importlib, importlib.util, sys, js, bun\n" }, [
  [
    "import cjs_pkg\ncjs_pkg.add(1, 2), cjs_pkg.helper.name, cjs_pkg.helper.dirname, cjs_pkg.version, cjs_pkg.lazy, type(cjs_pkg).__name__",
    "(3, 'helper', 'cjs-pkg/lib', '1.2.3', 'computed', 'JSPlainObject')",
  ],
  [
    "from cjs_pkg import add, helper\nadd('a', 'b'), helper.name, sys.modules['cjs_pkg'] is cjs_pkg",
    "('ab', 'helper', True)",
  ],
  ["cjs_pkg.version = '9'\ncjs_pkg.version, bun.require('cjs-pkg').version", "('9', '9')"],
  [
    "import esm_pkg\nfrom esm_pkg import default as Client, VERSION, configure, bump, ns\nc = Client(retries=5)\ntype(c).__name__, c.options.retries, Client.defaults.retries, VERSION, isinstance(c, Client)",
    "('JSObject', 5, 3, '1.0.0', True)",
  ],
  [
    "(await c.get('/x')).retries, (await Client().get('/y')).retries, (await Client({'retries': 1}).get('/z')).path",
    "(5, 3, '/z')",
  ],
  ["configure(), configure(a=5), configure({'b': 7}), configure(b=1, a=2)", "([1, 2], [5, 2], [1, 7], [2, 1])"],
  // The attribute of the module is live; a name bound by `from ... import` is a copy, as ever in Python.
  ["from esm_pkg import live\nbump(), bump(), esm_pkg.live, live", "(1, 2, 2, 0)"],
  [
    "ns.feature, ns.default, list(esm_pkg), 'VERSION' in esm_pkg",
    "(True, 'feature default', ['VERSION', 'bump', 'configure', 'default', 'live', 'ns'], True)",
  ],
  ["esm_pkg.VERSION = '2'\n0", "!JSTypeError: TypeError: Attempted to assign to readonly property."],
  [
    "importlib.import_module('esm-pkg/feature').feature, bun.require('esm-pkg/feature').feature, bun.require('esm-pkg/data.json').k[:2]",
    "(True, True, [1, 2])",
  ],
  ["import esm_pkg.feature\nesm_pkg.feature.feature", "True", "ModuleNotFoundError: 'esm_pkg' is not a package"],
  ["from esm_pkg.feature import feature\nfeature", "True", "the same"],
  [
    "importlib.import_module('esm-pkg/data.json').k[:2]",
    "[1, 2]",
    "a dot in a specifier is taken to part a package from a module",
  ],
  [
    "s = importlib.import_module('@scope/pkg')\ns(), s.extra, bun.require('@scope/pkg/main.js').extra",
    "('scoped', 1, 1)",
  ],
  [
    "import typed\ntyped.Color.Red, typed.Color.Green, typed.Color[5], typed.identity(3), typed.N.v, hasattr(typed, 'Unused')",
    "(0, 5, 'Green', 3, 1, False)",
  ],
  ["import awaits\nawaits.value", "'after an await at the top level'"],
  ["import local\nlocal.where, local.dir", "('local.mjs', True)"],
  [
    "bun.require('./conf.json').a, bun.require('./conf.toml').a, bun.require('./note.txt').default",
    "(1, 1, 'hello text\\n')",
  ],
  [
    "m = await js.eval('s => import(s)')(js.Bun.resolveSync('esm-pkg', __file__))\nm is esm_pkg, m.default is Client",
    "(True, True)",
  ],
  ["from esm_pkg import *\nVERSION", "'1.0.0'"],
  [
    "from esm_pkg import missing\n0",
    "!ImportError: cannot import name 'missing' from 'esm_pkg' (unknown location)",
    "the message has no name for the module",
  ],
  [
    "importlib.util.find_spec('cjs_pkg').origin.split('node_modules/')[1]",
    "'cjs-pkg/lib/index.js'",
    "ValueError: cjs_pkg.__spec__ is not set, once it has been imported",
  ],
  ["esm_pkg.__name__", "'esm_pkg'", "a module of JavaScript has no __name__, __file__ or __spec__"],
  ["import no_such_package\n0", "!ModuleNotFoundError: No module named 'no_such_package'"],
]);

group(
  "plugins written in Python; JavaScript imports Python in a program in Python",
  {
    setup: `
import os, json
def setup(build):
    build.onResolve({"filter": js.RegExp("^virtual:")}, lambda args: {"path": args.path, "namespace": "virtual"})
    build.onLoad({"filter": js.RegExp(".*"), "namespace": "virtual"}, lambda args: {"contents": "export const value = 'from a plugin in Python';", "loader": "js"})
    async def load(args):
        text = await bun.file(args.path).text()
        return {"contents": "export default " + js.JSON.stringify(text.strip().upper()), "loader": "js"}
    build.onLoad({"filter": js.RegExp("\\\\.custom$")}, load)
`,
  },
  [
    [
      "r = await bun.build(entrypoints=['./entry.ts'], plugins=[{'name': 'py', 'setup': setup}], target='bun')\ncode = await r.outputs[0].text()\nr.success, len(r.outputs), 'from a plugin in Python' in code, 'RAW CUSTOM' in code",
      "(True, 1, True, True)",
    ],
    [
      "bun.plugin({'name': 'py', 'setup': setup})\n(await js.eval('p => import(p)')(os.path.abspath('entry.ts'))).out",
      "'from a plugin in Python:RAW CUSTOM'",
    ],
    [
      "import mod\nm = await js.eval('p => import(p)')(os.path.abspath('mod.py'))\nm.default is mod, m.x, m.inc()",
      "(True, 41, 42)",
    ],
    [
      "bun.require(os.path.abspath('mod.py')) is mod",
      "True",
      "once import() has loaded the file, require() gives the namespace object; before that, the module",
    ],
    ["mod.x = 100\nm.inc(), m.default.x, m.x", "(101, 100, 41)"],
    ["p = await js.eval(\"() => import('python:json')\")()\np.default is json, p.dumps([1])", "(True, '[1]')"],
    [
      "bun.require('python:json') is json",
      "True",
      "ModuleNotFoundError: bun.require() looks for a package named python:json",
    ],
  ],
);
