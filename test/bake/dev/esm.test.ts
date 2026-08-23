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
// devTest("live bindings through export star", {
//   framework: minimalFramework,
//   files: {
//     "state.ts": `
//       export var value = 0;
//       export function increment() {
//         value++;
//       }
//     `,
//     "proxy.ts": `
//       export * from './state';
//     `,
//     "routes/index.ts": `
//       import { increment } from '../state';
//       import { live } from '../proxy';
//       export default function(req, meta) {
//         increment();
//         return new Response('State: ' + live);
//       }
//     `,
//   },
//   test: liveBindingTest.test,
// });
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
// constant that the lowering moves into the namespace object.
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
// A module with top level await keeps the single phase form: its namespace
// object exists only after its body. Its partner reads it after both evaluate.
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
// A module with top level await keeps the single phase form, so its namespace
// object stays empty until its body ends. A top level read of it from inside
// the cycle answers `undefined`. `bun run` throws
// `ReferenceError: Cannot access 'value' before initialization` for the same
// files, and the dev server of 1.4.0 throws `TypeError: null is not an
// object`. This test documents the middle state, which no longer stops the
// page.
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
    await c.expectMessage("seen: undefined");
  },
});
// A module with `export * from` keeps the single phase form too, because the
// spread copies the re-exported values. Its partner reads it after both
// evaluate.
devTest("import cycle through an export star barrel: a deferred read", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { read } from './reader';
      import * as barrel from './barrel';
      if (read() !== 'leaf+reader') throw new Error('wrong value: ' + read());
      if (barrel.leaf !== 'leaf') throw new Error('wrong value: ' + barrel.leaf);
      console.log('PASS');
    `,
    "reader.ts": `
      import { leaf, own } from './barrel';
      export const tag = 'reader';
      export function read() { return leaf + '+' + own(); }
    `,
    "barrel.ts": `
      import { tag } from './reader';
      export * from './leaf';
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
// A module with no imports gets no `yield`, so the instantiation phase runs
// its whole body. A throw there must be recorded on the module, the way a
// throw in the evaluation phase is: the next import of that id repeats the
// error instead of handing out a module that never finished.
devTest("a module that throws while it instantiates keeps the failure", {
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
    // No imports, so the bundler emits no `yield` for this module.
    "boom.ts": `
      throw new Error('boom');
      export const unreachable = 1;
    `,
  },
  async test(dev) {
    await using c = await dev.client({ errors: ["error: boom"] });
    await c.expectMessage("first: boom", "second: boom");
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
