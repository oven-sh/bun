import { spawn } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, tempDir, withoutAggressiveGC } from "harness";
import { once } from "node:events";
import { connect } from "node:net";
import { join } from "node:path";
import vm from "node:vm";
import storesThatEndInADefinition from "../bun/jsc/stores-that-end-in-a-definition-fixture.js";

test("exists", () => {
  expect(typeof URL !== "undefined").toBe(true);
  expect(typeof URLSearchParams !== "undefined").toBe(true);
  expect(typeof DOMException !== "undefined").toBe(true);
  expect(typeof Event !== "undefined").toBe(true);
  expect(typeof EventTarget !== "undefined").toBe(true);
  expect(typeof AbortController !== "undefined").toBe(true);
  expect(typeof AbortSignal !== "undefined").toBe(true);
  expect(typeof CustomEvent !== "undefined").toBe(true);
  expect(typeof Headers !== "undefined").toBe(true);
  expect(typeof ErrorEvent !== "undefined").toBe(true);
  expect(typeof CloseEvent !== "undefined").toBe(true);
  expect(typeof MessageEvent !== "undefined").toBe(true);
  expect(typeof TextEncoder !== "undefined").toBe(true);
  expect(typeof WebSocket !== "undefined").toBe(true);
  expect(typeof Blob !== "undefined").toBe(true);
  expect(typeof FormData !== "undefined").toBe(true);
  expect(typeof Worker !== "undefined").toBe(true);
  expect(typeof File !== "undefined").toBe(true);
  expect(typeof Performance !== "undefined").toBe(true);
  expect(typeof PerformanceEntry !== "undefined").toBe(true);
  expect(typeof PerformanceMark !== "undefined").toBe(true);
  expect(typeof PerformanceMeasure !== "undefined").toBe(true);
  expect(typeof PerformanceObserver !== "undefined").toBe(true);
  expect(typeof PerformanceObserverEntryList !== "undefined").toBe(true);
  expect(typeof PerformanceResourceTiming !== "undefined").toBe(true);
  expect(typeof PerformanceServerTiming !== "undefined").toBe(true);
  expect(typeof PerformanceTiming !== "undefined").toBe(true);
  expect(typeof Math.sumPrecise !== "undefined").toBe(true);
});

const globalSetters = [
  [ErrorEvent, "onerror", "error", "error"],
  [MessageEvent, "onmessage", "message", "data"],
];

for (const [Constructor, name, eventName, prop] of globalSetters) {
  test(`self.${name}`, () => {
    var called = false;
    console.log("name", name);

    const callback = ({ [prop]: data }) => {
      expect(data).toBe("hello");
      called = true;
    };

    try {
      globalThis[name] = callback;
      expect(globalThis[name]).toBe(callback);
      dispatchEvent(new Constructor(eventName, { data: "hello", error: "hello" }));
      expect(called).toBe(true);
    } finally {
      globalThis[name] = null;

      called = false;
      dispatchEvent(new Constructor(eventName, { data: "hello", error: "hello" }));
      expect(called).toBe(false);
    }
  });

  test(`self.addEventListener(${name})`, () => {
    var called = false;

    const callback = ({ [prop]: data }) => {
      expect(data).toBe("hello");
      called = true;
    };

    try {
      addEventListener(eventName, callback);
      dispatchEvent(new Constructor(eventName, { data: "hello", error: "hello" }));
      expect(called).toBe(true);
    } finally {
      globalThis[name] = null;
      removeEventListener(eventName, callback);
      called = false;
      dispatchEvent(new Constructor(eventName, { data: "hello", error: "hello" }));
      expect(called).toBe(false);
    }
  });
}

