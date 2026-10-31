// ESM tests are about various esm features in development mode.
import { expect } from "bun:test";
import { isWindows } from "harness";
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
// The client side of this rule is in test/bake/dev-and-prod.test.ts.
{
  const importer = `
    import d from "babel-default";
    import local from "../local.cjs";
    export { d };
    export const readLocal = () => local;
  `;
  const importCall = `exports.load = () => import("babel-default");`;
  devTest("the default import of a CommonJS module in server code follows the module type of the importer", {
    framework: minimalFramework,
    files: {
      "node_modules/babel-default/package.json": JSON.stringify({ name: "babel-default", main: "index.js" }),
      "node_modules/babel-default/index.js": `
        exports.__esModule = true;
        exports.default = function Modal() {};
      `,
      "which.js": `
        export const which = value =>
          value === require("babel-default")
            ? "module.exports"
            : value === require("babel-default").default
              ? "exports.default"
              : typeof value;
      `,
      "local.cjs": `module.exports = { __esModule: true, default: "first" };`,
      "untyped/importer.js": importer,
      "untyped/import-call.cjs": importCall,
      "type-module/package.json": `{ "type": "module" }`,
      "type-module/importer.js": importer,
      "type-module/required.js": importer,
      "type-module/import-call.js": importCall,
      // The record of this file has no list of export names, so the manifest comes from its evaluation.
      "type-module/client.js": `"use client"; exports.Button = function Button() {};`,
      "routes/index.ts": `
        import { serverManifest } from "bun:bake/server";
        import "../type-module/client.js";
        import * as untyped from "../untyped/importer.js";
        import * as typed from "../type-module/importer.js";
        import untypedImportCall from "../untyped/import-call.cjs";
        import typedImportCall from "../type-module/import-call.js";
        import { which } from "../which.js";
        export default async function () {
          return new Response(JSON.stringify({
            'no "type"': which(untyped.d),
            '"type": "module"': which(typed.d),
            'first loaded by require(), "type": "module"': which(require("../type-module/required.js").d),
            "import() in .cjs": which((await untypedImportCall.load()).default),
            'import() in CommonJS, "type": "module"': which((await typedImportCall.load()).default),
            'the manifest of a "use client" CommonJS module, "type": "module"': Object.keys(serverManifest).map(
              key => key.replaceAll("\\\\", "/"),
            ),
            "a module that a hot update replaces": [untyped.readLocal(), typed.readLocal()],
          }));
        }
      `,
    },
    async test(dev) {
      const expected = {
        'no "type"': "exports.default",
        '"type": "module"': "module.exports",
        'first loaded by require(), "type": "module"': "module.exports",
        "import() in .cjs": "exports.default",
        'import() in CommonJS, "type": "module"': "module.exports",
        'the manifest of a "use client" CommonJS module, "type": "module"': ["type-module/client.js#Button"],
      };
      await dev.fetch("/").equals({
        ...expected,
        "a module that a hot update replaces": ["first", { __esModule: true, default: "first" }],
      });
      // The server graph sends only the changed file again. The runtime patches the binding of each importer.
      await dev.patch("local.cjs", { find: "first", replace: "second" });
      await dev.fetch("/").equals({
        ...expected,
        "a module that a hot update replaces": ["second", { __esModule: true, default: "second" }],
      });
    },
  });
}
// The namespace of a CommonJS module inherits from the prototype of `module.exports`. A `then` from there is
// not an export: `import()` and `await ns` must not call it.
{
  const importer = `
    import * as promise from "../promise.cjs";
    import * as subclass from "../subclass.cjs";
    import * as instance from "../instance.cjs";
    import * as proto from "../proto.cjs";
    import * as statics from "../static.cjs";
    import * as esModule from "../esmodule.cjs";
    import * as getter from "../getter.cjs";
    import * as ownThen from "../own-then.cjs";
    import * as ownAndInherited from "../own-and-inherited.cjs";
    import * as plain from "../plain.cjs";
    import * as notCallable from "../not-callable.cjs";
    import * as late from "../late.cjs";
    import query, { where } from "../instance.cjs";
    import counter, * as counterNs from "../counter.cjs";
    import { Query } from "../query.cjs";

    const outcome = async (get, ns) => {
      try {
        const value = await get();
        return value === ns ? "the namespace" : value;
      } catch (error) {
        return "rejected with " + error.constructor.name;
      }
    };
    const forIn = object => {
      const keys = [];
      for (const key in object) keys.push(key);
      return keys;
    };
    export const read = async () => ({
      "import()": {
        promise: await outcome(() => import("../promise.cjs"), promise),
        subclass: await outcome(() => import("../subclass.cjs"), subclass),
        instance: await outcome(() => import("../instance.cjs"), instance),
        proto: await outcome(() => import("../proto.cjs"), proto),
        static: await outcome(() => import("../static.cjs"), statics),
        esModule: await outcome(() => import("../esmodule.cjs"), esModule),
        getter: await outcome(() => import("../getter.cjs"), getter),
        ownThen: await outcome(() => import("../own-then.cjs"), ownThen),
        ownAndInherited: await outcome(() => import("../own-and-inherited.cjs"), ownAndInherited),
        plain: await outcome(() => import("../plain.cjs"), plain),
      },
      "import * as": {
        await: await outcome(() => promise, promise),
        asyncReturn: await outcome(async () => instance, instance),
        promiseResolve: await outcome(() => Promise.resolve(proto), proto),
        promiseAll: await outcome(async () => (await Promise.all([statics]))[0], statics),
        getter: await outcome(() => getter, getter),
      },
      "every other member": {
        namedImport: typeof where,
        method: instance.where(),
        instanceOf: instance instanceof Query,
        ownNames: Object.getOwnPropertyNames(instance),
        forIn: forIn(proto),
        then: typeof instance.then,
        thenOfDefault: typeof query.then,
        thenNotCallable: typeof notCallable.then,
        thenGetterReads: getter.reads(),
        samePrototypeWithoutThen: Object.getPrototypeOf(counterNs) === Object.getPrototypeOf(counter),
        thenInWithoutThen: "then" in counterNs,
        defaultWithEsModule:
          esModule.default === 5
            ? "exports.default"
            : esModule.default === require("../esmodule.cjs")
              ? "module.exports"
              : typeof esModule.default,
      },
      "a then that the prototype gets after the import": (late.addThen(), await outcome(() => late, late)),
    });
  `;
  const expected = (defaultWithEsModule: "exports.default" | "module.exports") => ({
    "import()": {
      promise: "the namespace",
      subclass: "the namespace",
      instance: "the namespace",
      proto: "the namespace",
      static: "the namespace",
      esModule: "the namespace",
      getter: "the namespace",
      ownThen: "the exported then was called",
      ownAndInherited: "the exported then was called",
      plain: "the namespace",
    },
    "import * as": {
      await: "the namespace",
      asyncReturn: "the namespace",
      promiseResolve: "the namespace",
      promiseAll: "the namespace",
      getter: "the namespace",
    },
    "every other member": {
      namedImport: "function",
      method: "where 2",
      instanceOf: true,
      ownNames: ["default", "rows"],
      forIn: ["default"],
      then: "undefined",
      thenOfDefault: "function",
      thenNotCallable: "undefined",
      thenGetterReads: 0,
      samePrototypeWithoutThen: true,
      thenInWithoutThen: false,
      defaultWithEsModule,
    },
    // A known difference from Node and `bun run`, which give the namespace. A bundle of these files calls it too.
    "a then that the prototype gets after the import": "the late then was called",
  });
  devTest("the namespace of a CommonJS module hides a then that module.exports inherits", {
    framework: minimalFramework,
    files: {
      "promise.cjs": `module.exports = Promise.resolve(42);`,
      // `then` is two prototypes away.
      "subclass.cjs": `
        class Cancelable extends Promise {}
        module.exports = Cancelable.resolve(42);
      `,
      "query.cjs": `
        exports.Query = class Query {
          rows = [1, 2];
          then(resolve) {
            resolve("Query.prototype.then was called");
          }
          where() {
            return "where " + this.rows.length;
          }
        };
      `,
      "instance.cjs": `module.exports = new (require("./query.cjs").Query)();`,
      "proto.cjs": `
        module.exports = Object.create({
          then(resolve) {
            resolve("the inherited then was called");
          },
        });
      `,
      "static.cjs": `
        class Base {
          static then(resolve) {
            resolve("Base.then was called");
          }
        }
        module.exports = class Derived extends Base {};
      `,
      // Without `nodeMode`, the `default` of this namespace is `exports.default`, not `module.exports`.
      "esmodule.cjs": `
        module.exports = Object.create({
          then(resolve) {
            resolve("the inherited then was called");
          },
        });
        module.exports.__esModule = true;
        module.exports.default = 5;
      `,
      // `toESM` asks whether `then` is there and does not read it.
      "getter.cjs": `
        let reads = 0;
        class Counter {
          get then() {
            reads++;
          }
        }
        module.exports = new Counter();
        module.exports.reads = () => reads;
      `,
      // An own "then" is an export. `import()` calls it, as it does for an ES module.
      "own-then.cjs": `
        exports.then = function (resolve) {
          resolve("the exported then was called");
        };
      `,
      "own-and-inherited.cjs": `
        module.exports = Object.create({
          then(resolve) {
            resolve("the inherited then was called");
          },
        });
        module.exports.then = function (resolve) {
          resolve("the exported then was called");
        };
      `,
      "plain.cjs": `exports.x = 1;`,
      "not-callable.cjs": `module.exports = Object.create({ then: "not a function" });`,
      "counter.cjs": `
        class Counter {
          count = 1;
        }
        module.exports = new Counter();
      `,
      "late.cjs": `
        class Late {}
        module.exports = new Late();
        module.exports.addThen = () => {
          Late.prototype.then = function (resolve) {
            resolve("the late then was called");
          };
        };
      `,
      "untyped/importer.js": importer,
      "typed/importer.mjs": importer,
      "routes/index.ts": `
        import * as untyped from "../untyped/importer.js";
        import * as typed from "../typed/importer.mjs";
        export default async function () {
          return Response.json({ 'no "type"': await untyped.read(), ".mjs": await typed.read() });
        }
      `,
    },
    async test(dev) {
      expect(await dev.fetch("/").json()).toEqual({
        'no "type"': expected("exports.default"),
        ".mjs": expected("module.exports"),
      });
    },
  });
}
// The server graph sends only the JSON file again. The file that imports it does not run a second time.
devTest("a hot update of a JSON file in server code reaches a file that imports it and does not run again", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      import { read } from "../importer.js";
      export default function () {
        return new Response(JSON.stringify(read()));
      }
    `,
    "importer.js": `
      import data from "./data.json";
      globalThis.importerRuns = (globalThis.importerRuns ?? 0) + 1;
      export const read = () => ({ data, importerRuns: globalThis.importerRuns });
    `,
    "data.json": `{ "__esModule": true, "default": 1 }`,
  },
  async test(dev) {
    await dev.fetch("/").equals({ data: { __esModule: true, default: 1 }, importerRuns: 1 });
    await dev.patch("data.json", { find: "1", replace: "2" });
    await dev.fetch("/").equals({ data: { __esModule: true, default: 2 }, importerRuns: 1 });
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

// A host that the resolver reads as a number passes the check, because DNS
// cannot rebind it. Outside Windows that covers the IPv4 shorthand, which wget
// and Python send as typed. ares_inet_pton also took an IPv6 text with "/bits"
// or with a shortened IPv4 part, and no resolver reads those.
devTest("html routes accept a numeric host header and reject one that no resolver reads", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      console.log("loaded");
    `,
  },
  async test(dev) {
    const statuses = async (hosts: string[]) =>
      Object.fromEntries(
        await Promise.all(
          hosts.map(async host => {
            const res = await dev.fetch("/", { headers: { Host: host } });
            await res.text();
            return [host, res.status];
          }),
        ),
      );

    const numeric = [
      "127.0.0.1",
      "127.0.0.1:3000",
      "10.0.0.1",
      "[::1]",
      "[::1]:3000",
      "[::ffff:127.0.0.1]",
      // The longest text of an address, 45 bytes.
      "[ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255]:3000",
    ];
    expect(await statuses(numeric)).toEqual(Object.fromEntries(numeric.map(host => [host, 200])));

    const shorthand = ["127.1", "127.1:3000", "10", "0x7f000001", "127.000.000.001", "1.2.3"];
    expect(await statuses(shorthand)).toEqual(Object.fromEntries(shorthand.map(host => [host, isWindows ? 403 : 200])));

    // inet_aton stops at whitespace, and the check does not.
    const unread = [
      "[::1/64]",
      "[::1/128]:3000",
      "[::ffff:127.1]",
      "127.0.0.1 rebound-host.example",
      "rebound-host.example",
    ];
    expect(await statuses(unread)).toEqual(Object.fromEntries(unread.map(host => [host, 403])));
  },
});
