// ESM tests are about various esm features in development mode.
import { expect } from "bun:test";
import { type Dev, devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

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

devTest("a module that failed to load fails the same way when it is loaded again", {
  // A failed ESM module must be recorded as failed by every loader path.
  // Otherwise it stays half-initialized in the registry and the next
  // `import()` or `require()` of it silently gets a namespace that is `null`
  // (or empty, through `require`) instead of the error. The modules that fail
  // on their own number their evaluations in the error message, so these
  // assertions also tell a recorded failure apart from a second evaluation
  // that happens to fail the same way.
  framework: minimalFramework,
  files: {
    "a.ts": `
      import "./a-dep";
      export const value = "unreachable";
    `,
    "a-dep.ts": `
      throw new Error("a-dep threw");
    `,
    "b.ts": `
      import "./b-dep";
      export const value = "unreachable";
    `,
    "b-dep.ts": `
      throw new Error("b-dep threw");
    `,
    "c.ts": `
      import "./c-dep";
      export const value = "unreachable";
    `,
    "c-dep.ts": `
      throw new Error("c-dep threw");
    `,
    "d.ts": `
      export const value = "unreachable";
      await 1;
      throw new Error("d rejected #" + (globalThis.dEvaluations = (globalThis.dEvaluations ?? 0) + 1));
    `,
    "e.ts": `
      import "./e-mid";
      export const value = "unreachable";
    `,
    "e-mid.ts": `
      import "./e-dep";
      export const value = "unreachable";
    `,
    "e-dep.ts": `
      throw new Error("e-dep threw");
    `,
    "f.ts": `
      export const value = "unreachable";
      throw new Error("f threw #" + (globalThis.fEvaluations = (globalThis.fEvaluations ?? 0) + 1));
    `,
    "g.ts": `
      export { value } from "./g-dep";
    `,
    "g-dep.ts": `
      await 1;
      export const value = "g loaded";
    `,
    "h.ts": `
      export const value = "unreachable";
      throw new Error("h threw #" + (globalThis.hEvaluations = (globalThis.hEvaluations ?? 0) + 1));
    `,
    "i.ts": `
      import "./i-dep";
      export const value = "unreachable";
    `,
    "i-dep.ts": `
      await 1;
      throw new Error("i-dep rejected");
    `,
    "j.ts": `
      import "./j-mid";
      export const value = "unreachable";
    `,
    "j-mid.ts": `
      require("./j-async");
      export const value = "unreachable";
    `,
    "j-async.ts": `
      await 1;
      export const value = "unreachable";
    `,
    "k.ts": `
      export { value } from "./k-mid";
    `,
    "k-mid.ts": `
      export { value } from "./k-async";
    `,
    "k-async.ts": `
      await 1;
      export const value = "k loaded";
    `,
    "l.ts": `
      import "./l-cjs";
      export const value = "unreachable";
    `,
    "l-cjs.ts": `
      require("./l-async");
      module.exports = { value: "unreachable" };
    `,
    "l-async.ts": `
      await 1;
      export const value = "unreachable";
    `,
    "routes/index.ts": `
      // A synchronous throw and a rejection produce the same result, so this
      // does not depend on which of the two import() reports a failure with.
      async function attempt(load) {
        try {
          return "resolved: " + JSON.stringify(await load());
        } catch (e) {
          return "threw: " + e.message;
        }
      }
      export default async function () {
        const results = {};
        results.importWithThrowingDep = [
          await attempt(() => import("../a")),
          await attempt(() => import("../a")),
        ];
        results.requireWithThrowingDep = [
          await attempt(() => require("../b")),
          await attempt(() => require("../b")),
        ];
        results.importThenRequireWithThrowingDep = [
          await attempt(() => import("../c")),
          await attempt(() => require("../c")),
        ];
        results.importWithRejectingTopLevelAwait = [
          await attempt(() => import("../d")),
          await attempt(() => import("../d")),
        ];
        results.importChain = [
          await attempt(() => import("../e")),
          await attempt(() => import("../e")),
          await attempt(() => import("../e-mid")),
        ];
        results.requireThrowingModule = [
          await attempt(() => require("../f")),
          await attempt(() => require("../f")),
        ];
        results.requireWithAsyncDep = [
          await attempt(() => require("../g")),
          await attempt(() => require("../g")),
          await attempt(() => import("../g")),
        ];
        results.importThrowingModule = [
          await attempt(() => import("../h")),
          await attempt(() => import("../h")),
        ];
        results.importWithRejectingDep = [
          await attempt(() => import("../i")),
          await attempt(() => import("../i")),
        ];
        results.requireWithDepThatFailedToRequire = [
          await attempt(() => require("../j")),
          await attempt(() => require("../j")),
          await attempt(() => import("../j")),
        ];
        results.requireWithAsyncDepTwoLevelsDown = [
          await attempt(() => require("../k")),
          await attempt(() => require("../k")),
          await attempt(() => require("../k-mid")),
          await attempt(() => import("../k")),
          await attempt(() => import("../k-mid")),
        ];
        results.requireWithCommonJSDepThatFailedToRequire = [
          await attempt(() => require("../l")),
          await attempt(() => require("../l")),
          await attempt(() => import("../l")),
        ];
        return Response.json(results);
      }
    `,
  },
  async test(dev) {
    const cannotRequire = (id: string, asyncId: string) =>
      `threw: Cannot require "${id}" because "${asyncId}" uses top-level await, but 'require' is a synchronous operation.`;
    const cannotRequireJ = expect.stringMatching(
      /^threw: Cannot require "(j|j-async)\.ts" because "j-async\.ts" uses top-level await, but 'require' is a synchronous operation\.$/,
    );
    const kLoaded = 'resolved: {"value":"k loaded"}';
    expect(await dev.fetch("/").json()).toEqual({
      // A static dependency throws while the module is being loaded.
      importWithThrowingDep: ["threw: a-dep threw", "threw: a-dep threw"],
      requireWithThrowingDep: ["threw: b-dep threw", "threw: b-dep threw"],
      // The failure recorded by one loader is seen by the other one too.
      importThenRequireWithThrowingDep: ["threw: c-dep threw", "threw: c-dep threw"],
      // The module's own top-level await rejects.
      importWithRejectingTopLevelAwait: ["threw: d rejected #1", "threw: d rejected #1"],
      // Every module between the importer and the throwing dependency fails.
      importChain: ["threw: e-dep threw", "threw: e-dep threw", "threw: e-dep threw"],
      // The module's own body throws synchronously during require().
      requireThrowingModule: ["threw: f threw #1", "threw: f threw #1"],
      // Refusing to require() a module with an async dependency is not an
      // evaluation failure: it keeps failing under require() and still loads
      // through import().
      requireWithAsyncDep: [
        cannotRequire("g.ts", "g-dep.ts"),
        cannotRequire("g.ts", "g-dep.ts"),
        'resolved: {"value":"g loaded"}',
      ],
      // These two paths already recorded the failure; the ones above now match them.
      importThrowingModule: ["threw: h threw #1", "threw: h threw #1"],
      importWithRejectingDep: ["threw: i-dep rejected", "threw: i-dep rejected"],
      // Here the dependency's body itself called require() on an async module,
      // so the same kind of error is a real evaluation failure this time and
      // import() must fail as well. (require() rewrites the message of the
      // error it rethrows, hence the loose match on the module it names.)
      requireWithDepThatFailedToRequire: [cannotRequireJ, cannotRequireJ, cannotRequireJ],
      // The refusal travels up through k-mid, which has to stay loadable too.
      requireWithAsyncDepTwoLevelsDown: [
        cannotRequire("k.ts", "k-async.ts"),
        cannotRequire("k.ts", "k-async.ts"),
        cannotRequire("k-mid.ts", "k-async.ts"),
        kLoaded,
        kLoaded,
      ],
      // Like j, but the dependency is CommonJS. A CommonJS module that throws
      // is evaluated again on its next load rather than recorded as failed, so
      // the importer is left loadable as well and fails afresh every time,
      // through import() too (which only has the inner require() name the module).
      requireWithCommonJSDepThatFailedToRequire: [
        cannotRequire("l.ts", "l-async.ts"),
        cannotRequire("l.ts", "l-async.ts"),
        cannotRequire("l-async.ts", "l-async.ts"),
      ],
    });
  },
});

devTest("a module that failed to load fails the same way when it is loaded again (client)", {
  // Same loader as the server test above, running in the browser runtime.
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      async function attempt(load) {
        try {
          return "resolved: " + JSON.stringify(await load());
        } catch (e) {
          return "threw: " + e.message;
        }
      }
      console.log({
        importWithThrowingDep: [await attempt(() => import("./a")), await attempt(() => import("./a"))],
        requireWithThrowingDep: [await attempt(() => require("./b")), await attempt(() => require("./b"))],
        importWithRejectingTopLevelAwait: [await attempt(() => import("./c")), await attempt(() => import("./c"))],
      });
    `,
    "a.ts": `
      import "./a-dep";
      export const value = "unreachable";
    `,
    "a-dep.ts": `
      throw new Error("a-dep threw");
    `,
    "b.ts": `
      import "./b-dep";
      export const value = "unreachable";
    `,
    "b-dep.ts": `
      throw new Error("b-dep threw");
    `,
    "c.ts": `
      export const value = "unreachable";
      await 1;
      throw new Error("c rejected");
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage({
      importWithThrowingDep: ["threw: a-dep threw", "threw: a-dep threw"],
      requireWithThrowingDep: ["threw: b-dep threw", "threw: b-dep threw"],
      importWithRejectingTopLevelAwait: ["threw: c rejected", "threw: c rejected"],
    });
  },
});