// This file is a module: a listener that is called with the JSGlobalObject cell as `this` sees undefined.
describe("an event dispatched on the global object has globalThis as its target", () => {
  function seenBy(thisValue, event) {
    return {
      this: thisValue === globalThis,
      target: event.target === globalThis,
      currentTarget: event.currentTarget === globalThis,
      srcElement: event.srcElement === globalThis,
      composedPath: event.composedPath().map(target => target === globalThis),
    };
  }
  const everythingIsGlobalThis = {
    this: true,
    target: true,
    currentTarget: true,
    srcElement: true,
    composedPath: [true],
  };
  const { addEventListener: add, removeEventListener: remove, dispatchEvent: dispatch } = EventTarget.prototype;

  test.each([
    ["the functions of the global object", addEventListener, removeEventListener, dispatchEvent],
    ...[globalThis, undefined, null].map(receiver => [
      `the methods of EventTarget.prototype called on ${receiver === globalThis ? "globalThis" : receiver}`,
      add.bind(receiver),
      remove.bind(receiver),
      dispatch.bind(receiver),
    ]),
  ])("a function listener, through %s", (_, addListener, removeListener, send) => {
    const seen = [];
    function listener(event) {
      seen.push(seenBy(this, event));
    }
    const event = new Event("global-target");
    addListener("global-target", listener);
    try {
      send(event);
    } finally {
      removeListener("global-target", listener);
    }
    expect(seen).toEqual([everythingIsGlobalThis]);
    // The event keeps its target behind the dispatch.
    expect([event.target === globalThis, event.srcElement === globalThis, event.currentTarget]).toEqual([
      true,
      true,
      null,
    ]);
    expect(event.composedPath()).toEqual([]);
  });

  test("an object with handleEvent: `this` is the object", () => {
    const seen = [];
    const listener = {
      handleEvent(event) {
        seen.push({ thisIsListener: this === listener, ...seenBy(globalThis, event) });
      },
    };
    addEventListener("global-target", listener);
    try {
      dispatchEvent(new Event("global-target"));
    } finally {
      removeEventListener("global-target", listener);
    }
    expect(seen).toEqual([{ thisIsListener: true, ...everythingIsGlobalThis }]);
  });

  for (const [Constructor, name, eventName] of globalSetters) {
    test(`a function in ${name}`, () => {
      const seen = [];
      globalThis[name] = function (event) {
        seen.push(seenBy(this, event));
      };
      try {
        dispatchEvent(new Constructor(eventName));
      } finally {
        globalThis[name] = null;
      }
      expect(seen).toEqual([everythingIsGlobalThis]);
    });
  }

  test("no listener", () => {
    const event = new Event("global-target");
    dispatchEvent(event);
    expect([event.target === globalThis, event.srcElement === globalThis]).toEqual([true, true]);
  });

  test("an event that is dispatched on the global object, on another target and on the global object again", () => {
    const other = new EventTarget();
    const event = new Event("global-target");
    const targets = [];
    for (const target of [globalThis, other, globalThis]) {
      target.dispatchEvent(event);
      targets.push(event.target === globalThis ? "globalThis" : event.target === other ? "other" : "neither");
    }
    expect(targets).toEqual(["globalThis", "other", "globalThis"]);
  });

  // The listener is called on the target, as on any other EventTarget, and not on the global object of its own realm.
  test("a listener that a node:vm context made", () => {
    const seen = [];
    const context = vm.createContext({ seen });
    const body = "seen.push(this, event.target, event.currentTarget);";
    const listeners = [
      vm.runInContext(`(function (event) { ${body} })`, context),
      vm.runInContext(`(function (event) { "use strict"; ${body} })`, context),
      vm.compileFunction(body, ["event"], { parsingContext: context }),
    ];
    for (const listener of listeners) {
      addEventListener("global-target", listener);
      try {
        dispatchEvent(new Event("global-target"));
      } finally {
        removeEventListener("global-target", listener);
      }
    }
    globalThis.onmessage = listeners[0];
    try {
      dispatchEvent(new MessageEvent("message"));
    } finally {
      globalThis.onmessage = null;
    }
    expect(seen.map(value => value === globalThis)).toEqual(Array(12).fill(true));
  });

  test.concurrent("in a CommonJS file, where a function listener is sloppy", async () => {
    using dir = tempDir("global-event-target", {
      "main.cjs": `
        const seen = [];
        function seenBy(thisValue, event) {
          return [thisValue, event.target, event.currentTarget, event.srcElement, ...event.composedPath()].map(value => value === globalThis);
        }
        addEventListener("global-target", function (event) {
          seen.push(seenBy(this, event));
        });
        addEventListener("global-target", function (event) {
          "use strict";
          seen.push(seenBy(this, event));
        });
        onmessage = function (event) {
          seen.push(seenBy(this, event));
        };
        try {
          dispatchEvent(new Event("global-target"));
          dispatchEvent(new MessageEvent("message"));
        } finally {
          // A handler of messages keeps the process alive.
          onmessage = null;
        }
        console.log(JSON.stringify(seen));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: JSON.stringify(Array(3).fill([true, true, true, true, true])) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // The warning names its target as an event would. Only the method of EventTarget.prototype warns: the function of the
  // global object is another one, without a warning.
  test.concurrent("the warning about a listener that is null", async () => {
    const script = `
      class Sub extends EventTarget {}
      const channel = new BroadcastChannel("warning-target");
      const { port1, port2 } = new MessageChannel();
      const targets = {
        EventTarget: new EventTarget(),
        subclass: new Sub(),
        AbortSignal: new AbortController().signal,
        BroadcastChannel: channel,
        MessagePort: port1,
        performance,
      };
      const receivers = [globalThis, undefined, null];
      const seen = [];
      const { promise, resolve } = Promise.withResolvers();
      process.on("warning", warning => {
        const { target } = warning;
        seen.push(target === globalThis ? "globalThis" : Object.keys(targets).find(name => targets[name] === target));
        if (seen.length === Object.keys(targets).length + receivers.length) resolve();
      });
      for (const target of Object.values(targets)) target.addEventListener("warning-target", null);
      for (const receiver of receivers) EventTarget.prototype.addEventListener.call(receiver, "warning-target", undefined);
      await promise;
      channel.close();
      port1.close();
      port2.close();
      console.log(JSON.stringify(seen));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    // stderr has the nine warnings.
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({
      stdout:
        JSON.stringify([
          "EventTarget",
          "subclass",
          "AbortSignal",
          "BroadcastChannel",
          "MessagePort",
          "performance",
          "globalThis",
          "globalThis",
          "globalThis",
        ]) + "\n",
      exitCode: 0,
    });
  });

  // A class of a node:vm context has no global object with event wrappers of its own: JSDOMWrapperCache.cpp makes its
  // instances in the main global object, also where the class is used inside a ShadowRealm. The first answer says that
  // it still does. Once it does not, this test goes: the tests of `bun test --isolate` below do not need that.
  test("an event whose wrapper another global object made", () => {
    const seen = new ShadowRealm().evaluate(`(() => {
      "use strict";
      const vm = process.getBuiltinModule("node:vm");
      const Sub = vm.runInContext("(class Sub extends Event {})", vm.createContext({ Event }));
      const seen = [];
      addEventListener("global-target", function (event) {
        seen.push(
          event.composedPath().constructor !== Array,
          this === globalThis,
          event.target === globalThis,
          event.currentTarget === globalThis,
          event.srcElement === globalThis,
          event.composedPath()[0] === globalThis,
        );
      });
      const event = new Sub("global-target");
      dispatchEvent(event);
      seen.push(event.target === globalThis);
      return seen.join();
    })()`);
    expect(seen).toBe("true,true,true,true,true,true,true");
  });

  // With --isolate, `bun test` loads the package of a DOM environment into a global object that outlives the files. The
  // wrapper of an event that the package makes is of that global object, and a file dispatches the event on its own.
  const fakeHappyDOM = {
    "node_modules/happy-dom/package.json": JSON.stringify({ name: "happy-dom", main: "index.js" }),
    "node_modules/happy-dom/index.js": `
      const kept = [];
      exports.Window = class Window {
        document = {};
        happyDOM = { cancelAsync() {} };
        eventOfPackage = () => {
          const event = new Event("global-target");
          kept.push(event);
          return event;
        };
        eventsOfPackage = () => kept;
        isGlobalOfPackage = value => value === globalThis;
      };
    `,
  };
  // In two parts: `bun test` looks for the comment in the whole text of a test file, and this file is one.
  const inHappyDOM = `// ${"@vitest"}-environment happy-dom`;
  // EventTarget and dispatchEvent are the window's in such a file. BroadcastChannel.prototype is still below Bun's EventTarget.prototype.
  const methodsOfBun = `const { addEventListener, removeEventListener, dispatchEvent } = Object.getPrototypeOf(BroadcastChannel.prototype);`;
  const nameOf = `const name = value =>
    value === null ? "null" : value === globalThis ? "globalThis" : isGlobalOfPackage(value) ? "of the package" : typeof value;`;

  // What the files print, and how the run ends.
  async function bunTest(dir, ...flags) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...flags],
      env: { ...bunEnv, NODE_PATH: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      // The first line is the banner of `bun test`.
      stdout: stdout.split(/\r?\n/).slice(1).filter(Boolean),
      summary: stderr.match(/^ *\d+ (?:pass|fail)$/gm)?.map(line => line.trim()),
      exitCode,
    };
  }

  test.concurrent.each(["--isolate", "--parallel=2"])(
    "an event whose wrapper the lasting global object of `bun test %s` made",
    async flag => {
      using dir = tempDir("global-event-target", {
        ...fakeHappyDOM,
        "target.test.js": `${inHappyDOM}
          import { expect, test } from "bun:test";
          test("target", () => {
            expect(isGlobalOfPackage(globalThis)).toBe(false);
            ${methodsOfBun}
            const event = eventOfPackage();
            const seen = [];
            function listener(event) {
              seen.push(this, event.target, event.currentTarget, event.srcElement, ...event.composedPath());
            }
            addEventListener.call(globalThis, "global-target", listener);
            try {
              dispatchEvent.call(globalThis, event);
            } finally {
              removeEventListener.call(globalThis, "global-target", listener);
            }
            seen.push(event.target);
            ${nameOf}
            console.log(JSON.stringify(seen.map(name)));
          });
        `,
      });
      expect(await bunTest(dir, flag, "target.test.js")).toEqual({
        stdout: [JSON.stringify(Array(6).fill("globalThis"))],
        summary: ["1 pass", "0 fail"],
        exitCode: 0,
      });
    },
  );

  // A file that is done leaves its global object to the collector. An event that the package keeps has that object as
  // its target until then, and no target after. Which object the collector takes first is not told, so the last file
  // asks until one is gone.
  test.concurrent("an event that outlives the global object that it was dispatched on", async () => {
    const dispatches = `${inHappyDOM}
      import { expect, test } from "bun:test";
      test("dispatch", () => {
        ${methodsOfBun}
        const event = eventOfPackage();
        dispatchEvent.call(globalThis, event);
        expect(event.target === globalThis).toBe(true);
      });
    `;
    using dir = tempDir("global-event-target", {
      ...fakeHappyDOM,
      ...Object.fromEntries(["a", "b", "c", "d", "e", "f"].map(name => [`${name}.test.js`, dispatches])),
      "z.test.js": `${inHappyDOM}
        import { test } from "bun:test";
        test("read", async () => {
          const events = eventsOfPackage();
          let gone;
          for (let round = 0; round < 50 && !gone; round++) {
            Bun.gc(true);
            await new Promise(resolve => setImmediate(resolve));
            gone = events.find(event => event.target === null);
          }
          ${nameOf}
          const seen = { kept: events.length, gone: gone ? [gone.target, gone.srcElement].map(name) : "none" };
          // No event answers the global object of the package, or of this file.
          seen.others = [...new Set(events.map(event => name(event.target)))].filter(kind => kind !== "null" && kind !== "object");
          if (gone) {
            ${methodsOfBun}
            dispatchEvent.call(globalThis, gone);
            seen.again = [gone.target, gone.srcElement].map(name);
          }
          console.log(JSON.stringify(seen));
        });
      `,
    });
    expect(await bunTest(dir, "--isolate")).toEqual({
      stdout: [JSON.stringify({ kept: 6, gone: ["null", "null"], others: [], again: ["globalThis", "globalThis"] })],
      summary: ["7 pass", "0 fail"],
      exitCode: 0,
    });
  });
});

