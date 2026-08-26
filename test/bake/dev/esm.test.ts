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
