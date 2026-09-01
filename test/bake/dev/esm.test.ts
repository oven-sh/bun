// ESM tests are about various esm features in development mode.
import { expect } from "bun:test";
import { devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

const liveBindingTest = devTest("live bindings with `var`", {
  framework: minimalFramework,
  files: {
    "state.ts": `
      export var value = 0;
      export function increment() {
        value++;
      }
    `,
    "routes/index.ts": `
      import { value, increment } from '../state';
      export default function(req, meta) {
        increment();
        return new Response('State: ' + value);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("State: 1");
    await dev.fetch("/").equals("State: 2");
    await dev.fetch("/").equals("State: 3");
    await dev.patch("routes/index.ts", {
      find: "State",
      replace: "Value",
    });
    await dev.fetch("/").equals("Value: 4");
    await dev.fetch("/").equals("Value: 5");
    await dev.write(
      "state.ts",
      `
        export var value = 0;
        export function increment() {
          value--;
        }
      `,
    );
    await dev.fetch("/").equals("Value: -1");
    await dev.fetch("/").equals("Value: -2");
  },
});
devTest("live bindings through export clause", {
  framework: minimalFramework,
  files: {
    "state.ts": `
      export var value = 0;
      export function increment() {
        value++;
      }
    `,
    "proxy.ts": `
      import { value } from './state';
      export { value as live };
    `,
    "routes/index.ts": `
      import { increment } from '../state';
      import { live } from '../proxy';
      export default function(req, meta) {
        increment();
        return new Response('State: ' + live);
      }
    `,
  },
  test: liveBindingTest.test,
});
devTest("live bindings through export from", {
  framework: minimalFramework,
  files: {
    "state.ts": `
      export var value = 0;
      export function increment() {
        value++;
      }
    `,
    "proxy.ts": `
      export { value as live } from './state';
    `,
    "routes/index.ts": `
      import { increment } from '../state';
      import { live } from '../proxy';
      export default function(req, meta) {
        increment();
        return new Response('State: ' + live);
      }
    `,
  },
  test: liveBindingTest.test,
});
devTest("live bindings through export star (#29747)", {
  framework: minimalFramework,
  files: {
    "state.ts": `
      export var value = 0;
      export function increment() {
        value++;
      }
    `,
    "proxy.ts": `
      export * from './state';
    `,
    "routes/index.ts": `
      import { increment, value } from '../proxy';
      export default function(req, meta) {
        increment();
        return new Response('State: ' + value);
      }
    `,
  },
  test: liveBindingTest.test,
});
devTest("live bindings through export star namespace read", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "lib.ts": `
      export let count = 0;
      export function increment() { count++; }
    `,
    "barrel.ts": `
      export * from './lib';
    `,
    "index.ts": `
      import * as barrel from './barrel';
      barrel.increment();
      if (barrel.count !== 1) {
        console.log("FAIL: expected 1, got " + barrel.count);
      } else {
        console.log("PASS");
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
devTest("export star with direct export precedence", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "lib.ts": `
      export const x = "from-lib";
      export const y = "lib-y";
    `,
    "barrel.ts": `
      export * from './lib';
      export const x = "from-barrel";
    `,
    "index.ts": `
      import { x, y } from './barrel';
      if (x !== "from-barrel") { console.log("FAIL x: " + x); }
      else if (y !== "lib-y") { console.log("FAIL y: " + y); }
      else console.log("PASS");
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
devTest("export star does not forward 'default'", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "lib.ts": `
      export default "DEFAULT";
      export const x = 1;
    `,
    "barrel.ts": `
      export * from './lib';
    `,
    "index.ts": `
      import * as barrel from './barrel';
      if ("default" in barrel) { console.log("FAIL: 'default' should not be re-exported"); }
      else if (barrel.x !== 1) { console.log("FAIL x: " + barrel.x); }
      else console.log("PASS");
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
devTest("export star chain (barrel -> barrel -> lib) preserves live bindings", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "lib.ts": `
      export let count = 0;
      export function increment() { count++; }
    `,
    "mid.ts": `
      export * from './lib';
    `,
    "top.ts": `
      export * from './mid';
    `,
    "index.ts": `
      import * as barrel from './top';
      barrel.increment();
      barrel.increment();
      if (barrel.count === 2) console.log("PASS");
      else console.log("FAIL: expected 2, got " + barrel.count);
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
devTest("a later star re-export wins through a shared barrel", {
  // b and c share d inside one star walk. c does not declare k, so its view
  // of k is d's, and c comes after b: the merged k must be d's, not b's.
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "d.ts": `
      export const k = "from-d";
    `,
    "b.ts": `
      export * from './d';
      export const k = "from-b";
    `,
    "c.ts": `
      export * from './d';
    `,
    "s.ts": `
      export * from './b';
      export * from './c';
    `,
    "p.ts": `
      export * from './s';
    `,
    "index.ts": `
      import { k } from './p';
      console.log(k);
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("from-d");
  },
});
devTest("export star tolerates circular star re-exports", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "a.ts": `
      export * from './b';
      export const aVal = "A";
    `,
    "b.ts": `
      export * from './a';
      export const bVal = "B";
    `,
    "index.ts": `
      import * as a from './a';
      import * as b from './b';
      // Loading must not throw during the circular star-export setup, and
      // after both modules finish, each side sees the other's direct export.
      if (a.aVal === "A" && a.bVal === "B" && b.aVal === "A" && b.bVal === "B") {
        console.log("PASS");
      } else {
        console.log("FAIL: " + JSON.stringify({
          aVal_on_a: a.aVal, bVal_on_a: a.bVal,
          aVal_on_b: b.aVal, bVal_on_b: b.bVal,
        }));
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
devTest("export star through require() (sync loader) circular", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "a.ts": `
      export * from './b';
      export const aVal = "A";
    `,
    "b.ts": `
      export * from './a';
      export const bVal = "B";
    `,
    "index.ts": `
      const a = require('./a');
      const b = require('./b');
      if (a.aVal === "A" && a.bVal === "B" && b.aVal === "A" && b.bVal === "B") {
        console.log("PASS");
      } else {
        console.log("FAIL: " + JSON.stringify({
          aVal_on_a: a.aVal, bVal_on_a: a.bVal,
          aVal_on_b: b.aVal, bVal_on_b: b.bVal,
        }));
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
// Two barrels star each other and both star a third module that declares the
// name. The forwarding getter must read the module that declares the name,
// not the other barrel, or the two getters call each other forever.
devTest("export star: mutual barrels with a shared provider", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "a.ts": `
      export * from './c';
      export * from './b';
    `,
    "b.ts": `
      export * from './c';
      export * from './a';
    `,
    "c.ts": `
      export let z = 1;
      export function bump() { z++; }
    `,
    "index.ts": `
      import * as a from './a';
      import * as b from './b';
      a.bump();
      if (a.z === 2 && b.z === 2) console.log("PASS");
      else console.log("FAIL: " + JSON.stringify({ a_z: a.z, b_z: b.z }));
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
devTest("export star: a ring of barrels with a shared provider", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "a.ts": `
      export * from './p';
      export * from './b';
    `,
    "b.ts": `
      export * from './p';
      export * from './c';
    `,
    "c.ts": `
      export * from './p';
      export * from './a';
    `,
    "p.ts": `
      export const v = 1;
    `,
    "index.ts": `
      import * as a from './a';
      import * as b from './b';
      import * as c from './c';
      if (a.v === 1 && b.v === 1 && c.v === 1) console.log("PASS");
      else console.log("FAIL: " + JSON.stringify({ a: a.v, b: b.v, c: c.v }));
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
// Inside a star chain, a module's own name wins over the same name from its
// own stars, so the barrel above it forwards to that module, not deeper.
devTest("export star: an own name wins inside a nested chain", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "top.ts": `
      export * from './mid';
    `,
    "mid.ts": `
      export * from './deep';
      export const shadowed = "mid";
    `,
    "deep.ts": `
      export const shadowed = "deep";
      export const onlyDeep = "deep";
    `,
    "index.ts": `
      import * as top from './top';
      const got = [top.shadowed, top.onlyDeep].join(",");
      if (got === "mid,deep") console.log("PASS");
      else console.log("FAIL: " + got);
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
devTest("export * as ns from preserves live bindings across HMR", {
  framework: minimalFramework,
  files: {
    "state.ts": `
      export var value = 0;
      export function increment() {
        value++;
      }
    `,
    "proxy.ts": `
      export * as ns from './state';
    `,
    "routes/index.ts": `
      import { ns } from '../proxy';
      export default function(req, meta) {
        ns.increment();
        return new Response('State: ' + ns.value);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("State: 1");
    await dev.fetch("/").equals("State: 2");
    await dev.write(
      "state.ts",
      `
        export var value = 100;
        export function increment() { value--; }
      `,
    );
    // After the hot update replaces state.ts's exports object, proxy.ns
    // must see the new object, and the properties on it must still
    // live-bind.
    await dev.fetch("/").equals("State: 99");
    await dev.fetch("/").equals("State: 98");
  },
});
devTest("export star from a builtin module on the server", {
  framework: minimalFramework,
  files: {
    "proxy.ts": `
      export * from "node:path";
    `,
    "routes/index.ts": `
      import { basename } from '../proxy';
      export default function(req, meta) {
        return new Response('name: ' + basename('/a/b.txt'));
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("name: b.txt");
  },
});
devTest("cyclic read of a named builtin re-export on the server", {
  // B evaluates while A is still on the stack and calls A's hoisted getter
  // for a builtin re-export, so the builtin namespace must be assigned in
  // the instantiate phase, before the yield.
  framework: minimalFramework,
  files: {
    "A.ts": `
      export { basename } from 'node:path';
      import './B';
      export function tag() { return 'A'; }
    `,
    "B.ts": `
      import { basename } from './A';
      export const eager = basename('/x/y.txt');
    `,
    "routes/index.ts": `
      import { tag } from '../A';
      import { eager } from '../B';
      export default function(req, meta) {
        return new Response('eager: ' + eager + ' from ' + tag());
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("eager: y.txt from A");
  },
});
devTest("export star through a CommonJS module", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "lib.cts": `
      module.exports = { fromCjs: "cjs-value" };
    `,
    "barrel.ts": `
      export * from './lib.cts';
    `,
    "index.ts": `
      import { fromCjs } from './barrel';
      if (fromCjs === "cjs-value") console.log("PASS");
      else console.log("FAIL: " + fromCjs);
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
devTest("later CommonJS star re-export wins for a duplicate name", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "a.cts": `
      module.exports = { shared: "from-a" };
    `,
    "b.cts": `
      module.exports = { shared: "from-b" };
    `,
    "barrel.ts": `
      export * from './a.cts';
      export * from './b.cts';
    `,
    "index.ts": `
      import { shared } from './barrel';
      console.log(shared);
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("from-b");
  },
});
devTest("export star from a module with top-level await", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "lib.ts": `
      export const x = 1;
    `,
    "barrel.ts": `
      export * from './lib';
      await 0;
      export const y = 2;
    `,
    "index.ts": `
      import { x, y } from './barrel';
      if (x === 1 && y === 2) console.log("PASS");
      else console.log("FAIL: x=" + x + " y=" + y);
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
devTest("require of a throwing ESM module throws again on retry", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "boom.ts": `
      export const x = 1;
      throw new Error("boom");
    `,
    "index.ts": `
      let first, second;
      try { require('./boom'); } catch (e) { first = e.message; }
      try { require('./boom'); } catch (e) { second = e.message; }
      console.log(first + " " + second);
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("boom boom");
  },
});
devTest("dynamic import with a throwing dependency rejects again on retry", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "dep.cts": `
      throw new Error("dep-boom");
    `,
    "parent.ts": `
      import './dep.cts';
      export const x = 1;
    `,
    "index.ts": `
      let first, second;
      try { await import('./parent'); } catch (e) { first = e.message; }
      try { await import('./parent'); } catch (e) { second = e.message; }
      console.log(first + " " + second);
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("dep-boom dep-boom");
  },
});
devTest("dynamic import of a throwing top-level-await module rejects again on retry", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "boom.ts": `
      export const x = 1;
      await 0;
      throw new Error("boom");
    `,
    "index.ts": `
      let first, second;
      try { await import('./boom'); } catch (e) { first = e.message; }
      try { await import('./boom'); } catch (e) { second = e.message; }
      console.log(first + " " + second);
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("boom boom");
  },
});
/** Mirrors the real react-refresh runtime: isLikelyComponentType is true
 * only for functions, never for the exports object itself. */
const realisticRefreshRuntimeStub = {
  "node_modules/react-refresh/runtime.js": /* js */ `
    exports.performReactRefresh = () => console.log("performReactRefresh");
    exports.injectIntoGlobalHook = () => {};
    exports.isLikelyComponentType = t => typeof t === "function" && /^[A-Z]/.test(t.name || "");
    exports.register = () => {};
    exports.createSignatureFunctionForTransform = () => fn => fn;
  `,
};
devTest("an arrow function component export stays a fast refresh boundary", {
  // The exports object exposes non-function-declaration exports through
  // getters. isReactRefreshBoundary must read through them, or a module
  // that exports an arrow component stops self-accepting and every edit
  // causes a full page reload.
  files: {
    ...realisticRefreshRuntimeStub,
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "App.tsx": `
      export const App = () => "version 1";
    `,
    "index.ts": `
      import { App } from './App';
      globalThis.renderApp = () => App();
      console.log(App());
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("version 1");
    // App.tsx exports only a component, so it self-accepts. The update must
    // apply in place; the harness fails on a full page reload.
    await dev.patch("App.tsx", { find: "version 1", replace: "version 2" });
    await c.expectMessage("performReactRefresh");
    expect(await c.js`return globalThis.renderApp()`).toBe("version 2");
  },
});
devTest("reassigned componentish default export stays live under fast refresh", {
  files: {
    ...realisticRefreshRuntimeStub,
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "App.tsx": `
      export default function App() {
        return "original";
      }
      App = () => "wrapped";
    `,
    "index.ts": `
      import App from './App';
      console.log(App());
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("wrapped");
  },
});
devTest("cyclic import with a top-level read (#40248)", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["/entry.js"],
    }),
    "entry.js": `
      import { describe } from "./b.js";

      export function name() {
        return "entry";
      }

      console.log(describe());
    `,
    "b.js": `
      import { name } from "./entry.js";

      export function describe() {
        return "b sees " + name();
      }

      // entry.js is still evaluating here. This is the cyclic read.
      export const eager = describe();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("b sees entry");
  },
});
devTest("cyclic call reads an import that was already loaded (diamond)", {
  // B's body runs while A is still on the stack. A's function reads A's own
  // import of C, which was already loaded when A requested it, so the early
  // binding must also fire on the registry-hit path.
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import './C';
      import './A';
    `,
    "C.ts": `
      export const c = 42;
    `,
    "A.ts": `
      import { c } from './C';
      import './B';
      export function readC() { return c; }
    `,
    "B.ts": `
      import { readC } from './A';
      console.log("B sees " + readC());
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("B sees 42");
  },
});
devTest("cyclic call reads a CommonJS import of the module on the stack", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import './A';
    `,
    "C.cts": `
      module.exports = { c: 42 };
    `,
    "A.ts": `
      import { c } from './C.cts';
      import './B';
      export function readC() { return c; }
    `,
    "B.ts": `
      import { readC } from './A';
      console.log("B sees " + readC());
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("B sees 42");
  },
});
devTest("cyclic import reads a star re-export at the top level", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["/entry.js"],
    }),
    "entry.js": `
      import { greet } from "./barrel.js";

      export function name() {
        return "entry";
      }

      console.log(greet());
    `,
    "barrel.js": `
      export * from "./impl.js";
    `,
    "impl.js": `
      import { name } from "./entry.js";

      export function greet() {
        return "hello " + name();
      }

      // entry.js is still evaluating here. This is the cyclic read.
      export const eager = greet();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("hello entry");
  },
});
// A module that takes part in an import cycle is evaluated while its partner is
// still on the stack. Its partner's exported function declarations are already
// initialized, the same as with `bun run` and with `bun build`.
devTest("import cycle: a top level read of the cyclic import", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    // `index.ts` enters the cycle through `load-client.ts`, so `router.ts` is
    // the module that evaluates inside the cycle.
    "index.ts": `
      import { replaceRouteChunk } from './load-client';
      import { RouterCore } from './router';
      if (typeof RouterCore.prototype.replaceRouteChunk !== 'function')
        throw new Error('the cyclic import was not linked: ' + typeof RouterCore.prototype.replaceRouteChunk);
      if (replaceRouteChunk() !== 'chunk:info') throw new Error('wrong value: ' + replaceRouteChunk());
      console.log('PASS');
    `,
    "load-client.ts": `
      import { getInfo } from './router';
      export function replaceRouteChunk() { return 'chunk:' + getInfo(); }
    `,
    "router.ts": `
      import { replaceRouteChunk } from './load-client';
      export function getInfo() { return 'info'; }
      export class RouterCore {}
      RouterCore.prototype.replaceRouteChunk = replaceRouteChunk;
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
// The same cycle, read after both modules evaluate. `patchImporters` repairs
// this one, and it must keep working with the two phase link.
devTest("import cycle: a deferred read of the cyclic import", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import './load-client';
      import { RouterCore } from './router';
      if (new RouterCore().replaceRouteChunk() !== 'chunk:info') throw new Error('wrong value');
      console.log('PASS');
    `,
    "load-client.ts": `
      import { getInfo } from './router';
      export function replaceRouteChunk() { return 'chunk:' + getInfo(); }
    `,
    "router.ts": `
      import { replaceRouteChunk } from './load-client';
      export function getInfo() { return 'info'; }
      export class RouterCore {
        replaceRouteChunk() { return replaceRouteChunk(); }
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
// Each export form of the module inside the cycle is read by its partner
// while the module is still on the stack: a class, a reassigned `let`, an
// `export * as` namespace, a default export of an object, an alias, and a
// constant that the lowering moves into the namespace object. The partner's
// `read` runs before the partner binds its own imports, so the runtime must
// bind the import of a module that is still on the stack as soon as the
// dependency instantiates.
devTest("import cycle: each export form of the module inside the cycle", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    // `index.ts` enters the cycle through `reader.ts`, so `shapes.ts`
    // evaluates inside the cycle and calls `read` while `reader.ts` is still
    // on the stack.
    "index.ts": `
      import { read } from './reader';
      import { reading } from './shapes';
      if (reading !== 'function,2,leaf,made,renamed,moved') throw new Error('wrong value: ' + reading);
      if (read() !== reading) throw new Error('the later read differs: ' + read());
      console.log('PASS');
    `,
    "reader.ts": `
      import made, { Shape, counter, ns, renamed, movable } from './shapes';
      export function read() {
        return [typeof Shape, counter, ns.leaf, made.kind, renamed, movable].join(',');
      }
    `,
    "shapes.ts": `
      import { read } from './reader';
      export class Shape {}
      export let counter = 1;
      counter = 2;
      export * as ns from './leaf';
      export default { kind: 'made' };
      const local = 'renamed';
      export { local as renamed };
      export const movable = 'moved';
      export const reading = read();
    `,
    "leaf.ts": `
      export const leaf = 'leaf';
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
// A read of a binding that the module inside the cycle has not declared yet
// is a temporal dead zone error, the same as with `bun run`: not `undefined`,
// and not a `TypeError` on a missing namespace.
devTest("import cycle: a read of a binding before its declaration throws", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    // `index.ts` enters the cycle through `shapes.ts`, so `reader.ts`
    // evaluates before `shapes.ts` declares `Shape`.
    "index.ts": `
      import { Shape } from './shapes';
      import { seen } from './reader';
      if (seen !== 'ReferenceError') throw new Error('expected the temporal dead zone, got: ' + seen);
      if (typeof Shape !== 'function') throw new Error('the class is not exported');
      console.log('PASS');
    `,
    "reader.ts": `
      import { Shape } from './shapes';
      let seen;
      try { seen = typeof Shape; } catch (error) { seen = error.constructor.name; }
      export { seen };
    `,
    "shapes.ts": `
      import './reader';
      export class Shape {}
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
// A module with top level await is an async generator with the same two
// phases. Its partner reads it after both evaluate.
devTest("import cycle through a module with top level await: a deferred read", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { describe } from './partner';
      import { waited, partnerName } from './waiter';
      if (describe() !== 'waited:partner') throw new Error('wrong value: ' + describe());
      if (partnerName() !== 'partner') throw new Error('wrong value: ' + partnerName());
      console.log('PASS');
    `,
    "partner.ts": `
      import { waited } from './waiter';
      export const name = 'partner';
      export function describe() { return waited + ':' + name; }
    `,
    "waiter.ts": `
      import { name } from './partner';
      export const waited = await Promise.resolve('waited');
      export function partnerName() { return name; }
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
// The namespace object of a module with top level await exists before its body
// runs, so its partner reads the binding through a live getter after the
// `await` settled. `bun run` and Node print the same value. The dev server of
// 1.4.0 threw `TypeError: null is not an object` here.
devTest("import cycle through a module with top level await: a top level read", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { seen } from './waiter';
      console.log('seen: ' + seen);
    `,
    "waiter.ts": `
      import { describe } from './partner';
      export const value = await Promise.resolve('waited');
      export const seen = describe();
    `,
    "partner.ts": `
      import { value } from './waiter';
      export function describe() { return String(value); }
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("seen: waited");
  },
});
// The partner of a module with top level await waits for that module, as with
// `bun run` and Node: the cycle is entered through the partner here, so the
// module with the `await` evaluates first and the partner reads the settled
// value.
devTest("import cycle through a module with top level await: the partner waits for the await", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { seen } from './partner';
      import { value } from './waiter';
      console.log(seen + ' then ' + value);
    `,
    "partner.ts": `
      import { value, tag } from './waiter';
      let valueSeen;
      try { valueSeen = typeof value; } catch (error) { valueSeen = error.constructor.name; }
      export const seen = tag() + ':' + valueSeen;
    `,
    "waiter.ts": `
      import './partner';
      export function tag() { return 'waiter'; }
      export const value = await Promise.resolve('waited');
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("waiter:string then waited");
  },
});
// The partner of an `export * from` barrel reads a re-exported name through
// the barrel while the barrel is still on the stack. The runtime defines the
// forwarding getters when the barrel instantiates, so the read resolves once
// the re-exported module has evaluated, which `leaf.ts` has: the barrel loads
// it before `reader.ts`.
devTest("import cycle through an export star barrel: a top level read", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { own } from './barrel';
      import { seen } from './reader';
      if (seen !== 'leaf+reader') throw new Error('wrong value: ' + seen);
      if (own() !== 'reader') throw new Error('wrong value: ' + own());
      console.log('PASS');
    `,
    "reader.ts": `
      import { leaf, own } from './barrel';
      export const tag = 'reader';
      export const seen = leaf + '+' + own();
    `,
    "barrel.ts": `
      export * from './leaf';
      import { tag } from './reader';
      export function own() { return tag; }
    `,
    "leaf.ts": `
      export const leaf = 'leaf';
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
// A hot update replaces the module inside the cycle and links it again with
// its partner, which did not change.
devTest("import cycle: a hot update of the module inside the cycle", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import './load-client';
      import { RouterCore } from './router';
      console.log('value ' + new RouterCore().replaceRouteChunk());
      import.meta.hot.accept();
    `,
    "load-client.ts": `
      import { getInfo } from './router';
      export function replaceRouteChunk() { return 'chunk:' + getInfo(); }
    `,
    "router.ts": `
      import { replaceRouteChunk } from './load-client';
      export function getInfo() { return 'info 1'; }
      export class RouterCore {
        replaceRouteChunk() { return replaceRouteChunk(); }
      }
      RouterCore.prototype.chunkAtLoad = replaceRouteChunk();
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("value chunk:info 1");
    await dev.patch("router.ts", {
      find: "info 1",
      replace: "info 2",
    });
    await c.expectMessage("value chunk:info 2");
  },
});
// A throw in the body of a module that a dynamic import loads must be recorded
// on the module: the next import of that id repeats the error instead of
// handing out a module that never finished.
devTest("dynamic import of a throwing module rejects again on retry", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      async function attempt(label) {
        try {
          await import('./boom');
          console.log(label + ': no error');
        } catch (error) {
          console.log(label + ': ' + error.message);
        }
      }
      void (async () => {
        await attempt('first');
        await attempt('second');
      })();
    `,
    "boom.ts": `
      throw new Error('boom');
      export const unreachable = 1;
    `,
  },
  async test(dev) {
    // The throws are caught in user code, so no error overlay appears.
    await using c = await dev.client("/");
    await c.expectMessage("first: boom", "second: boom");
  },
});
devTest("export { x as y }", {
  framework: minimalFramework,
  files: {
    "module.ts": `
      function x(value) {
        return value + 1;
      } 
      export { x as y };
    `,
    "routes/index.ts": `
      import { y } from '../module';
      export default function(req, meta) {
        return new Response('Value: ' + y(1));
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Value: 2");
    await dev.patch("module.ts", {
      find: "1",
      replace: "2",
    });
    await dev.fetch("/").equals("Value: 3");
  },
});
devTest("import { x as y }", {
  framework: minimalFramework,
  files: {
    "module.ts": `
      export const x = 1;
    `,
    "routes/index.ts": `
      import { x as y } from '../module';
      export default function(req, meta) {
        return new Response('Value: ' + y);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Value: 1");
    await dev.patch("module.ts", {
      find: "1",
      replace: "2",
    });
    await dev.fetch("/").equals("Value: 2");
  },
});
devTest("import { default as y }", {
  framework: minimalFramework,
  files: {
    "module.ts": `
      export default 1;
    `,
    "routes/index.ts": `
      import { default as y } from '../module';
      export default function(req, meta) {
        return new Response('Value: ' + y);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Value: 1");
    await dev.patch("module.ts", {
      find: "1",
      replace: "2",
    });
    await dev.fetch("/").equals("Value: 2");
  },
});
devTest("export { default as y }", {
  framework: minimalFramework,
  files: {
    "module.ts": `
      export default 1;
    `,
    "middle.ts": `
      export { default as y } from './module';
    `,
    "routes/index.ts": `
      import { y } from '../middle';
      export default function(req, meta) {
        return new Response('Value: ' + y);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Value: 1");
    await dev.patch("module.ts", {
      find: "1",
      replace: "2",
    });
    await dev.fetch("/").equals("Value: 2");
  },
});
devTest("export * as namespace", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { ns as renamed } from './module';
      if (typeof renamed !== 'object') throw new Error('renamed should be an object');
      if (renamed.x !== 1) throw new Error('renamed.x should be 1');
      if (renamed.y !== 2) throw new Error('renamed.y should be 2');
      console.log('PASS');
    `,
    "module.ts": `
      export * as ns from './module2';
    `,
    "module2.ts": `
      export const x = 1;
      export const y = 2;
      export const ns = "FAIL";
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
devTest("ESM <-> CJS sync", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      const mod = require('./esm');
      if (!mod.__esModule) throw new Error('mod.__esModule should be set');
      console.log('PASS');
    `,
    "esm.ts": `
      export const x = 1;
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
devTest("ESM <-> CJS (async)", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      const esmImport = await import('./esm'); // TODO: implement sync ESM
      const mod = require('./esm');
      if (!mod.__esModule) throw new Error('mod.__esModule should be set');
      if (esmImport.x !== mod.x) throw new Error('esmImport.x should be equal to mod.x');
      if ('__esModule' in esmImport) throw new Error('esmImport.__esModule should be unset');
      console.log('PASS');
    `,
    "esm.ts": `
      export const x = 1;
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
devTest("importer tracking survives flipping a module from ESM to CJS", {
  // https://github.com/oven-sh/bun/issues/31942
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import './dep';
      import.meta.hot.data.runs = (import.meta.hot.data.runs ?? 0) + 1;
      console.log('index run ' + import.meta.hot.data.runs);
      import.meta.hot.accept();
    `,
    "dep.ts": `
      export const value = 'esm';
    `,
    "leaf.ts": `
      console.log('leaf 1');
      export const value = 'leaf1';
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("index run 1");
    // Flip `dep` from ESM to CJS. The dead branch gets `leaf` bundled (direct
    // `require` calls are statically rewritten to `hmr.require`, which binds
    // `this` correctly), while the indirect `m.require(...)` call is emitted
    // verbatim and goes through the `require` function bound onto the
    // replacement CJS module object, which must record `dep` as an importer
    // of `leaf`.
    await dev.write(
      "dep.ts",
      `
        if (globalThis.__never_set) require('./leaf');
        const m = module;
        module.exports = { value: m.require(module.id.replace('dep', 'leaf')).value };
      `,
    );
    await c.expectMessage("leaf 1", "index run 2");
    // Editing `leaf` must propagate through the flipped module up to the
    // self-accepting root as a hot update. If the importer edge was dropped,
    // the dev server forces a full page reload instead (the client harness
    // fails on unexpected reloads).
    await dev.write(
      "leaf.ts",
      `
        console.log('leaf 2');
        export const value = 'leaf2';
      `,
    );
    await c.expectMessage("leaf 2", "index run 3");
  },
});
devTest("cannot require a module with top level await", {
  // TODO: after the module-loader rewrite the dev server's /_bun/report_error
  // handler can hang (never responds), so the client overlay never mounts and
  // expectErrorOverlay times out. The error itself is thrown correctly.
  // Previously gated on !(isCI && isASAN) for the same symptom. Tracked for
  // follow-up — re-enable once the report_error hang is fixed.
  skip: ["ci"],
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      const mod = require('./esm');
      console.log('FAIL');
    `,
    "esm.ts": `
      console.log("FAIL");
      import { hello } from './dir';
      hello;
    `,
    "dir/index.ts": `
      import './async';
    `,
    "dir/async.ts": `
      console.log("FAIL");
      await 1;
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: [
        `error: Cannot require "esm.ts" because "dir/async.ts" uses top-level await, but 'require' is a synchronous operation.`,
      ],
    });
  },
});
devTest("function that is assigned to should become a live binding", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      // 1. basic test
      import { live, change } from "./live.js";
      {
        if (live() !== 1) throw new Error("live() should be 1");
        change();
        if (live() !== 2) throw new Error("live() should be 2");
      }

      // 2. integration test with @babel/runtime
      import inheritsLoose from "./inheritsLoose.js";
      {
        function A() {}
        function B() {}
        inheritsLoose(B, A);
      }

      console.log('PASS');
    `,
    "live.js": `
      export function live() {
        return 1;
      }
      export function change() {
        live = function() {
          return 2;
        }
      }
    `,
    "inheritsLoose.js": `
      import setPrototypeOf from "./setPrototypeOf.js";
      function _inheritsLoose(t, o) {
        t.prototype = Object.create(o.prototype), t.prototype.constructor = t, setPrototypeOf(t, o);
      }
      export { _inheritsLoose as default };
    `,
    "setPrototypeOf.js": `
      function _setPrototypeOf(t, e) {
        return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) {
          return t.__proto__ = e, t;
        }, _setPrototypeOf(t, e);
      }
      export { _setPrototypeOf as default };
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});