// Assigning onmessage/onerror through a receiver that is not the global object
// (e.g. a Proxy of globalThis) used to crash with a type confusion.
test.concurrent("onmessage/onerror assignment through a Proxy of globalThis", async () => {
  const script = `
    const messages = [];
    const onMessage = e => messages.push(e.data);
    new Proxy(globalThis, {}).onmessage = onMessage;
    if (globalThis.onmessage !== onMessage) throw new Error("onmessage not installed through Proxy");
    dispatchEvent(new MessageEvent("message", { data: "hello" }));
    if (messages.join() !== "hello") throw new Error("onmessage not dispatched");
    new Proxy(globalThis, {}).onmessage = null;
    if (globalThis.onmessage !== null) throw new Error("onmessage not cleared through Proxy");

    const onError = () => {};
    new Proxy(globalThis, {}).onerror = onError;
    if (globalThis.onerror !== onError) throw new Error("onerror not installed through Proxy");
    new Proxy(globalThis, {}).onerror = null;
    if (globalThis.onerror !== null) throw new Error("onerror not cleared through Proxy");

    with (new Proxy(globalThis, {})) { onmessage = function () {} }
    if (typeof globalThis.onmessage !== "function") throw new Error("onmessage not installed through with scope");
    globalThis.onmessage = null;
    console.log("ok");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

test.concurrent("worker: onmessage assignment through a Proxy of self", async () => {
  using dir = tempDir("worker-proxy-onmessage", {
    "worker.js": `
      new Proxy(self, {}).onmessage = e => postMessage("echo:" + e.data);
      postMessage("ready");
    `,
    "main.js": `
      const worker = new Worker(new URL("./worker.js", import.meta.url).href);
      worker.onmessage = e => {
        if (e.data === "ready") {
          worker.postMessage("hi");
        } else {
          console.log(e.data);
          worker.terminate();
        }
      };
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("echo:hi\n");
  expect(exitCode).toBe(0);
});