devTest("a route whose dependency throws reports that error on every request", {
  // The server runtime loads the route's modules again for each request. A
  // route left half-initialized by a failed dependency used to report the real
  // error once and then "null is not an object" for every later request.
  framework: minimalFramework,
  files: {
    "dep.ts": `
      export const value = "unreachable";
      throw new Error("dep threw");
    `,
    "routes/index.ts": `
      import { value } from "../dep";
      export default function () {
        return new Response(value);
      }
    `,
  },
  async test(dev) {
    // The dev error page embeds its payload as JSON (see src/runtime/server/DevErrorPage.rs).
    const errorPageJson = /<script id="__bunfallback" type="application\/json">([^<]*)<\/script>/;
    for (let i = 0; i < 2; i++) {
      const response = await dev.fetch("/");
      const payload = JSON.parse(errorPageJson.exec(await response.text())![1]);
      expect(payload.problems.exceptions.map((exception: any) => exception.message)).toEqual(["dep threw"]);
      expect(response.status).toBe(500);
    }
  },
});

// Fixture for the three tests below: modules whose top-level await the test
// settles through the route, so that a module can be hot-updated while an
// evaluation of it (or of a module importing it) is still waiting.
const supersededEvaluationFiles = {
  "slow-1.ts": settledThroughRoute("slow-1"),
  "slow-2.ts": settledThroughRoute("slow-2"),
  "reexports-slow-2.ts": `
    export { value } from "./slow-2";
  `,
  "slow-3.ts": settledThroughRoute("slow-3"),
  "slow-4.ts": settledThroughRoute("slow-4"),
  "slow-a.ts": settledThroughRoute("slow-a"),
  "slow-b.ts": settledThroughRoute("slow-b"),
  "imports-slow-a.ts": `
    import "./slow-a";
    export const value = "imports-slow-a v1";
  `,
  "imports-slow-b.ts": `
    import "./slow-b";
    export const value = "imports-slow-b v1";
  `,
  "routes/index.ts": `
    const loaders = {
      "slow-1": () => import("../slow-1"),
      "slow-2": () => import("../slow-2"),
      "reexports-slow-2": () => import("../reexports-slow-2"),
      "slow-3": () => import("../slow-3"),
      "slow-4": () => import("../slow-4"),
      "slow-4-require": () => require("../slow-4"),
      "imports-slow-a": () => import("../imports-slow-a"),
      "imports-slow-b": () => import("../imports-slow-b"),
    };
    async function attempt(load) {
      try {
        return "resolved: " + JSON.stringify(await load());
      } catch (e) {
        return "threw: " + e.message;
      }
    }
    export default async function (req) {
      const [op, name, version] = req.headers.get("x-command").split(" ");
      if (op === "start") {
        (globalThis.started ??= {})[name] = attempt(loaders[name]);
        return new Response("started");
      }
      if (op === "resolve" || op === "reject") {
        globalThis.settlers[name + " " + version][op]();
        return new Response("settled");
      }
      return Response.json({
        first: await globalThis.started[name],
        again: await attempt(loaders[name]),
      });
    }
  `,
};

