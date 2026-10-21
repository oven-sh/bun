import { describe, expect, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, tempDir } from "harness";
import net from "net";
import perf, { PerformanceObserver, type PerformanceNodeEntry } from "perf_hooks";

test("stubs", () => {
  expect(perf.performance.nodeTiming).toBeObject();

  expect(perf.performance.now()).toBeNumber();
  expect(perf.performance.timeOrigin).toBeNumber();
  expect(perf.performance.eventLoopUtilization()).toBeObject();
});

test("doesn't throw", () => {
  expect(() => performance.mark("test")).not.toThrow();
  expect(() => performance.measure("test", "test")).not.toThrow();
  expect(() => performance.clearMarks()).not.toThrow();
  expect(() => performance.clearMeasures()).not.toThrow();
  expect(() => performance.getEntries()).not.toThrow();
  expect(() => performance.getEntriesByName("test")).not.toThrow();
  expect(() => performance.getEntriesByType("measure")).not.toThrow();
  expect(() => performance.now()).not.toThrow();
  expect(() => performance.timeOrigin).not.toThrow();
  // @ts-expect-error
  expect(() => performance.markResourceTiming()).not.toThrow();
});

// Node coerces the name via `${name}` for mark/clearMarks/clearMeasures, so a
// Symbol hits V8's ToString message. Verified against Node v26.3.0.
test("Symbol name argument throws V8 wording", () => {
  const msg = "Cannot convert a Symbol value to a string";
  expect(() => performance.mark(Symbol() as any)).toThrow(new TypeError(msg));
  expect(() => performance.clearMarks(Symbol() as any)).toThrow(new TypeError(msg));
  expect(() => performance.clearMeasures(Symbol() as any)).toThrow(new TypeError(msg));
});

// Node only looks at start/end to decide whether the options dict supplies
// timing; a {detail}/{duration}-only dict falls through and the trailing
// endMark is honoured. Verified against Node v26.3.0.
test("measure(name, optionsWithoutStartOrEnd, endMark) honours the trailing endMark", () => {
  performance.mark("end100", { startTime: 100 });
  const e = performance.measure("x", { detail: "d" }, "end100");
  expect({ detail: e.detail, startTime: e.startTime, duration: e.duration }).toEqual({
    detail: "d",
    startTime: 0,
    duration: 100,
  });
  // duration in the dict is discarded when endMark is supplied.
  const e2 = performance.measure("x2", { duration: 999 }, "end100");
  expect({ startTime: e2.startTime, duration: e2.duration }).toEqual({ startTime: 0, duration: 100 });
  // An empty dict + endMark still measures to the mark, not to now().
  const e3 = performance.measure("x3", {}, "end100");
  expect({ startTime: e3.startTime, duration: e3.duration }).toEqual({ startTime: 0, duration: 100 });
  performance.clearMarks("end100");
  performance.clearMeasures();
});

test("timerify entry shape", async () => {
  const { promise, resolve } = Promise.withResolvers<PerformanceNodeEntry>();
  const observer = new PerformanceObserver(list => resolve(list.getEntries()[0] as PerformanceNodeEntry));
  observer.observe({ entryTypes: ["function"] });

  const fn = perf.performance.timerify(function work(_a, _b) {});
  fn(42, "hello");

  const entry = await promise;
  observer.disconnect();

  expect(entry).toBeInstanceOf(PerformanceEntry);
  expect(entry.constructor.name).toBe("PerformanceNodeEntry");
  expect(Object.getPrototypeOf(entry.constructor)).toBe(PerformanceEntry);
  expect(entry.name).toBe("work");
  expect(entry.entryType).toBe("function");
  expect(typeof entry.startTime).toBe("number");
  expect(typeof entry.duration).toBe("number");
  expect(entry.detail).toEqual([42, "hello"]);
  // Node also exposes the args as indexed own-properties on the entry.
  expect(entry[0]).toBe(42);
  expect(entry[1]).toBe("hello");
  expect(entry.toJSON()).toEqual({
    name: "work",
    entryType: "function",
    startTime: entry.startTime,
    duration: entry.duration,
    detail: [42, "hello"],
  });
});

test("timerify is exposed on both performance and as a top-level export (Node v25.2+)", () => {
  expect(perf.performance.timerify).toBeFunction();
  expect(perf.timerify).toBeFunction();
});