// Each store of the fixture ends in a definition of the value on the global object. The handler is installed, a
// later direct store replaces it, and a clear through a proxy removes it: nothing keeps the process or the worker
// alive after that.
const storesFixture = join(import.meta.dir, "..", "bun", "jsc", "stores-that-end-in-a-definition-fixture.js");

test.concurrent(
  "onmessage/onerror: every store that ends in a definition on globalThis installs the handler",
  async () => {
    const script = `
    const stores = require(${JSON.stringify(storesFixture)});
    const events = {
      onmessage: () => new MessageEvent("message", { data: "payload" }),
      onerror: () => new ErrorEvent("error", { error: "payload" }),
    };
    for (const [what, store] of Object.entries(stores)) {
      for (const [name, makeEvent] of Object.entries(events)) {
        const where = what + ", " + name;
        const seen = [];
        const first = event => seen.push("first:" + (event.data ?? event.error));
        const second = event => seen.push("second:" + (event.data ?? event.error));
        store(globalThis, name, first);
        if (globalThis[name] !== first) throw new Error(where + ": not read back");
        dispatchEvent(makeEvent());
        globalThis[name] = second;
        dispatchEvent(makeEvent());
        new Proxy(globalThis, {})[name] = null;
        if (globalThis[name] !== null) throw new Error(where + ": not cleared through a proxy");
        dispatchEvent(makeEvent());
        if (seen.join() !== "first:payload,second:payload") throw new Error(where + ": dispatched " + JSON.stringify(seen));
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
        if (JSON.stringify(descriptor) !== '{"value":null,"writable":true,"enumerable":true,"configurable":true}')
          throw new Error(where + ": descriptor " + JSON.stringify(descriptor));
      }
    }
    console.log("ok");
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  },
);

// The global of a node:vm context made from globalThis answers for the properties of globalThis. As the receiver of a
// Reflect.set it is what the native setter gets as its `this`, and it is no global object of Bun's own.
test.concurrent(
  "onmessage/onerror: Reflect.set with the global of a node:vm context of globalThis as the receiver",
  async () => {
    const script = `
    const vm = require("node:vm");
    const contextGlobal = vm.runInContext("globalThis", vm.createContext(globalThis));
    const events = {
      onmessage: () => new MessageEvent("message", { data: "payload" }),
      onerror: () => new ErrorEvent("error", { error: "payload" }),
    };
    const seen = [];
    for (const [name, makeEvent] of Object.entries(events)) {
      const handler = event => seen.push(name + ":" + (event.data ?? event.error));
      if (!Reflect.set({}, name, handler, contextGlobal)) throw new Error(name + ": Reflect.set answered false");
      if (globalThis[name] !== handler) throw new Error(name + ": not read back");
      dispatchEvent(makeEvent());
      if (!Reflect.set({}, name, null, contextGlobal)) throw new Error(name + ": Reflect.set answered false");
      if (globalThis[name] !== null) throw new Error(name + ": not cleared");
      dispatchEvent(makeEvent());
    }
    console.log(seen.join());
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("onmessage:payload,onerror:payload\n");
    expect(exitCode).toBe(0);
  },
);

