// ESM tests are about various esm features in development mode.
import { expect } from "bun:test";
import { isWindows } from "harness";
import { Dev, devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

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
devTest("a tagged template with non-ASCII text works on the server", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      export default function (req, meta) {
        return new Response(String.raw\`日本 \\n é\`);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("日本 \\n é");
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

// With `development.console`, console.log and console.error of the page also format their
// arguments and send the text to the dev server. The tests below hold that the page cannot
// observe this: the call does not throw and it runs no code of the page.
const consoleForwardingFiles = (script: string) => ({
  "index.html": emptyHtmlFile({
    scripts: ["index.ts"],
  }),
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
  "index.ts": `
    const custom = Symbol.for("nodejs.util.inspect.custom");
    // Counts the calls that reach code of the page.
    let calls = 0;
    const hit = () => {
      calls++;
    };
    // The test client sends the arguments of console.log to the test as JSON, which reads
    // getters too. JSON reads nothing of a value that has this method.
    const hidden = value => Object.defineProperty(value, "toJSON", { value: () => null });
    globalThis.results = {};
    globalThis.probe = function probe(name, value, method = "log") {
      const before = calls;
      let outcome = "returned";
      try {
        console[method](name, value);
      } catch (e) {
        outcome = "threw " + e;
      }
      globalThis.results[name] = outcome + ", " + (calls - before) + " calls";
    };
    ${script}
  `,
});

// The text of every line that the page forwarded to the terminal. A value that prints on more
// than one line gives only its first line.
function forwardedLines(dev: Dev) {
  return dev.output.lines
    .filter(line => line.includes("[browser]"))
    .map(line => Bun.stripANSI(line).slice("[browser] ".length));
}

devTest("browser console forwarding runs no getter, hook or overridden method of the page", {
  files: consoleForwardingFiles(`
    probe("array accessors", hidden(Object.defineProperties([1, 2, 3], {
      0: { get() { hit(); return 1; }, enumerable: true, configurable: true },
      1: { get() { hit(); return 2; }, set() {}, enumerable: true, configurable: true },
      2: { set() {}, enumerable: true, configurable: true },
      named: { get() { hit(); return 4; }, enumerable: true },
    })));
    probe("object accessor", hidden({ get own() { hit(); return 1; } }));
    probe("class getter", new (class Foo { get bar() { hit(); return 1; } })());
    probe("inspect hook", { a: 1, [custom]() { hit(); return "text of the hook"; } });
    probe("Map subclass", new (class extends Map {
      get size() { hit(); return 7; }
      entries() { hit(); return super.entries(); }
      [Symbol.iterator]() { hit(); return super[Symbol.iterator](); }
    })([["k", 1]]));
    probe("Set subclass", new (class extends Set {
      get size() { hit(); return 7; }
      values() { hit(); return super.values(); }
      [Symbol.iterator]() { hit(); return super[Symbol.iterator](); }
    })([1]));
    probe("Date subclass", hidden(new (class extends Date {
      getTime() { hit(); return 0; }
      toISOString() { hit(); return "text of the override"; }
    })(86400000)));
    probe("RegExp subclass", new (class extends RegExp {
      get source() { hit(); return "override"; }
      get flags() { hit(); return "y"; }
      get global() { hit(); return false; }
      toString() { hit(); return "text of the override"; }
    })("a+", "gi"));
    probe("typed array subclass", new (class Bytes extends Uint8Array {
      get length() { hit(); return 1; }
    })([1, 2]));
    probe("typed array constructor getter", Object.defineProperty(new Uint8Array([1]), "constructor", {
      get() { hit(); return Uint8Array; },
    }));
    probe("error stack getter", Object.defineProperty(new RangeError("bad"), "stack", {
      get() { hit(); return "text of the getter"; },
    }));
    probe("error name getter", Object.defineProperty(new (class extends Error {
      get name() { hit(); return "text of the getter"; }
      get message() { hit(); return "text of the getter"; }
    })(), "stack", {
      get() { hit(); return undefined; },
    }));
    probe("function name getter", Object.defineProperty(function () {}, "name", {
      get() { hit(); return "text of the getter"; },
    }));
    class Headers { x = 1; }
    Object.defineProperty(Headers.prototype, "constructor", { get() { hit(); return Headers; } });
    probe("constructor getter", new Headers());
    probe("RegExp look-alike", Object.create(RegExp.prototype, { global: { get() { hit(); return true; } } }));
    probe("ArrayBuffer", new Uint8Array([1, 255]).buffer);
    probe("ArrayBuffer look-alike", Object.create(ArrayBuffer.prototype, {
      [Symbol.iterator]: { get() { hit(); return undefined; } },
      length: { get() { hit(); return 0; } },
    }));
    // Getters that the engine implements are still read: these are not code of the page.
    probe("engine getter", Object(Symbol("tag")));
    probe("engine getter that throws", Object.create(Symbol.prototype));
    class Shadowed {}
    Shadowed.prototype.kind = "prototype";
    probe("own property that is not enumerable", Object.defineProperty(new Shadowed(), "kind", { value: "own" }));
    console.log("done");
  `),
  htmlFiles: [],
  async test(dev) {
    await using c = await dev.client("/");
    const results = {
      "array accessors": "returned, 0 calls",
      "object accessor": "returned, 0 calls",
      "class getter": "returned, 0 calls",
      "inspect hook": "returned, 0 calls",
      "Map subclass": "returned, 0 calls",
      "Set subclass": "returned, 0 calls",
      "Date subclass": "returned, 0 calls",
      "RegExp subclass": "returned, 0 calls",
      "typed array subclass": "returned, 0 calls",
      "typed array constructor getter": "returned, 0 calls",
      "error stack getter": "returned, 0 calls",
      "error name getter": "returned, 0 calls",
      "function name getter": "returned, 0 calls",
      "constructor getter": "returned, 0 calls",
      "RegExp look-alike": "returned, 0 calls",
      "ArrayBuffer": "returned, 0 calls",
      "ArrayBuffer look-alike": "returned, 0 calls",
      "engine getter": "returned, 0 calls",
      "engine getter that throws": "returned, 0 calls",
      "own property that is not enumerable": "returned, 0 calls",
    };
    // Every call reached the console of the test client.
    await c.expectMessage(...Object.keys(results), "done");
    expect(await c.js`results`).toEqual(results);

    await dev.output.waitForLine(/\[browser\].* done/);
    expect(forwardedLines(dev)).toEqual([
      "array accessors [ [Getter], [Getter/Setter], [Setter], named: [Getter] ]",
      "object accessor { own: [Getter] }",
      "class getter Foo {}",
      "inspect hook { a: 1 }",
      "Map subclass Map { 'k' => 1 }",
      "Set subclass Set { 1 }",
      "Date subclass 1970-01-02T00:00:00.000Z [Date]",
      "RegExp subclass /a+/gi",
      "typed array subclass Bytes [ 1, 2 ]",
      // The name of the class is behind the getter.
      "typed array constructor getter Object [ 1 ]",
      "error stack getter RangeError: bad",
      "error name getter Error",
      "function name getter [Function: <anonymous>]",
      "constructor getter { x: 1 }",
      "RegExp look-alike RegExp {}",
      "ArrayBuffer ArrayBuffer { 01 ff }",
      "ArrayBuffer look-alike ArrayBuffer {}",
      "engine getter Symbol { description: 'tag' }",
      "engine getter that throws Symbol { description: undefined }",
      "own property that is not enumerable Shadowed { kind: 'own' }",
      "done",
    ]);
  },
});

devTest("browser console forwarding does not throw into the page", {
  files: consoleForwardingFiles(`
    probe("hook that throws", { [custom]() { throw new Error("thrown by the hook"); } });
    probe("accessor that throws", hidden(Object.defineProperty([], 0, {
      get() { throw new Error("thrown by the getter"); },
      enumerable: true,
    })));
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    // JSON does not read the elements of a Set.
    probe("revoked Proxy", new Set([revoked.proxy]));
    probe("Proxy of a Map", new Proxy(new Map([["k", 1]]), {}));
    probe("look-alikes", [
      Object.create(Map.prototype),
      Object.create(Set.prototype),
      hidden(Object.create(Date.prototype)),
    ]);
    const throws = new Proxy({}, { getPrototypeOf() { throw new Error("thrown by the trap"); } });
    probe("value that throws twice", { a: throws, b: throws, c: [7] });
    const endless = { getPrototypeOf() { return new Proxy({}, endless); } };
    probe("endless prototype chain", new Proxy({}, endless));
    probe("stack that is a symbol", Object.defineProperty(new Error("e"), "stack", { value: Symbol("s") }));
    probe("error", new TypeError("with a stack"));
    console.log("done");
  `),
  htmlFiles: [],
  async test(dev) {
    await using c = await dev.client("/");
    const results = {
      "hook that throws": "returned, 0 calls",
      "accessor that throws": "returned, 0 calls",
      "revoked Proxy": "returned, 0 calls",
      "Proxy of a Map": "returned, 0 calls",
      "look-alikes": "returned, 0 calls",
      "value that throws twice": "returned, 0 calls",
      "endless prototype chain": "returned, 0 calls",
      "stack that is a symbol": "returned, 0 calls",
      "error": "returned, 0 calls",
    };
    await c.expectMessage(...Object.keys(results), "done");
    expect(await c.js`results`).toEqual(results);

    await dev.output.waitForLine(/\[browser\].* done/);
    expect(forwardedLines(dev)).toEqual([
      "hook that throws {}",
      "accessor that throws [ [Getter] ]",
      // One value that cannot print does not take the line, or the values beside it.
      "revoked Proxy Set { [threw while printing] }",
      "Proxy of a Map Map { [entries not read] }",
      "look-alikes [ Map { [entries not read] }, Set { [entries not read] }, Date {} ]",
      "value that throws twice { a: [threw while printing], b: [threw while printing], c: [ 7 ] }",
      "endless prototype chain {}",
      "stack that is a symbol Error: e",
      "error TypeError: with a stack",
      "done",
    ]);
    // The stack of an error is still read.
    expect(Bun.stripANSI(dev.output.lines.join("\n"))).toMatch(/\[browser\] error TypeError: with a stack\n\s+at /);

    // The page has loaded, so the socket of the forwarder is open and the next line goes to send().
    const sent = await c.js`
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = () => {
        throw new Error("thrown by send");
      };
      probe("socket that throws", 1);
      WebSocket.prototype.send = send;
      return results["socket that throws"];
    `;
    expect(sent).toBe("returned, 0 calls");
    await c.expectMessage("socket that throws");
  },
});

devTest("browser console forwarding reads a Proxy with reflective traps only", {
  files: consoleForwardingFiles(`
    function recorded(target, traps) {
      const handler = new Proxy({}, {
        get(_, trap) {
          return (...args) => {
            traps.push(trap === "get" ? "get " + String(args[1]) : trap);
            return Reflect[trap](...args);
          };
        },
      });
      return new Proxy(target, handler);
    }
    const objectTraps = [];
    const arrayTraps = [];
    const longArrayTraps = [];
    // JSON does not read the elements of a Set.
    probe("object", new Set([recorded({ a: 1 }, objectTraps)]));
    probe("array", new Set([recorded([1, 2], arrayTraps)]));
    probe("long array", new Set([recorded([1, 2, 3, 4, 5], longArrayTraps)]));
    const lengthReads = traps => traps.filter(trap => trap === "get length").length;
    globalThis.traps = {
      object: [...new Set(objectTraps)].sort(),
      array: [...new Set(arrayTraps)].sort(),
      lengthReadsDependOnLength: lengthReads(arrayTraps) !== lengthReads(longArrayTraps),
    };

    // A trap runs while its Proxy prints. A console.log in the trap must not print the Proxy again.
    const logs = new Proxy({ a: 1 }, {
      getPrototypeOf(target) {
        console.log("trap", logs, [1], () => {}, 2, "text");
        return Reflect.getPrototypeOf(target);
      },
    });
    probe("trap that logs", logs);
    console.log("done");
  `),
  htmlFiles: [],
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("object", "array", "long array", "trap that logs", "trap", "trap", "done");
    expect(await c.js`({ results, traps })`).toEqual({
      results: {
        "object": "returned, 0 calls",
        "array": "returned, 0 calls",
        "long array": "returned, 0 calls",
        "trap that logs": "returned, 0 calls",
      },
      traps: {
        object: ["getOwnPropertyDescriptor", "getPrototypeOf", "ownKeys"],
        array: ["get length", "getOwnPropertyDescriptor", "ownKeys"],
        lengthReadsDependOnLength: false,
      },
    });

    await dev.output.waitForLine(/\[browser\].* done/);
    expect(forwardedLines(dev)).toEqual([
      "object Set { { a: 1 } }",
      "array Set { [ 1, 2 ] }",
      "long array Set { [ 1, 2, 3, 4, 5 ] }",
      "trap [Object] [Object] [Function] 2 text",
      "trap [Object] [Object] [Function] 2 text",
      "trap that logs { a: 1 }",
      "done",
    ]);
  },
});

devTest("browser console forwarding does not change console.error of the page", {
  files: consoleForwardingFiles(`
    probe("accessor", Object.defineProperty([], 0, { get() { hit(); return 1; }, enumerable: true }), "error");
    probe("class getter", new (class Foo { get bar() { hit(); return 1; } })(), "error");
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    probe("revoked Proxy", new Set([revoked.proxy]), "error");
    console.error("done");
  `),
  htmlFiles: [],
  async test(dev) {
    // `errors` lets the page call console.error.
    await using c = await dev.client("/", { errors: [] });
    await dev.output.waitForLine(/\[browser\].* done/);
    expect(await c.js`results`).toEqual({
      "accessor": "returned, 0 calls",
      "class getter": "returned, 0 calls",
      "revoked Proxy": "returned, 0 calls",
    });
    expect(forwardedLines(dev)).toEqual([
      "accessor [ [Getter] ]",
      "class getter Foo {}",
      "revoked Proxy Set { [threw while printing] }",
      "done",
    ]);
  },
});

// The test client above is not a browser. In a browser, an object of the platform (a DOMRect)
// keeps its fields in getters that the engine implements, and a window of another origin throws
// on most reads. This needs a Chrome that Bun.WebView finds on its own.
const chromeInstalled =
  !isWindows &&
  (!!process.env.BUN_CHROME_PATH ||
    [
      "google-chrome-stable",
      "google-chrome",
      "chromium-browser",
      "chromium",
      "brave-browser",
      "microsoft-edge",
      "chrome",
    ].some(name => Bun.which(name)));

devTest("browser console forwarding prints the objects of a real browser", {
  skip: chromeInstalled ? [] : [process.platform as "linux" | "darwin" | "win32"],
  files: consoleForwardingFiles(`
    probe("platform object", new DOMRect(1, 2, 3, 4));
    probe("error", new RangeError("with a stack"));
    probe("DOMException", new DOMException("message", "AbortError"));
    probe("class getter", new (class Foo { get bar() { hit(); return 1; } })());
    probe("Proxy of a Map", new Proxy(new Map([["k", 1]]), {}));
    // A sandboxed frame has an origin of its own.
    const frame = document.createElement("iframe");
    frame.sandbox = "";
    frame.srcdoc = "<p>frame</p>";
    await new Promise(resolve => {
      frame.onload = resolve;
      document.body.append(frame);
    });
    probe("window of another origin", frame.contentWindow);
    console.log("done");
  `),
  htmlFiles: [],
  async test(dev) {
    // --no-sandbox: Chrome does not start as root without it, and containers run tests as root.
    await using view = new Bun.WebView({
      backend: { type: "chrome", url: false, argv: ["--no-sandbox"] },
      width: 400,
      height: 300,
    });
    await view.navigate(dev.baseUrl + "/");
    await dev.output.waitForLine(/\[browser\].* done/);
    expect(await view.evaluate("results")).toEqual({
      "platform object": "returned, 0 calls",
      "error": "returned, 0 calls",
      "DOMException": "returned, 0 calls",
      "class getter": "returned, 0 calls",
      "Proxy of a Map": "returned, 0 calls",
      "window of another origin": "returned, 0 calls",
    });
    expect(forwardedLines(dev)).toEqual([
      "platform object DOMRect { x: 1, y: 2, width: 3, height: 4 }",
      "error RangeError: with a stack",
      "DOMException AbortError: message",
      "class getter Foo {}",
      "Proxy of a Map Map { [entries not read] }",
      "window of another origin [threw while printing]",
      "done",
    ]);
    expect(Bun.stripANSI(dev.output.lines.join("\n"))).toMatch(/\[browser\] error RangeError: with a stack\n\s+at /);
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
