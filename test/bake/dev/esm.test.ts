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
devTest("server module throwing while it is hot reloaded is reported and fixed by the next save", {
  framework: minimalFramework,
  files: {
    "config.ts": `
      export const value = "v1";
    `,
    "routes/index.ts": `
      import { value } from '../config';
      export default function(req, meta) {
        return new Response(value);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("v1");

    // The new version of the module throws while the server runtime evaluates
    // it during the update. Before the fix this was an unhandled rejection in
    // the dev server process, which exited; every `dev.write` below then
    // failed because nothing was listening any more.
    await dev.write(
      "config.ts",
      `
        throw new Error("config boom sync");
        export const value = "v2";
      `,
    );
    await dev.output.waitForLine(/config boom sync/);
    // The route keeps being served from the modules evaluated before the failed
    // update (the route module is a root and is not re-evaluated by it), and
    // saving the file again replaces the module whatever state the failed
    // evaluation left it in.
    await dev.fetch("/").equals("v1");
    await dev.write("config.ts", `export const value = "v3";`);
    await dev.fetch("/").equals("v3");

    // Same thing when the module fails asynchronously: with top-level await the
    // update is applied through a promise that rejects instead of a throw.
    await dev.write(
      "config.ts",
      `
        await 1;
        throw new Error("config boom async");
        export const value = "v4";
      `,
    );
    await dev.output.waitForLine(/config boom async/);
    await dev.fetch("/").equals("v3");
    await dev.write(
      "config.ts",
      `
        await 1;
        export const value = "v5";
      `,
    );
    await dev.fetch("/").equals("v5");
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
devTest("import() and require() probes: options forwarding, rejection instead of throwing, require-of-TLA error", {
  // Every import() in a dev server module is lowered to hmr.dynamicImport(),
  // and require() to hmr.require(). One server, one route per concern.
  framework: minimalFramework,
  files: {
    // /import-options: modules the dev server did not bundle (builtins,
    // externals, absolute paths) fall through to a real import(), which must
    // receive the options and whose promise must be handed back to the caller.
    "import-options/dep.ts": `
      export const x = 1;
    `,
    "import-options/data.json": `{"a":1}`,
    "routes/import-options.ts": `
      import * as path from "node:path";
      export default async function (req, meta) {
        const builtinWithOptions = import("node:path", { with: {} });
        // Computed, so the bundler cannot resolve it; type: "text" is only
        // honored if the options object reaches the real import().
        const dataFile = path.join(process.cwd(), "import-options/data.json");
        const computedWithOptions = import(dataFile, { with: { type: "text" } });
        const bundledWithOptions = import("../import-options/dep", { with: {} });
        return Response.json({
          builtinWithOptions: [builtinWithOptions instanceof Promise, (await builtinWithOptions) === path],
          computedWithOptions: [computedWithOptions instanceof Promise, (await computedWithOptions)?.default],
          bundledWithOptions: [bundledWithOptions instanceof Promise, (await bundledWithOptions)?.x],
        });
      }
    `,
    // /rejects: like a native import(), hmr.dynamicImport() must always hand
    // back a promise: load failures reject it rather than escape synchronously.
    "rejects/ok.ts": `
      export const value = "ok";
    `,
    "rejects/throws.ts": `
      export const value = "unreachable";
      throw new Error("boom esm");
    `,
    "rejects/throws-cjs.ts": `
      module.exports = { value: "unreachable" };
      throw new Error("boom cjs");
    `,
    "rejects/imports-thrower.ts": `
      import "./throws-dep";
      export const value = "unreachable";
    `,
    "rejects/throws-dep.ts": `
      export const value = "unreachable";
      throw new Error("boom dep");
    `,
    "rejects/imports-tla-thrower.ts": `
      import "./tla-throws";
      export const value = "unreachable";
    `,
    "rejects/tla-throws.ts": `
      export const value = "unreachable";
      await 1;
      throw new Error("boom tla");
    `,
    "rejects/proxy-cjs.ts": `
      module.exports = new Proxy({}, {
        ownKeys() {
          throw new Error("boom ownKeys");
        },
      });
    `,
    "routes/rejects.ts": `
      async function probe(run) {
        let promise;
        try {
          promise = run();
        } catch (e) {
          return "threw synchronously: " + e.message;
        }
        if (!(promise instanceof Promise)) return "returned a non-promise";
        return promise.then(
          ns => "resolved: " + ns.value,
          e => "rejected: " + e.message,
        );
      }
      export default async function () {
        const results = {};
        results.ok = await probe(() => import("../rejects/ok"));
        results.okAgain = await probe(() => import("../rejects/ok"));
        results.esm = await probe(() => import("../rejects/throws"));
        results.esmAgain = await probe(() => import("../rejects/throws"));
        results.cjs = await probe(() => import("../rejects/throws-cjs"));
        results.cjsAgain = await probe(() => import("../rejects/throws-cjs"));
        results.dep = await probe(() => import("../rejects/imports-thrower"));
        results.tla = await probe(() => import("../rejects/imports-tla-thrower"));
        results.tlaAgain = await probe(() => import("../rejects/imports-tla-thrower"));
        results.cjsProxy = await probe(() => import("../rejects/proxy-cjs"));
        results.builtin = await probe(() => import("node:path").then(m => ({ value: typeof m.join })));
        return Response.json(results);
      }
    `,
    // /require-tla: require() used to produce its message by rewriting, in
    // place, the error the loader threw, so every enclosing require() the error
    // propagated through renamed it again (including a recorded failure).
    "require-tla/tla.ts": `
      await 1;
      export const value = "tla";
    `,
    "require-tla/imports-tla.ts": `
      import "./tla";
      export const value = "unreachable";
    `,
    "require-tla/outer.ts": `
      require("./inner");
      export const value = "unreachable";
    `,
    "require-tla/inner.ts": `
      require("./tla");
      export const value = "unreachable";
    `,
    "require-tla/requires-tla.ts": `
      require("./tla");
      export const value = "unreachable";
    `,
    "require-tla/imports-requires-tla.ts": `
      import "./requires-tla";
      export const value = "unreachable";
    `,
    "routes/require-tla.ts": `
      async function attempt(load) {
        try {
          await load();
          return "loaded";
        } catch (e) {
          return e.message;
        }
      }
      export default async function () {
        return Response.json({
          requireTla: await attempt(() => require("../require-tla/tla")),
          requireImportsTla: await attempt(() => require("../require-tla/imports-tla")),
          requireOuter: await attempt(() => require("../require-tla/outer")),
          importRequiresTla: await attempt(() => import("../require-tla/requires-tla")),
          requireRequiresTla: await attempt(() => require("../require-tla/requires-tla")),
          requireImportsRequiresTla: await attempt(() => require("../require-tla/imports-requires-tla")),
          importRequiresTlaAgain: await attempt(() => import("../require-tla/requires-tla")),
        });
      }
    `,
  },
  async test(dev) {
    expect(await dev.fetch("/import-options").json()).toStrictEqual({
      builtinWithOptions: [true, true],
      computedWithOptions: [true, '{"a":1}'],
      bundledWithOptions: [true, 1],
    });

    expect(await dev.fetch("/rejects").json()).toStrictEqual({
      ok: "resolved: ok",
      okAgain: "resolved: ok",
      // First import evaluates the module; the second one hits its recorded failure.
      esm: "rejected: boom esm",
      esmAgain: "rejected: boom esm",
      // CommonJS failures are not recorded: the module is marked stale and the
      // second import runs its body again, which throws again.
      cjs: "rejected: boom cjs",
      cjsAgain: "rejected: boom cjs",
      dep: "rejected: boom dep",
      tla: "rejected: boom tla",
      tlaAgain: "rejected: boom tla",
      // The module evaluates fine; converting its exports to a namespace fails.
      cjsProxy: "rejected: boom ownKeys",
      // Not part of the bundle, so this falls through to the runtime's own import().
      builtin: "resolved: function",
    });

    const cannotRequire = (id: string, asyncId: string) =>
      `Cannot require "require-tla/${id}" because "require-tla/${asyncId}" uses top-level await, but 'require' is a synchronous operation.`;
    expect(await dev.fetch("/require-tla").json()).toStrictEqual({
      // The required module, or one of its static imports, has top-level await.
      requireTla: cannotRequire("tla.ts", "tla.ts"),
      requireImportsTla: cannotRequire("imports-tla.ts", "tla.ts"),
      // The call that failed is the require("./tla") in inner.ts; its error
      // propagates out of the two enclosing require() calls unchanged.
      requireOuter: cannotRequire("tla.ts", "tla.ts"),
      // The import() records the error on requires-tla.ts; the require() calls
      // rethrow that recorded error as-is, and so does the second import().
      importRequiresTla: cannotRequire("tla.ts", "tla.ts"),
      requireRequiresTla: cannotRequire("tla.ts", "tla.ts"),
      requireImportsRequiresTla: cannotRequire("tla.ts", "tla.ts"),
      importRequiresTlaAgain: cannotRequire("tla.ts", "tla.ts"),
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

// Loading an entry point discovers its whole graph synchronously. "tla" starts
// evaluating, and suspends at its await, while "a" is being visited, so any
// module visited after "a" finds "tla" and "a" still in flight.
const tlaAndFirstImporter = (dir: string) => ({
  [`${dir}/tla.ts`]: `
    await 1;
    export const v = "tla";
  `,
  [`${dir}/a.ts`]: `
    import { v } from "./tla";
    export const a = "a:" + v;
  `,
});
// "b" and "c" must wait instead of being evaluated against a namespace that
// does not exist yet ("TypeError: null is not an object (evaluating
// 'import_tla.v')" thrown from b.ts).
const inFlightDiamond = (dir: string) => ({
  ...tlaAndFirstImporter(dir),
  // Second importer of a module that itself uses top-level await.
  [`${dir}/b.ts`]: `
    import { v } from "./tla";
    export const b = "b:" + v;
  `,
  // Second importer of a module that is only waiting on a dependency.
  [`${dir}/c.ts`]: `
    import { a } from "./a";
    export const c = "c:" + a;
  `,
});
devTest("modules found while another module's top-level await is in flight wait for it (server)", {
  // One server; each route has its own module graph under a directory of the same name.
  framework: minimalFramework,
  files: {
    ...inFlightDiamond("diamond"),
    "routes/diamond.ts": `
      import { a } from "../diamond/a";
      import { b } from "../diamond/b";
      import { c } from "../diamond/c";
      export default function () {
        return new Response(a + " " + b + " " + c);
      }
    `,
    // "probes" has no static dependencies, so it is evaluated synchronously
    // while "tla" (started by "a" just before) is still suspended at its await.
    ...tlaAndFirstImporter("probes"),
    "probes/probes.ts": `
      function tryRequire(load) {
        try {
          return "returned " + JSON.stringify(load());
        } catch (e) {
          return "threw: " + e.message;
        }
      }
      const requireTla = tryRequire(() => require("./tla"));
      const requireA = tryRequire(() => require("./a"));
      export const probes = import("./tla").then(ns => ({
        dynamicImport: ns === null ? "resolved to null" : "resolved to v=" + ns.v,
        requireTla,
        requireA,
      }));
    `,
    "routes/probes.ts": `
      import { a } from "../probes/a";
      import { probes } from "../probes/probes";
      export default async function () {
        const duringLoad = await probes;
        return Response.json({ a, duringLoad, requireAfterLoad: require("../probes/tla").v });
      }
    `,
    // "a" and "b" both wait on "tla", whose load rejects. Each of them, and the
    // route, must fail with that error. (When "b" was instead evaluated right
    // away, the rejection "a" was waiting on ended up unhandled and took the
    // whole dev server process down.)
    "rejects/tla.ts": `
      await 1;
      throw new Error("boom tla");
      export const v = "unreachable";
    `,
    "rejects/a.ts": `
      import { v } from "./tla";
      export const a = "a:" + v;
    `,
    "rejects/b.ts": `
      import { v } from "./tla";
      export const b = "b:" + v;
    `,
    "routes/rejects.ts": `
      import { a } from "../rejects/a";
      import { b } from "../rejects/b";
      export default function () {
        return new Response(a + " " + b);
      }
    `,
    "routes/other.ts": `
      export default function () {
        return new Response("other route still works");
      }
    `,
    // Version 1 of each module never finishes loading. Replacing it with a
    // version that loads synchronously must make the module usable again: the
    // pending load is forgotten when the reload starts, whether the reload is
    // started by the update itself (x, y; y also switches to CommonJS) or by a
    // require() that arrives while the update is parked on a dispose callback
    // (z). w is like z but stays asynchronous: require() keeps refusing it and
    // must not consume the stale mark the parked update left, so that the
    // import() after it evaluates the new version.
    "supersede/x.ts": `
      await new Promise(() => {});
      export const version = "unreachable";
    `,
    "supersede/y.ts": `
      await new Promise(() => {});
      export const version = "unreachable";
    `,
    "supersede/z.ts": `
      import.meta.hot.accept();
      import.meta.hot.dispose(() => new Promise(() => {}));
      await new Promise(() => {});
      export const version = "unreachable";
    `,
    "supersede/w.ts": `
      import.meta.hot.accept();
      import.meta.hot.dispose(() => new Promise(() => {}));
      await new Promise(() => {});
      export const version = "unreachable";
    `,
    "supersede/probe.ts": `
      export function tryRequire(load) {
        try {
          return "returned " + JSON.stringify(load());
        } catch (e) {
          return "threw: " + e.message;
        }
      }
    `,
    "routes/supersede.ts": `
      import { tryRequire } from "../supersede/probe";
      export default function () {
        // Version 1 of these never settles, so nothing awaits them.
        import("../supersede/x");
        import("../supersede/y");
        import("../supersede/z");
        import("../supersede/w");
        return Response.json({
          x: tryRequire(() => require("../supersede/x")),
          y: tryRequire(() => require("../supersede/y")),
          z: tryRequire(() => require("../supersede/z")),
          w: tryRequire(() => require("../supersede/w")),
        });
      }
    `,
    "routes/supersede-z.ts": `
      import { tryRequire } from "../supersede/probe";
      export default function () {
        return Response.json([tryRequire(() => require("../supersede/z")), tryRequire(() => require("../supersede/z"))]);
      }
    `,
    "routes/supersede-w.ts": `
      import { tryRequire } from "../supersede/probe";
      export default async function () {
        const required = tryRequire(() => require("../supersede/w"));
        const imported = (await import("../supersede/w")).version;
        return Response.json([required, imported]);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/diamond").equals("a:tla b:tla c:a:tla");
    // The second request reuses the loaded graph.
    await dev.fetch("/diamond").equals("a:tla b:tla c:a:tla");

    expect(await dev.fetch("/probes").json()).toStrictEqual({
      a: "a:tla",
      duringLoad: {
        dynamicImport: "resolved to v=tla",
        // Same errors as requiring them before anything started loading: the
        // module that contains the await is the one named, whether it is the
        // required module itself or a dependency it is waiting on.
        requireTla: `threw: Cannot require "probes/tla.ts" because "probes/tla.ts" uses top-level await, but 'require' is a synchronous operation.`,
        requireA: `threw: Cannot require "probes/a.ts" because "probes/tla.ts" uses top-level await, but 'require' is a synchronous operation.`,
      },
      // Once the load has settled, synchronous access works again.
      requireAfterLoad: "tla",
    });

    await dev.fetch("/rejects").expectErrorPage("boom tla");
    await dev.fetch("/rejects").expectErrorPage("boom tla");
    await dev.fetch("/other").equals("other route still works");

    const refused = (id: string) =>
      `threw: Cannot require "supersede/${id}" because "supersede/${id}" uses top-level await, but 'require' is a synchronous operation.`;
    // Nothing has started loading z or w yet, so this is the plain refusal (and
    // it gets these routes bundled before the updates below).
    expect(await dev.fetch("/supersede-z").json()).toStrictEqual([refused("z.ts"), refused("z.ts")]);
    // Now every version 1 is in flight.
    expect(await dev.fetch("/supersede").json()).toStrictEqual({
      x: refused("x.ts"),
      y: refused("y.ts"),
      z: refused("z.ts"),
      w: refused("w.ts"),
    });

    await dev.write("supersede/x.ts", `export const version = "x2";`);
    await dev.write("supersede/y.ts", `module.exports = { version: "y2" };`);
    // z and w self-accept and their dispose callbacks never settle, so these
    // updates mark them stale and then stay parked; the first require() below
    // performs z's reload, the second one sees the reloaded module.
    await dev.write("supersede/z.ts", `export const version = "z2";`);
    await dev.write(
      "supersede/w.ts",
      `
        await 1;
        export const version = "w2";
      `,
    );

    expect(await dev.fetch("/supersede-z").json()).toStrictEqual([
      'returned {"version":"z2"}',
      'returned {"version":"z2"}',
    ]);
    expect(await dev.fetch("/supersede-w").json()).toStrictEqual([refused("w.ts"), "w2"]);
    expect(await dev.fetch("/supersede").json()).toStrictEqual({
      x: 'returned {"version":"x2"}',
      y: 'returned {"version":"y2"}',
      z: 'returned {"version":"z2"}',
      w: 'returned {"version":"w2"}',
    });
  },
});
devTest("modules found while another module's top-level await is in flight wait for it (client)", {
  files: {
    ...inFlightDiamond("."),
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { a } from "./a";
      import { b } from "./b";
      import { c } from "./c";
      console.log(a + " " + b + " " + c);
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("a:tla b:tla c:a:tla");
  },
});
devTest("route loader waits for a layout whose load the page already started", {
  // The server runtime loads the page module and then its layouts. The page
  // imports the layout, so by the time the layout itself is requested its
  // top-level await is in flight, and the loader must hand back that pending
  // load rather than the module's unfinished namespace.
  framework: {
    ...minimalFramework,
    fileSystemRouterTypes: [{ ...minimalFramework.fileSystemRouterTypes![0], layouts: true }],
  },
  files: {
    "routes/_layout.ts": `
      // A module handed out without waiting has its namespace read one
      // microtask later. \`await 1\` would have resumed within that window; a
      // timer keeps this module suspended across it.
      await new Promise(resolve => setTimeout(resolve, 0));
      export const name = "layout";
    `,
    "routes/index.ts": `
      import { name } from "./_layout";
      export default function (req, meta) {
        const seenByLoader = meta.layouts.map(layout => (layout === null ? "null" : layout.name));
        return new Response("page saw " + name + ", loader saw " + seenByLoader);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("page saw layout, loader saw layout");
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
    // The server runtime loads a route's modules again for each request. A
    // route left half-initialized by a failed dependency used to report the
    // real error once and then "null is not an object" for every later request.
    "throwing-dep.ts": `
      export const value = "unreachable";
      throw new Error("dep threw");
    `,
    "routes/throwing-dep.ts": `
      import { value } from "../throwing-dep";
      export default function () {
        return new Response(value);
      }
    `,
  },
  async test(dev) {
    const cannotRequire = (id: string, asyncId: string) =>
      `threw: Cannot require "${id}" because "${asyncId}" uses top-level await, but 'require' is a synchronous operation.`;
    const kLoaded = 'resolved: {"value":"k loaded"}';
    expect(await dev.fetch("/").json()).toStrictEqual({
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
      // import() must fail as well.
      requireWithDepThatFailedToRequire: [
        cannotRequire("j-async.ts", "j-async.ts"),
        cannotRequire("j-async.ts", "j-async.ts"),
        cannotRequire("j-async.ts", "j-async.ts"),
      ],
      // The refusal travels up through k-mid, which has to stay loadable too.
      requireWithAsyncDepTwoLevelsDown: [
        cannotRequire("k.ts", "k-async.ts"),
        cannotRequire("k.ts", "k-async.ts"),
        cannotRequire("k-mid.ts", "k-async.ts"),
        kLoaded,
        kLoaded,
      ],
      // Like j, but the dependency is CommonJS. The CommonJS module itself is
      // not recorded as failed (it is evaluated again on its next load), but
      // its ESM importer is, and the recorded error names the require() that failed.
      requireWithCommonJSDepThatFailedToRequire: [
        cannotRequire("l-async.ts", "l-async.ts"),
        cannotRequire("l-async.ts", "l-async.ts"),
        cannotRequire("l-async.ts", "l-async.ts"),
      ],
    });

    await dev.fetch("/throwing-dep").expectErrorPage("dep threw");
    await dev.fetch("/throwing-dep").expectErrorPage("dep threw");
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
    // import() with an options object: a computed specifier is left to the
    // runtime's own import(), which must receive the options and whose promise
    // must be handed back (a literal data: URL would be bundled like any other module).
    "import-options.html": emptyHtmlFile({
      scripts: ["import-options.ts"],
    }),
    "import-options.ts": `
      const specifier = "data:text/javascript," + encodeURIComponent("export default 1;");
      const computedWithOptions = import(specifier, { with: {} });
      const bundledWithOptions = import("./dep", { with: {} });
      console.log({
        computedWithOptions: [typeof computedWithOptions?.then, (await computedWithOptions)?.default],
        bundledWithOptions: [typeof bundledWithOptions?.then, (await bundledWithOptions)?.x],
      });
    `,
    "dep.ts": `
      export const x = 1;
    `,
  },
  async test(dev) {
    {
      await using c = await dev.client("/");
      await c.expectMessage({
        importWithThrowingDep: ["threw: a-dep threw", "threw: a-dep threw"],
        requireWithThrowingDep: ["threw: b-dep threw", "threw: b-dep threw"],
        importWithRejectingTopLevelAwait: ["threw: c rejected", "threw: c rejected"],
      });
    }
    {
      await using c = await dev.client("/import-options");
      await c.expectMessage({
        computedWithOptions: ["function", 1],
        bundledWithOptions: ["function", 1],
      });
    }
  },
});

// Modules whose top-level await the test settles through the route, so that a
// module can be hot-updated while an evaluation of it (or of a module importing
// it) is still waiting.
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
  files: {
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
    // "start <module>", "resolve <module> <version>", "reject <module> <version>"
    // or "load <module>". (Sent as a header because static framework routes
    // currently 404 on query strings in development.)
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
  },
  async test(dev) {
    const command = (line: string) => dev.fetch("/", { headers: { "x-command": line } });

    await command("start slow-1").equals("started");
    await command("start slow-2").equals("started");
    await dev.patch("slow-1.ts", { find: '"v1"', replace: '"v2"' });
    await dev.patch("slow-2.ts", { find: '"v1"', replace: '"v2"' });
    await command("resolve slow-1 v2").equals("settled");
    await command("resolve slow-2 v2").equals("settled");
    // Imports slow-2 after v2 has loaded, so its binding points at v2.
    await command("start reexports-slow-2").equals("started");

    await command("reject slow-1 v1").equals("settled");
    await command("resolve slow-2 v1").equals("settled");

    expect(await command("load slow-1").json()).toStrictEqual({
      first: "threw: slow-1 v1 failed",
      again: 'resolved: {"value":"slow-1 v2"}',
    });
    expect(await command("load reexports-slow-2").json()).toStrictEqual({
      first: 'resolved: {"value":"slow-2 v2"}',
      again: 'resolved: {"value":"slow-2 v2"}',
    });

    // Same, except that the new version of the module is CommonJS, which the
    // loaders evaluate on a different path. The old evaluation settling must
    // neither mark the CommonJS module as failed nor tear down its module object.
    await command("start slow-3").equals("started");
    await command("start slow-4").equals("started");
    await dev.write("slow-3.ts", `module.exports = { value: "slow-3 cjs" };`);
    await dev.write("slow-4.ts", `module.exports = { value: "slow-4 cjs" };`);

    await command("reject slow-3 v1").equals("settled");
    await command("resolve slow-4 v1").equals("settled");

    expect(await command("load slow-3").json()).toStrictEqual({
      first: "threw: slow-3 v1 failed",
      again: 'resolved: {"default":{"value":"slow-3 cjs"},"value":"slow-3 cjs"}',
    });
    // Nothing was started under this name, so only `again` is reported.
    expect(await command("load slow-4-require").json()).toStrictEqual({
      again: 'resolved: {"value":"slow-4 cjs"}',
    });

    // While an importer waits for a dependency with top-level await, the
    // importer itself is saved without that import. Once the dependency
    // settles, the superseded evaluation must neither run the old body nor
    // record the dependency's failure over the new version.
    await command("start imports-slow-a").equals("started");
    await command("start imports-slow-b").equals("started");
    await dev.write("imports-slow-a.ts", `export const value = "imports-slow-a v2";`);
    await dev.write("imports-slow-b.ts", `export const value = "imports-slow-b v2";`);

    await command("resolve slow-a v1").equals("settled");
    await command("reject slow-b v1").equals("settled");

    expect(await command("load imports-slow-a").json()).toStrictEqual({
      first: 'resolved: {"value":"imports-slow-a v2"}',
      again: 'resolved: {"value":"imports-slow-a v2"}',
    });
    expect(await command("load imports-slow-b").json()).toStrictEqual({
      first: "threw: slow-b v1 failed",
      again: 'resolved: {"value":"imports-slow-b v2"}',
    });
  },
});

devTest("modules that failed because of a dependency are evaluated again once the dependency is fixed", {
  // A failed module rethrows its failure on every later load. Fixing the
  // dependency only replaces the dependency; the modules that failed with it,
  // whose bodies never ran, have no import bindings to patch and have to be
  // evaluated again. One server; each case has its own module graph under a
  // directory of the same name.
  framework: minimalFramework,
  files: {
    // The route fails together with its rejecting dependency.
    "rejected/dep.ts": `
      await 1;
      export const value = "unreachable";
      throw new Error("dep rejected");
    `,
    "routes/rejected.ts": `
      import { value } from "../rejected/dep";
      export default function () {
        return new Response("value: " + value);
      }
    `,
    // `async-mod` fails along with `dep`. require() refuses it (it has
    // top-level await); import() evaluates it.
    "async-mod/dep.ts": `
      await 1;
      export const value = "unreachable";
      throw new Error("dep rejected");
    `,
    "async-mod/async-mod.ts": `
      import { value } from "./dep";
      await 1;
      export const result = "async-mod: " + value;
    `,
    "routes/async-mod.ts": `
      export default async function () {
        const results = [];
        try {
          results.push("require: " + require("../async-mod/async-mod").result);
        } catch (e) {
          results.push("require threw: " + e.message);
        }
        try {
          results.push("import: " + (await import("../async-mod/async-mod")).result);
        } catch (e) {
          results.push("import threw: " + e.message);
        }
        return Response.json(results);
      }
    `,
    // The route throws because of what its dependency exports.
    "port/config.ts": `
      export const port = "not a number";
    `,
    "routes/port.ts": `
      import { port } from "../port/config";
      if (typeof port !== "number") throw new Error("invalid port: " + port);
      export default function () {
        return new Response("port: " + port);
      }
    `,
    // `dep` is imported by one route directly and by the other one through
    // `shared`. Discovering the failed modules must walk all of `dep`'s
    // importers, including the ones behind a root that does not accept the
    // update, rather than stopping at the first such root.
    "shared/dep.ts": `
      export const value = "broken";
    `,
    "shared/shared.ts": `
      export { value } from "./dep";
    `,
    "routes/shared-index.ts": `
      import { value } from "../shared/dep";
      if (value === "broken") throw new Error("index: dep is broken");
      export default function () {
        return new Response("index: " + value);
      }
    `,
    "routes/shared-other.ts": `
      import { value } from "../shared/shared";
      if (value === "broken") throw new Error("other: dep is broken");
      export default function () {
        return new Response("other: " + value);
      }
    `,
    // `dep` is already recorded as failed (by /failed-first) when /failed loads
    // it. Loading a failed module rethrows its failure right away; the route
    // still has to be recorded as one of its importers, or fixing `dep` cannot find it.
    "failed/dep.ts": `
      export const value = "unreachable";
      throw new Error("dep threw");
    `,
    "routes/failed-first.ts": `
      export default async function () {
        const { value } = await import("../failed/dep");
        return new Response("first: " + value);
      }
    `,
    "routes/failed.ts": `
      const { value } = require("../failed/dep");
      export default function () {
        return new Response("failed: " + value);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/rejected").expectErrorPage("dep rejected");
    await dev.fetch("/rejected").expectErrorPage("dep rejected");
    await dev.write(
      "rejected/dep.ts",
      `
        await 1;
        export const value = "fixed";
      `,
    );
    await dev.fetch("/rejected").equals("value: fixed");

    const cannotRequire = `require threw: Cannot require "async-mod/async-mod.ts" because "async-mod/async-mod.ts" uses top-level await, but 'require' is a synchronous operation.`;
    expect(await dev.fetch("/async-mod").json()).toStrictEqual([cannotRequire, "import threw: dep rejected"]);
    await dev.write(
      "async-mod/dep.ts",
      `
        await 1;
        export const value = "fixed";
      `,
    );
    // The update evaluated async-mod again (it sits between the fixed
    // dependency and the route), so it is loaded by the time the route runs.
    expect(await dev.fetch("/async-mod").json()).toStrictEqual([
      "require: async-mod: fixed",
      "import: async-mod: fixed",
    ]);

    await dev.fetch("/port").expectErrorPage("invalid port: not a number");
    // Still broken: the route is evaluated against the new dependency and
    // reports the new failure, not the remembered one.
    await dev.write("port/config.ts", `export const port = "still not a number";`);
    await dev.fetch("/port").expectErrorPage("invalid port: still not a number");
    await dev.write("port/config.ts", `export const port = 3000;`);
    await dev.fetch("/port").equals("port: 3000");
    // Once loaded, the route takes further updates as a regular importer.
    await dev.write("port/config.ts", `export const port = 3001;`);
    await dev.fetch("/port").equals("port: 3001");

    await dev.fetch("/shared-index").expectErrorPage("index: dep is broken");
    await dev.fetch("/shared-other").expectErrorPage("other: dep is broken");
    await dev.write("shared/dep.ts", `export const value = "fixed";`);
    await dev.fetch("/shared-index").equals("index: fixed");
    await dev.fetch("/shared-other").equals("other: fixed");

    await dev.fetch("/failed-first").expectErrorPage("dep threw");
    await dev.fetch("/failed").expectErrorPage("dep threw");
    await dev.write("failed/dep.ts", `export const value = "fixed";`);
    await dev.fetch("/failed").equals("failed: fixed");
    await dev.fetch("/failed-first").equals("first: fixed");
  },
});

devTest("a module that failed because its dependency rejected is loaded again once the dependency is fixed (client)", {
  // Same as the server test above, in the browser runtime. The failure is
  // reached through import() so that it does not take the page down; the
  // entry point accepts the update so that it is applied without a reload.
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      globalThis.loadLazy = async () => {
        try {
          return (await import("./lazy")).value;
        } catch (e) {
          return "failed: " + e.message;
        }
      };
      console.log("ready");
      import.meta.hot.accept();
    `,
    "lazy.ts": `
      import { value } from "./dep";
      export { value };
    `,
    "dep.ts": `
      await 1;
      export const value = "unreachable";
      throw new Error("dep rejected");
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("ready");
    expect(await c.js`loadLazy()`).toBe("failed: dep rejected");
    expect(await c.js`loadLazy()`).toBe("failed: dep rejected");
    await dev.write(
      "dep.ts",
      `
        await 1;
        export const value = "fixed";
      `,
    );
    // The self-accepting entry point is evaluated again by the update.
    await c.expectMessage("ready");
    expect(await c.js`loadLazy()`).toBe("fixed");
  },
});

devTest("a dependency that throws while an earlier dependency's top-level await is in flight does not leave that rejection unhandled", {
  framework: minimalFramework,
  files: {
    // The route lists `slow` before `sync`: `slow` comes back as a promise that later rejects, then `sync` throws right away.
    "slow.ts": `
      await 1;
      export const slow = "unreachable";
      throw new Error("slow rejected");
    `,
    "sync.ts": `
      export const sync = "unreachable";
      throw new Error("sync threw");
    `,
    "routes/index.ts": `
      import { slow } from "../slow";
      import { sync } from "../sync";
      export default function () {
        return new Response(slow + sync);
      }
    `,
    "routes/other.ts": `
      export default function () {
        return new Response("other route still works");
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").expectErrorPage("sync threw");
    // An unhandled rejection from `slow` would have taken the dev server down before this request is answered.
    await dev.fetch("/other").equals("other route still works");
    await dev.fetch("/").expectErrorPage("sync threw");
  },
});