test.concurrent("worker: every store that ends in a definition on self installs onmessage", async () => {
  using dir = tempDir("worker-definition-onmessage", {
    "worker.js": `
      const stores = require(${JSON.stringify(storesFixture)});
      const forms = Object.keys(stores);
      const next = () => {
        const what = forms.shift();
        if (what === undefined) {
          new Proxy(self, {}).onmessage = null;
          return;
        }
        stores[what](self, "onmessage", e => {
          postMessage(what + ": " + e.data);
          next();
        });
        postMessage("ready");
      };
      next();
    `,
    "main.js": `
      const expected = Object.keys(require(${JSON.stringify(storesFixture)})).map(what => what + ": echo");
      const worker = new Worker(new URL("./worker.js", import.meta.url).href);
      const answers = [];
      worker.onmessage = e => {
        if (e.data === "ready") return worker.postMessage("echo");
        answers.push(e.data);
        // A store that did not install its handler leaves the one before it in place.
        if (e.data !== expected[answers.length - 1]) worker.terminate();
      };
      worker.onerror = event => {
        answers.push("error: " + event.message);
        worker.terminate();
      };
      worker.addEventListener("close", () => console.log(JSON.stringify(answers)));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual(Object.keys(storesThatEndInADefinition).map(what => what + ": echo"));
  expect(exitCode).toBe(0);
});

test("CloseEvent", () => {
  var event = new CloseEvent("close", { reason: "world" });
  expect(event.type).toBe("close");
  const target = new EventTarget();
  var called = false;
  target.addEventListener("close", ({ type, reason }) => {
    expect(type).toBe("close");
    expect(reason).toBe("world");
    called = true;
  });
  target.dispatchEvent(event);
  expect(called).toBe(true);
});

test("MessageEvent", () => {
  var event = new MessageEvent("message", { data: "world" });
  expect(event.type).toBe("message");
  const target = new EventTarget();
  var called = false;
  target.addEventListener("message", ({ type, data }) => {
    expect(type).toBe("message");
    expect(data).toBe("world");
    called = true;
  });
  target.dispatchEvent(event);
  expect(called).toBe(true);
});

test.each([Event, CustomEvent, ErrorEvent, CloseEvent, MessageEvent].map(C => [C.name, C]))(
  "new %s() without a type throws ERR_MISSING_ARGS",
  (_, C) => {
    expect(() => new C()).toThrow(
      expect.objectContaining({ name: "TypeError", code: "ERR_MISSING_ARGS", message: "Not enough arguments" }),
    );
  },
);

it("crypto.getRandomValues", () => {
  var foo = new Uint8Array(32);

  // run it once buffered and unbuffered
  {
    var array = crypto.getRandomValues(foo);
    expect(array).toBe(foo);
    expect(array.reduce((sum, a) => (sum += a === 0), 0) != foo.length).toBe(true);
  }

  // disable it for this block because it tends to get stuck here running the GC forever
  withoutAggressiveGC(() => {
    // run it again to check that the fast path works
    for (var i = 0; i < 9000; i++) {
      var array = crypto.getRandomValues(foo);
      expect(array).toBe(foo);
    }
  });

  // run it on a large input
  expect(!!crypto.getRandomValues(new Uint8Array(8192)).find(a => a > 0)).toBe(true);

  {
    // additional arguments are ignored
    var array = crypto.getRandomValues(foo, "unbuffered");
    expect(array).toBe(foo);
    expect(array.reduce((sum, a) => (sum += a === 0), 0) != foo.length).toBe(true);
  }
});

// not actually a web global
it("crypto.timingSafeEqual", () => {
  const crypto = import.meta.require("node:crypto");
  var uuidStr = crypto.randomUUID();
  expect(uuidStr.length).toBe(36);
  expect(uuidStr[8]).toBe("-");
  expect(uuidStr[13]).toBe("-");
  expect(uuidStr[18]).toBe("-");
  expect(uuidStr[23]).toBe("-");
  const uuid = Buffer.from(uuidStr);

  expect(crypto.timingSafeEqual(uuid, uuid)).toBe(true);
  expect(crypto.timingSafeEqual(uuid, uuid.slice())).toBe(true);
  try {
    crypto.timingSafeEqual(uuid, uuid.slice(1));
    expect.unreachable();
  } catch (e) {}

  try {
    crypto.timingSafeEqual(uuid, uuid.slice(0, uuid.length - 2));
    expect.unreachable();
  } catch (e) {
    expect(e.message).toBe("Input buffers must have the same byte length");
  }

  try {
    expect(crypto.timingSafeEqual(uuid, crypto.randomUUID())).toBe(false);
    expect.unreachable();
  } catch (e) {
    expect(e.name).toBe("TypeError");
  }

  var shorter = uuid.slice(0, 1);
  for (let i = 0; i < 9000; i++) {
    if (!crypto.timingSafeEqual(shorter, shorter)) throw new Error("fail");
  }
});

it("crypto.randomUUID", () => {
  var uuid = crypto.randomUUID();
  expect(uuid.length).toBe(36);
  expect(uuid[8]).toBe("-");
  expect(uuid[13]).toBe("-");
  expect(uuid[18]).toBe("-");
  expect(uuid[23]).toBe("-");

  withoutAggressiveGC(() => {
    // check that the fast path works
    // (45,000 expect() calls don't fit in the test budget on debug builds, so
    // check the predicate and call expect() on the first malformed UUID only)
    let malformed;
    for (let i = 0; i < 9000 && malformed === undefined; i++) {
      var uuid2 = crypto.randomUUID();
      if (uuid2.length !== 36 || uuid2[8] !== "-" || uuid2[13] !== "-" || uuid2[18] !== "-" || uuid2[23] !== "-") {
        malformed = uuid2;
      }
    }
    expect(malformed).toBeUndefined();
  });
});

it("crypto.randomUUID version, issues#3575", () => {
  var uuid = crypto.randomUUID();

  function validate(uuid) {
    const regex =
      /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;
    return typeof uuid === "string" && regex.test(uuid);
  }
  function version(uuid) {
    if (!validate(uuid)) {
      throw TypeError("Invalid UUID");
    }

    return parseInt(uuid.slice(14, 15), 16);
  }

  expect(version(uuid)).toBe(4);
});

it("URL.prototype.origin", () => {
  const url = new URL("https://html.spec.whatwg.org/");
  const { origin, host, hostname } = url;

  expect(hostname).toBe("html.spec.whatwg.org");
  expect(host).toBe("html.spec.whatwg.org");
  expect(origin).toBe("https://html.spec.whatwg.org");
});

test("navigator", () => {
  expect(globalThis.navigator !== undefined).toBe(true);
  const version = process.versions.bun;
  const userAgent = `Bun/${version}`;
  expect(navigator.hardwareConcurrency > 0).toBe(true);
  expect(navigator.userAgent).toBe(userAgent);
  if (isMacOS) {
    expect(navigator.platform).toBe("MacIntel");
  } else if (isWindows) {
    expect(navigator.platform).toBe("Win32");
  } else if (isLinux) {
    expect(navigator.platform).toBe("Linux x86_64");
  }
});

// https://github.com/oven-sh/bun/issues/21585
test.concurrent.each(["userAgent", "platform", "hardwareConcurrency"])(
  "navigator.%s is a getter-only accessor",
  async key => {
    // Spawn a fresh process so we don't mutate the test runner's own navigator object.
    const k = JSON.stringify(key);
    const src = `
    const nav = globalThis.navigator;
    const before = nav[${k}];
    const desc = Object.getOwnPropertyDescriptor(nav, ${k});
    let strictErr = null;
    try {
      (function () { "use strict"; nav[${k}] = "overwritten"; })();
    } catch (e) {
      strictErr = e.constructor.name;
    }
    // indirect eval for sloppy-mode assignment (bun -e is a module / strict by default)
    (0, eval)('globalThis.navigator[${k}] = "overwritten";');
    console.log(JSON.stringify({
      before,
      after: nav[${k}],
      desc: { get: typeof desc.get, set: typeof desc.set, enumerable: desc.enumerable, configurable: desc.configurable, hasWritable: "writable" in desc },
      strictErr,
    }));
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const result = JSON.parse(stdout);
    expect({ ...result, stderr, exitCode }).toEqual({
      before: result.before,
      after: result.before,
      desc: { get: "function", set: "undefined", enumerable: true, configurable: true, hasWritable: false },
      strictErr: "TypeError",
      stderr: expect.any(String),
      exitCode: 0,
    });
    expect(result.after).not.toBe("overwritten");
  },
);

test("confirm (yes) unix newline", async () => {
  const proc = spawn({
    cmd: [bunExe(), require("path").join(import.meta.dir, "./confirm-fixture.js")],
    stdio: ["pipe", "pipe", "pipe"],
    env: bunEnv,
  });

  proc.stdin.write("Y");
  await proc.stdin.flush();

  proc.stdin.write("\n");
  await proc.stdin.flush();

  await proc.exited;

  expect(await proc.stderr.text()).toBe("Yes\n");
});

test("confirm (yes) windows newline", async () => {
  const proc = spawn({
    cmd: [bunExe(), require("path").join(import.meta.dir, "./confirm-fixture.js")],
    stdio: ["pipe", "pipe", "pipe"],
    env: bunEnv,
  });

  proc.stdin.write("Y");
  await proc.stdin.flush();

  proc.stdin.write("\r\n"); // Windows-style newline
  await proc.stdin.flush();

  await proc.exited;

  expect(await proc.stderr.text()).toBe("Yes\n");
});

test("confirm (no) unix newline", async () => {
  const proc = spawn({
    cmd: [bunExe(), require("path").join(import.meta.dir, "./confirm-fixture.js")],
    stdio: ["pipe", "pipe", "pipe"],
    env: bunEnv,
  });

  proc.stdin.write("poask\n");
  await proc.stdin.flush();
  await proc.exited;

  expect(await proc.stderr.text()).toBe("No\n");
});

test("confirm (no) windows newline", async () => {
  const proc = spawn({
    cmd: [bunExe(), require("path").join(import.meta.dir, "./confirm-fixture.js")],
    stdio: ["pipe", "pipe", "pipe"],
    env: bunEnv,
  });

  proc.stdin.write("poask\r\n");
  await proc.stdin.flush();
  await proc.exited;

  expect(await proc.stderr.text()).toBe("No\n");
});

// Only the CRLF terminator's `\r` is stripped. An earlier `\r` is part of the answer.
test.concurrent.each([
  ["hello\r\n", "hello"],
  ["x\r\r\n", "x\r"],
  ["\r\r\n", "\r"],
])("prompt with stdin %j returns %j", async (stdin, expected) => {
  await using proc = spawn({
    cmd: [bunExe(), "-e", `console.error(JSON.stringify(prompt("Q?")));`],
    stdio: ["pipe", "pipe", "pipe"],
    env: bunEnv,
  });

  proc.stdin.write(stdin);
  await proc.stdin.flush();
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "Q? ",
    stderr: JSON.stringify(expected) + "\n",
    exitCode: 0,
  });
});

