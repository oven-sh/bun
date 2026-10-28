// Small programs of several modules, one for each thing a bundler's linker has to get right: which files are CommonJS, `require` of an ES module,
// `import()` of each kind, `export *` with and without CommonJS behind it, ambiguous and missing names, live bindings, what a namespace object is,
// cycles and dead zones, top-level await, what is dropped, the forms of CommonJS exports, loaders, and the names that reach the running program.
// `--aot` links modules by itself and does not go by the bundle, so each program is run three ways: see ./run-three-ways.ts.
//
// By name: the files of the program. The entry point is the file named main.
export const cases: Record<string, Record<string, string>> = {
  "star-and-default-of-an-empty-file": {
    "empty.js": "\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as ns from \"./empty.js\"; import d from \"./empty.js\"; say(Object.keys(ns).join(), typeof d, JSON.stringify(d));\n",
  },
  "a-named-import-of-an-empty-file": {
    "empty.js": "\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { x } from \"./empty.js\"; say(typeof x);\n",
  },
  "require-of-esm-from-cjs": {
    "lib.mjs": "export const a = 1; export default function d() { return 2; } export let n = 0; export const inc = () => ++n;\n",
    "main.cjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; const l = require(\"./lib.mjs\"); l.inc(); say(Object.keys(l).sort().join(), l.__esModule, l.a, l.default(), l.n, Object.prototype.toString.call(l), Object.getPrototypeOf(l) === null, require(\"./lib.mjs\") === l);\n",
  },
  "require-of-esm-from-esm": {
    "lib.mjs": "export const a = 1; export default function d() { return 2; } export let n = 0; export const inc = () => ++n;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; const l = require(\"./lib.mjs\"); const { a, inc } = require(\"./lib.mjs\"); inc(); say(Object.keys(l).sort().join(), l.__esModule, a, l.default(), l.n, require(\"./lib.mjs\").a);\n",
  },
  "one-esm-imported-and-required": {
    "lib.mjs": "export const a = 1; export default 2;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as ns from \"./lib.mjs\"; const r = require(\"./lib.mjs\"); say(Object.keys(ns).sort().join(), \"__esModule\" in ns, ns.__esModule, Object.keys(r).sort().join(), \"__esModule\" in r, r.__esModule, r === ns, Reflect.ownKeys(ns).map(String).join(), Reflect.ownKeys(r).map(String).join());\n",
  },
  "import-of-each-kind": {
    "cjs.cjs": "module.exports = { a: 1, b: 2 };\n",
    "esm.mjs": "export const a = 1; export default 2;\n",
    "fn.cjs": "module.exports = function f() {}; module.exports.p = 1;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; for (const m of [await import(\"./esm.mjs\"), await import(\"./cjs.cjs\"), await import(\"./marked.cjs\"), await import(\"./fn.cjs\")]) say(Object.keys(m).sort().join(), typeof m.default, JSON.stringify(m.default), m.a, m.__esModule);\n",
    "marked.cjs": "Object.defineProperty(exports, \"__esModule\", { value: true }); exports.default = \"d\"; exports.a = 1;\n",
  },
  "a-then-export": {
    "lib.mjs": "export function then(resolve) { resolve(\"from then\"); } export const a = 1;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; const m = await import(\"./lib.mjs\"); say(typeof m, m); import * as ns from \"./lib.mjs\"; say(typeof ns.then, ns.a);\n",
  },
  "an-export-named-module-exports": {
    "lib.mjs": "const v = { custom: true }; export { v as \"module.exports\" }; export const a = 1;\n",
    "main.cjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; const l = require(\"./lib.mjs\"); say(l, l.a, l.custom);\n",
  },
  "commonjs-names-in-an-es-module": {
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import \"./other.mjs\"; say(typeof module, typeof exports, typeof require, typeof __filename, typeof __dirname, typeof this, typeof import.meta.url, typeof import.meta.require);\n",
    "other.mjs": "export {};\n",
  },
  "exports-stored-in-a-file-with-export": {
    "lib.js": "export const a = 1; exports.b = 2; module.exports.c = 3;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as ns from \"./lib.js\"; say(Object.keys(ns).sort().join(), ns.a, ns.b, ns.c);\n",
  },
  "the-entry-point-is-imported-back": {
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { seen, early } from \"./other.mjs\"; export const v = 5; export function f() { return \"hoisted\"; } say(early, seen().join());\n",
    "other.mjs": "import { v, f } from \"./main.mjs\"; export const seen = () => [typeof f, f(), (() => { try { return v; } catch (e) { return e.constructor.name; } })()];  export const early = seen().join();\n",
  },
  "this-return-arguments-at-the-top-of-commonjs": {
    "lib.cjs": "exports.a = this === exports; exports.b = this === module.exports; exports.n = arguments.length; exports.t = [typeof arguments[0], typeof arguments[1], typeof arguments[2], typeof arguments[3], typeof arguments[4]].join(); if (exports.a) return; exports.unreached = 1;\n",
    "main.cjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; say(require(\"./lib.cjs\"), this === exports, arguments.length);\n",
  },
  "umd": {
    "lib.js": "(function (root, factory) { if (typeof define === \"function\" && define.amd) define([], factory); else if (typeof module === \"object\" && module.exports) module.exports = factory(); else root.Lib = factory(); })(typeof self !== \"undefined\" ? self : this, function () { return { kind: \"umd\" }; });\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import lib from \"./lib.js\"; import * as ns from \"./lib.js\"; say(lib.kind, Object.keys(ns).sort().join(), typeof globalThis.Lib, require(\"./lib.js\").kind);\n",
  },
  "module-exports-is-a-require": {
    "a.cjs": "module.exports = require(\"./b.cjs\");\n",
    "b.cjs": "module.exports = require(\"./c.cjs\");\n",
    "c.cjs": "exports.x = 1; exports.f = function () { return this === exports; };\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import a, { x, f } from \"./a.cjs\"; import c from \"./c.cjs\"; say(x, a === c, a.f(), tryit(() => f()), Object.keys(a).join());\n",
  },
  "freeze-define-delete-on-a-held-default": {
    "lib.cjs": "exports.a = 1; exports.b = 2; exports.read = () => [exports.a, exports.b, exports.c].join();\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import lib from \"./lib.cjs\"; Object.defineProperty(lib, \"c\", { value: 3, enumerable: true }); delete lib.b; lib.a = 9; say(lib.read(), Object.keys(lib).join()); Object.freeze(lib); say(Object.isFrozen(lib), tryit(() => { \"use strict\"; lib.a = 1; return \"stored\"; }), require(\"./lib.cjs\") === lib);\n",
  },
  "export-star": {
    "a.mjs": "export const a = 1, shadowed = \"a\"; export default \"not through a star\";\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as ns from \"./star.mjs\"; import { a, shadowed } from \"./star.mjs\"; say(Object.keys(ns).join(), a, shadowed, \"default\" in ns);\n",
    "star.mjs": "export * from \"./a.mjs\"; export const shadowed = \"star\", own = 2;\n",
  },
  "two-stars-one-name": {
    "a.mjs": "export const x = \"a\", onlyA = 1;\n",
    "b.mjs": "export const x = \"b\", onlyB = 2;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as ns from \"./star.mjs\"; say(Object.keys(ns).join(), ns.x, \"x\" in ns);\n",
    "star.mjs": "export * from \"./a.mjs\"; export * from \"./b.mjs\";\n",
  },
  "an-ambiguous-name-imported": {
    "a.mjs": "export const x = \"a\";\n",
    "b.mjs": "export const x = \"b\";\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { x } from \"./star.mjs\"; say(x);\n",
    "star.mjs": "export * from \"./a.mjs\"; export * from \"./b.mjs\";\n",
  },
  "a-diamond-is-not-ambiguous": {
    "base.mjs": "export const x = \"base\";\n",
    "l.mjs": "export * from \"./base.mjs\";\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { x } from \"./star.mjs\"; import * as ns from \"./star.mjs\"; say(x, Object.keys(ns).join());\n",
    "r.mjs": "export { x } from \"./base.mjs\";\n",
    "star.mjs": "export * from \"./l.mjs\"; export * from \"./r.mjs\";\n",
  },
  "export-star-of-commonjs": {
    "c.cjs": "exports.fromCjs = 1; exports.late = undefined; setTimeout(() => { exports.late = \"late\"; exports.added = \"added\"; }, 0); exports.default = \"cjs default\";\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as ns from \"./star.mjs\"; import { fromCjs, own, late } from \"./star.mjs\"; say(Object.keys(ns).sort().join(), fromCjs, own, late, \"default\" in ns); setTimeout(() => say(late, ns.late, ns.added, Object.keys(ns).sort().join()), 5);\n",
    "star.mjs": "export * from \"./c.cjs\"; export const own = 2;\n",
  },
  "commonjs-in-the-middle-of-stars": {
    "base.mjs": "export const deep = \"esm\";\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { deep, mid, top } from \"./top.mjs\"; import * as ns from \"./top.mjs\"; say(deep, mid, top, Object.keys(ns).sort().join());\n",
    "mid.cjs": "Object.assign(exports, require(\"./base.mjs\")); exports.mid = \"cjs\";\n",
    "top.mjs": "export * from \"./mid.cjs\"; export const top = 1;\n",
  },
  "export-star-as": {
    "a.mjs": "export const a = 1; export default 2;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { inner, same } from \"./star.mjs\"; say(Object.keys(inner).join(), inner.default, inner === same);\n",
    "star.mjs": "export * as inner from \"./a.mjs\"; import * as same from \"./a.mjs\"; export { same };\n",
  },
  "stars-in-a-cycle": {
    "a.mjs": "export * from \"./b.mjs\"; export const a = 1;\n",
    "b.mjs": "export * from \"./a.mjs\"; export const b = 2;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as A from \"./a.mjs\"; import * as B from \"./b.mjs\"; say(Object.keys(A).join(), Object.keys(B).join());\n",
  },
  "a-written-reexport-wins-over-a-star": {
    "a.mjs": "export const x = \"a\";\n",
    "b.mjs": "export const x = \"b\";\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { x } from \"./star.mjs\"; say(x);\n",
    "star.mjs": "export * from \"./a.mjs\"; export { x } from \"./b.mjs\";\n",
  },
  "chains-of-reexports": {
    "a.mjs": "export let v = 1; export const bump = () => ++v;\n",
    "b.mjs": "export { v as w, bump } from \"./a.mjs\";\n",
    "c.mjs": "export { w as x, bump as default } from \"./b.mjs\";\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import bump, { x } from \"./c.mjs\"; const before = x; bump(); say(before, x);\n",
  },
  "a-cycle-of-reexports": {
    "foo.mjs": "export { a as b } from \"./foo.mjs\"; export { b as c } from \"./foo.mjs\"; export { c as a } from \"./foo.mjs\";\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { a } from \"./foo.mjs\"; say(typeof a);\n",
  },
  "a-missing-export-of-esm": {
    "lib.mjs": "export const a = 1;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { nope } from \"./lib.mjs\"; say(typeof nope);\n",
  },
  "a-missing-name-off-a-namespace": {
    "lib.mjs": "export const a = 1;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as ns from \"./lib.mjs\"; const { nope, toString, hasOwnProperty, a } = ns; const d = await import(\"./lib.mjs\"); const { toString: t2, valueOf } = d; const r = require(\"./lib.mjs\"); say(ns.nope, nope, toString, hasOwnProperty, a, t2, valueOf, typeof r.toString, ns[\"no\" + \"pe\"]);\n",
  },
  "a-type-reexported-from-typescript": {
    "main.ts": "import * as ns from \"./mid\"; import { real, type T } from \"./mid\"; const t: T = { a: real }; console.log(Object.keys(ns).join(), t.a);\n",
    "mid.ts": "export { T, I, real } from \"./types\";\n",
    "types.ts": "export type T = { a: number }; export interface I { b: string } export const real = 1;\n",
  },
  "a-missing-name-of-commonjs": {
    "lib.cjs": "exports.a = 1;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { nope, a } from \"./lib.cjs\"; say(typeof nope, a);\n",
  },
  "export-default-of-an-import": {
    "a.mjs": "export let n = 1; export const inc = () => ++n;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import snap, { live } from \"./snap.mjs\"; import nsd from \"./nsd.mjs\"; import * as a from \"./a.mjs\"; a.inc(); say(snap, live, nsd === a, nsd.n);\n",
    "nsd.mjs": "import * as ns from \"./a.mjs\"; export default ns;\n",
    "snap.mjs": "import { n } from \"./a.mjs\"; export default n; export { n as live };\n",
  },
  "default-live-or-a-snapshot": {
    "fn.mjs": "export default function f() { return 1; } export const replace = () => { f = () => 2; };\n",
    "lib.mjs": "let x = 1; export { x as default }; export const setX = v => { x = v; }; let y = 1; export const getY = () => y; export const setY = v => { y = v; };\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import x, { setX } from \"./lib.mjs\"; import f, { replace } from \"./fn.mjs\"; setX(5); replace(); say(x, f());\n",
  },
  "toesm-by-the-kind-of-the-importer": {
    "from-js.js": "import d, * as ns from \"./marked.cjs\"; import e from \"./nodefault.cjs\"; export const js = [typeof d, Object.keys(ns).sort().join(), typeof e].join(\" \");\n",
    "from-mjs.mjs": "import d, * as ns from \"./marked.cjs\"; import e from \"./nodefault.cjs\"; export const mjs = [typeof d, Object.keys(ns).sort().join(), typeof e].join(\" \");\n",
    "from-ts.ts": "// @ts-nocheck\nimport d, * as ns from \"./marked.cjs\"; import e from \"./nodefault.cjs\"; export const ts = [typeof d, Object.keys(ns).sort().join(), typeof e].join(\" \");\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { js } from \"./from-js.js\"; import { mjs } from \"./from-mjs.mjs\"; import { ts } from \"./from-ts.ts\"; say(\"js:\", js, \"| mjs:\", mjs, \"| ts:\", ts);\n",
    "marked.cjs": "Object.defineProperty(exports, \"__esModule\", { value: true }); exports.default = \"the default\"; exports.named = 1;\n",
    "nodefault.cjs": "Object.defineProperty(exports, \"__esModule\", { value: true }); exports.named = 1;\n",
  },
  "names-of-commonjs-are-read-each-time": {
    "lib.cjs": "let n = 0; Object.defineProperty(exports, \"counted\", { get() { return ++n; }, enumerable: true }); exports.plain = 1; exports.change = () => { exports.plain = 2; };\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { counted, plain, change } from \"./lib.cjs\"; const a = counted, b = counted; change(); say(a, b, plain);\n",
  },
  "this-of-an-imported-function": {
    "esm.mjs": "export function who() { return this === undefined ? \"undefined\" : typeof this; }\n",
    "lib.cjs": "exports.who = function () { return this === undefined ? \"undefined\" : this === exports ? \"exports\" : typeof this; };\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { who } from \"./lib.cjs\"; import lib from \"./lib.cjs\"; import * as cns from \"./lib.cjs\"; import * as ens from \"./esm.mjs\"; import { who as ewho } from \"./esm.mjs\"; say(who(), lib.who(), cns.who(), ewho(), ens.who(), (0, ens.who)(), ens[\"who\"]());\n",
  },
  "stores-to-imports": {
    "lib.mjs": "export let x = 1;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as ns from \"./lib.mjs\"; say(tryit(() => { ns.x = 2; return \"stored\"; }), tryit(() => { ns.y = 2; return \"stored\"; }), tryit(() => delete ns.x), tryit(() => delete ns.nope), tryit(() => Object.defineProperty(ns, \"x\", { value: 3 })), tryit(() => Object.setPrototypeOf(ns, {})), tryit(() => Object.setPrototypeOf(ns, null)), ns.x);\n",
  },
  "what-a-namespace-object-is": {
    "lib.mjs": "export const b = 1, a = 2; export default 3; export function z() {} export let c; export { b as \"x y\" };\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as ns from \"./lib.mjs\"; const d = Object.getOwnPropertyDescriptor(ns, \"a\"); say(Reflect.ownKeys(ns).map(String).join(), Object.prototype.toString.call(ns), Object.getPrototypeOf(ns), Object.isExtensible(ns), Object.isSealed(ns), Object.isFrozen(ns), d, Object.getOwnPropertyDescriptor(ns, Symbol.toStringTag), typeof ns, JSON.stringify(ns), \"a\" in ns, Object.keys({ ...ns }).join(), String(tryit(() => `${ns}`)));\n",
  },
  "one-namespace-object": {
    "lib.mjs": "export const a = 1;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as ns from \"./lib.mjs\"; import { ns as theirs, again } from \"./other.mjs\"; const d = await import(\"./lib.mjs\"); say(ns === theirs, ns === again, ns === d, (await import(\"./lib.mjs\")) === d, require(\"./lib.mjs\") === ns);\n",
    "other.mjs": "import * as ns from \"./lib.mjs\"; export { ns }; export * as again from \"./lib.mjs\";\n",
  },
  "the-order-of-evaluation": {
    "a.mjs": "globalThis.log ??= []; const note = s => globalThis.log.push(s); note(\"a\"); import \"./c.mjs\";\n",
    "b.mjs": "globalThis.log ??= []; const note = s => globalThis.log.push(s); note(\"b\");\n",
    "c.mjs": "globalThis.log ??= []; const note = s => globalThis.log.push(s); note(\"c\");\n",
    "main.mjs": "globalThis.log ??= []; const note = s => globalThis.log.push(s); note(\"main\"); import \"./a.mjs\"; import \"./b.mjs\"; export * from \"./c.mjs\"; note(\"before require\"); require(\"./r.cjs\"); note(\"after require\"); await import(\"./b.mjs\"); console.log(globalThis.log.join());\n",
    "r.cjs": "globalThis.log ??= []; const note = s => globalThis.log.push(s); note(\"r\");\n",
  },
  "dead-zones-in-a-cycle": {
    "a.mjs": "import { readA, fnB } from \"./b.mjs\"; export const early = [readA(), fnB()].join(); export const a = \"a\"; export class K {} export function hoisted() { return \"hoisted\"; } export var v = \"var\";\n",
    "b.mjs": "import { a, K, hoisted, v } from \"./a.mjs\"; const t = f => { try { return String(f()); } catch (e) { return e.constructor.name; } }; export const readA = () => [t(() => a), t(() => K.name), t(() => hoisted()), t(() => v)].join(\"|\"); export function fnB() { return \"b\"; }\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { early } from \"./a.mjs\"; import { readA } from \"./b.mjs\"; say(early, readA());\n",
  },
  "a-cycle-of-commonjs": {
    "a.cjs": "exports.first = 1; const b = require(\"./b.cjs\"); exports.sawB = Object.keys(b).join(); exports.last = 2;\n",
    "b.cjs": "const a = require(\"./a.cjs\"); exports.sawA = Object.keys(a).join(); exports.later = () => Object.keys(a).join();\n",
    "main.cjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; const a = require(\"./a.cjs\"), b = require(\"./b.cjs\"); say(a.sawB, b.sawA, b.later());\n",
  },
  "a-cycle-across-the-kinds": {
    "a.mjs": "import b from \"./b.cjs\"; export const a = \"a\"; export const fromB = b.seen;\n",
    "b.cjs": "let seen; try { const a = require(\"./a.mjs\"); seen = Object.keys(a).join() + \":\" + (() => { try { return a.a; } catch (e) { return e.constructor.name; } })(); } catch (e) { seen = \"require: \" + e.constructor.name; } exports.seen = seen;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { fromB } from \"./a.mjs\"; say(fromB);\n",
  },
  "top-level-await-and-siblings": {
    "fast.mjs": "globalThis.log ??= []; const note = s => globalThis.log.push(s); note(\"fast\");\n",
    "main.mjs": "globalThis.log ??= []; const note = s => globalThis.log.push(s); import \"./user.mjs\"; import \"./fast.mjs\"; note(\"main\"); console.log(globalThis.log.join());\n",
    "slow.mjs": "globalThis.log ??= []; const note = s => globalThis.log.push(s); note(\"slow starts\"); await new Promise(r => setTimeout(r, 20)); note(\"slow ends\"); export const s = 1;\n",
    "user.mjs": "globalThis.log ??= []; const note = s => globalThis.log.push(s); import { s } from \"./slow.mjs\"; note(\"user \" + s);\n",
  },
  "a-rejected-top-level-await": {
    "bad.mjs": "await Promise.reject(new RangeError(\"from bad\"));\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; const a = await import(\"./bad.mjs\").catch(e => e.message); const b = await import(\"./bad.mjs\").catch(e => e.message); say(a, b);\n",
  },
  "a-module-that-throws": {
    "bad.cjs": "globalThis.runs = (globalThis.runs || 0) + 1; exports.partial = 1; throw new RangeError(\"run \" + globalThis.runs);\n",
    "bad.mjs": "globalThis.eruns = (globalThis.eruns || 0) + 1; throw new RangeError(\"esm run \" + globalThis.eruns);\n",
    "main.cjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; const t = f => { try { return f(); } catch (e) { return e.message; } }; (async () => { say(t(() => require(\"./bad.cjs\")), t(() => require(\"./bad.cjs\")), globalThis.runs, await import(\"./bad.mjs\").catch(e => e.message), await import(\"./bad.mjs\").catch(e => e.message), globalThis.eruns); })();\n",
  },
  "functions-hoisted-over-imports": {
    "helper.mjs": "export function helper() {}\n",
    "lib.mjs": "export const v = use(); function use() { return typeof helper; } import { helper } from \"./helper.mjs\";\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; say(v); import { v } from \"./lib.mjs\";\n",
  },
  "side-effects-false": {
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import \"pure\"; import { x } from \"pure\"; import { y } from \"some\"; import \"some/effect.js\"; say(globalThis.pureRan, globalThis.someRan, globalThis.effectRan);\n",
    "node_modules/pure/index.js": "globalThis.pureRan = true; exports.x = 1;\n",
    "node_modules/pure/package.json": "{ \"name\": \"pure\", \"version\": \"1.0.0\", \"sideEffects\": false, \"main\": \"index.js\" }\n",
    "node_modules/some/effect.js": "globalThis.effectRan = true;\n",
    "node_modules/some/index.js": "globalThis.someRan = true; exports.y = 1;\n",
    "node_modules/some/package.json": "{ \"name\": \"some\", \"version\": \"1.0.0\", \"sideEffects\": [\"./effect.js\"], \"main\": \"index.js\" }\n",
  },
  "an-unused-import-of-a-file-with-effects": {
    "effect.mjs": "globalThis.ran = true; export const unused = 1;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { unused } from \"./effect.mjs\"; say(globalThis.ran);\n",
  },
  "pure-marks-and-unused-statements": {
    "lib.mjs": "const effect = n => { (globalThis.calls ??= []).push(n); return n; }; const a = /* @__PURE__ */ effect(\"pure unused\"); const b = effect(\"plain unused\"); export const c = /* @__PURE__ */ effect(\"pure exported unused\"); export const d = /* @__PURE__ */ effect(\"pure used\"); /* @__NO_SIDE_EFFECTS__ */ function quiet(n) { return effect(n); } const e = quiet(\"no side effects unused\"); new (class { constructor() { effect(\"new unused\"); } })(); export function unusedFn() { effect(\"never\"); }\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { d } from \"./lib.mjs\"; say(d, globalThis.calls);\n",
  },
  "branches-known-at-the-build": {
    "browser.cjs": "(globalThis.loaded ??= []).push(\"browser\");\n",
    "dev.cjs": "(globalThis.loaded ??= []).push(\"dev\"); exports.kind = \"dev\";\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; if (false) require(\"./never.cjs\"); if (typeof window !== \"undefined\") require(\"./browser.cjs\"); const x = process.env.NODE_ENV === \"production\" ? require(\"./prod.cjs\") : require(\"./dev.cjs\"); say(x.kind, globalThis.loaded);\n",
    "never.cjs": "(globalThis.loaded ??= []).push(\"never\");\n",
    "prod.cjs": "(globalThis.loaded ??= []).push(\"prod\"); exports.kind = \"prod\";\n",
  },
  "a-missing-module-behind-try": {
    "main.cjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; let a; try { a = require(\"not-installed-anywhere\"); } catch (e) { a = e.code || e.constructor.name; } let b; try { b = require(\"./not-here.js\"); } catch (e) { b = e.code || e.constructor.name; } (async () => { say(a, b, await import(\"also-not-installed\").catch(e => e.code || e.constructor.name)); })();\n",
  },
  "barrels": {
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { a } from \"barrel\"; say(a, globalThis.loaded);\n",
    "node_modules/barrel/a.js": "(globalThis.loaded ??= []).push(\"a\"); export const a = 1;\n",
    "node_modules/barrel/b.js": "(globalThis.loaded ??= []).push(\"b\"); export const b = 2;\n",
    "node_modules/barrel/c.js": "(globalThis.loaded ??= []).push(\"c\"); export const c = 3;\n",
    "node_modules/barrel/index.js": "export { a } from \"./a.js\"; export { b } from \"./b.js\"; export * from \"./c.js\";\n",
    "node_modules/barrel/package.json": "{ \"name\": \"barrel\", \"version\": \"1.0.0\", \"sideEffects\": false, \"type\": \"module\", \"main\": \"index.js\" }\n",
  },
  "forms-of-exports": {
    "a.cjs": "exports.x = 1; module.exports.y = 2; this.z = 3; exports[\"w\"] = 4; Object.defineProperty(exports, \"v\", { value: 5, enumerable: true }); Object.assign(module.exports, { u: 6 });\n",
    "b.cjs": "exports = module.exports = function f() {}; exports.p = 1;\n",
    "c.cjs": "exports.lost = 1; module.exports = { kept: 2 }; exports.alsoLost = 3;\n",
    "d.cjs": "const k = \"comp\" + \"uted\"; exports[k] = 1; for (const n of [\"l1\", \"l2\"]) exports[n] = n; delete exports.l1;\n",
    "e.cjs": "function fill(o) { o.filled = 1; } fill(exports); const alias = module; alias.exports.viaAlias = 2; const { exports: ex } = module; ex.viaPattern = 3;\n",
    "g.cjs": "module.exports = class K { static s = 1; }; module.exports.extra = 2;\n",
    "h.cjs": "module.exports = 42;\n",
    "i.cjs": "module.exports = null;\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import * as a from \"./a.cjs\"; import * as b from \"./b.cjs\"; import * as c from \"./c.cjs\"; import * as d from \"./d.cjs\"; import * as e from \"./e.cjs\"; import * as g from \"./g.cjs\"; import h from \"./h.cjs\"; import i from \"./i.cjs\"; import { x, y, z, w, v, u } from \"./a.cjs\"; import { computed, l2 } from \"./d.cjs\"; import { filled, viaAlias, viaPattern } from \"./e.cjs\"; for (const m of [a, b, c, d, e, g]) say(Object.keys(m).sort().join()); say(x, y, z, w, v, u, computed, l2, filled, viaAlias, viaPattern, h, i);\n",
  },
  "the-module-object": {
    "lib.cjs": "exports.m = [typeof module.id, typeof module.filename, module.loaded, Array.isArray(module.children), Array.isArray(module.paths), typeof module.parent, typeof module.require, module.exports === exports, require.main === module, typeof require.resolve, typeof require.cache, Object.keys(module).sort().join()].join(\" \");\n",
    "main.cjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; say(require(\"./lib.cjs\").m, require.main === module, module.loaded, Object.keys(require.cache).length > 0, typeof require.resolve(\"./lib.cjs\"));\n",
  },
  "require-cache": {
    "lib.cjs": "globalThis.n = (globalThis.n || 0) + 1; exports.n = globalThis.n;\n",
    "main.cjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; const a = require(\"./lib.cjs\"); const key = require.resolve(\"./lib.cjs\"); const had = key in require.cache; delete require.cache[key]; const b = require(\"./lib.cjs\"); say(a.n, b.n, a === b, had);\n",
  },
  "filename-dirname-url-of-each-module": {
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import l from \"./sub/lib.cjs\"; import * as e from \"./sub/esm.mjs\"; say(l, e, import.meta.main);\n",
    "sub/esm.mjs": "const tail = s => String(s).split(/[\\\\/]/).slice(-2).join(\"/\"); export const u = tail(import.meta.url), d = tail(import.meta.dir), f = import.meta.file, m = import.meta.main, p = tail(import.meta.path), dn = tail(import.meta.dirname), fn = tail(import.meta.filename);\n",
    "sub/lib.cjs": "const p = require(\"node:path\"); exports.f = p.basename(__filename); exports.d = p.basename(__dirname);\n",
  },
  "globals-do-not-leak": {
    "a.cjs": "var leaked = \"a\"; function fnLeaked() {} implicit = \"sloppy global\";\n",
    "b.mjs": "var leakedEsm = \"b\"; export {};\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import \"./a.cjs\"; import \"./b.mjs\"; say(typeof leaked, typeof fnLeaked, typeof implicit, typeof leakedEsm, typeof globalThis.leaked, globalThis.implicit);\n",
  },
  "requires-that-are-not-plain": {
    "data/one.cjs": "exports.n = 1;\n",
    "data/two.cjs": "exports.n = 2;\n",
    "main.cjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; const r = require; const alias = r(\"./data/one.cjs\").n; const cond = require(true ? \"./data/one.cjs\" : \"./data/two.cjs\").n; const tpl = require(`./data/two.cjs`).n; const paren = (require)(\"./data/one.cjs\").n; const opt = require?.(\"./data/two.cjs\").n; const call = require.call(null, \"./data/one.cjs\").n; const mr = module.require(\"./data/two.cjs\").n; say(alias, cond, tpl, paren, opt, call, mr, typeof require(\"./data/one.cjs\", \"extra\"));\n",
  },
  "json-as-a-module": {
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import p, { name, version, nested } from \"./p.json\"; import * as ns from \"./p.json\"; const r = require(\"./p.json\"); p.added = 1; nested.a.push(3); say(name, version, p.default, Object.keys(ns).sort().join(), r === p, r.added, p.nested === nested, r.nested.a, (await import(\"./p.json\")).default === p, ns[\"a-b\"]);\n",
    "p.json": "{ \"name\": \"p\", \"version\": \"1.2.3\", \"nested\": { \"a\": [1, 2] }, \"default\": \"a key named default\", \"a-b\": 1 }\n",
  },
  "text-and-files-as-modules": {
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import t from \"./t.txt\"; import * as ns from \"./t.txt\"; say(t.trim(), Object.keys(ns).join(), typeof require(\"./t.txt\"), typeof (await import(\"./t.txt\")).default);\n",
    "t.txt": "text body\n",
  },
  "names-of-exports": {
    "lib.mjs": "const a = 1; export { a as \"a-b\", a as \"\", a as \"😀\", a as default, a as \"default2\", a as if, a as class, a as then2 }; export { a as __proto__ }; export { a as constructor, a as toString };\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { \"a-b\" as ab, \"\" as empty, \"😀\" as face, default as d, if as i, class as c, __proto__ as p, constructor as k, toString as t } from \"./lib.mjs\"; import * as ns from \"./lib.mjs\"; say(ab, empty, face, d, i, c, p, k, t, Reflect.ownKeys(ns).map(String).join(\"|\"), ns.__proto__, ns[\"a-b\"]);\n",
  },
  "forms-of-export-default": {
    "a.mjs": "export default function () {}\n",
    "b.mjs": "export default class {}\n",
    "c.mjs": "export default () => {};\n",
    "d.mjs": "export default (function () {});\n",
    "e.mjs": "export default async function named() {}\n",
    "g.mjs": "export default class Named {}\n",
    "h.mjs": "export default [1].map(x => x);\n",
    "i.mjs": "const f = function () {}; export default f;\n",
    "j.mjs": "export default (class {});\n",
    "k.mjs": "export default function* () {}\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import a from \"./a.mjs\"; import b from \"./b.mjs\"; import c from \"./c.mjs\"; import d from \"./d.mjs\"; import e from \"./e.mjs\"; import g from \"./g.mjs\"; import h from \"./h.mjs\"; import i from \"./i.mjs\"; import j from \"./j.mjs\"; import k from \"./k.mjs\"; console.log([a, b, c, d, e, g, i, j, k].map(x => JSON.stringify(x.name)).join(), h);\n",
  },
  "a-named-import-of-esm-and-nothing-else": {
    "lib.mjs": "export const a = 1; export function f() { return 2; } export let n = 0; export default 3;\n",
    "main.mjs": "import { a, f, n } from \"./lib.mjs\"; globalThis.sink = [a, f(), n];\n",
  },
  "members-of-a-namespace-import-and-nothing-else": {
    "lib.mjs": "export const a = 1; export function f() { return 2; } export let n = 0; export default 3;\n",
    "main.mjs": "import * as ns from \"./lib.mjs\"; globalThis.sink = [ns.a, ns.f(), ns.n, ns.default];\n",
  },
  "a-namespace-import-as-a-value-and-nothing-else": {
    "lib.mjs": "export const a = 1; export function f() { return 2; } export let n = 0; export default 3;\n",
    "main.mjs": "import * as ns from \"./lib.mjs\"; globalThis.sink = ns;\n",
  },
  "require-of-esm-from-esm-members-and-nothing-else": {
    "lib.mjs": "export const a = 1; export function f() { return 2; } export let n = 0; export default 3;\n",
    "main.mjs": "import \"./other.mjs\"; globalThis.sink = [require(\"./lib.mjs\").a, require(\"./lib.mjs\").f()];\n",
    "other.mjs": "export {};\n",
  },
  "require-of-esm-from-esm-a-pattern-and-nothing-else": {
    "lib.mjs": "export const a = 1; export function f() { return 2; } export let n = 0; export default 3;\n",
    "main.mjs": "import \"./other.mjs\"; const { a, f } = require(\"./lib.mjs\"); globalThis.sink = [a, f()];\n",
    "other.mjs": "export {};\n",
  },
  "require-of-esm-from-cjs-and-nothing-else": {
    "lib.mjs": "export const a = 1; export function f() { return 2; } export let n = 0; export default 3;\n",
    "main.cjs": "const l = require(\"./lib.mjs\"); globalThis.sink = [l.a, l.f()];\n",
  },
  "named-imports-of-commonjs-and-nothing-else": {
    "lib.cjs": "exports.a = 1; exports.f = function () { return 2; };\n",
    "main.mjs": "import { a, f } from \"./lib.cjs\"; globalThis.sink = [a, f()];\n",
  },
  "the-default-import-of-commonjs-and-nothing-else": {
    "lib.cjs": "exports.a = 1; exports.f = function () { return 2; };\n",
    "main.mjs": "import l from \"./lib.cjs\"; globalThis.sink = [l.a, l.f()];\n",
  },
  "require-of-commonjs-and-nothing-else": {
    "lib.cjs": "exports.a = 1; exports.f = function () { return 2; };\n",
    "main.cjs": "const l = require(\"./lib.cjs\"); const { a } = require(\"./lib.cjs\"); globalThis.sink = [l.a, l.f(), a, require(\"./lib.cjs\").a];\n",
  },
  "import-call-of-esm-and-nothing-else": {
    "lib.mjs": "export const a = 1; export function f() { return 2; } export let n = 0; export default 3;\n",
    "main.mjs": "const { a, f } = await import(\"./lib.mjs\"); globalThis.sink = [a, f(), (await import(\"./lib.mjs\")).n];\n",
  },
  "a-reexport-and-a-star-and-nothing-else": {
    "lib.mjs": "export const a = 1; export function f() { return 2; } export let n = 0; export default 3;\n",
    "main.mjs": "import { b, f } from \"./mid.mjs\"; globalThis.sink = [b, f()];\n",
    "mid.mjs": "export { a as b } from \"./lib.mjs\"; export * from \"./lib.mjs\";\n",
  },
  "json-and-nothing-else": {
    "main.mjs": "import p, { name } from \"./p.json\"; globalThis.sink = [p.n, name];\n",
    "p.json": "{ \"name\": \"p\", \"n\": 1 }\n",
  },
  "commonjs-whose-names-are-not-known-and-nothing-else": {
    "lib.cjs": "for (const k of [\"a\", \"b\"]) exports[k] = 1;\n",
    "main.mjs": "import { a } from \"./lib.cjs\"; globalThis.sink = a;\n",
  },
  "nothing-and-nothing-else": {
    "main.mjs": "globalThis.sink = 1;\n",
  },
  "one-name-in-two-files": {
    "a.mjs": "function helper() { return \"a\"; } class Box {} const arrow = () => {}; const obj = { method() {} }; export const A = [helper.name, Box.name, arrow.name, obj.method.name, String(helper).slice(0, 17), String(Box), new Box().constructor.name, (() => { try { null.x; } catch (e) { return e.stack.split(\"\\n\")[1].trim().split(\" \")[1]; } })()];\n",
    "b.mjs": "function helper() { return \"b\"; } class Box {} const arrow = () => {}; const obj = { method() {} }; export const B = [helper.name, Box.name, arrow.name, obj.method.name, String(helper).slice(0, 17), String(Box), new Box().constructor.name];\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { A } from \"./a.mjs\"; import { B } from \"./b.mjs\"; function helper() {} class Box {} say(A, B, helper.name, Box.name);\n",
  },
  "names-in-stacks-and-messages": {
    "a.mjs": "function thrower() { throw new Error(\"a\"); } export const stackA = () => { try { thrower(); } catch (e) { return e.stack.split(\"\\n\").slice(1, 3).map(l => l.trim().split(\" \")[1]).join(); } }; const notFn = 1; export const msgA = () => { try { notFn(); } catch (e) { return e.message; } };\n",
    "b.mjs": "function thrower() { throw new Error(\"b\"); } export const stackB = () => { try { thrower(); } catch (e) { return e.stack.split(\"\\n\").slice(1, 3).map(l => l.trim().split(\" \")[1]).join(); } }; const notFn = 2; export const msgB = () => { try { notFn(); } catch (e) { return e.message; } }; export const tdz = () => { try { return late; } catch (e) { return e.message; } }; export const early = tdz(); const late = 1; export const undef = () => { try { return missingName; } catch (e) { return e.message; } };\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { stackA, msgA } from \"./a.mjs\"; import { stackB, msgB, early, undef } from \"./b.mjs\"; say(stackA(), stackB(), msgA(), msgB(), early, undef());\n",
  },
  "direct-eval-and-with-look-names-up": {
    "a.cjs": "var shared = \"a\"; function helper() { return \"helper a\"; } exports.a = [eval(\"shared\"), eval(\"helper()\"), eval(\"typeof require\"), eval(\"var made = 1; made\"), typeof made, new Function(\"return typeof shared\")()];\n",
    "b.cjs": "var shared = \"b\"; function helper() { return \"helper b\"; } with ({ shared: \"from with\" }) { exports.w = [shared, helper()]; } exports.b = [eval(\"shared\"), (0, eval)(\"typeof shared\")];\n",
    "main.cjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; var shared = \"main\"; say(require(\"./a.cjs\").a, require(\"./b.cjs\"), eval(\"shared\"));\n",
  },
  "inner-names-that-look-renamed": {
    "a.mjs": "const value = \"a\"; export const readA = () => { const value2 = \"inner\"; return [value, value2].join(); };\n",
    "b.mjs": "const value = \"b\"; const value2 = \"b2\"; export const readB = () => { const value3 = \"inner\"; return [value, value2, value3].join(); };\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { readA } from \"./a.mjs\"; import { readB } from \"./b.mjs\"; const value = \"main\", value2 = \"main2\", value3 = \"main3\"; say(readA(), readB(), value, value2, value3);\n",
  },
  "reserved-and-global-names-at-the-top": {
    "a.mjs": "const Object2 = 1; const Promise = \"mine\"; const undefined2 = 2; function Array() { return \"my Array\"; } const console2 = 3; const require2 = 4; const exports2 = 5; const module2 = 6; export const a = [Promise, Array(), typeof globalThis.Promise, [].constructor === globalThis.Array];\n",
    "b.mjs": "export const b = [typeof Promise, typeof Array, Array.isArray([])];\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import { a } from \"./a.mjs\"; import { b } from \"./b.mjs\"; say(a, b);\n",
  },
  "names-given-by-assignment": {
    "anon.mjs": "export default () => {};\n",
    "main.mjs": "const say = (...v) => console.log(...v.map(x => typeof x === \"function\" ? \"fn:\" + x.name : typeof x === \"symbol\" ? String(x) : typeof x === \"object\" && x !== null ? JSON.stringify(x) : String(x))); const tryit = f => { try { return f(); } catch (e) { return e.constructor.name; } }; import anon from \"./anon.mjs\"; const a = function () {}, b = () => {}, c = class {}; let d; d = function () {}; const o = { e: function () {}, f: () => {}, [\"g\" + 1]: () => {}, h: class {} }; const { i = () => {} } = {}; const [j = class {}] = []; function k(l = () => {}) { return l; } class M { n = () => {}; static o = function () {}; #p = () => {}; q() { return this.#p; } } const r = (0, function () {}); const s = (() => {}); const t = a; var u = u || function () {}; say([a, b, c, d, o.e, o.f, o.g1, o.h, i, j, k(), new M().n, M.o, new M().q(), r, s, t, u, anon].map(x => x.name).join(\"|\"));\n",
  },
  "a-cycle-across-the-kinds-cut-finer": {
    "a.mjs": "import b from \"./b.cjs\"; export const a = \"a\"; export function hoisted() { return \"h\"; } export var v = \"v\"; export const fromB = b.seen;\n",
    "b.cjs": "const t = f => { try { return f(); } catch (e) { return e.constructor.name; } };\nconst out = [];\nlet a;\nout.push(\"require: \" + t(() => { a = require(\"./a.mjs\"); return typeof a; }));\nout.push(\"hoisted: \" + t(() => a.hoisted()));\nout.push(\"var: \" + t(() => a.v));\nout.push(\"const: \" + t(() => a.a));\nout.push(\"keys: \" + t(() => Object.keys(a).join()));\nout.push(\"ownKeys: \" + t(() => Reflect.ownKeys(a).map(String).join()));\nexports.seen = out.join(\" | \");\n",
    "main.mjs": "import { fromB } from \"./a.mjs\"; console.log(fromB);\n",
  },
  "a-call-marked-pure-that-reads-what-changes": {
    "lib.mjs": "globalThis.mode = \"at load\";\nlet counter = 0;\nexport function bump() { counter++; }\nconst readMode = () => globalThis.mode;\nconst readCounter = () => counter;\nexport const seenAtLoad = /* @__PURE__ */ readMode();\nexport const counterAtLoad = /* @__PURE__ */ readCounter();\n",
    "main.mjs": "import { seenAtLoad, counterAtLoad, bump } from \"./lib.mjs\";\nbump(); bump();\nglobalThis.mode = \"changed later\";\nconsole.log(seenAtLoad, counterAtLoad);\n",
  },
  "import-defer": {
    "late.ts": "console.log(\"late is evaluated\"); export const value = 1;\n",
    "main.ts": "import defer * as late from \"./late\"; console.log(\"main\"); console.log(late.value); console.log(late.value, Object.keys(late).join());\n",
  },
  "import-defer-and-nothing-is-read": {
    "late.ts": "console.log(\"late is evaluated\"); export const value = 1;\n",
    "main.ts": "import defer * as late from \"./late\"; console.log(\"main\", typeof late);\n",
  },
  "a-stack-trace-names-the-sources": {
    "lib.ts": "interface Unused { x: number }\n\nexport function thrower(message: string): never {\n  const error = new Error(message);\n  throw error;\n}\n",
    "main.ts": "import { thrower } from \"./lib\";\nfunction caller(): never {\n  return thrower(\"boom\");\n}\nfunction outer() { try { caller(); } catch (e) { console.log((e as Error).stack!.replace(/[^\\s(]*[\\\\/]/g, \"\")); } }\nouter();\n",
  },
  "names-in-heap-snapshots": {
    "main.ts": "class Link { constructor(public next: Link | null, public label: string, public payload: { inner: number[] }) {} }\nfunction makeCounter() { let count = 0; return function counter() { return ++count; }; }\nfunction makePair() { let shared = { tag: \"shared\" + Date.now() }; return [() => shared, (next: { tag: string }) => { shared = next; }]; }\n(globalThis as any).kept = [new Link(new Link(null, \"tail\" + Date.now(), { inner: [1] }), \"head\" + Date.now(), { inner: [2] }), makeCounter(), makePair()];\nconst v8 = JSON.parse(Bun.generateHeapSnapshot(\"v8\") as unknown as string);\nconst nodeFields = v8.snapshot.meta.node_fields, edgeFields = v8.snapshot.meta.edge_fields, edgeTypes = v8.snapshot.meta.edge_types[0], nodeTypes = v8.snapshot.meta.node_types[0];\nconst names = new Set<string>(), fields = new Set<string>(), scopes = new Set<string>();\nlet edge = 0;\nfor (let i = 0; i < v8.nodes.length; i += nodeFields.length) {\n  const name = v8.strings[v8.nodes[i + nodeFields.indexOf(\"name\")]];\n  names.add(name);\n  for (let k = v8.nodes[i + nodeFields.indexOf(\"edge_count\")]; k > 0; k--, edge += edgeFields.length) {\n    if (name === \"Link\" && edgeTypes[v8.edges[edge + edgeFields.indexOf(\"type\")]] === \"property\") fields.add(v8.strings[v8.edges[edge + edgeFields.indexOf(\"name_or_index\")]]);\n    if (edgeTypes[v8.edges[edge + edgeFields.indexOf(\"type\")]] === \"context\" && v8.strings[v8.edges[edge + edgeFields.indexOf(\"name_or_index\")]] === \"shared\") scopes.add(nodeTypes[v8.nodes[i + nodeFields.indexOf(\"type\")]] + \" \" + name.startsWith(\"system / \"));\n  }\n}\nconsole.log([\"Link\", \"counter\"].map(name => name + \":\" + names.has(name)).join(\" \"), [\"next\", \"label\", \"payload\"].map(name => name + \":\" + fields.has(name)).join(\" \"), \"shared:\" + [...scopes].join());\nconst own: any = Bun.generateHeapSnapshot();\nconsole.log(own.nodeClassNames.includes(\"Link\"), [\"next\", \"label\", \"payload\", \"inner\"].map(name => name + \":\" + own.edgeNames.includes(name)).join(\" \"));\n",
  },
};