// "start <module>", "resolve <module> <version>", "reject <module> <version>"
// or "load <module>", see the route above. (Sent as a header because static
// framework routes currently 404 on query strings in development.)
function command(dev: Dev, line: string) {
  return dev.fetch("/", { headers: { "x-command": line } });
}

function settledThroughRoute(name: string) {
  return `
    const version = "v1";
    const { promise, resolve, reject } = Promise.withResolvers();
    (globalThis.settlers ??= {})["${name} " + version] = {
      resolve,
      reject: () => reject(new Error("${name} " + version + " failed")),
    };
    await promise;
    export const value = "${name} " + version;
  `;
}

devTest("an evaluation superseded by a hot update does not publish its outcome", {
  // Saving a module while its top-level await is still pending starts a second
  // evaluation of the same registry entry. When the first one settles later,
  // it must neither record its failure over the new version nor push its
  // namespace to the importers of the new one.
  framework: minimalFramework,
  files: supersededEvaluationFiles,
  async test(dev) {
    await command(dev, "start slow-1").equals("started");
    await command(dev, "start slow-2").equals("started");
    await dev.patch("slow-1.ts", { find: '"v1"', replace: '"v2"' });
    await dev.patch("slow-2.ts", { find: '"v1"', replace: '"v2"' });
    await command(dev, "resolve slow-1 v2").equals("settled");
    await command(dev, "resolve slow-2 v2").equals("settled");
    // Imports slow-2 after v2 has loaded, so its binding points at v2.
    await command(dev, "start reexports-slow-2").equals("started");

    await command(dev, "reject slow-1 v1").equals("settled");
    await command(dev, "resolve slow-2 v1").equals("settled");

    expect(await command(dev, "load slow-1").json()).toEqual({
      first: "threw: slow-1 v1 failed",
      again: 'resolved: {"value":"slow-1 v2"}',
    });
    expect(await command(dev, "load reexports-slow-2").json()).toEqual({
      first: 'resolved: {"value":"slow-2 v2"}',
      again: 'resolved: {"value":"slow-2 v2"}',
    });
  },
});