// The child's end of an extra pipe is overlapped. `ReadFile` waits for the signal of such a handle, which the end of any request on it sets.
test.skipIf(!isWindows)("prompt waits on an overlapped stdin that another process writes to", async () => {
  const sharesItsPipe = `
    const asks = Bun.spawn({
      cmd: [process.execPath, "-e", 'console.error(JSON.stringify(prompt("Q?")))'],
      stdio: [3, "inherit", "inherit"],
    });
    setInterval(() => require("fs").writeSync(3, "x"), 1);
    process.exit(await asks.exited);
  `;
  await using proc = spawn({
    cmd: [bunExe(), "-e", sharesItsPipe],
    stdio: ["ignore", "pipe", "pipe", "pipe"],
    env: bunEnv,
  });

  let stdout = "";
  let writesSinceTheQuestion = 0;
  const pipe = connect({ fd: proc.stdio[3] });
  pipe.on("data", () => {
    if (stdout && ++writesSinceTheQuestion === 20) pipe.write("answer\n");
  });
  const readStdout = async () => {
    for await (const chunk of proc.stdout) stdout += Buffer.from(chunk);
  };

  const [, stderr, exitCode] = await Promise.all([readStdout(), proc.stderr.text(), proc.exited, once(pipe, "close")]);

  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "Q? ", stderr: '"answer"\n', exitCode: 0 });
});

