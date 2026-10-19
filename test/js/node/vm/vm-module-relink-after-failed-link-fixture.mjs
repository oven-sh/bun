// Flags: --experimental-vm-modules
// The programs of "node:vm SourceTextModule link() after a link() that failed" in vm.test.ts.
//
// A module that is still "unlinked" after a failed link() can get other modules from the next link() or
// linkRequests(), as in Node. A program here makes a link() fail and then links again, mostly with another module for
// one specifier. Then it reads what the modules see.
//
// This file uses only node:assert and node:vm, so Node runs the identical file:
//
//   node --experimental-vm-modules vm-module-relink-after-failed-link-fixture.mjs [group]
//
// Every expected line is what Node v26.3.0 prints. A binding of a cycle is read after the evaluation, and no status
// is printed: the order in which a cycle runs and the status of a module that linked inside a failed link() are not
// Node's yet in Bun, for other reasons.
import assert from "node:assert";
import vm from "node:vm";

const isBun = typeof process.versions.bun === "string";

const link = (module, modules) => module.link(specifier => modules[specifier]);
const outcome = promise =>
  promise.then(
    () => "linked",
    error => error.name,
  );

// Node v26.3.0 does not parse `import defer`. It runs these programs with a plain namespace import.
const defer = isBun ? "defer " : "";