// Captured from the real node v26.3.0 binary:
// `node -p "Object.keys(require('perf_hooks')).sort()"`.
test("export surface matches Node v26.3.0", () => {
  const nodeExports = [
    "Performance",
    "PerformanceEntry",
    "PerformanceMark",
    "PerformanceMeasure",
    "PerformanceObserver",
    "PerformanceObserverEntryList",
    "PerformanceResourceTiming",
    "constants",
    "createHistogram",
    "eventLoopUtilization",
    "monitorEventLoopDelay",
    "performance",
    "timerify",
  ];
  for (const name of nodeExports) {
    expect(perf).toHaveProperty(name);
  }
  // Node names the PerformanceNodeEntry class but does not export it.
  expect(perf.PerformanceNodeEntry).toBeUndefined();
  // Known bun-only extra, pre-existing on main: PerformanceNodeTiming.
  expect(
    Object.keys(perf)
      .filter(k => !nodeExports.includes(k))
      .sort(),
  ).toEqual(["PerformanceNodeTiming"]);
});

// The options defaults must not read through a polluted Object.prototype.
// Node uses kEmptyObject for both; verified against Node v26.3.0.
test("timerify and createHistogram survive Object.prototype option pollution", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `Object.prototype.histogram = 1;
       Object.prototype.lowest = 99;
       Object.prototype.figures = 99;
       const { performance, createHistogram } = require("perf_hooks");
       console.log("timerify=" + typeof performance.timerify(function f() {}));
       console.log("histogram=" + typeof createHistogram().record);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "timerify=function\nhistogram=function\n", exitCode: 0 });
  expect(stderr).not.toContain("ERR_INVALID_ARG_TYPE");
});

test("timerify and AsyncResource.bind survive Object.prototype.get pollution", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { performance } = require("perf_hooks");
       const { AsyncResource } = require("async_hooks");
       // Pollute after module load: this test targets the two defineProperties
       // sites that timerify()/bind() call per invocation, not module init.
       Object.prototype.get = function () {};
       const t = performance.timerify(function f(_a) {});
       console.log("timerified name=" + t.name + " length=" + t.length);
       const bound = new AsyncResource("R").bind(function g(_a, _b) {});
       console.log("bound length=" + bound.length);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("Invalid property descriptor");
  expect(stdout).toBe("timerified name=timerified f length=1\nbound length=2\n");
  expect(exitCode).toBe(0);
});

test("net entries are instanceof PerformanceEntry", async () => {
  const { promise, resolve } = Promise.withResolvers<PerformanceNodeEntry>();
  const observer = new PerformanceObserver(list => resolve(list.getEntries()[0] as PerformanceNodeEntry));
  observer.observe({ entryTypes: ["net"] });

  const server = net.createServer(c => c.end());
  await new Promise<void>(r => server.listen(0, r));
  const port = (server.address() as net.AddressInfo).port;
  const socket = net.connect(port, "127.0.0.1");
  await new Promise(r => socket.on("connect", r));

  const entry = await promise;
  observer.disconnect();
  socket.destroy();
  await new Promise(r => server.close(r));

  expect(entry).toBeInstanceOf(PerformanceEntry);
  expect(entry.constructor.name).toBe("PerformanceNodeEntry");
  expect(entry.entryType).toBe("net");
});

test("re-wrapped native entries, timing and observer keep JS identity", async () => {
  const name = "identity-" + Math.random();
  performance.mark(name);
  expect(performance.getEntriesByName(name)[0]).toBe(performance.getEntriesByName(name)[0]);
  expect((performance as any).timing).toBe((performance as any).timing);

  const { promise, resolve } = Promise.withResolvers<boolean>();
  const observer = new PerformanceObserver((list, obs) => {
    obs.disconnect();
    resolve(obs === observer && list.getEntries()[0] === list.getEntries()[0]);
  });
  observer.observe({ entryTypes: ["mark"] });
  performance.mark(name + "-2");
  expect(await promise).toBe(true);
});

test("PerformanceObserver delivers entries to a callback created in a node:vm context", async () => {
  // A context has no PerformanceObserver of its own. A test runner or a sandbox hands it the host class,
  // and the callback is then a function of the context's realm. Delivery used to crash the process.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const vm = require("node:vm");
       const perfHooks = require("node:perf_hooks");

       // Only its source is used: a context evaluates it, so the function belongs to the context's realm.
       function contextCallback(list, observer) {
         observer.disconnect();
         report({ receiver: this, passed: observer, list, names: list.getEntries().map(entry => entry.name) });
       }
       const callbackSource = "(" + contextCallback + ")";
       const check = ({ receiver, passed, list, names }, observer, callback) => ({
         foreignCallback: !(callback instanceof Function),
         receiver: receiver === observer,
         observer: passed === observer,
         list: list instanceof PerformanceObserverEntryList,
         names,
       });

       // The context gets the host class and constructs the observer itself.
       function insideTheContext() {
         const { promise, resolve } = Promise.withResolvers();
         const context = vm.createContext({
           PerformanceObserver,
           performance,
           report: result => resolve(check(result, observer, callback)),
         });
         const { observer, callback } = vm.runInContext(
           "const callback = " + callbackSource + ";" +
           "const observer = new PerformanceObserver(callback);" +
           "observer.observe({ entryTypes: ['mark'] });" +
           "performance.mark('inside-the-context');" +
           "({ observer, callback });",
           context,
         );
         return promise;
       }

       // The host constructs the observer around a function that a context returned.
       function fromTheHost(Observer, options, trigger) {
         const { promise, resolve } = Promise.withResolvers();
         const callback = vm.runInNewContext(callbackSource, {
           report: result => resolve(check(result, observer, callback)),
         });
         const observer = new Observer(callback);
         observer.observe(options);
         trigger?.();
         return promise;
       }

       (async () => {
         performance.measure("buffered", { start: 0, end: 1 });
         console.log(
           JSON.stringify({
             insideTheContext: await insideTheContext(),
             globalClass: await fromTheHost(PerformanceObserver, { entryTypes: ["mark"] }, () => performance.mark("global")),
             perfHooksClass: await fromTheHost(perfHooks.PerformanceObserver, { entryTypes: ["mark"] }, () =>
               performance.mark("perf_hooks"),
             ),
             // observe({ buffered: true }) queues the entries there are. The callback gets them later.
             buffered: await fromTheHost(PerformanceObserver, { type: "measure", buffered: true }),
           }),
         );
       })();`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const delivered = { foreignCallback: true, receiver: true, observer: true, list: true };
  expect(JSON.parse(stdout)).toEqual({
    insideTheContext: { ...delivered, names: ["inside-the-context"] },
    globalClass: { ...delivered, names: ["global"] },
    perfHooksClass: { ...delivered, names: ["perf_hooks"] },
    buffered: { ...delivered, names: ["buffered"] },
  });
  expect(exitCode).toBe(0);
});