test("globalThis.self = 123 works", () => {
  expect(Object.getOwnPropertyDescriptor(globalThis, "self")).toMatchObject({
    configurable: true,
    enumerable: true,
    get: expect.any(Function),
    set: expect.any(Function),
  });
  const original = Object.getOwnPropertyDescriptor(globalThis, "self");
  try {
    globalThis.self = 123;
    expect(globalThis.self).toBe(123);
  } finally {
    Object.defineProperty(globalThis, "self", original);
  }
});

// A constructor reads `new.target.prototype` for the prototype of the object it makes. The read can
// run script and throw, so it comes after the arguments convert and before the constructor steps.
describe("new.target.prototype", () => {
  function unreadableNewTarget() {
    const newTarget = function () {}.bind(null);
    Object.defineProperty(newTarget, "prototype", {
      get() {
        throw new Error("prototype getter");
      },
    });
    return newTarget;
  }

  test.each([
    ["AbortController", AbortController, []],
    ["Bun.Cookie", Bun.Cookie, ["name", "value"]],
    ["Bun.CookieMap", Bun.CookieMap, ["a=1"]],
    ["CloseEvent", CloseEvent, ["close"]],
    ["CustomEvent", CustomEvent, ["custom"]],
    ["DOMException", DOMException, ["message", "NotFoundError"]],
    ["ErrorEvent", ErrorEvent, ["error"]],
    ["Event", Event, ["event"]],
    ["EventEmitter (of process)", Object.getPrototypeOf(process).constructor, []],
    ["EventTarget", EventTarget, []],
    ["FormData", FormData, []],
    ["Headers (init)", Headers, [{ a: "1" }]],
    ["Headers (copy)", Headers, [new Headers({ a: "1" })]],
    ["MessageChannel", MessageChannel, []],
    ["MessageEvent", MessageEvent, ["message"]],
    ["PerformanceMark", PerformanceMark, ["mark"]],
    ["PerformanceObserver", PerformanceObserver, [() => {}]],
    ["TextEncoder", TextEncoder, []],
    ["URL", URL, ["http://example.com/"]],
    ["URLPattern (pattern, base)", URLPattern, ["/a", "http://example.com/"]],
    ["URLPattern (init)", URLPattern, [{ pathname: "/a" }]],
    ["URLSearchParams", URLSearchParams, ["a=1"]],
  ])("new %s reads it once and gives it to the object", (_name, Constructor, args) => {
    let reads = 0;
    const prototype = Object.create(Constructor.prototype);
    const newTarget = function () {}.bind(null);
    Object.defineProperty(newTarget, "prototype", {
      get() {
        reads++;
        return prototype;
      },
    });
    const object = Reflect.construct(Constructor, args, newTarget);
    expect({ reads, prototype: Object.getPrototypeOf(object) === prototype }).toEqual({ reads: 1, prototype: true });
  });

  test.each([
    ["URL", URL, ["not a url"]],
    ["URLPattern (pattern, base)", URLPattern, ["((", "http://example.com/"]],
    ["URLPattern (init)", URLPattern, [{ pathname: "((" }]],
    ["Headers", Headers, [{ "bad name": "1" }]],
    ["Bun.Cookie", Bun.Cookie, ["name", "value", { sameSite: "bogus" }]],
    ["WebSocket (url)", WebSocket, ["http://[bad"]],
    ["WebSocket (url, protocol)", WebSocket, ["http://[bad", "chat"]],
    ["WebSocket (url, options)", WebSocket, ["http://[bad", {}]],
  ])("new %s: a failed read wins over arguments that the constructor steps reject", (_name, Constructor, args) => {
    expect(() => new Constructor(...args)).toThrow();
    expect(() => Reflect.construct(Constructor, args, unreadableNewTarget())).toThrow("prototype getter");
  });

  test("arguments convert before the read", () => {
    expect(() => Reflect.construct(URL, [], unreadableNewTarget())).toThrow(TypeError);
    const url = {
      toString() {
        throw new RangeError("toString");
      },
    };
    expect(() => Reflect.construct(URL, [url], unreadableNewTarget())).toThrow(RangeError);
  });

  test("new PerformanceMark runs its steps before the read, as Node does", () => {
    expect(() => Reflect.construct(PerformanceMark, ["mark", { startTime: -1 }], unreadableNewTarget())).toThrow(
      TypeError,
    );
  });

  test("new Worker: a failed read leaves the transfer list alone", async () => {
    const script = "data:text/javascript,";
    const buffer = new ArrayBuffer(8);
    const options = { workerData: buffer, transferList: [buffer] };
    expect(() => Reflect.construct(Worker, [script, options], unreadableNewTarget())).toThrow("prototype getter");
    expect(buffer.byteLength).toBe(8);

    // A prototype that can be read: the worker starts, takes the buffer, and ends with its empty script.
    class Subclass extends Worker {}
    const worker = new Subclass(script, options);
    expect(Object.getPrototypeOf(worker)).toBe(Subclass.prototype);
    expect(buffer.byteLength).toBe(0);
    await new Promise(resolve => worker.addEventListener("close", resolve, { once: true }));
  });

  test("new ReadableStreamDefaultReader: a failed read leaves the stream alone", async () => {
    const response = new Response("hello");
    expect(() => Reflect.construct(ReadableStreamDefaultReader, [response.body], unreadableNewTarget())).toThrow(
      "prototype getter",
    );
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe("hello");
  });
});

test("dispatchEvent skips a listener that is a WebAssembly GC object", () => {
  // (module (type $s (struct (field (mut i32))))
  //   (func (export "mk") (result (ref null $s)) struct.new_default $s))
  // prettier-ignore
  const bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x0a, 0x02, 0x5f, 0x01, 0x7f, 0x01, 0x60, 0x00, 0x01, 0x63, 0x00,
    0x03, 0x02, 0x01, 0x01,
    0x07, 0x06, 0x01, 0x02, 0x6d, 0x6b, 0x00, 0x00,
    0x0a, 0x07, 0x01, 0x05, 0x00, 0xfb, 0x01, 0x00, 0x0b,
  ]);
  const listener = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.mk();
  const target = new EventTarget();
  let calls = 0;
  target.addEventListener("a", listener);
  target.addEventListener("a", () => calls++);
  target.dispatchEvent(new Event("a"));
  expect(calls).toBe(1);
});
