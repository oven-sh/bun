/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js. That is why it
 * uses node:test and node:assert, and gets "harness" from a dynamic import.
 *
 * Node has one PerformanceObserver class, which is the global one. An observer
 * has one queue for the entries of every type it observes, and all the queues
 * are delivered from one setImmediate():
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L117-L127
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L328-L351
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import http2 from "node:http2";
import net from "node:net";
import perf, { PerformanceObserver } from "node:perf_hooks";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

type Entry = { name: string; entryType: string; startTime: number; detail?: unknown };
type Options = Parameters<PerformanceObserver["observe"]>[0];

const timed = perf.performance.timerify(function work(..._args: unknown[]) {});
const names = (entries: Entry[]) => entries.map(entry => entry.name);
const types = (entries: Entry[]) => entries.map(entry => entry.entryType);
const immediate = setImmediate;
const turns = async (count: number) => {
  while (count-- > 0) await new Promise<void>(resolve => immediate(resolve));
};
/** Lets a delivery that is due happen. */
const delivery = () => turns(2);

const harness = typeof Bun !== "undefined" ? await import("harness") : undefined;
// Runs `script` with the runtime that runs this file.
const childEnv = harness?.bunEnv ?? process.env;
const childExe = harness?.bunExe() ?? process.execPath;
async function run(script: string) {
  const child = spawn(childExe, ["-e", script], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", chunk => (stderr += chunk));
  const [exitCode] = await once(child, "close");
  return { stdout, stderr, exitCode };
}

describe("the queue of a PerformanceObserver", () => {
  for (const options of [{ entryTypes: ["function"] }, { type: "function" }]) {
    test(`takeRecords() returns the function entries that are queued, with observe(${JSON.stringify(options)})`, async () => {
      const delivered: string[] = [];
      const observer = new PerformanceObserver(list => void delivered.push(...names(list.getEntries())));
      try {
        observer.observe(options as Options);
        timed(1);
        timed(2);
        timed(3);
        const records = observer.takeRecords() as Entry[];
        assert.deepStrictEqual(
          records.map(entry => [entry.name, entry.entryType, (entry.detail as number[])[0]]),
          [
            ["work", "function", 1],
            ["work", "function", 2],
            ["work", "function", 3],
          ],
        );
        assert.ok(records[0] instanceof PerformanceEntry);
        // Taken: not queued any more, and not delivered.
        assert.deepStrictEqual(observer.takeRecords(), []);
        await delivery();
        assert.deepStrictEqual(delivered, []);
      } finally {
        observer.disconnect();
      }
    });
  }

  test("disconnect() loses no function entry that takeRecords() took, and drops the rest", async () => {
    let calls = 0;
    const observer = new PerformanceObserver(() => void calls++);
    try {
      observer.observe({ entryTypes: ["function"] });
      timed();
      timed();
      const taken = observer.takeRecords();
      observer.disconnect();
      assert.strictEqual(taken.length, 2);

      observer.observe({ entryTypes: ["function"] });
      timed();
      observer.disconnect();
      assert.deepStrictEqual(observer.takeRecords(), []);
      await delivery();
      assert.strictEqual(calls, 0);
    } finally {
      observer.disconnect();
    }
  });

  test("takeRecords() inside the callback takes what the callback queued", async () => {
    const seen: (number | string)[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    const observer = new PerformanceObserver(list => {
      const count = list.getEntries().length;
      // (Node calls back once more, with the list that takeRecords() emptied.)
      if (count === 0) return;
      seen.push(count);
      timed();
      seen.push("took " + observer.takeRecords().length);
      resolve();
    });
    try {
      observer.observe({ entryTypes: ["function"] });
      timed();
      await promise;
      await delivery();
      assert.deepStrictEqual(seen, [1, "took 1"]);
    } finally {
      observer.disconnect();
    }
  });

  test("takeRecords() returns a net entry", async () => {
    const observer = new PerformanceObserver(() => {});
    const server = net.createServer(socket => socket.end());
    try {
      observer.observe({ entryTypes: ["net"] });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const socket = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
      // The entry is queued where the socket emits 'connect', before this continues.
      await once(socket, "connect");
      const records = observer.takeRecords();
      socket.destroy();
      assert.deepStrictEqual(
        records.map(entry => [entry.name, entry.entryType]),
        [["connect", "net"]],
      );
    } finally {
      observer.disconnect();
      server.close();
    }
  });

  test("takeRecords() returns an http entry", async () => {
    const observer = new PerformanceObserver(() => {});
    const server = http.createServer((_request, response) => void response.end("ok"));
    try {
      observer.observe({ type: "http" });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as net.AddressInfo;
      // The client's entry is queued before the response is handed out.
      const records = await new Promise<Entry[]>(resolve =>
        http.get({ port, host: "127.0.0.1", agent: false }, response => {
          resolve(observer.takeRecords());
          response.resume();
        }),
      );
      assert.ok(names(records).includes("HttpClient"));
      assert.ok(!types(records).includes("net"));
    } finally {
      observer.disconnect();
      server.close();
    }
  });

  test("http2 entries reach the observer", async () => {
    const seen = new Set<string>();
    const { promise: both, resolve } = Promise.withResolvers<void>();
    const observer = new PerformanceObserver(list => {
      for (const name of names(list.getEntries())) seen.add(name);
      if (seen.has("Http2Stream") && seen.has("Http2Session")) resolve();
    });
    const server = http2.createServer((_request, response) => void response.end("ok"));
    try {
      observer.observe({ entryTypes: ["http2"] });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const client = http2.connect("http://127.0.0.1:" + (server.address() as net.AddressInfo).port);
      try {
        // A stream's entry is queued when the stream closes, a session's when the session does.
        const request = client.request({ ":path": "/" });
        request.resume();
        await once(request, "close");
        client.close();
        await both;
      } finally {
        client.destroy();
      }
    } finally {
      observer.disconnect();
      server.close();
    }
  });

  test("an observer of marks and function entries has one queue, and one list per delivery", async () => {
    const delivered: string[][] = [];
    const observer = new PerformanceObserver(list => void delivered.push(types(list.getEntries())));
    try {
      observer.observe({ entryTypes: ["mark", "function"] });
      performance.mark("one queue");
      timed();
      performance.mark("one queue");
      assert.deepStrictEqual(types(observer.takeRecords()), ["mark", "function", "mark"]);

      performance.mark("one queue");
      timed();
      performance.mark("one queue");
      await delivery();
      assert.deepStrictEqual(delivered, [["mark", "function", "mark"]]);
    } finally {
      observer.disconnect();
      performance.clearMarks("one queue");
    }
  });

  test("takeRecords() is in the order the entries were queued, a delivered list in the order they started", async () => {
    const { promise: gate, resolve: open } = Promise.withResolvers<void>();
    const slow = perf.performance.timerify(async function slow() {
      await gate;
    });
    const fast = perf.performance.timerify(function fast() {});
    const { promise: delivered, resolve } = Promise.withResolvers<string[]>();
    const observer = new PerformanceObserver(list => resolve(names(list.getEntries())));
    try {
      observer.observe({ entryTypes: ["function"] });
      // `slow` starts first and ends last: its entry is queued when its promise settles.
      const started = performance.now();
      const pending = slow();
      while (performance.now() === started);
      fast();
      open();
      await pending;
      assert.deepStrictEqual(names(observer.takeRecords()), ["fast", "slow"]);

      // The same two entries again, this time for the callback.
      const { promise: secondGate, resolve: openSecond } = Promise.withResolvers<void>();
      const slowAgain = perf.performance.timerify(async function slow() {
        await secondGate;
      });
      const startedAgain = performance.now();
      const pendingAgain = slowAgain();
      while (performance.now() === startedAgain);
      fast();
      openSecond();
      await pendingAgain;
      assert.deepStrictEqual(await delivered, ["slow", "fast"]);
    } finally {
      observer.disconnect();
    }
  });
});

describe("the callback of a PerformanceObserver", () => {
  test("gets the observer as `this` and a PerformanceObserverEntryList for function entries", async () => {
    const { promise, resolve } = Promise.withResolvers<{ receiver: unknown; list: any; passed: unknown }>();
    const observer = new PerformanceObserver(function (this: unknown, list, passed) {
      resolve({ receiver: this, list, passed });
    });
    try {
      observer.observe({ entryTypes: ["function"] });
      timed();
      timed();
      const { receiver, list, passed } = await promise;
      assert.strictEqual(receiver, observer);
      assert.strictEqual(passed, observer);
      assert.ok(list instanceof PerformanceObserverEntryList);
      assert.deepStrictEqual(
        {
          entries: names(list.getEntries()),
          sameEntries: list.getEntries()[0] === list.getEntries()[0],
          newArray: list.getEntries() !== list.getEntries(),
          byType: list.getEntriesByType("function").length,
          byOtherType: list.getEntriesByType("mark").length,
          byName: list.getEntriesByName("work").length,
          byNameAndType: list.getEntriesByName("work", "function").length,
          byNameAndOtherType: list.getEntriesByName("work", "mark").length,
          byOtherName: list.getEntriesByName("function").length,
        },
        {
          entries: ["work", "work"],
          sameEntries: true,
          newArray: true,
          byType: 2,
          byOtherType: 0,
          byName: 2,
          byNameAndType: 2,
          byNameAndOtherType: 0,
          byOtherName: 0,
        },
      );
    } finally {
      observer.disconnect();
    }
  });

  test("the list filters marks, measures and function entries by name and by type", async () => {
    // Named like the timerified function, so that a name is on entries of three types.
    const work = perf.performance.timerify(function shared() {});
    const { promise, resolve } = Promise.withResolvers<any>();
    const observer = new PerformanceObserver(list => resolve(list));
    try {
      observer.observe({ entryTypes: ["mark", "measure", "function"] });
      performance.mark("shared");
      work();
      performance.measure("shared", "shared");
      performance.mark("other");
      work();
      const list = await promise;
      const described = (entries: Entry[]) => entries.map(entry => entry.entryType + ":" + entry.name).sort();
      assert.deepStrictEqual(
        {
          all: described(list.getEntries()),
          marks: described(list.getEntriesByType("mark")),
          measures: described(list.getEntriesByType("measure")),
          functions: described(list.getEntriesByType("function")),
          unknownType: described(list.getEntriesByType("no such type")),
          shared: described(list.getEntriesByName("shared")),
          sharedMarks: described(list.getEntriesByName("shared", "mark")),
          sharedMeasures: described(list.getEntriesByName("shared", "measure")),
          sharedFunctions: described(list.getEntriesByName("shared", "function")),
          otherFunctions: described(list.getEntriesByName("other", "function")),
          unknownName: described(list.getEntriesByName("no such name")),
          // The type is compared as it is: null is no type, and what is not a string is the type of no entry.
          sharedOfNullType: described(list.getEntriesByName("shared", null)),
          sharedOfObjectType: described(list.getEntriesByName("shared", { toString: () => "mark" })),
        },
        {
          all: ["function:shared", "function:shared", "mark:other", "mark:shared", "measure:shared"],
          marks: ["mark:other", "mark:shared"],
          measures: ["measure:shared"],
          functions: ["function:shared", "function:shared"],
          unknownType: [],
          shared: ["function:shared", "function:shared", "mark:shared", "measure:shared"],
          sharedMarks: ["mark:shared"],
          sharedMeasures: ["measure:shared"],
          sharedFunctions: ["function:shared", "function:shared"],
          otherFunctions: [],
          unknownName: [],
          sharedOfNullType: ["function:shared", "function:shared", "mark:shared", "measure:shared"],
          sharedOfObjectType: [],
        },
      );
      // In the order they started.
      const startTimes = list.getEntries().map((entry: Entry) => entry.startTime);
      assert.deepStrictEqual(
        startTimes,
        startTimes.toSorted((a: number, b: number) => a - b),
      );
    } finally {
      observer.disconnect();
      performance.clearMarks("shared");
      performance.clearMarks("other");
      performance.clearMeasures("shared");
    }
  });

  test("a list of marks alone filters by name and by type", async () => {
    const { promise, resolve } = Promise.withResolvers<any>();
    const observer = new PerformanceObserver(list => resolve(list));
    try {
      observer.observe({ entryTypes: ["mark", "measure"] });
      performance.mark("only marks: a");
      performance.mark("only marks: b");
      performance.mark("only marks: a");
      const list = await promise;
      assert.deepStrictEqual(
        {
          all: names(list.getEntries()),
          marks: names(list.getEntriesByType("mark")),
          measures: names(list.getEntriesByType("measure")),
          functions: names(list.getEntriesByType("function")),
          unknownType: names(list.getEntriesByType("no such type")),
          byName: names(list.getEntriesByName("only marks: a")),
          byNameAndType: names(list.getEntriesByName("only marks: b", "mark")),
          byNameAndOtherType: names(list.getEntriesByName("only marks: b", "measure")),
          byNameAndNullType: names(list.getEntriesByName("only marks: b", null)),
          byNameAndObjectType: names(list.getEntriesByName("only marks: b", { toString: () => "mark" })),
        },
        {
          all: ["only marks: a", "only marks: b", "only marks: a"],
          marks: ["only marks: a", "only marks: b", "only marks: a"],
          measures: [],
          functions: [],
          unknownType: [],
          byName: ["only marks: a", "only marks: a"],
          byNameAndType: ["only marks: b"],
          byNameAndOtherType: [],
          byNameAndNullType: ["only marks: b"],
          byNameAndObjectType: [],
        },
      );
    } finally {
      observer.disconnect();
      performance.clearMarks("only marks: a");
      performance.clearMarks("only marks: b");
    }
  });

  // A callback that throws, made in a node:vm context, for a function entry and then for a mark.
  const throwsFromContext = (report: string) => `
    const { performance, PerformanceObserver } = require("node:perf_hooks");
    const vm = require("node:vm");
    const timed = performance.timerify(function work() {});
    const context = vm.createContext({});
    const ContextError = vm.runInContext("Error", context);
    const reported = [];
    let next;
    process.on("uncaughtException", error => {
      reported.push(error.message + (error instanceof ContextError ? ", an Error of the context" : ""));
      next();
    });
    (async () => {
      for (const type of ["function", "mark"]) {
        const callback = vm.runInContext("(function () { throw new Error('thrown for a " + type + "'); })", context);
        const observer = new PerformanceObserver(callback);
        observer.observe({ entryTypes: [type] });
        const thrown = new Promise(resolve => (next = resolve));
        type === "mark" ? performance.mark("from a context") : timed();
        await thrown;
        observer.disconnect();
      }
      ${report}
    })();
  `;
  const reported = ["thrown for a function, an Error of the context", "thrown for a mark, an Error of the context"];

  test("what a callback of a node:vm context throws is reported to uncaughtException", async () => {
    const { stdout, stderr, exitCode } = await run(throwsFromContext("console.log(JSON.stringify(reported));"));
    assert.strictEqual(stderr, "");
    assert.deepStrictEqual(JSON.parse(stdout), reported);
    assert.strictEqual(exitCode, 0);
  });

  // (In a process of its own: under `bun test`, what is thrown in a worker fails the test that is running.)
  test("and to the uncaughtException of a worker thread", async () => {
    const worker = throwsFromContext(`require("node:worker_threads").parentPort.postMessage(reported);`);
    const { stdout, stderr, exitCode } = await run(`
      const { Worker } = require("node:worker_threads");
      const worker = new Worker(${JSON.stringify(worker)}, { eval: true });
      const events = [];
      worker.on("message", message => events.push(message));
      worker.on("error", error => events.push("error: " + error.message));
      worker.on("exit", code => console.log(JSON.stringify([...events, "exit " + code])));
    `);
    assert.strictEqual(stderr, "");
    const [messages, exit] = JSON.parse(stdout);
    // (On some platforms Node.js v26.3.0 calls the handler of the worker twice for each.)
    assert.deepStrictEqual(
      [typeof Bun === "undefined" ? [...new Set(messages)] : messages, exit],
      [reported, "exit 0"],
    );
    assert.strictEqual(exitCode, 0);
  });
});

describe("PerformanceObserver.observe()", () => {
  // What observe() does with one or more option objects in turn, on a new observer: the error, or
  // how many of one mark and one function entry made after it the observer has.
  const attempt = (...calls: object[]) => {
    const observer = new PerformanceObserver(() => {});
    try {
      for (const options of calls) observer.observe(options as Options);
      performance.mark("observe() rules");
      timed();
      return types(observer.takeRecords()).join(",") || "nothing";
    } catch (error) {
      const { name, code } = error as Error & { code?: string };
      return code === "ERR_INVALID_ARG_TYPE" ? code : name;
    } finally {
      observer.disconnect();
      performance.clearMarks("observe() rules");
    }
  };

  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L265-L282
  test("keeps to `type` or to `entryTypes` until disconnect()", () => {
    assert.deepStrictEqual(
      ["function", "mark"].map(type => ({
        entryTypesThenType: attempt({ entryTypes: [type] }, { type }),
        typeThenEntryTypes: attempt({ type }, { entryTypes: [type] }),
        both: attempt({ type, entryTypes: [type] }),
        neither: attempt({}),
        // The first observe() decides, whether or not it knows the type.
        unknownTypeThenEntryTypes: attempt({ type: "no such type" }, { entryTypes: [type] }),
        // An `entryTypes` with no type that is known is a disconnect().
        unknownEntryTypesThenType: attempt({ entryTypes: ["no such type"] }, { type }),
        entryTypesTwice: attempt({ entryTypes: [type] }, { entryTypes: [type] }),
        typeTwice: attempt({ type }, { type }),
      })),
      ["function", "mark"].map(type => ({
        entryTypesThenType: "InvalidModificationError",
        typeThenEntryTypes: "InvalidModificationError",
        both: "TypeError",
        neither: "TypeError",
        unknownTypeThenEntryTypes: "InvalidModificationError",
        unknownEntryTypesThenType: type,
        entryTypesTwice: type,
        typeTwice: type,
      })),
    );
  });

  // Missing is `=== undefined`, set with the other is `!= null`, and which of the two it keeps to is
  // `!== undefined`, with `type` first:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L257-L301
  test("takes a null `type` or `entryTypes` as node does", () => {
    assert.deepStrictEqual(
      ["function", "mark"].map(type => ({
        nullType: attempt({ type: null }),
        nullEntryTypes: attempt({ entryTypes: null }),
        nullTypeWithEntryTypes: attempt({ entryTypes: [type], type: null }),
        typeWithNullEntryTypes: attempt({ type, entryTypes: null }),
        bothNull: attempt({ type: null, entryTypes: null }),
        undefinedTypeWithEntryTypes: attempt({ type: undefined, entryTypes: [type] }),
        // A null `type` keeps the observer to `type`.
        nullTypeThenEntryTypes: attempt({ type: null }, { entryTypes: [type] }),
        nullTypeWithEntryTypesThenEntryTypes: attempt({ entryTypes: [type], type: null }, { entryTypes: [type] }),
        nullTypeThenType: attempt({ type: null }, { type }),
        // And a null `entryTypes` is one that is not undefined.
        typeThenTypeWithNullEntryTypes: attempt({ type }, { type, entryTypes: null }),
        entryTypesThenEntryTypesWithNullType: attempt({ entryTypes: [type] }, { entryTypes: [type], type: null }),
      })),
      ["function", "mark"].map(type => ({
        nullType: "nothing",
        nullEntryTypes: "ERR_INVALID_ARG_TYPE",
        nullTypeWithEntryTypes: "nothing",
        typeWithNullEntryTypes: type,
        bothNull: "nothing",
        undefinedTypeWithEntryTypes: type,
        nullTypeThenEntryTypes: "InvalidModificationError",
        nullTypeWithEntryTypesThenEntryTypes: "InvalidModificationError",
        nullTypeThenType: type,
        typeThenTypeWithNullEntryTypes: "InvalidModificationError",
        entryTypesThenEntryTypesWithNullType: "InvalidModificationError",
      })),
    );
  });

  test("with `entryTypes` replaces what is observed and keeps what is queued", () => {
    const observer = new PerformanceObserver(() => {});
    try {
      observer.observe({ entryTypes: ["mark"] });
      performance.mark("replaced");
      observer.observe({ entryTypes: ["function"] });
      performance.mark("replaced");
      timed();
      assert.deepStrictEqual(types(observer.takeRecords()), ["mark", "function"]);

      // With no type that is known, an observer of function entries stops observing.
      timed();
      observer.observe({ entryTypes: ["no such type"] } as object as Options);
      timed();
      assert.deepStrictEqual(observer.takeRecords(), []);
    } finally {
      observer.disconnect();
      performance.clearMarks("replaced");
    }
  });

  test("with `type` adds to what is observed", async () => {
    const delivered: string[] = [];
    const observer = new PerformanceObserver(list => void delivered.push(...types(list.getEntries())));
    const server = http.createServer((_request, response) => void response.end("ok"));
    try {
      observer.observe({ type: "function" });
      observer.observe({ type: "mark" });
      timed();
      performance.mark("added");
      timed();
      assert.deepStrictEqual(types(observer.takeRecords()), ["function", "mark", "function"]);
      observer.disconnect();

      observer.observe({ type: "mark" });
      observer.observe({ type: "function" });
      performance.mark("added");
      timed();
      performance.mark("added");
      assert.deepStrictEqual(types(observer.takeRecords()), ["mark", "function", "mark"]);
      observer.disconnect();

      // Two of Node's types: both are produced from then on.
      await delivery();
      delivered.length = 0;
      observer.observe({ type: "net" });
      observer.observe({ type: "http" });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as net.AddressInfo;
      // The socket's entry and the client's entry are queued before the response is handed out.
      const records = await new Promise<Entry[]>(resolve =>
        http.get({ port, host: "127.0.0.1", agent: false }, response => {
          resolve(observer.takeRecords());
          response.resume();
        }),
      );
      assert.deepStrictEqual([...new Set([...delivered, ...types(records)])].sort(), ["http", "net"]);
    } finally {
      observer.disconnect();
      performance.clearMarks("added");
      server.close();
    }
  });

  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L304-L310
  test("with `buffered` queues the entries there are, and delivers them later", async () => {
    performance.clearMarks();
    const observer = new PerformanceObserver(() => {});
    const batches: string[][] = [];
    const batched = new PerformanceObserver(list => void batches.push(names(list.getEntries())));
    const late: string[][] = [];
    const disconnected = new PerformanceObserver(list => void late.push(names(list.getEntries())));
    try {
      // takeRecords() right after it has them, and what was queued since.
      performance.mark("pre1");
      performance.mark("pre2");
      let calledInsideObserve = false;
      const first = new PerformanceObserver(() => void (calledInsideObserve = true));
      first.observe({ type: "mark", buffered: true });
      first.disconnect();
      assert.strictEqual(calledInsideObserve, false);
      observer.observe({ type: "mark", buffered: true });
      performance.mark("post1");
      assert.deepStrictEqual(names(observer.takeRecords()), ["pre1", "pre2", "post1"]);
      performance.clearMarks();

      // They are delivered with what is queued before the delivery, in one list.
      performance.mark("b1");
      batched.observe({ type: "mark", buffered: true });
      performance.mark("b2");
      await delivery();
      assert.deepStrictEqual(batches, [["b1", "b2"]]);
      batched.disconnect();
      performance.clearMarks();

      // disconnect() before the delivery drops them.
      performance.mark("c1");
      disconnected.observe({ type: "mark", buffered: true });
      disconnected.disconnect();
      await delivery();
      assert.deepStrictEqual(late, []);
    } finally {
      observer.disconnect();
      batched.disconnect();
      disconnected.disconnect();
      performance.clearMarks();
    }
  });

  test("with `buffered` queues them in the order they were made, for an observer of function entries too", async () => {
    performance.clearMarks();
    const made = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const observer = new PerformanceObserver(() => {});
    const { promise: delivered, resolve } = Promise.withResolvers<string[]>();
    const calls: string[] = [];
    const second = new PerformanceObserver(list => {
      calls.push("callback");
      resolve(names(list.getEntries()));
    });
    try {
      for (const name of made) performance.mark(name);
      observer.observe({ type: "function" });
      observer.observe({ type: "mark", buffered: true });
      performance.mark("post");
      assert.deepStrictEqual(names(observer.takeRecords()), [...made, "post"]);
      observer.disconnect();

      second.observe({ type: "function" });
      second.observe({ type: "mark", buffered: true });
      calls.push("observe() returned");
      assert.deepStrictEqual(await delivered, [...made, "post"]);
      assert.deepStrictEqual(calls, ["observe() returned", "callback"]);
    } finally {
      observer.disconnect();
      second.disconnect();
      performance.clearMarks();
    }
  });
});

describe("the delivery of Node's entry types", () => {
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L117-L127
  test("is from one setImmediate(), in the async context that queued the first entry", async () => {
    const storage = new AsyncLocalStorage<string>();
    const order: string[] = [];
    const observer = new PerformanceObserver(() => void order.push("observer in " + storage.getStore()));
    // (An immediate that an earlier test left is not the one of this test.)
    await delivery();
    try {
      observer.observe({ entryTypes: ["function"] });
      // An immediate that script set before the entry runs before the callback, one set after it runs after.
      setImmediate(() => order.push("immediate 1"));
      storage.run("the context of the first entry", timed);
      storage.run("the context of the second entry", timed);
      setImmediate(() => order.push("immediate 2"));
      await delivery();
      assert.deepStrictEqual(order, ["immediate 1", "observer in the context of the first entry", "immediate 2"]);
    } finally {
      observer.disconnect();
    }
  });

  test("calls every observer that has entries before any tick or microtask of the first", async () => {
    const order: string[] = [];
    const first = new PerformanceObserver(() => {
      order.push("first");
      process.nextTick(() => order.push("tick of first"));
      Promise.resolve().then(() => order.push("microtask of first"));
    });
    const second = new PerformanceObserver(() => void order.push("second"));
    try {
      first.observe({ entryTypes: ["function"] });
      second.observe({ entryTypes: ["function"] });
      timed();
      await delivery();
      assert.deepStrictEqual(order, ["first", "second", "tick of first", "microtask of first"]);
    } finally {
      first.disconnect();
      second.disconnect();
    }
  });

  test("calls the observers in the order they got their first entry, not the one they were made in", async () => {
    const order: string[] = [];
    const made1st = new PerformanceObserver(() => void order.push("made 1st"));
    const made2nd = new PerformanceObserver(() => void order.push("made 2nd"));
    const again = new PerformanceObserver(list => void order.push("again: " + list.getEntries().length));
    const other = new PerformanceObserver(list => void order.push("other: " + list.getEntries().length));
    try {
      made1st.observe({ entryTypes: ["http", "mark"] });
      made2nd.observe({ entryTypes: ["function"] });
      timed();
      performance.mark("for the one made 1st");
      await delivery();
      made1st.disconnect();
      made2nd.disconnect();
      assert.deepStrictEqual(order.splice(0), ["made 2nd", "made 1st"]);

      // disconnect() takes an observer out of the order. observe() does not put it back: its next entry does.
      again.observe({ entryTypes: ["function"] });
      other.observe({ entryTypes: ["function"] });
      timed();
      again.disconnect();
      again.observe({ entryTypes: ["function"] });
      timed();
      await delivery();
      assert.deepStrictEqual(order, ["other: 2", "again: 1"]);
    } finally {
      made1st.disconnect();
      made2nd.disconnect();
      again.disconnect();
      other.disconnect();
      performance.clearMarks("for the one made 1st");
    }
  });

  test("a buffered observe() takes a place in that order, and an observe() in a callback moves no observer", async () => {
    const order: string[] = [];
    const plain = new PerformanceObserver(() => void order.push("plain"));
    const buffered = new PerformanceObserver(() => void order.push("buffered"));
    let calls = 0;
    const caller = new PerformanceObserver(() => {
      order.push("caller");
      // `waiting` still has its entry of this delivery. observe() does not make it the first of the next one.
      if (++calls === 1) waiting.observe({ entryTypes: ["function"] });
    });
    const waiting = new PerformanceObserver(() => void order.push("waiting"));
    try {
      plain.observe({ type: "function" });
      buffered.observe({ type: "function", buffered: true });
      timed();
      await delivery();
      plain.disconnect();
      buffered.disconnect();
      assert.deepStrictEqual(order.splice(0), ["buffered", "plain"]);

      caller.observe({ entryTypes: ["function"] });
      waiting.observe({ entryTypes: ["function"] });
      timed();
      await delivery();
      timed();
      await delivery();
      assert.deepStrictEqual(order, ["caller", "waiting", "caller", "waiting"]);
    } finally {
      plain.disconnect();
      buffered.disconnect();
      caller.disconnect();
      waiting.disconnect();
    }
  });

  test("lets the event loop go on between the callbacks of an observer that queues its next entry", async () => {
    let calls = 0;
    const { promise: calledTwice, resolve } = Promise.withResolvers<void>();
    const observer = new PerformanceObserver(() => {
      if (++calls === 2) resolve();
      timed();
    });
    try {
      observer.observe({ entryTypes: ["function"] });
      timed();
      await calledTwice;
      // The callbacks never stop. A timer still runs.
      await new Promise(resolve => setTimeout(resolve, 1));
    } finally {
      observer.disconnect();
    }
  });

  test("is not through what script made of globalThis.setImmediate", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const { performance, PerformanceObserver } = require("node:perf_hooks");
      const timed = performance.timerify(function work() {});
      const immediate = setImmediate;
      let replacementCalls = 0;
      globalThis.setImmediate = (...args) => { replacementCalls++; return immediate(...args); };
      const observer = new PerformanceObserver(list => {
        observer.disconnect();
        console.log(JSON.stringify({ replacementCalls, delivered: list.getEntries().length }));
      });
      observer.observe({ entryTypes: ["function"] });
      timed();
    `);
    assert.strictEqual(stderr, "");
    assert.deepStrictEqual(JSON.parse(stdout), { replacementCalls: 0, delivered: 1 });
    assert.strictEqual(exitCode, 0);
  });

  test("holds for what is queued when observe() changes what an observer observes", async () => {
    const seen: string[] = [];
    const observer = new PerformanceObserver(list => void seen.push(types(list.getEntries()).join(",")));
    const taker = new PerformanceObserver(() => {});
    try {
      // A mark is queued, then the observer takes one of Node's types. Nothing is queued after.
      observer.observe({ type: "mark" });
      performance.mark("changed");
      observer.observe({ type: "function" });
      await turns(3);
      observer.disconnect();
      assert.deepStrictEqual(seen.splice(0), ["mark"]);

      // A function entry is queued, then the observer goes to marks alone. Nothing is queued after.
      observer.observe({ entryTypes: ["function"] });
      timed();
      observer.observe({ entryTypes: ["mark"] });
      await turns(3);
      observer.disconnect();
      assert.deepStrictEqual(seen.splice(0), ["function"]);

      // With immediates around it: a mark, then a function entry, are delivered together from the immediate.
      await delivery();
      observer.observe({ type: "mark" });
      setImmediate(() => seen.push("immediate 1"));
      performance.mark("changed");
      observer.observe({ type: "function" });
      timed();
      setImmediate(() => seen.push("immediate 2"));
      await turns(3);
      observer.disconnect();
      assert.deepStrictEqual(seen.splice(0), ["immediate 1", "mark,function", "immediate 2"]);

      // takeRecords() has what was queued before and after each change.
      taker.observe({ entryTypes: ["mark"] });
      performance.mark("changed");
      taker.observe({ entryTypes: ["function", "mark"] });
      timed();
      taker.observe({ entryTypes: ["mark"] });
      performance.mark("changed");
      assert.deepStrictEqual(types(taker.takeRecords()), ["mark", "function", "mark"]);
    } finally {
      observer.disconnect();
      taker.disconnect();
      performance.clearMarks("changed");
    }
  });

  test("holds when a callback changes what another observer observes", async () => {
    const seen: string[] = [];
    let second: PerformanceObserver;
    const first = new PerformanceObserver(() => {
      seen.push("first");
      second.observe({ type: "function" });
    });
    second = new PerformanceObserver(list => void seen.push("second: " + types(list.getEntries()).join(",")));
    let later: PerformanceObserver;
    const earlier = new PerformanceObserver(list => {
      seen.push("earlier: " + list.getEntries().length);
      earlier.disconnect();
      later.disconnect();
      earlier.observe({ type: "function" });
      later.observe({ type: "function" });
      if (seen.length < 4) timed();
    });
    later = new PerformanceObserver(list => void seen.push("later: " + list.getEntries().length));
    try {
      // Both have a mark queued. The callback of the first gives the second one of Node's types.
      first.observe({ type: "mark" });
      second.observe({ type: "mark" });
      performance.mark("changed in a callback");
      await turns(3);
      first.disconnect();
      second.disconnect();
      assert.deepStrictEqual(seen.splice(0), ["first", "second: mark"]);

      // The callback of one disconnects both, and both observe again: what the other had queued is dropped.
      earlier.observe({ entryTypes: ["function"] });
      later.observe({ entryTypes: ["function"] });
      timed();
      await turns(8);
      // (Node calls `later` with the list that disconnect() emptied.)
      assert.deepStrictEqual(
        seen.filter(call => call !== "later: 0"),
        ["earlier: 1", "later: 1", "earlier: 1", "later: 1", "earlier: 1"],
      );
    } finally {
      first.disconnect();
      second.disconnect();
      earlier.disconnect();
      later.disconnect();
      performance.clearMarks("changed in a callback");
    }
  });
});

describe("the PerformanceObserver class", () => {
  test("takes observe(null) and a callback that is no function as invalid arguments", () => {
    const observer = new PerformanceObserver(() => {});
    assert.throws(() => observer.observe(null as never), {
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: 'The "options" argument must be of type object. Received null',
    });
    const received = [
      [undefined, "undefined"],
      [null, "null"],
      [1, "type number (1)"],
    ] as const;
    for (const [callback, description] of received) {
      assert.throws(() => new PerformanceObserver(callback as never), {
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: 'The "callback" argument must be of type function. Received ' + description,
      });
    }
  });

  test("is the global one, with node's surface", () => {
    assert.strictEqual(PerformanceObserver, globalThis.PerformanceObserver);
    assert.strictEqual(perf.PerformanceObserverEntryList, globalThis.PerformanceObserverEntryList);
    assert.strictEqual(perf.PerformanceEntry, globalThis.PerformanceEntry);
    const { supportedEntryTypes } = PerformanceObserver;
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L82-L93
    assert.deepStrictEqual(
      [...supportedEntryTypes],
      ["dns", "function", "gc", "http", "http2", "mark", "measure", "net", "quic", "resource"],
    );
    assert.strictEqual(PerformanceObserver.supportedEntryTypes, supportedEntryTypes);
    assert.ok(Object.isFrozen(supportedEntryTypes));
    const descriptor = Object.getOwnPropertyDescriptor(PerformanceObserver, "supportedEntryTypes")!;
    assert.deepStrictEqual(
      { ...descriptor, get: typeof descriptor.get },
      { get: "function", set: undefined, enumerable: false, configurable: true },
    );
    assert.deepStrictEqual(Reflect.ownKeys(PerformanceObserver).map(String).sort(), [
      "length",
      "name",
      "prototype",
      "supportedEntryTypes",
    ]);
    assert.deepStrictEqual(Object.getOwnPropertyNames(PerformanceObserver.prototype), [
      "constructor",
      "observe",
      "disconnect",
      "takeRecords",
    ]);

    const observer = new PerformanceObserver(() => {});
    observer.observe({ entryTypes: ["function"] });
    observer.disconnect();
    assert.deepStrictEqual(Reflect.ownKeys(observer), []);

    assert.throws(() => (PerformanceObserver as any)(() => {}), {
      name: "TypeError",
      message: "Class constructor PerformanceObserver cannot be invoked without 'new'",
    });
    assert.throws(() => new (PerformanceObserver as any)(), { code: "ERR_INVALID_ARG_TYPE" });
  });

  test("supportedEntryTypes stays the same array through garbage collection", async () => {
    // Nothing but the class holds the array between the two reads.
    const { stdout, stderr, exitCode } = await run(`
      const collect =
        typeof Bun !== "undefined"
          ? () => Bun.gc(true)
          : (require("node:v8").setFlagsFromString("--expose-gc"), require("node:vm").runInNewContext("gc"));
      const seen = new WeakSet();
      seen.add(PerformanceObserver.supportedEntryTypes);
      (async () => {
        for (let i = 0; i < 10; i++) {
          collect();
          await new Promise(resolve => setImmediate(resolve));
        }
        console.log(seen.has(PerformanceObserver.supportedEntryTypes));
      })();
    `);
    assert.strictEqual(stderr, "");
    assert.strictEqual(stdout.trim(), "true");
    assert.strictEqual(exitCode, 0);
  });

  test("observes Node's entry types where node:perf_hooks was never loaded", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const net = require("node:net");
      let socket;
      const turns = async count => { while (count-- > 0) await new Promise(resolve => setImmediate(resolve)); };
      const report = entry => {
        console.log(JSON.stringify(entry && {
          entryType: entry.entryType,
          isPerformanceEntry: entry instanceof PerformanceEntry,
          className: entry.constructor.name,
          extendsPerformanceEntry: Object.getPrototypeOf(entry.constructor) === PerformanceEntry,
        }));
        observer.disconnect();
        socket.destroy();
        server.close();
      };
      const observer = new PerformanceObserver(list => report(list.getEntries()[0]));
      observer.observe({ type: "net" });
      const server = net.createServer(accepted => accepted.end()).listen(0, "127.0.0.1", () => {
        socket = net.connect(server.address().port, "127.0.0.1");
        // Delivered from the next immediate. Three turns on, it was never queued.
        socket.on("connect", () => turns(3).then(() => server.listening && report(null)));
      });
    `);
    assert.strictEqual(stderr, "");
    assert.deepStrictEqual(JSON.parse(stdout), {
      entryType: "net",
      isPerformanceEntry: true,
      className: "PerformanceNodeEntry",
      extendsPerformanceEntry: true,
    });
    assert.strictEqual(exitCode, 0);
  });

  test("does not depend on the globals that script can replace", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const real = { Uint32Array, PerformanceObserver, PerformanceEntry, PerformanceObserverEntryList };
      class Shim {
        observe() {}
        disconnect() {}
        takeRecords() { return []; }
      }
      // As a DOM shim or a polyfill does, before the first node: module loads.
      globalThis.Uint32Array = function (length) { return new Array(length).fill(0); };
      globalThis.PerformanceObserver = Shim;
      globalThis.PerformanceEntry = Shim;
      globalThis.PerformanceObserverEntryList = Shim;
      require("node:events");
      const perf = require("node:perf_hooks");
      Object.assign(globalThis, real);

      const timed = perf.performance.timerify(function work() {});
      const result = {
        exportsTheRealClasses:
          perf.PerformanceObserver === real.PerformanceObserver &&
          perf.PerformanceEntry === real.PerformanceEntry &&
          perf.PerformanceObserverEntryList === real.PerformanceObserverEntryList,
      };
      const observer = new perf.PerformanceObserver(list => {
        result.delivered = list.getEntries().map(entry => entry.entryType);
        result.isPerformanceEntry = list.getEntries()[0] instanceof real.PerformanceEntry;
        observer.disconnect();
        console.log(JSON.stringify(result));
      });
      observer.observe({ entryTypes: ["function"] });
      timed();
      result.taken = observer.takeRecords().length;
      timed();
    `);
    assert.strictEqual(stderr, "");
    assert.deepStrictEqual(JSON.parse(stdout), {
      exportsTheRealClasses: true,
      taken: 1,
      delivered: ["function"],
      isPerformanceEntry: true,
    });
    assert.strictEqual(exitCode, 0);
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (harness) {
  const { bunEnv, nodeExe } = harness;
  const node = nodeExe();
  // A Node.js that does not strip types cannot run this file: there is nothing to compare with.
  const runsTypeScript =
    !!node &&
    ["strip", "transform"].includes(
      Bun.spawnSync({ cmd: [node, "-p", "process.features.typescript"], env: bunEnv })
        .stdout.toString()
        .trim(),
    );

  describe("Node.js compatibility", () => {
    (runsTypeScript ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      const child = spawn(node!, ["--v8-pool-size=1", fileURLToPath(import.meta.url)], {
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.setEncoding("utf8").on("data", chunk => (output += chunk));
      child.stderr.setEncoding("utf8").on("data", chunk => (output += chunk));
      const [exitCode] = await once(child, "close");
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : output }, { exitCode: 0, output: "" });
    });
  });
}
