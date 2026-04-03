// ESM tests are about various esm features in development mode.
import { isASAN, isCI } from "harness";
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
// TODO: timings are not quite right. This is a bug we need to fix.
if (!(isCI && isASAN))
  devTest("cannot require a module with top level await", {
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

devTest("cyclic ESM imports with deferred access", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { getB } from './a';
      console.log(getB());
    `,
    "a.ts": `
      import { b } from './b';
      export const a = "A";
      export function getB() { return b(); }
    `,
    "b.ts": `
      import { a } from './a';
      export function b() { return "B+" + a; }
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("B+A");
  },
});

devTest("cyclic ESM imports through barrel files with top-level usage", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { wrappedValue } from './lib';
      console.log(wrappedValue);
    `,
    // Barrel file re-exports from atoms and molecules
    "lib/index.ts": `
      export * from './atoms';
      export * from './molecules';
    `,
    // Atoms: no cycle, just exports a value
    "lib/atoms/index.ts": `
      export * from './value';
    `,
    "lib/atoms/value.ts": `
      export const value = "PASS";
      export function getValue() { return value; }
    `,
    // Molecules: imports from the barrel (cycle), uses value at top level
    "lib/molecules/index.ts": `
      export * from './wrapper';
    `,
    "lib/molecules/wrapper.ts": `
      import { value, getValue } from '../index';
      export const wrappedValue = "wrapped:" + value;
      export function getWrappedValue() { return "wrapped:" + getValue(); }
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("wrapped:PASS");
  },
});

devTest("cyclic ESM imports with hoisted function called at top level", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { result } from './helpers';
      console.log(result);
    `,
    // helpers.ts imports a function from columns.ts and calls it at top level
    "helpers.ts": `
      import { makeColumns } from './columns';
      export const result = makeColumns("test");
      export function getTime(val: string) { return val + "-time"; }
    `,
    // columns.ts exports a function declaration and imports from helpers (cycle)
    "columns.ts": `
      import { getTime } from './helpers';
      export function makeColumns(name: string) {
        return "col:" + name;
      }
      export function makeTimeCol(val: string) {
        return getTime(val);
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("col:test");
  },
});

devTest("client-side HMR hot update with self-accept", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { value } from './module';
      console.log('value:' + value);
      import.meta.hot.accept();
    `,
    "module.ts": `
      export const value = "initial";
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("value:initial");
    await dev.write("module.ts", `export const value = "updated";`);
    await c.expectMessage("value:updated");
  },
});

devTest("full reload reflects updated content (no self-accept)", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { value } from './module';
      console.log('value:' + value);
      // No import.meta.hot.accept() — forces full page reload
    `,
    "module.ts": `
      export const value = "initial";
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("value:initial");
    await c.expectReload(async () => {
      await dev.write("module.ts", `export const value = "updated";`);
    });
    await c.expectMessage("value:updated");
  },
});

devTest("full reload with cyclic imports reflects updated content", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { getB } from './a';
      console.log(getB());
    `,
    "a.ts": `
      import { b } from './b';
      export const a = "A";
      export function getB() { return b(); }
    `,
    "b.ts": `
      import { a } from './a';
      export function b() { return "B+" + a; }
    `,
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("B+A");
    await c.expectReload(async () => {
      await dev.write(
        "b.ts",
        `
        import { a } from './a';
        export function b() { return "C+" + a; }
      `,
      );
    });
    await c.expectMessage("C+A");
  },
});

devTest("JSON default import used at top level", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import data from './data.json';
      console.log(data.message);
    `,
    "data.json": JSON.stringify({ message: "PASS" }),
  },
  async test(dev) {
    await using c = await dev.client();
    await c.expectMessage("PASS");
  },
});