test("mark/measure toJSON and inspection include detail without perf_hooks being loaded", async () => {
  // These used to be patched onto the prototypes when node:perf_hooks was first required,
  // so JSON.stringify(performance.mark(...)) dropped `detail` until then.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const mark = performance.mark("m", { detail: { a: 1 } });
       const measure = performance.measure("mm", { start: 0, end: 1, detail: [1, 2] });
       const json = [JSON.parse(JSON.stringify(mark)), JSON.parse(JSON.stringify(measure))];
       const { inspect } = require("node:util");
       const custom = Symbol.for("nodejs.util.inspect.custom");
       const result = {
         json,
         inspected: [inspect(mark), inspect(measure, { depth: 0 }), inspect(mark, { depth: -1 })],
         nativeInspected: Bun.inspect(mark),
         // util.inspect never calls the hook on a prototype object. Bun.inspect / console.log do,
         // and the hook has to fall back to the default formatting there instead of throwing
         // from the brand-checked toJSON.
         protos: [
           inspect(PerformanceMark.prototype),
           Bun.inspect(PerformanceEntry.prototype).split("\\n")[0],
           Bun.inspect(PerformanceMark.prototype).split("\\n")[0],
           Bun.inspect(PerformanceMeasure.prototype).split("\\n")[0],
         ],
         descriptor: { ...Object.getOwnPropertyDescriptor(PerformanceEntry.prototype, custom), value: PerformanceEntry.prototype[custom].name },
         toJSONEnumerable: Object.getOwnPropertyDescriptor(PerformanceMark.prototype, "toJSON").enumerable,
         generic: PerformanceEntry.prototype[custom].call({ constructor: { name: "Fake" }, toJSON: () => ({ z: 1 }) }, 1, {}, inspect),
       };
       // util.inspect forwards an option it does not know to the hook as-is, so the hook's copy
       // of the options has to cope with an index key.
       result.indexOption = inspect(mark, { 0: 1 }).split("\\n")[0];
       // The hook copies the options the way { ...options } does: a setter that userland put on
       // Object.prototype under one of the option names must not run.
       Object.defineProperty(Object.prototype, "showHidden", { configurable: true, set() { throw new Error("setter ran"); } });
       result.polluted = inspect(mark).split("\\n")[0];
       console.log(JSON.stringify(result));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const result = JSON.parse(stdout);
  expect(result.json).toEqual([
    { name: "m", entryType: "mark", startTime: expect.any(Number), duration: 0, detail: { a: 1 } },
    { name: "mm", entryType: "measure", startTime: 0, duration: 1, detail: [1, 2] },
  ]);
  expect(result.inspected[0]).toStartWith("PerformanceMark {\n  name: 'm',");
  expect(result.inspected[0]).toContain("detail: { a: 1 }");
  expect(result.inspected[1]).toBe("PerformanceMeasure [Object]");
  expect(result.inspected[2]).toBe("PerformanceMark {}");
  expect(result.nativeInspected).toStartWith("PerformanceMark {\n  name: 'm',");
  expect(result.protos).toEqual([
    "PerformanceEntry [PerformanceMark] { detail: [Getter] }",
    "PerformanceEntry {",
    "PerformanceMark {",
    "PerformanceMeasure {",
  ]);
  expect(result.descriptor).toEqual({
    value: "[nodejs.util.inspect.custom]",
    writable: true,
    enumerable: false,
    configurable: true,
  });
  expect(result.toJSONEnumerable).toBe(false);
  expect(result.generic).toBe("Fake { z: 1 }");
  expect(result.indexOption).toBe("PerformanceMark {");
  expect(result.polluted).toBe("PerformanceMark {");
  expect(exitCode).toBe(0);
});

