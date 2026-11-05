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

// With `development.console`, console.log and console.error of the page also format their
// arguments in the page and send the text to the dev server. The tests below hold that the
// page's call returns for a value that cannot print, and that code of the page that logs while
// a line is forwarded does not start a recursion.
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
    // The test client sends the arguments of console.log to the test as JSON, which reads the
    // value too. JSON reads nothing of a value that has this method.
    const hidden = value => Object.defineProperty(value, "toJSON", { value: () => null });
    globalThis.results = {};
    globalThis.probe = function probe(name, value, method = "log", ...after) {
      try {
        console[method](name, value, ...after);
        globalThis.results[name] = "returned";
      } catch (e) {
        globalThis.results[name] = "threw " + e;
      }
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

devTest("browser console forwarding does not throw into the page", {
  files: consoleForwardingFiles(`
    probe("custom inspect function that throws", { [custom]() { throw new Error("thrown by the function"); } });
    probe("getter of an array that throws", hidden(Object.defineProperty([1, 2, 3], 1, {
      get() { throw new Error("thrown by the getter"); },
      enumerable: true,
    })));
    probe("getter of a class that throws", new (class Foo {
      get bar() { throw new Error("thrown by the getter"); }
    })());
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    // JSON does not read the elements of a Set.
    probe("revoked Proxy", new Set([revoked.proxy]));
    const throwsForA = {
      get(target, key, receiver) {
        if (key === "a") throw new Error("thrown by the trap");
        return Reflect.get(target, key, receiver);
      },
    };
    probe("Proxy that throws for one key", new Set([new Proxy({ a: 1, b: 2 }, throwsForA)]));
    probe("Proxy of an array that throws for one key", new Set([new Proxy(Object.assign([1, 2], { a: 3, b: 4 }), throwsForA)]));
    const revokedFunction = Proxy.revocable(function () {}, {});
    revokedFunction.revoke();
    probe("revoked Proxy of a function", new Set([revokedFunction.proxy]));
    // The shape of a remote object of a library such as comlink: every property is the Proxy.
    const remote = new Proxy(function () {}, { get: () => remote, apply: () => ({}) });
    probe("Proxy of a function", remote);
    probe("Proxy of a Map", new Proxy(new Map([["k", 1]]), {}));
    probe("object that inherits from Map.prototype", Object.create(Map.prototype));
    const throws = new Proxy({}, { getPrototypeOf() { throw new Error("thrown by the trap"); } });
    probe("value that throws twice", { a: throws, b: throws, c: [7] });
    probe("error whose stack is a symbol", Object.defineProperty(new Error("e"), "stack", { value: Symbol("s") }));
    probe("error", new TypeError("with a stack"));
    probe("value before another argument", { [custom]() { throw new Error("thrown by the function"); } }, "log", "after");
    // The console of the test client throws for a BigInt. The page still sees that.
    probe("console that throws", 1n);
    // The forwarder counts the console calls in progress. The count goes down when the console
    // throws, so a line that is two calls deep is still forwarded.
    probe("getter that logs after the console threw", new (class After {
      get a() {
        console.log("second call after the console threw");
        return 1;
      }
    })());
    console.log("done");
  `),
  htmlFiles: [],
  async test(dev) {
    await using c = await dev.client("/");
    await dev.output.waitForLine(/\[browser\].* done/);
    const returned = [
      "custom inspect function that throws",
      "getter of an array that throws",
      "getter of a class that throws",
      "revoked Proxy",
      "Proxy that throws for one key",
      "Proxy of an array that throws for one key",
      "revoked Proxy of a function",
      "Proxy of a function",
      "Proxy of a Map",
      "object that inherits from Map.prototype",
      "value that throws twice",
      "error whose stack is a symbol",
      "error",
      "value before another argument",
      "getter that logs after the console threw",
    ];
    expect(await c.js`results`).toEqual({
      ...Object.fromEntries(returned.map(name => [name, "returned"])),
      "console that throws": "threw TypeError: Do not know how to serialize a BigInt",
    });
    // Every call that returned reached the console of the test client.
    await c.expectMessage(...returned, "second call after the console threw", "done");

    expect(forwardedLines(dev)).toEqual([
      "custom inspect function that throws [threw while printing]",
      "getter of an array that throws [ 1, [threw while printing], 3 ]",
      "getter of a class that throws Foo { bar: [threw while printing] }",
      // One value that cannot print does not take the line, or the values beside it.
      "revoked Proxy Set { [threw while printing] }",
      "Proxy that throws for one key Set { { a: [threw while printing], b: 2 } }",
      "Proxy of an array that throws for one key Set { [ 1, 2, a: [threw while printing], b: 4 ] }",
      "revoked Proxy of a function Set { [threw while printing] }",
      "Proxy of a function [threw while printing]",
      "Proxy of a Map [threw while printing]",
      "object that inherits from Map.prototype [threw while printing]",
      "value that throws twice { a: [threw while printing], b: [threw while printing], c: [ 7 ] }",
      "error whose stack is a symbol Symbol(s)",
      "error TypeError: with a stack",
      "value before another argument [threw while printing] after",
      "second call after the console threw",
      "getter that logs after the console threw After { a: 1 }",
      "done",
    ]);
    expect(Bun.stripANSI(dev.output.lines.join("\n"))).toMatch(/\[browser\] error TypeError: with a stack\n\s+at /);
  },
});

// The forwarder sends each line on the socket of the dev server, and a page can replace send().
// This test logs strings only, so it does not depend on the formatter.
devTest("browser console forwarding returns for a send() that throws or logs", {
  files: {
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
      console.log("loaded");
    `,
  },
  htmlFiles: [],
  async test(dev) {
    // `errors` lets the page call console.error.
    await using c = await dev.client("/", { errors: [] });
    await c.expectMessage("loaded");
    // The line arrives when the socket is open, so the next lines go to send().
    await dev.output.waitForLine(/\[browser\].* loaded/);

    const threw = await c.js`
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = () => {
        throw new Error("thrown by send");
      };
      try {
        console.log("send that throws");
        console.error("send that throws");
        return "returned";
      } catch (e) {
        return "threw " + e;
      } finally {
        WebSocket.prototype.send = send;
      }
    `;
    expect(threw).toBe("returned");
    await c.expectMessage("send that throws");

    // The line that send() logs is two console calls deep, and it is forwarded. Its own send()
    // logs a line that is three calls deep, and that one is not. The limit of 100 only keeps a
    // build that forwards every line from running until the stack is full.
    const sends = await c.js`
      const send = WebSocket.prototype.send;
      let sends = 0;
      WebSocket.prototype.send = function (data) {
        if (sends++ < 100) console.log("send", data);
        return send.call(this, data);
      };
      try {
        console.log("send that logs");
      } finally {
        WebSocket.prototype.send = send;
      }
      console.log("line after");
      return sends;
    `;
    expect(sends).toBe(2);
    await c.expectMessage("send that logs", "send", "send", "line after");
    await dev.output.waitForLine(/\[browser\].* line after/);
    expect(forwardedLines(dev)).toEqual(["loaded", "send llsend that logs", "send that logs", "line after"]);
  },
});

// Code of the page runs while a line is forwarded: a trap of a Proxy, a getter, a custom inspect
// function, a built-in that the page replaced. The console of the test client runs code of the
// page too. That code can log. The forwarder forwards a console call that is at most two calls
// deep. Each limit below only keeps a build that forwards every call from running until the
// stack is full.
devTest("browser console forwarding returns for a value that logs while it prints", {
  files: consoleForwardingFiles(`
    globalThis.calls = { trap: 0, functionTrap: 0, getter: 0, hook: 0, builtIn: 0, element: 0, has: 0 };
    const logs = new Proxy({ a: 1 }, {
      getPrototypeOf(target) {
        if (calls.trap++ < 1000) console.log("trap", logs, { self: logs });
        return Reflect.getPrototypeOf(target);
      },
    });
    probe("trap that logs its Proxy", logs);

    class Store {
      get a() {
        if (calls.getter++ < 1000) console.log("getter a", this);
        return 1;
      }
      get b() {
        if (calls.getter++ < 1000) console.log("getter b", { of: this }, Store);
        return 2;
      }
    }
    probe("getters that log their object", new Store());

    // A function is not in the list of the values that print, and a custom inspect function
    // runs before its object is in the list. Each of them logs again in the nested call, three
    // calls deep.
    const logsFunction = new Proxy(function f() {}, {
      getPrototypeOf(target) {
        if (calls.functionTrap++ < 1000) console.log("function trap", logsFunction);
        return Reflect.getPrototypeOf(target);
      },
    });
    probe("trap that logs its Proxy of a function", logsFunction);

    const hooked = {
      [custom]() {
        if (calls.hook++ < 1000) console.log("hook", hooked, null, 2);
        return "text of the function";
      },
    };
    probe("custom inspect function that logs its object", hooked);

    // A custom inspect function gets the options of the formatter. It cannot add to the list.
    const added = { added: 1 };
    probe("custom inspect function that adds to the list", {
      [custom](depth, options) {
        options.seen.push(added);
        return "text of the function";
      },
    });
    probe("value that the function added", added);

    // A number prints through Object.is, and a page can replace a built-in.
    const is = Object.is;
    Object.is = function (a, b) {
      if (calls.builtIn++ < 1000) console.log("Object.is", 7);
      return is(a, b);
    };
    probe("built-in that logs a number", 5);
    Object.is = is;

    // The console of the test client reads each element of an array, as the console of Chrome
    // does. So this getter also logs from inside the console's own call.
    const elements = [1, 2, 3];
    let nesting = 0;
    Object.defineProperty(elements, 0, {
      get() {
        calls.element++;
        if (nesting < 8) {
          nesting++;
          try {
            console.log("element getter", elements);
          } finally {
            nesting--;
          }
        }
        return 1;
      },
      enumerable: true,
    });
    probe("array whose element getter logs it", elements);

    // Svelte replaces includes like this in development: after a miss, it asks each element of
    // the array for a key. The formatter does not give it the list of the values that print.
    const includes = Array.prototype.includes;
    const state = Symbol("state");
    Array.prototype.includes = function (item, from) {
      const found = includes.call(this, item, from);
      if (!found) {
        for (const element of this) {
          if (typeof element === "object" && element !== null && state in element) break;
        }
      }
      return found;
    };
    probe("Proxy whose has trap logs, with includes replaced", new Set([new Proxy({ a: 1 }, {
      has(target, key) {
        calls.has++;
        console.log("has trap");
        return Reflect.has(target, key);
      },
    })]));
    Array.prototype.includes = includes;
    console.log("done");
  `),
  htmlFiles: [],
  async test(dev) {
    await using c = await dev.client("/");
    await dev.output.waitForLine(/\[browser\].* done/);
    // formatObject calls the trap of "logs" 9 times, once for each `instanceof`.
    expect(await c.js`({ results, calls })`).toEqual({
      results: {
        "trap that logs its Proxy": "returned",
        "getters that log their object": "returned",
        "trap that logs its Proxy of a function": "returned",
        "custom inspect function that logs its object": "returned",
        "custom inspect function that adds to the list": "returned",
        "value that the function added": "returned",
        "built-in that logs a number": "returned",
        "array whose element getter logs it": "returned",
        "Proxy whose has trap logs, with includes replaced": "returned",
      },
      calls: { trap: 9, getter: 2, functionTrap: 2, hook: 2, builtIn: 2, element: 26, has: 0 },
    });

    const lines = forwardedLines(dev);
    expect(lines).toEqual([
      // A value that prints now is [Circular] in a call from the code that it runs.
      ...Array.from({ length: 9 }, () => "trap [Circular] { self: [Circular] }"),
      "trap that logs its Proxy { a: 1 }",
      "getter a [Circular]",
      "getter b { of: [Circular] } [Function: Store]",
      "getters that log their object Store { a: 1, b: 2 }",
      "function trap [Function: f]",
      "trap that logs its Proxy of a function [Function: f]",
      "hook text of the function null 2",
      "custom inspect function that logs its object text of the function",
      "custom inspect function that adds to the list text of the function",
      "value that the function added { added: 1 }",
      "Object.is 7",
      "built-in that logs a number 5",
      // The first line is from the console's own call, where the array does not print yet.
      "element getter [ 1, 2, 3 ]",
      "element getter [Circular]",
      "array whose element getter logs it [ 1, 2, 3 ]",
      "Proxy whose has trap logs, with includes replaced Set { { a: 1 } }",
      "done",
    ]);
    // The console of the test client got every one of these calls, each before its line was
    // sent. It also got the calls that are three or more calls deep.
    const names =
      /^(function trap|getter [ab]|hook|trap( that logs its Proxy( of a function)?)?|getters that log their object|custom inspect function that (logs its object|adds to the list)|value that the function added|Object\.is|built-in that logs a number|element getter|array whose element getter logs it|Proxy whose has trap logs, with includes replaced|done)/;
    await c.expectMessageInAnyOrder(
      ...lines.map(line => names.exec(line)![0]),
      "function trap",
      "hook",
      "Object.is",
      ...Array.from({ length: 21 }, () => "element getter"),
    );
  },
});

// A line of console.error goes to stderr of the dev server and a line of console.log to stdout,
// so one ordered list cannot hold both.
devTest("browser console forwarding does not make console.error throw", {
  files: consoleForwardingFiles(`
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    probe("revoked Proxy", new Set([revoked.proxy]), "error");
    probe("Proxy of a Map", new Proxy(new Map([["k", 1]]), {}), "error");
    // A console.error from a getter that the forwarder runs still prints its error.
    probe("getter that logs an error", new (class Cart {
      get total() {
        try {
          throw new RangeError("no items");
        } catch (e) {
          console.error("total failed", e);
          return 0;
        }
      }
    })(), "error");
    // console.log and console.error count their calls together, so the third call here is not
    // forwarded.
    probe("getters that call console.log and console.error", new (class First {
      get a() {
        console.log("second call", new (class Second {
          get b() {
            console.error("third call");
            return 2;
          }
        })());
        return 1;
      }
    })(), "error");
    // The console of the test client calls this function and throws. The page still sees that.
    probe("console that throws", { [custom]() { throw new Error("thrown by the function"); } }, "error");
    // The console of the test client calls this function too, so it logs from inside the
    // console's own call. console.error and console.log count their calls together.
    globalThis.hookCalls = 0;
    let nesting = 0;
    const logsAnError = {
      [custom]() {
        hookCalls++;
        if (nesting < 4) {
          nesting++;
          try {
            console.error("hook", logsAnError);
          } finally {
            nesting--;
          }
        }
        return "text of the function";
      },
    };
    probe("custom inspect function that logs an error", logsAnError, "error");
    console.error("done");
  `),
  htmlFiles: [],
  async test(dev) {
    // `errors` lets the page call console.error.
    await using c = await dev.client("/", { errors: [] });
    await dev.output.waitForLine(/\[browser\].* done/);
    expect(await c.js`({ results, hookCalls })`).toEqual({
      results: {
        "revoked Proxy": "returned",
        "Proxy of a Map": "returned",
        "getter that logs an error": "returned",
        "getters that call console.log and console.error": "returned",
        "console that throws": "threw Error: thrown by the function",
        "custom inspect function that logs an error": "returned",
      },
      hookCalls: 18,
    });
    await c.expectMessage("second call");
    await dev.output.waitForLine(/\[browser\].* second call/);
    const lines = forwardedLines(dev);
    expect(lines.filter(line => line.startsWith("second call"))).toEqual(["second call Second { b: 2 }"]);
    expect(lines.filter(line => !line.startsWith("second call"))).toEqual([
      "revoked Proxy Set { [threw while printing] }",
      "Proxy of a Map [threw while printing]",
      "total failed RangeError: no items",
      "getter that logs an error Cart { total: 0 }",
      "getters that call console.log and console.error First { a: 1 }",
      "hook text of the function",
      "hook text of the function",
      "custom inspect function that logs an error text of the function",
      "done",
    ]);
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