devTest("an evaluation superseded by a hot update to CommonJS does not publish its outcome", {
  // Same as above, except that the new version of the module is CommonJS, which
  // the loaders evaluate on a different path. The old evaluation settling must
  // neither mark the CommonJS module as failed nor tear down its module object.
  framework: minimalFramework,
  files: supersededEvaluationFiles,
  async test(dev) {
    await command(dev, "start slow-3").equals("started");
    await command(dev, "start slow-4").equals("started");
    await dev.write("slow-3.ts", `module.exports = { value: "slow-3 cjs" };`);
    await dev.write("slow-4.ts", `module.exports = { value: "slow-4 cjs" };`);

    await command(dev, "reject slow-3 v1").equals("settled");
    await command(dev, "resolve slow-4 v1").equals("settled");

    expect(await command(dev, "load slow-3").json()).toEqual({
      first: "threw: slow-3 v1 failed",
      again: 'resolved: {"default":{"value":"slow-3 cjs"},"value":"slow-3 cjs"}',
    });
    // Nothing was started under this name, so only `again` is reported.
    expect(await command(dev, "load slow-4-require").json()).toEqual({
      again: 'resolved: {"value":"slow-4 cjs"}',
    });
  },
});

devTest("an importer re-evaluated by a hot update ignores the dependencies its previous evaluation waited for", {
  // While an importer waits for a dependency with top-level await, the importer
  // itself is saved without that import. Once the dependency settles, the
  // superseded evaluation must neither run the old body nor record the
  // dependency's failure over the new version.
  framework: minimalFramework,
  files: supersededEvaluationFiles,
  async test(dev) {
    await command(dev, "start imports-slow-a").equals("started");
    await command(dev, "start imports-slow-b").equals("started");
    await dev.write("imports-slow-a.ts", `export const value = "imports-slow-a v2";`);
    await dev.write("imports-slow-b.ts", `export const value = "imports-slow-b v2";`);

    await command(dev, "resolve slow-a v1").equals("settled");
    await command(dev, "reject slow-b v1").equals("settled");

    expect(await command(dev, "load imports-slow-a").json()).toEqual({
      first: 'resolved: {"value":"imports-slow-a v2"}',
      again: 'resolved: {"value":"imports-slow-a v2"}',
    });
    expect(await command(dev, "load imports-slow-b").json()).toEqual({
      first: "threw: slow-b v1 failed",
      again: 'resolved: {"value":"imports-slow-b v2"}',
    });
  },
});