devTest("browser field is used", {
  files: {
    // Ensure the package.json gets parsed before the HTML is bundled.
    "bunfig.toml": `
      preload = [
        "axios/lib/utils.js",
      ]
    `,
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "node_modules/axios/package.json": JSON.stringify({
      name: "axios",
      version: "1.0.0",
      browser: {
        "./lib/utils.js": "./lib/utils.browser.js",
      },
    }),
    "node_modules/axios/lib/utils.js": `
      export default "FAIL";
    `,
    "node_modules/axios/lib/utils.browser.js": `
      export default "PASS";
    `,
    "index.ts": `
      import axios from "axios/lib/utils.js";
      console.log(axios);
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});

devTest("browser console forwarding strips terminal control bytes", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      console.log("loaded");
    `,
    // The harness-generated bun.app.ts does not enable the dev console echo,
    // so provide one directly. `htmlFiles: []` tells the harness not to
    // generate its own config from index.html.
    "bun.app.ts": `
      import html from "./index.html";
      export default {
        static: {
          "/": html,
        },
        development: {
          console: true,
        },
        fetch(req) {
          return new Response("Not Found", { status: 404 });
        },
      };
    `,
  },
  htmlFiles: [],
  async test(dev) {
    // The harness already holds an open /_bun/hmr websocket in `dev.socket`.
    // A ConsoleLog frame is 'l' (message id) + 'l' (kind = log) + payload;
    // the payload is echoed to the dev server's terminal when
    // `development.console` is enabled. Send a payload carrying an OSC 52
    // clipboard-write sequence and assert the escape introducer never
    // reaches the terminal.
    dev.socket!.send("ll" + "\x1b]52;c;aGVsbG8=\x07" + "clipboard-probe-end");
    const filtered = await dev.output.waitForLine(/\[browser\].*clipboard-probe-end/);
    expect(filtered.input).not.toContain("\x1b]52");
    expect(filtered.input).not.toContain("\x07");

    // A plain printable payload is still forwarded verbatim.
    dev.socket!.send("ll" + "plain-console-probe");
    const plain = await dev.output.waitForLine(/\[browser\].*plain-console-probe/);
    expect(plain.input).toContain("plain-console-probe");
  },
});