// group -> program -> [the lines that Node prints, the program]
const groups = {
  "the environment of a member of the cycle": {
    "a namespace import of the module that failed": [
      ["SyntaxError", "SyntaxError", "linked", "only2,v v=b2"],
      async ({ mk, print }) => {
        const root = mk("root", 'import "b"; import { read } from "a"; export { read };');
        const a = mk("a", 'import * as ns from "b"; export const read = () => Object.keys(ns) + " v=" + ns.v;');
        const b1 = mk("b1", 'import "a"; import { missing } from "c"; export var v = "b1";');
        const b2 = mk("b2", 'import "a"; export var v = "b2"; export var only2;');
        const c = mk("c", "export var y = 1;");
        print(await outcome(link(root, { a, b: b1, c })));
        print(await outcome(link(root, { a, b: b1, c })));
        print(await outcome(link(root, { a, b: b2, c })));
        await root.evaluate();
        print(root.namespace.read());
      },
    ],
    "the same with linkRequests() and instantiate()": [
      ["SyntaxError", "only2,v v=b2"],
      async ({ mk, print }) => {
        const root = mk("root", 'import "b"; import { read } from "a"; export { read };');
        const a = mk("a", 'import * as ns from "b"; export const read = () => Object.keys(ns) + " v=" + ns.v;');
        const b1 = mk("b1", 'import "a"; import { missing } from "c"; export var v = "b1";');
        const b2 = mk("b2", 'import "a"; export var v = "b2"; export var only2;');
        const c = mk("c", "export var y = 1;");
        root.linkRequests([b1, a]);
        a.linkRequests([b1]);
        b1.linkRequests([a, c]);
        c.linkRequests([]);
        try {
          root.instantiate();
          print("instantiated");
        } catch (error) {
          print(error.name);
        }
        a.linkRequests([b2]);
        b2.linkRequests([a]);
        root.linkRequests([b2, a]);
        root.instantiate();
        await root.evaluate();
        print(root.namespace.read());
      },
    ],
    "a replacement without the export that a member of the cycle imports": [
      ["SyntaxError", "SyntaxError", "linked", "b3"],
      async ({ mk, print }) => {
        const a = mk("a", 'import { v } from "b"; export const read = () => v;');
        const b1 = mk("b1", 'import "a"; import { missing } from "c"; export var v = "b1";');
        const b2 = mk("b2", 'import "a"; export var other = "b2";');
        const b3 = mk("b3", 'import "a"; export var v = "b3";');
        const c = mk("c", "export var y = 1;");
        print(await outcome(link(b1, { a, b: b1, c })));
        print(await outcome(link(a, { a, b: b2, c })));
        print(await outcome(link(a, { a, b: b3, c })));
        await a.evaluate();
        print(a.namespace.read());
      },
    ],
    "module.namespace of a member of the cycle before evaluate()": [
      ["SyntaxError", "linked", "only2,v v=undefined"],
      async ({ mk, print }) => {
        const a = mk("a", 'import * as ns from "b"; export function read() { return Object.keys(ns) + " v=" + ns.v; }');
        const b1 = mk("b1", 'import "a"; import { missing } from "c"; export var v = "b1";');
        const b2 = mk("b2", 'import "a"; export var v = "b2"; export var only2;');
        const c = mk("c", "export var y = 1;");
        print(await outcome(link(b1, { a, b: b1, c })));
        print(await outcome(link(a, { a, b: b2, c })));
        print(a.namespace.read());
      },
    ],
    "three link() calls, each with another module": [
      ["SyntaxError", "SyntaxError", "linked", "only3,v v=b3", "ERR_VM_MODULE_STATUS"],
      async ({ mk, print }) => {
        const root = mk("root", 'import "b"; import { read } from "a"; export { read };');
        const a = mk("a", 'import * as ns from "b"; export const read = () => Object.keys(ns) + " v=" + ns.v;');
        const b1 = mk("b1", 'import "a"; import { missing } from "c"; export var v = "b1"; export var only1;');
        const b2 = mk("b2", 'import "a"; import { missing } from "c"; export var v = "b2"; export var only2;');
        const b3 = mk("b3", 'import "a"; export var v = "b3"; export var only3;');
        const c = mk("c", "export var y = 1;");
        print(await outcome(link(root, { a, b: b1, c })));
        print(await outcome(link(root, { a, b: b2, c })));
        print(await outcome(link(root, { a, b: b3, c })));
        await root.evaluate();
        print(root.namespace.read());
        print(
          await link(root, { a, b: b1, c }).then(
            () => "linked",
            error => error.code,
          ),
        );
      },
    ],
  },

  "other bindings of a member of the cycle": {
    "a namespace import of a linked module that the next link() replaces": [
      ["SyntaxError", "linked", "only2,v v=c2"],
      async ({ mk, print }) => {
        const root = mk("root", 'import "b"; import { read } from "a"; export { read };');
        const a = mk(
          "a",
          'import * as ns from "c"; import "b"; export const read = () => Object.keys(ns) + " v=" + ns.v;',
        );
        const b1 = mk("b1", 'import "a"; import { missing } from "c";');
        const b2 = mk("b2", 'import "a";');
        const c1 = mk("c1", 'export let v = "c1"; export let only1 = 1;');
        const c2 = mk("c2", 'export let v = "c2"; export let only2 = 2;');
        print(await outcome(link(root, { a, b: b1, c: c1 })));
        // c1 linked. It is a graph of its own, and it runs before the next link().
        if (c1.status === "unlinked") await c1.link(() => {});
        await c1.evaluate();
        print(await outcome(link(root, { a, b: b2, c: c2 })));
        await root.evaluate();
        print(root.namespace.read());
      },
    ],
    "a function declaration and import.meta of a member of the cycle": [
      ["SyntaxError", "linked", "a#1 b2 function"],
      async ({ mk, print }) => {
        let metaCalls = 0;
        const initializeImportMeta = (meta, module) => {
          meta.id = module.identifier + "#" + ++metaCalls;
        };
        const root = mk("root", 'import "b"; import { read } from "a"; export { read };');
        const a = mk(
          "a",
          'import * as ns from "b"; export function read() { return import.meta.id + " " + ns.v + " " + typeof read; }',
          { initializeImportMeta },
        );
        const b1 = mk("b1", 'import "a"; import { missing } from "c"; export var v = "b1";');
        const b2 = mk("b2", 'import "a"; export var v = "b2";');
        const c = mk("c", "export var y = 1;");
        print(await outcome(link(root, { a, b: b1, c })));
        print(await outcome(link(root, { a, b: b2, c })));
        await root.evaluate();
        print(root.namespace.read());
      },
    ],
    "a SyntheticModule in the graph": [
      ["SyntaxError", "linked", "synthetic b2"],
      async ({ context, mk, print }) => {
        const synthetic = new vm.SyntheticModule(
          ["s"],
          function () {
            this.setExport("s", "synthetic");
          },
          { context },
        );
        const a = mk(
          "a",
          'import { s } from "synthetic"; import * as ns from "b"; export const read = () => s + " " + ns.v;',
        );
        const b1 = mk("b1", 'import "a"; import { missing } from "c"; export var v = "b1";');
        const b2 = mk("b2", 'import "a"; export var v = "b2";');
        const c = mk("c", "export var y = 1;");
        print(await outcome(link(b1, { a, b: b1, c, synthetic })));
        print(await outcome(link(a, { a, b: b2, c, synthetic })));
        await a.evaluate();
        print(a.namespace.read());
      },
    ],
    "a named import of the namespace that the replaced module exports": [
      ["SyntaxError", "linked", "only2,v v=c2"],
      async ({ mk, print }) => {
        const root = mk("root", 'import "b"; import { read } from "a"; export { read };');
        const a = mk("a", 'import { ns } from "b"; export const read = () => Object.keys(ns) + " v=" + ns.v;');
        const b1 = mk("b1", 'import "a"; export * as ns from "c"; import { missing } from "d";');
        const b2 = mk("b2", 'import "a"; export * as ns from "c";');
        const c1 = mk("c1", 'export let v = "c1"; export let only1 = 1;');
        const c2 = mk("c2", 'export let v = "c2"; export let only2 = 2;');
        const d = mk("d", "export var y = 1;");
        print(await outcome(link(root, { a, b: b1, c: c1, d })));
        print(await outcome(link(root, { a, b: b2, c: c2, d })));
        await root.evaluate();
        print(root.namespace.read());
      },
    ],
  },

  // They are raw pointers to module records.
  "the exports that a module resolved through another module": {
    "an indirect export that a member of the cycle resolved": [
      ["SyntaxError", "linked", "b2"],
      async ({ mk, print }) => {
        const root = mk("root", 'import { v } from "a"; export const read = () => v;');
        const a = mk("a", 'export { v } from "b"; import "z";');
        const b1 = mk("b1", 'import { v as fromA } from "a"; export let v = "b1";');
        const b2 = mk("b2", 'import "a"; export let v = "b2";');
        const z1 = mk("z1", 'import "a"; import { missing } from "c";');
        const z2 = mk("z2", 'import "a";');
        const c = mk("c", "export var y = 1;");
        print(await outcome(link(root, { a, b: b1, z: z1, c })));
        print(await outcome(link(root, { a, b: b2, z: z2, c })));
        await root.evaluate();
        print(root.namespace.read());
      },
    ],
    "an indirect export of a module that the failed link() did not reach": [
      ["SyntaxError", "linked", "g2"],
      async ({ mk, print }) => {
        const sources = {
          root: 'import "d"; import { read } from "m"; export { read };',
          d: 'import "m"; export { v } from "e";',
        };
        const root1 = mk("root1", sources.root);
        const d1 = mk("d1", sources.d);
        const m1 = mk("m1", 'import { v, missing } from "d"; export const read = () => v;');
        const root2 = mk("root2", sources.root);
        const d2 = mk("d2", sources.d);
        const m2 = mk("m2", 'import { v } from "d"; export const read = () => v;');
        const e = mk("e", 'export { v } from "g";');
        const g2 = mk("g2", 'export let v = "g2";');
        await (async () => {
          const g1 = mk("g1", 'export let v = "g1";');
          print(await outcome(link(root1, { d: d1, m: m1, e, g: g1 })));
        })();
        // Only e keeps g1. The next link() gives e another module, and g1 can go.
        globalThis.Bun?.gc(true);
        print(await outcome(link(root2, { d: d2, m: m2, e, g: g2 })));
        globalThis.Bun?.gc(true);
        await root2.evaluate();
        print(root2.namespace.read());
      },
    ],
    "modules that get no linkRequests() call after the failed instantiate()": [
      ["SyntaxError", "b2 b2"],
      async ({ mk, print }) => {
        const r = mk("r", 'import { read, v } from "x"; import "z"; export { read, v };');
        const x = mk("x", 'import { v } from "a"; export { v }; export const read = () => v;');
        const a = mk("a", 'import "r"; export { v } from "b";');
        const b1 = mk("b1", 'export let v = "b1";');
        const b2 = mk("b2", 'export let v = "b2";');
        const z = mk("z", 'import "r"; import { wanted } from "q";');
        const q1 = mk("q1", "export let other = 1;");
        const q2 = mk("q2", "export let wanted = 1;");
        r.linkRequests([x, z]);
        x.linkRequests([a]);
        a.linkRequests([r, b1]);
        z.linkRequests([r, q1]);
        for (const leaf of [b1, b2, q1, q2]) leaf.linkRequests([]);
        try {
          r.instantiate();
          print("instantiated");
        } catch (error) {
          print(error.name);
        }
        a.linkRequests([r, b2]);
        z.linkRequests([r, q2]);
        r.instantiate();
        await r.evaluate();
        print(x.namespace.read(), r.namespace.v);
      },
    ],
  },

  // It has the names and the bindings of every export.
  "the namespace object of a module": {
    "a module with a star export of the replaced module": [
      ["SyntaxError", "linked", "only2,v v=b2 only2,v"],
      async ({ mk, print }) => {
        const root = mk("root", 'import * as ns from "a"; export const read = () => Object.keys(ns) + " v=" + ns.v;');
        const a = mk("a", 'export * from "b"; import "z";');
        const b1 = mk("b1", 'import * as nsOfA from "a"; export let v = "b1"; export let only1 = 1;');
        const b2 = mk("b2", 'import "a"; export let v = "b2"; export let only2 = 2;');
        const z1 = mk("z1", 'import "a"; import { missing } from "c";');
        const z2 = mk("z2", 'import "a";');
        const c = mk("c", "export var y = 1;");
        print(await outcome(link(root, { a, b: b1, z: z1, c })));
        print(await outcome(link(root, { a, b: b2, z: z2, c })));
        await root.evaluate();
        print(root.namespace.read(), Object.keys(a.namespace) + "");
      },
    ],
    "a module that the failed link() did not reach": [
      ["SyntaxError", "linked", "only2,v v=h2 only2,v"],
      async ({ mk, print }) => {
        const sources = {
          root: 'import "b"; import { read } from "a"; export { read };',
          b: 'import "a"; import "z"; export * as ns from "c";',
          a: 'import { ns } from "b"; export const read = () => Object.keys(ns) + " v=" + ns.v;',
        };
        const root1 = mk("root1", sources.root);
        const b1 = mk("b1", sources.b);
        const a1 = mk("a1", sources.a);
        const z1 = mk("z1", 'import { missing } from "b";');
        const root2 = mk("root2", sources.root);
        const b2 = mk("b2", sources.b);
        const a2 = mk("a2", sources.a);
        const z2 = mk("z2", 'import "b";');
        const c = mk("c", 'export * from "h";');
        const h1 = mk("h1", 'export let v = "h1"; export let only1 = 1;');
        const h2 = mk("h2", 'export let v = "h2"; export let only2 = 2;');
        print(await outcome(link(root1, { b: b1, a: a1, z: z1, c, h: h1 })));
        print(await outcome(link(root2, { b: b2, a: a2, z: z2, c, h: h2 })));
        await root2.evaluate();
        print(root2.namespace.read(), Object.keys(c.namespace) + "");
      },
    ],
    // s is a member of the cycle. It has a namespace object for a2 and, in Bun, a deferred one for a.
    "the namespace and the deferred namespace of one module": [
      ["SyntaxError", "linked", "only2,v v=h2 | only2,v v=h2"],
      async ({ mk, print }) => {
        const root = mk(
          "root",
          'import "b"; import { read } from "a"; import { read2 } from "a2"; export { read, read2 };',
        );
        const a = mk(
          "a",
          `import ${defer}* as ns from "s"; import "b"; export const read = () => Object.keys(ns) + " v=" + ns.v;`,
        );
        const a2 = mk(
          "a2",
          'import * as ns from "s"; import "b"; export const read2 = () => Object.keys(ns) + " v=" + ns.v;',
        );
        const s = mk("s", 'export * from "h"; import "a"; import "a2";');
        const b1 = mk("b1", 'import "a"; import "a2"; import { missing } from "d";');
        const b2 = mk("b2", 'import "a"; import "a2";');
        const h1 = mk("h1", 'export let v = "h1"; export let only1 = 1;');
        const h2 = mk("h2", 'export let v = "h2"; export let only2 = 2;');
        const d = mk("d", "export var y = 1;");
        print(await outcome(link(root, { a, a2, b: b1, s, h: h1, d })));
        print(await outcome(link(root, { a, a2, b: b2, s, h: h2, d })));
        await root.evaluate();
        print(root.namespace.read(), "|", root.namespace.read2());
      },
    ],
    // The star exports of s go through h to the replaced module.
    "a deferred namespace whose exports come through another module": [
      ["SyntaxError", "linked", "only2,v v=k2"],
      async ({ mk, print }) => {
        const root = mk("root", 'import "b"; import { read } from "a"; export { read };');
        const a = mk(
          "a",
          `import ${defer}* as ns from "s"; import "b"; export const read = () => Object.keys(ns) + " v=" + ns.v;`,
        );
        const s = mk("s", 'export * from "h"; import "a";');
        const h = mk("h", 'export * from "k"; import "a";');
        const b1 = mk("b1", 'import "a"; import { missing } from "d";');
        const b2 = mk("b2", 'import "a";');
        const k1 = mk("k1", 'export let v = "k1"; export let only1 = 1;');
        const k2 = mk("k2", 'export let v = "k2"; export let only2 = 2;');
        const d = mk("d", "export var y = 1;");
        print(await outcome(link(root, { a, b: b1, s, h, k: k1, d })));
        print(await outcome(link(root, { a, b: b2, s, h, k: k2, d })));
        await root.evaluate();
        print(root.namespace.read());
      },
    ],
  },

  // The code of a module has the place of each imported binding in the module that exports it: v is the first
  // variable of b1 and the fourth of b2. In 1.4.3, two node:vm modules with one identifier and one source text
  // shared that code, and the module of the failed link() read p0. Since oven-sh/WebKit#639 each node:vm module has
  // code of its own, so these programs pass on a release build without the reset too. They are here for the day
  // that such modules share code again.
  "two modules with one identifier and one source text": {
    "the module of the failed link() links first": [
      ["SyntaxError", "linked", "linked", "b1 b2"],
      async ({ mk, print }) => {
        const source = 'import { v } from "b"; import "z"; export const read = () => v;';
        const first = mk("a", source);
        const second = mk("a", source);
        const b1 = mk("b1", 'export let v = "b1";');
        const b2 = mk("b2", 'export let p0 = "p0", p1 = "p1", p2 = "p2"; export let v = "b2";');
        const z1 = mk("z1", 'import "a"; import { missing } from "c";');
        const z2 = mk("z2", "export {};");
        const c = mk("c", "export let y = 1;");
        print(await outcome(link(z1, { a: first, b: b1, z: z1, c })));
        print(await outcome(link(second, { b: b1, z: z2 })));
        await second.evaluate();
        print(await outcome(link(first, { b: b2, z: z2 })));
        await first.evaluate();
        print(second.namespace.read(), first.namespace.read());
      },
    ],
    "the other module links first": [
      ["linked", "SyntaxError", "linked", "b1 b2"],
      async ({ mk, print }) => {
        const source = 'import { v } from "b"; import "z"; export const read = () => v;';
        const first = mk("a", source);
        const second = mk("a", source);
        const b1 = mk("b1", 'export let v = "b1";');
        const b2 = mk("b2", 'export let p0 = "p0", p1 = "p1", p2 = "p2"; export let v = "b2";');
        const z1 = mk("z1", 'import "a"; import { missing } from "c";');
        const z2 = mk("z2", "export {};");
        const c = mk("c", "export let y = 1;");
        print(await outcome(link(second, { b: b1, z: z2 })));
        print(await outcome(link(z1, { a: first, b: b1, z: z1, c })));
        await second.evaluate();
        print(await outcome(link(first, { b: b2, z: z2 })));
        await first.evaluate();
        print(second.namespace.read(), first.namespace.read());
      },
    ],
  },

  // Such a module is linked. It keeps the modules that it linked with.
  "a module that linked inside the failed link()": {
    "the next link() gives the linker's answer for it": [
      ["SyntaxError", "linked", "only1,v v=d1", "ERR_VM_MODULE_STATUS"],
      async ({ mk, print }) => {
        const root = mk("root", 'import { read } from "c"; import "b"; export { read };');
        const c = mk("c", 'import * as ns from "d"; export const read = () => Object.keys(ns) + " v=" + ns.v;');
        const d1 = mk("d1", 'export let v = "d1"; export let only1 = 1;');
        const d2 = mk("d2", 'export let v = "d2"; export let only2 = 2;');
        const a = mk("a", 'import "b";');
        const b1 = mk("b1", 'import "a"; import { missing } from "c";');
        const b2 = mk("b2", 'import "a";');
        print(await outcome(link(root, { c, d: d1, a, b: b1 })));
        print(await outcome(link(root, { c, d: d2, a, b: b2 })));
        await root.evaluate();
        print(root.namespace.read());
        try {
          print(Object.keys(d2.namespace) + "");
        } catch (error) {
          print(error.code);
        }
      },
    ],
    "linkRequests() is called on it": [
      ["SyntaxError", "only1,v v=d1"],
      async ({ mk, print }) => {
        const c = mk("c", 'import * as ns from "d"; export const read = () => Object.keys(ns) + " v=" + ns.v;');
        const d1 = mk("d1", 'export let v = "d1"; export let only1 = 1;');
        const d2 = mk("d2", 'export let v = "d2"; export let only2 = 2;');
        const root1 = mk("root1", 'import { read, missing } from "c";');
        const root2 = mk("root2", 'import { read } from "c"; export { read };');
        print(await outcome(link(root1, { c, d: d1 })));
        // Node refuses this call, because c is linked. Neither Node nor Bun gives c another module.
        try {
          c.linkRequests([d2]);
        } catch {}
        d2.linkRequests([]);
        root2.linkRequests([c]);
        root2.instantiate();
        await root2.evaluate();
        print(root2.namespace.read());
      },
    ],
    // No cycle. jest makes a new SyntheticModule on every linker call for a CommonJS module. Since 1.4.0 Bun asks
    // the linker again for a module that linked inside a failed link(), here e. Only e keeps the first "dep" alive.
    "the linker makes a new module for its request on every call": [
      ["SyntaxError", "linked", "dep#1"],
      async ({ context, mk, print }) => {
        let made = 0;
        const e = mk("e", 'export { value } from "dep";');
        const bad = mk("bad", 'import { value, missing } from "e";');
        const good = mk("good", 'import { value } from "e"; export const read = () => value;');
        const synthetic = async value => {
          const module = new vm.SyntheticModule(
            ["value"],
            function () {
              this.setExport("value", value);
            },
            { context },
          );
          await module.link(() => {});
          await module.evaluate();
          return module;
        };
        const linker = specifier => (specifier === "e" ? e : synthetic("dep#" + ++made));
        print(await outcome(bad.link(linker)));
        print(await outcome(good.link(linker)));
        await good.evaluate();
        globalThis.Bun?.gc(true);
        print(good.namespace.read());
      },
    ],
    "a link() of it that started before the failed instantiate() ends after it": [
      ["SyntaxError", "linked", "1"],
      async ({ mk, print }) => {
        const root = mk("root", 'import { missing } from "leaf";');
        const leaf = mk("leaf", "export let v = 1;");
        // leaf has no imports: this link() calls no linker, and it ends one job later.
        const late = outcome(leaf.link(() => {}));
        root.linkRequests([leaf]);
        try {
          root.instantiate();
          print("instantiated");
        } catch (error) {
          print(error.name);
        }
        print(await late);
        await leaf.evaluate();
        print(leaf.namespace.v);
      },
    ],
    // No link() fails here. root has two declarations for "x", and its link() links x.
    "linkRequests() is called on a module that its importer linked": [
      ["linked", "only1,v v=d1 1"],
      async ({ context, mk, print }) => {
        const root = mk(
          "root",
          'import { read } from "x"; import json from "x" with { type: "json" }; export { read, json };',
        );
        const x = mk("x", 'import * as ns from "d"; export const read = () => Object.keys(ns) + " v=" + ns.v;');
        const d1 = mk("d1", 'export let v = "d1"; export let only1 = 1;');
        const d2 = mk("d2", 'export let v = "d2"; export let only2 = 2;');
        const json = new vm.SyntheticModule(
          ["default"],
          function () {
            this.setExport("default", { k: 1 });
          },
          { context },
        );
        const linker = (specifier, referencingModule, { attributes }) =>
          specifier === "d" ? d1 : attributes.type === "json" ? json : x;
        print(await outcome(root.link(linker)));
        // Node refuses this call, because x is linked. Neither Node nor Bun gives x another module.
        try {
          x.linkRequests([d2]);
        } catch {}
        await root.evaluate();
        print(root.namespace.read(), root.namespace.json.k);
      },
    ],
  },

  "a link() that fails with a stack overflow": {
    // The chain doubles until Link() overflows the stack in it. vm.test.ts gives the process a small stack, so that
    // a short chain is enough.
    "a member of a cycle that finished before the overflow": [
      ["RangeError", "instantiated", "only2,v v=b2"],
      async ({ mk, print }) => {
        for (let length = 256; length <= 65536; length *= 2) {
          const id = name => name + "#" + length;
          const root = mk(id("root"), 'import { read } from "a"; import "next"; export { read };');
          const a = mk(
            id("a"),
            'import "root"; import * as ns from "b"; export const read = () => Object.keys(ns) + " v=" + ns.v;',
          );
          const b1 = mk(id("b1"), 'export var v = "b1"; export var only1;');
          const b2 = mk(id("b2"), 'export var v = "b2"; export var only2;');
          const tail = mk(id("tail"), "export {};");
          const chain = Array.from({ length }, (_, i) => mk(id("m" + i), 'import "next"; export {};'));
          root.linkRequests([a, chain[0]]);
          a.linkRequests([root, b1]);
          for (const leaf of [b1, b2, tail]) leaf.linkRequests([]);
          chain.forEach((module, i) => module.linkRequests([chain[i + 1] ?? tail]));
          try {
            root.instantiate();
            continue;
          } catch (error) {
            print(error.name);
          }
          a.linkRequests([root, b2]);
          root.linkRequests([a, tail]);
          root.instantiate();
          print("instantiated");
          await root.evaluate();
          print(root.namespace.read());
          break;
        }
      },
    ],
  },
};

// Each program runs in a context of its own, and in the main context.
const realms = {
  "a new context": () => vm.createContext({}),
  "the main context": () => undefined,
};

const selected = process.argv[2];
assert.ok(selected === undefined || Object.hasOwn(groups, selected), `no group "${selected}"`);

for (const [group, programs] of Object.entries(groups)) {
  if (selected !== undefined && group !== selected) continue;
  for (const [name, [expected, program]] of Object.entries(programs)) {
    for (const [realm, contextOf] of Object.entries(realms)) {
      const context = contextOf();
      const mk = (identifier, source, options) => new vm.SourceTextModule(source, { identifier, context, ...options });
      const lines = [];
      try {
        await program({ context, mk, print: (...values) => lines.push(values.join(" ")) });
      } catch (error) {
        lines.push(String(error));
      }
      assert.deepStrictEqual(lines, expected, `${group}: ${name}, in ${realm}`);
    }
  }
}
console.log("ok");