// `options.resolution` can be any safe integer >= 1.
describe("monitorEventLoopDelay with a resolution above the int32 range", () => {
  const cases = [
    { resolution: 2 ** 31, earlierCall: false, when: "as the first call" },
    { resolution: 2 ** 31, earlierCall: true, when: "after an earlier call" },
    { resolution: 2 ** 32, earlierCall: true, when: "after an earlier call" },
    { resolution: 2 ** 32 + 1, earlierCall: true, when: "after an earlier call" },
  ];

  test.concurrent.each(cases)("doesn't wrap resolution $resolution $when", async ({ resolution, earlierCall }) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { monitorEventLoopDelay } = require("node:perf_hooks");
         ${earlierCall ? "monitorEventLoopDelay();" : ""}
         const histogram = monitorEventLoopDelay({ resolution: ${resolution} });
         console.log("enable", histogram.enable());
         // If the resolution wrapped to 1 ms (2 ** 32 + 1 as an int32), it would record samples during these 10 ms.
         setTimeout(() => {
           console.log("count", histogram.count);
           console.log("disable", histogram.disable());
         }, 10);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      // If the period wrapped to 0 ms (2 ** 32 as an int32), the timer would re-arm forever and hang the event loop.
      timeout: 4_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, stdout, exitCode, signalCode: proc.signalCode }).toEqual({
      stderr: "",
      stdout: "enable true\ncount 0\ndisable true\n",
      exitCode: 0,
      signalCode: null,
    });
  });
});