devTest("error report endpoint tolerates a browser url whose normalized origin is longer than the input", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      export default function (req, meta) {
        return new Response('OK');
      }
    `,
  },
  async test(dev) {
    // /_bun/report_error payload: name, message and browser-url as
    // (u32-LE length + bytes) each, followed by a u32-LE stack-frame count.
    const enc = new TextEncoder();
    function str32(s: string) {
      const bytes = enc.encode(s);
      const out = new Uint8Array(4 + bytes.length);
      new DataView(out.buffer).setUint32(0, bytes.length, true);
      out.set(bytes, 4);
      return out;
    }
    // "http:h" serializes to "http://h/", so the parser reports an origin
    // length (9) that is longer than the 6-byte input.
    const parts = [str32("ReportName"), str32("report-message-sentinel"), str32("http:h"), new Uint8Array(4)];
    const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
      body.set(part, offset);
      offset += part.length;
    }

    // Fire the report without awaiting the response (the handler's reply
    // path is independently flaky; see the skip note on the top-level-await
    // test above). The handler logs the reported error to the terminal only
    // after it has parsed the payload, including the malformed browser url.
    dev.fetch("/_bun/report_error", { method: "POST", body }).catch(() => {});
    await dev.output.waitForLine(/report-message-sentinel/);

    // The dev server is still alive and serving requests.
    await dev.fetch("/").equals("OK");
  },
});

devTest("html routes reject requests whose host header does not match the dev server", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      console.log("loaded");
    `,
  },
  async test(dev) {
    // A request that reaches the listening socket but carries a foreign Host
    // header (the shape of a DNS-rebound origin) must not receive the HTML
    // document, which embeds the secret-bearing /_bun/client/... script URL.
    const rebound = await dev.fetch("/", { headers: { Host: "rebound-host.example" } });
    const reboundBody = await rebound.text();
    expect(reboundBody).not.toContain("/_bun/client/");
    expect(rebound.status).toBe(403);

    // The same request with the dev server's own host still serves the page
    // and its client bundle script tag.
    const normal = await dev.fetch("/");
    expect(await normal.text()).toContain("/_bun/client/");
    expect(normal.status).toBe(200);
  },
});