// What node does too is in perf-hooks-observer.test.ts, which also runs under Node.js. These are Bun's own.
describe("PerformanceObserver and the entry types that only Node has", () => {
  const timed = perf.performance.timerify(function work(..._args: unknown[]) {});
  const delivery = async () => {
    for (let turn = 0; turn < 2; turn++) await new Promise<void>(resolve => setImmediate(resolve));
  };

  async function run(cmd: string[], cwd?: string) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("queued function entries keep their arguments through garbage collection", async () => {
    const lists: any[] = [];
    const observer = new PerformanceObserver(list => void lists.push(list));
    try {
      observer.observe({ entryTypes: ["function"] });
      for (let i = 0; i < 10; i++) {
        const argument = { i };
        timed(argument);
        Bun.gc(true);
        const [entry] = observer.takeRecords() as PerformanceNodeEntry[];
        expect([(entry.detail as unknown[])[0], (entry as any)[0]]).toEqual([argument, argument]);
        expect((entry.detail as unknown[])[0]).toBe(argument);
      }
      // And in a list that only script holds.
      const argument = { delivered: true };
      timed(argument);
      await delivery();
      Bun.gc(true);
      expect(lists).toHaveLength(1);
      expect((lists[0].getEntries()[0].detail as unknown[])[0]).toBe(argument);
    } finally {
      observer.disconnect();
    }
  });

  test.concurrent("queueing an entry calls no setter that script put on Array.prototype", async () => {
    // (In a process of its own: the setter changes how every array in the realm is stored.)
    const { stdout, stderr, exitCode } = await run([
      "-e",
      `const { performance, PerformanceObserver } = require("node:perf_hooks");
       let calls = 0;
       const observer = new PerformanceObserver(() => {});
       observer.observe({ entryTypes: ["mark", "function"] });
       const timed = performance.timerify(function work() {});
       Object.defineProperty(Array.prototype, 0, { set() { calls++; }, get() {}, configurable: true });
       performance.mark("a");
       timed();
       performance.mark("b");
       const callsWhileQueueing = calls;
       const records = observer.takeRecords();
       delete Array.prototype[0];
       console.log(JSON.stringify({ callsWhileQueueing, records: records.map(entry => entry.entryType) }));`,
    ]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ callsWhileQueueing: 0, records: ["mark", "function", "mark"] });
    expect(exitCode).toBe(0);
  });

  test.concurrent(
    "an entry goes to the observers of the type its producer made, whatever script wrote on it since",
    async () => {
      // (In a process of its own: the setter is on Object.prototype.)
      const { stdout, stderr, exitCode } = await run([
        "-e",
        `const { performance, PerformanceObserver } = require("node:perf_hooks");
       const observer = new PerformanceObserver(() => {});
       observer.observe({ entryTypes: ["function"] });
       Object.defineProperty(Object.prototype, 0, {
         set() { if (this.entryType === "function") this.entryType = "mark"; },
         configurable: true,
       });
       performance.timerify(function work() {})(1);
       delete Object.prototype[0];
       console.log(JSON.stringify(observer.takeRecords().map(entry => entry.name + " is a " + entry.entryType)));`,
      ]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(["work is a mark"]);
      expect(exitCode).toBe(0);
    },
  );

  test("a node: module times its work only while an observer observes its entry type", async () => {
    const server = net.createServer(socket => socket.end());
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    // Where node:net times a connection, it leaves the key of its timing context on the socket.
    const timesConnect = async () => {
      const socket = net.connect(port, "127.0.0.1");
      try {
        await once(socket, "connect");
        return Object.getOwnPropertySymbols(socket).some(key => key.description === "kPerfHooksNetConnectContext");
      } finally {
        socket.destroy();
      }
    };
    const first = new PerformanceObserver(() => {});
    const second = new PerformanceObserver(() => {});
    try {
      const times: Record<string, boolean> = {};
      times.noObserver = await timesConnect();
      first.observe({ entryTypes: ["net"] });
      second.observe({ type: "net" });
      times.twoObservers = await timesConnect();
      first.disconnect();
      times.oneLeft = await timesConnect();
      second.disconnect();
      times.noneLeft = await timesConnect();

      // An observer that observes a type again is counted once for it.
      first.observe({ entryTypes: ["net"] });
      first.observe({ entryTypes: ["net", "mark"] });
      second.observe({ type: "net" });
      second.observe({ type: "net" });
      first.disconnect();
      second.disconnect();
      second.disconnect();
      times.observedTwiceThenDisconnected = await timesConnect();

      first.observe({ entryTypes: ["net"] });
      first.observe({ entryTypes: ["http"] });
      times.replacedByAnotherType = await timesConnect();

      first.observe({ entryTypes: ["net"] });
      first.observe({ entryTypes: ["no such type"] } as object as Parameters<PerformanceObserver["observe"]>[0]);
      times.unknownEntryTypes = await timesConnect();

      first.observe({ entryTypes: ["net"] });
      times.observedAgain = await timesConnect();

      expect(times).toEqual({
        noObserver: false,
        twoObservers: true,
        oneLeft: true,
        noneLeft: false,
        observedTwiceThenDisconnected: false,
        replacedByAnotherType: false,
        unknownEntryTypes: false,
        observedAgain: true,
      });
    } finally {
      first.disconnect();
      second.disconnect();
      await new Promise(resolve => server.close(resolve));
    }
  });

  // The first observe() of one of Node's types in a realm loads what the node: modules share.
  test.concurrent("the global class observes them in a realm where no node: module is loaded", async () => {
    using dir = tempDir("perf-hooks-first-observe", {
      // (The worker has to get performance.timerify() from node:perf_hooks, after it observes.)
      "observe.js": `
        const report = Bun.isMainThread ? message => console.log(JSON.stringify(message)) : message => postMessage(message);
        const observer = new PerformanceObserver(list => {
          observer.disconnect();
          report(list.getEntries().map(entry => [entry.entryType, entry instanceof PerformanceEntry]));
        });
        observer.observe({ entryTypes: ["function"] });
        require("node:perf_hooks").performance.timerify(function work() {})();
      `,
      "main.js": `
        require("./observe.js");
        const worker = new Worker(require.resolve("./observe.js"));
        worker.onmessage = event => {
          console.log(JSON.stringify(event.data));
          worker.terminate();
        };
      `,
      "mark-queued.js": `
        const observer = new PerformanceObserver(list => {
          observer.disconnect();
          console.log(JSON.stringify(list.getEntries().map(entry => entry.entryType)));
        });
        observer.observe({ entryTypes: ["mark"] });
        performance.mark("queued before the observer took a type of Node's");
        observer.observe({ entryTypes: ["mark", "function"] });
      `,
    });
    const [both, markQueued] = await Promise.all([run(["main.js"], String(dir)), run(["mark-queued.js"], String(dir))]);
    expect(both.stderr).toBe("");
    expect(
      both.stdout
        .trim()
        .split("\n")
        .map(line => JSON.parse(line)),
    ).toEqual([[["function", true]], [["function", true]]]);
    expect(both.exitCode).toBe(0);
    expect(markQueued.stderr).toBe("");
    expect(JSON.parse(markQueued.stdout)).toEqual(["mark"]);
    expect(markQueued.exitCode).toBe(0);
  });

  test.concurrent(
    "with Bun.ModuleGraph: an observer stops with its graph, and no callback keeps another graph",
    async () => {
      using dir = tempDir("perf-hooks-module-graph", {
        "tenant.mjs": `
        import { performance, PerformanceObserver } from "node:perf_hooks";
        export const observe = () => new PerformanceObserver(() => {}).observe({ entryTypes: ["function"] });
        // What the graph had queued when it was disposed: it runs once the host settles \`gate\`.
        export const late = [];
        export const observeAfter = async gate => {
          await gate;
          new PerformanceObserver(() => late.push("called")).observe({ entryTypes: ["function", "net"] });
          late.push("observe() returned");
        };
        export const timed = performance.timerify(function tenantWork() {});
      `,
        "host.mjs": `
        import { heapStats } from "bun:jsc";
        import { AsyncLocalStorage } from "node:async_hooks";
        import { performance, PerformanceObserver } from "node:perf_hooks";
        // How many observers the node: modules are told there are, per entry type of Node's.
        const { observerCounts } = require("internal/test/binding").internalBinding("performance");
        const observed = () => Array.from(observerCounts).join(" ");
        const graphs = () => (Bun.gc(true), heapStats().objectTypeCounts.ModuleGraph ?? 0);
        const turn = () => new Promise(resolve => setImmediate(resolve));
        const turns = async count => { while (count-- > 0) await turn(); };
        const tenantFile = import.meta.dir + "/tenant.mjs";
        // How many graphs are alive once the event loop has nothing more of a disposed graph to stop.
        const settled = async () => {
          let count = graphs();
          for (let same = 0; same < 3; ) {
            await turn();
            const now = graphs();
            same = now === count ? same + 1 : 0;
            count = now;
          }
          return count;
        };
        // How many of the graphs that \`use\` makes (after one that is not counted) stay alive.
        const kept = async (count, use) => {
          await use();
          const none = await settled();
          for (let i = 0; i < count; i++) await use();
          return (await settled()) - none;
        };
        const result = {};
        const storage = new AsyncLocalStorage();
        const hostWork = performance.timerify(function hostWork() {});

        // The delivery that was set while the realm had no graph: it calls the observer of the
        // first graph too, and not in the store that set it.
        const early = [];
        const earlyObserver = new PerformanceObserver(() => early.push("the host's: " + storage.getStore()));
        earlyObserver.observe({ entryTypes: ["function"] });
        storage.run("the store of the host", hostWork);
        const firstGraph = new Bun.ModuleGraph();
        firstGraph.run(() => {
          const observer = new PerformanceObserver(() => {
            early.push("the graph's: " + storage.getStore());
            observer.disconnect();
          });
          observer.observe({ entryTypes: ["function"] });
          hostWork();
        });
        await turns(2);
        earlyObserver.disconnect();
        firstGraph.dispose();
        result.setBeforeTheFirstGraph = early;

        // dispose() is what lets go of the observers a graph's script made: the host queues no entry.
        result.keptWithObservers = await kept(3, async () => {
          const graph = new Bun.ModuleGraph();
          const tenant = await graph.import(tenantFile);
          graph.run(() => tenant.observe());
          graph.dispose();
        });
        // (dispose() stops what is the graph's from the event loop, not before it returns.)
        await turns(2);
        result.observedAfterDispose = observed();

        // What a disposed graph had queued runs, and its observe() observes nothing.
        const late = [];
        for (let i = 0; i < 3; i++) {
          const gate = Promise.withResolvers();
          const graph = new Bun.ModuleGraph();
          const tenant = await graph.import(tenantFile);
          late.push(tenant.late);
          graph.run(() => tenant.observeAfter(gate.promise));
          graph.dispose();
          await turns(3);
          gate.resolve();
          await turns(3);
          hostWork();
          await turns(3);
        }
        result.lateObservers = late.flat();
        result.observedAfterLateObserve = observed();

        // The same once the disposed graph is collected too: here the callback is the host's, so nothing keeps the graph.
        let callsAfterCollection = 0;
        let orphan;
        (() => {
          const graph = new Bun.ModuleGraph();
          graph.run(() => void (orphan = new PerformanceObserver(() => callsAfterCollection++)));
          graph.dispose();
        })();
        await settled();
        orphan.observe({ entryTypes: ["function"] });
        result.observedByAnObserverOfACollectedGraph = observed();
        hostWork();
        result.queuedForAnObserverOfACollectedGraph = orphan.takeRecords().length;
        await turns(3);
        result.callsOfAnObserverOfACollectedGraph = callsAfterCollection;

        // The host's callback gets the entries that a graph's script queued. What it starts then
        // (here, something that keeps its async context) does not keep that graph or its stores.
        const snapshots = [];
        const stores = new Set();
        const observer = new PerformanceObserver(list => {
          stores.add(String(storage.getStore()));
          snapshots.push(AsyncLocalStorage.snapshot());
        });
        observer.observe({ entryTypes: ["function"] });
        result.keptByTheCallbackOfTheHost = await kept(3, async () => {
          const graph = new Bun.ModuleGraph();
          const tenant = await graph.import(tenantFile);
          graph.run(() => storage.run("the store of a graph's request", () => tenant.timed()));
          await turns(3);
          graph.dispose();
        });
        observer.disconnect();
        result.callbacksOfTheHost = snapshots.length;
        result.storesInTheCallbackOfTheHost = [...stores];

        console.log(JSON.stringify(result));
        process.exit(0);
      `,
      });
      const { stdout, stderr, exitCode } = await run(["--expose-internals", "host.mjs"], String(dir));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        setBeforeTheFirstGraph: ["the host's: undefined", "the graph's: undefined"],
        keptWithObservers: 0,
        observedAfterDispose: "0 0 0 0 0 0 0",
        lateObservers: ["observe() returned", "observe() returned", "observe() returned"],
        observedAfterLateObserve: "0 0 0 0 0 0 0",
        observedByAnObserverOfACollectedGraph: "0 0 0 0 0 0 0",
        queuedForAnObserverOfACollectedGraph: 0,
        callsOfAnObserverOfACollectedGraph: 0,
        keptByTheCallbackOfTheHost: 0,
        callbacksOfTheHost: 4,
        storesInTheCallbackOfTheHost: ["undefined"],
      });
      expect(exitCode).toBe(0);
    },
  );
});
