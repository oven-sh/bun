/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js. None of them
 * uses the network: a UDP server on 127.0.0.1 answers the queries, and
 * `dns.lookup` asks for "localhost".
 *
 * Node calls a `node:dns` callback from the event loop. When the callback has
 * returned, the process.nextTick queue runs, and then the promise jobs.
 * - `lookup` and `lookupService` make one MakeCallback per request:
 *   https://github.com/nodejs/node/blob/v26.3.0/src/cares_wrap.cc#L1881
 *   https://github.com/nodejs/node/blob/v26.3.0/src/cares_wrap.cc#L1916
 * - A c-ares query answers from a native immediate, and one callback scope
 *   covers every immediate of a loop turn:
 *   https://github.com/nodejs/node/blob/v26.3.0/src/cares_wrap.h#L388-L399
 *   https://github.com/nodejs/node/blob/v26.3.0/src/env.cc#L1424-L1454
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import dgram from "node:dgram";
import dns from "node:dns";
import { once } from "node:events";
import net from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

type Callback = (...args: any[]) => void;
type Queries = Pick<
  dns.Resolver,
  | "resolve"
  | "resolve4"
  | "resolve6"
  | "resolveAny"
  | "resolveCaa"
  | "resolveCname"
  | "resolveMx"
  | "resolveNaptr"
  | "resolveNs"
  | "resolvePtr"
  | "resolveSoa"
  | "resolveSrv"
  | "resolveTxt"
  | "reverse"
>;

// The record that the server has of each type. A type that is not here has no record.
const records: Record<number, Buffer> = {
  1: Buffer.from([127, 0, 0, 7]),
  12: Buffer.from("\x04host\x04test\x00", "latin1"),
  16: Buffer.from("\x05hello", "latin1"),
  28: Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]),
};

let port = 0;
let socket: dgram.Socket;
let servers: string[];
let held: (() => void)[] = [];
let holding = 0;

// The next `count` answers leave together, so that one read of the resolver finds them all.
function hold(count: number) {
  holding = count;
}

function newResolver(options: { timeout?: number; tries?: number } = { timeout: 5000, tries: 1 }) {
  const resolver = new dns.Resolver(options);
  resolver.setServers(["127.0.0.1:" + port]);
  return resolver;
}

before(async () => {
  socket = dgram.createSocket("udp4");
  // The first label of the name says what to do: "nx…" does not exist, and "hang…" is not answered.
  socket.on("message", (query, from) => {
    let end = 12;
    while (query[end] !== 0) end += query[end] + 1;
    const label = query.toString("latin1", 13, 13 + query[12]);
    if (label.startsWith("hang")) return;
    const type = query.readUInt16BE(end + 1);
    const rdata = label.startsWith("nx") ? undefined : records[type];
    const header = Buffer.from(query.subarray(0, 12));
    header.writeUInt16BE(label.startsWith("nx") ? 0x8183 : 0x8180, 2);
    header.writeUInt16BE(rdata ? 1 : 0, 6);
    const reply = Buffer.concat([
      header,
      query.subarray(12, end + 5),
      rdata ? Buffer.from([0xc0, 12, type >> 8, type & 0xff, 0, 1, 0, 0, 0, 60, 0, rdata.length]) : Buffer.alloc(0),
      rdata ?? Buffer.alloc(0),
    ]);
    const send = () => socket.send(reply, from.port, from.address);
    if (holding === 0) return send();
    held.push(send);
    if (held.length === holding) {
      const ready = held;
      held = [];
      holding = 0;
      for (const send of ready) send();
    }
  });
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  port = socket.address().port;
  servers = dns.getServers();
  dns.setServers(["127.0.0.1:" + port]);
});

// A test that failed with answers held must not keep them from the next test.
beforeEach(() => {
  held = [];
  holding = 0;
});

after(() => {
  dns.setServers(servers);
  socket.close();
});

// The first process.nextTick() of a process runs right after the microtask
// that queued it, which hides a callback that runs inside a microtask.
function tickQueueExists() {
  return new Promise<void>(resolve => process.nextTick(resolve));
}

// In which order the callback of a request, a nextTick that it queues and a microtask that it queues run.
async function orderInside(start: (callback: Callback) => void) {
  await tickQueueExists();
  const { promise, resolve } = Promise.withResolvers<string[]>();
  const order: string[] = [];
  const step = (name: string) => () => {
    order.push(name);
    if (order.length === 3) resolve(order);
  };
  start(() => {
    step("callback")();
    process.nextTick(step("nextTick"));
    queueMicrotask(step("microtask"));
  });
  return promise;
}

// The same for several requests: what runs, in order, until the last microtask has run. A callback
// says the code of its error. The requests are named A, B, … in the order of their callbacks.
async function orderOf(starts: ((callback: Callback) => void)[], log: string[] = []) {
  await tickQueueExists();
  const { promise, resolve } = Promise.withResolvers<string[]>();
  const names = new Map<number, string>();
  let left = starts.length;
  starts.forEach((start, index) =>
    start((err?: NodeJS.ErrnoException | null) => {
      const name = String.fromCharCode(65 + names.size);
      names.set(index, name);
      log.push(`callback ${name}${err ? " " + err.code : ""}`);
      process.nextTick(() => log.push(`nextTick ${name}`));
      queueMicrotask(() => {
        log.push(`microtask ${name}`);
        if (--left === 0) resolve(log);
      });
    }),
  );
  return promise;
}

const inOrder = ["callback", "nextTick", "microtask"];

describe("a process.nextTick queued by a dns callback runs before a microtask it queues", () => {
  const queries: [name: string, start: (resolver: Queries, name: string, callback: Callback) => void][] = [
    ["resolve", (resolver, name, callback) => resolver.resolve(name, callback)],
    ["resolve with an rrtype", (resolver, name, callback) => resolver.resolve(name, "TXT", callback)],
    ["resolve4", (resolver, name, callback) => resolver.resolve4(name, callback)],
    ["resolve4 with ttl", (resolver, name, callback) => resolver.resolve4(name, { ttl: true }, callback)],
    ["resolve6", (resolver, name, callback) => resolver.resolve6(name, callback)],
    ["resolve6 with ttl", (resolver, name, callback) => resolver.resolve6(name, { ttl: true }, callback)],
    ["resolveAny", (resolver, name, callback) => resolver.resolveAny(name, callback)],
    ["resolveCaa", (resolver, name, callback) => resolver.resolveCaa(name, callback)],
    ["resolveCname", (resolver, name, callback) => resolver.resolveCname(name, callback)],
    ["resolveMx", (resolver, name, callback) => resolver.resolveMx(name, callback)],
    ["resolveNaptr", (resolver, name, callback) => resolver.resolveNaptr(name, callback)],
    ["resolveNs", (resolver, name, callback) => resolver.resolveNs(name, callback)],
    ["resolvePtr", (resolver, name, callback) => resolver.resolvePtr(name, callback)],
    ["resolveSoa", (resolver, name, callback) => resolver.resolveSoa(name, callback)],
    ["resolveSrv", (resolver, name, callback) => resolver.resolveSrv(name, callback)],
    ["resolveTxt", (resolver, name, callback) => resolver.resolveTxt(name, callback)],
    ["reverse", (resolver, _name, callback) => resolver.reverse("192.0.2.7", callback)],
  ];

  for (const [name, start] of queries) {
    test(`dns.${name}`, async () => {
      assert.deepStrictEqual(
        await orderInside(callback => start(dns, `${name.replaceAll(" ", "-")}.test`, callback)),
        inOrder,
      );
    });
    test(`dns.${name} that fails`, async () => {
      assert.deepStrictEqual(
        await orderInside(callback => start(dns, `nx-${name.replaceAll(" ", "-")}.test`, callback)),
        inOrder,
      );
    });
    test(`Resolver.${name}`, async () => {
      const resolver = newResolver();
      assert.deepStrictEqual(await orderInside(callback => start(resolver, "a.test", callback)), inOrder);
    });
  }

  const lookups: [name: string, start: (callback: Callback) => void][] = [
    ["dns.lookup", callback => dns.lookup("localhost", callback)],
    ["dns.lookup with all", callback => dns.lookup("localhost", { all: true }, callback)],
    ["dns.lookup with a family", callback => dns.lookup("localhost", 4, callback)],
    ["dns.lookup of what is not a hostname", callback => dns.lookup("not a hostname", callback)],
    ["dns.lookupService", callback => dns.lookupService("127.0.0.1", 80, callback)],
  ];
  for (const [name, start] of lookups) {
    test(name, async () => {
      assert.deepStrictEqual(await orderInside(start), inOrder);
    });
  }

  test("a query that is cancelled", async () => {
    const resolver = newResolver();
    const order = orderInside(callback => resolver.resolve4("hang.test", callback));
    await tickQueueExists();
    resolver.cancel();
    assert.deepStrictEqual(await order, inOrder);
  });

  test("a query that times out", async () => {
    const resolver = newResolver({ timeout: 50, tries: 1 });
    assert.deepStrictEqual(await orderInside(callback => resolver.resolve4("hang.test", callback)), inOrder);
  });

  test("the 'lookup' event of net.connect()", async () => {
    const server = net.createServer(socket => socket.end());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const client = net.connect({ host: "localhost", port: (server.address() as net.AddressInfo).port, family: 4 });
    try {
      assert.deepStrictEqual(await orderInside(callback => client.once("lookup", callback)), inOrder);
    } finally {
      client.destroy();
      server.close();
    }
  });

  // In a subprocess: the replacement must not reach the other tests, and a
  // callback that is held ends the process with no output instead of a hang.
  test("while user code has replaced process.nextTick", async () => {
    const script = `
      const dns = require("node:dns");
      const realNextTick = process.nextTick;
      const order = [];
      process.on("exit", () => console.log(order.join(" ")));
      // The tick queue exists before the request starts.
      realNextTick(() => {
        // What a fake-timer library does: hold the job until the fake clock runs.
        process.nextTick = () => {};
        dns.lookup("localhost", () => {
          order.push("callback");
          realNextTick(() => order.push("nextTick"));
          queueMicrotask(() => order.push("microtask"));
        });
      });
    `;
    assert.deepStrictEqual(await run(script), { stdout: "callback nextTick microtask\n", stderr: "", code: 0 });
  });
});

describe("the callbacks of several requests", () => {
  test("c-ares queries that one read answers share one checkpoint, in the order of the answers", async () => {
    const resolver = newResolver();
    hold(3);
    assert.deepStrictEqual(
      await orderOf([
        callback => resolver.resolve4("a.test", callback),
        callback => resolver.resolve4("nx.test", callback),
        callback => resolver.resolveTxt("b.test", callback),
      ]),
      [
        "callback A",
        "callback B ENOTFOUND",
        "callback C",
        "nextTick A",
        "nextTick B",
        "nextTick C",
        "microtask A",
        "microtask B",
        "microtask C",
      ],
    );
  });

  test("queries that cancel() fails share one checkpoint, after cancel() has returned", async () => {
    const resolver = newResolver();
    const log: string[] = [];
    const order = orderOf(
      [callback => resolver.resolve4("hang-a.test", callback), callback => resolver.resolve6("hang-b.test", callback)],
      log,
    );
    await tickQueueExists();
    resolver.cancel();
    log.push("cancel() returned");
    assert.deepStrictEqual(await order, [
      "cancel() returned",
      "callback A ECANCELLED",
      "callback B ECANCELLED",
      "nextTick A",
      "nextTick B",
      "microtask A",
      "microtask B",
    ]);
  });

  test("each dns.lookup has a checkpoint of its own", async () => {
    assert.deepStrictEqual(
      await orderOf([
        callback => dns.lookup("localhost", callback),
        callback => dns.lookup("localhost", callback),
        callback => dns.lookup("localhost", 4, callback),
        callback => dns.lookup("not a hostname", callback),
      ]).then(log => log.map(entry => entry.replace(" ENOTFOUND", ""))),
      ["A", "B", "C", "D"].flatMap(name => [`callback ${name}`, `nextTick ${name}`, `microtask ${name}`]),
    );
  });

  test("each dns.lookupService has a checkpoint of its own", async () => {
    assert.deepStrictEqual(
      await orderOf([
        callback => dns.lookupService("127.0.0.1", 80, callback),
        callback => dns.lookupService("127.0.0.1", 80, callback),
        callback => dns.lookupService("127.0.0.1", 443, callback),
      ]).then(log => log.map(entry => entry.replace(/^(callback \w) .*/, "$1"))),
      ["A", "B", "C"].flatMap(name => [`callback ${name}`, `nextTick ${name}`, `microtask ${name}`]),
    );
  });

  test("a callback runs before the continuation of a promise that the same read settles", async () => {
    await tickQueueExists();
    const log: string[] = [];
    hold(2);
    const settled = dns.promises.resolve4("promise.test").then(() => log.push("continuation"));
    const called = new Promise<void>(resolve =>
      dns.resolve4("callback.test", () => {
        log.push("callback");
        process.nextTick(() => {
          log.push("nextTick");
          resolve();
        });
      }),
    );
    await Promise.all([settled, called]);
    assert.deepStrictEqual(log, ["callback", "nextTick", "continuation"]);
  });

  test("a throw from a callback is an uncaughtException, and the other callbacks run", async () => {
    const script = `
      const dns = require("node:dns");
      const resolver = new dns.Resolver({ timeout: 5000, tries: 1 });
      resolver.setServers(["127.0.0.1:${port}"]);
      const log = [];
      process.on("uncaughtException", err => log.push("uncaughtException " + err.message));
      process.on("exit", () => console.log(log.join(", ")));
      for (const name of ["a", "b", "c"]) {
        resolver.resolve4("throw-" + name + ".test", () => {
          log.push("callback " + name);
          if (name === "b") throw new Error("from callback b");
        });
      }
    `;
    hold(3);
    assert.deepStrictEqual(await run(script), {
      stdout: "callback a, callback b, uncaughtException from callback b, callback c\n",
      stderr: "",
      code: 0,
    });
  });
});

describe("a dns callback", () => {
  test("is called with (null, answer) or with (error)", async () => {
    const resolver = newResolver();
    const argumentsOf = (start: (callback: Callback) => void) =>
      new Promise<any[]>(resolve => start((...args) => resolve(args)));
    const [error, ...none] = await argumentsOf(callback => resolver.resolve4("nx-arguments.test", callback));
    assert.deepStrictEqual(
      {
        "lookup": await argumentsOf(callback => dns.lookup("localhost", 4, callback)),
        "resolve": await argumentsOf(callback => resolver.resolve("resolve.test", callback)),
        "resolve4": await argumentsOf(callback => resolver.resolve4("resolve4.test", callback)),
        "resolve4 with ttl": await argumentsOf(callback => resolver.resolve4("ttl.test", { ttl: true }, callback)),
        "resolve6": await argumentsOf(callback => resolver.resolve6("resolve6.test", callback)),
        "resolvePtr": await argumentsOf(callback => resolver.resolvePtr("ptr.test", callback)),
        "resolveTxt": await argumentsOf(callback => resolver.resolveTxt("txt.test", callback)),
        "reverse": await argumentsOf(callback => resolver.reverse("192.0.2.7", callback)),
        "resolve4 that fails": [{ code: error.code, syscall: error.syscall, hostname: error.hostname }, ...none],
      },
      {
        "lookup": [null, "127.0.0.1", 4],
        "resolve": [null, ["127.0.0.7"]],
        "resolve4": [null, ["127.0.0.7"]],
        "resolve4 with ttl": [null, [{ address: "127.0.0.7", ttl: 60 }]],
        "resolve6": [null, ["::1"]],
        "resolvePtr": [null, ["host.test"]],
        "resolveTxt": [null, [["hello"]]],
        "reverse": [null, ["host.test"]],
        "resolve4 that fails": [{ code: "ENOTFOUND", syscall: "queryA", hostname: "nx-arguments.test" }],
      },
    );
  });

  test("of an answer that is ready inside the call runs after the call has returned", async () => {
    const resolver = newResolver();
    // c-ares keeps the answer, and has it again inside the next call.
    await new Promise(resolve => resolver.resolve4("kept.test", resolve));
    await tickQueueExists();
    const { promise, resolve } = Promise.withResolvers<void>();
    const log: string[] = [];
    resolver.resolve4("kept.test", () => {
      log.push("callback");
      process.nextTick(() => log.push("nextTick"));
      queueMicrotask(() => {
        log.push("microtask");
        resolve();
      });
    });
    log.push("resolve4() returned");
    await promise;
    assert.deepStrictEqual(log, ["resolve4() returned", ...inOrder]);
  });

  test("shares an answer with a promise for the same name", async () => {
    const [called, settled] = await Promise.all([
      new Promise(resolve => dns.resolve4("shared.test", (err, addresses) => resolve(err ?? addresses))),
      dns.promises.resolve4("shared.test"),
    ]);
    assert.deepStrictEqual({ called, settled }, { called: ["127.0.0.7"], settled: ["127.0.0.7"] });
  });

  test("runs inside the AsyncLocalStorage store of the call", async () => {
    const storage = new AsyncLocalStorage<string>();
    const resolver = newResolver();
    await new Promise(resolve => resolver.resolve4("kept.test", resolve));
    const inside = (store: string, start: (callback: Callback) => void) =>
      new Promise(resolve => storage.run(store, () => start(() => resolve(storage.getStore()))));
    const stores = [
      "lookup",
      "lookup that fails",
      "lookupService",
      "query",
      "query that fails",
      "query with an answer inside the call",
      "query with a converted answer",
      "reverse",
    ];
    assert.deepStrictEqual(
      await Promise.all([
        inside(stores[0], callback => dns.lookup("localhost", callback)),
        inside(stores[1], callback => dns.lookup("not a hostname", callback)),
        inside(stores[2], callback => dns.lookupService("127.0.0.1", 80, callback)),
        inside(stores[3], callback => resolver.resolveTxt("store.test", callback)),
        inside(stores[4], callback => resolver.resolveTxt("nx-store.test", callback)),
        inside(stores[5], callback => resolver.resolve4("kept.test", { ttl: true }, callback)),
        inside(stores[6], callback => resolver.resolve4("store.test", callback)),
        inside(stores[7], callback => resolver.reverse("192.0.2.7", callback)),
      ]),
      stores,
    );
  });

  // A callback that goes through process.nextTick is a TickObject.
  test("is not a TickObject for async_hooks", async () => {
    const script = `
      const dns = require("node:dns");
      const types = new Set();
      require("node:async_hooks").createHook({ init: (id, type) => types.add(type) }).enable();
      const resolver = new dns.Resolver({ timeout: 5000, tries: 1 });
      resolver.setServers(["127.0.0.1:${port}"]);
      let left = 3;
      const done = () => {
        if (--left === 0) console.log(types.has("TickObject"));
      };
      dns.lookup("localhost", done);
      resolver.resolve4("hooks.test", done);
      resolver.resolve4("nx-hooks.test", done);
    `;
    assert.deepStrictEqual(await run(script), { stdout: "false\n", stderr: "", code: 0 });
  });
});

// A script in a process of this runtime.
async function run(script: string) {
  const env = typeof Bun === "undefined" ? process.env : (await import("harness")).bunEnv;
  const { promise, resolve } = Promise.withResolvers<{ stdout: string; stderr: string; code: number | string }>();
  execFile(process.execPath, ["-e", script], { env: env as NodeJS.ProcessEnv }, (err, stdout, stderr) =>
    resolve({ stdout, stderr, code: err ? (err.code ?? 1) : 0 }),
  );
  return promise;
}

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, bunExe, nodeExeAtLeast, tempDir } = await import("harness");
  const { expect } = await import("bun:test");
  // Node.js runs a TypeScript file since v23.6.0.
  const node = nodeExeAtLeast("23.6.0");

  // What `main.ts` prints when this runtime runs it beside `files`.
  async function runFiles(files: Record<string, string>) {
    using dir = tempDir("dns-callback-order", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A debug build also logs "[macro] call <name>" to stdout.
    return { stdout: stdout.replace(/^\[macro\] call .*\n/gm, ""), stderr, exitCode };
  }

  describe("in Bun", () => {
    // `expect().resolves` runs the event loop until the promise settles.
    test("a callback that waits on the event loop gets the callbacks of other requests", async () => {
      const resolver = newResolver();
      await new Promise(resolve => resolver.resolve4("kept.test", resolve));
      const { promise, resolve } = Promise.withResolvers<string[]>();
      const log: string[] = [];
      const request = (name: string, start: (callback: Callback) => void) =>
        new Promise<string>(resolve =>
          start(() => {
            log.push(name);
            resolve(name);
          }),
        );
      resolver.resolve4("waits.test", () => {
        log.push("waits");
        expect(request("lookup", callback => dns.lookup("localhost", callback))).resolves.toBe("lookup");
        expect(request("query", callback => resolver.resolveTxt("other.test", callback))).resolves.toBe("query");
        expect(request("answer inside the call", callback => resolver.resolve4("kept.test", callback))).resolves.toBe(
          "answer inside the call",
        );
        log.push("has waited");
        resolve(log);
      });
      assert.deepStrictEqual(await promise, ["waits", "lookup", "query", "answer inside the call", "has waited"]);
    });

    // A macro runs on an event loop of its own, which stops when the macro returns.
    test("a macro that does not wait for its callback takes no callback from the program", async () => {
      const result = await runFiles({
        "macro.ts": `
          import dns from "node:dns";
          export function askAndLeave() {
            dns.lookup("not a hostname", () => {});
            return "asked";
          }
        `,
        "main.ts": `
          import { askAndLeave } from "./macro.ts" with { type: "macro" };
          import dns from "node:dns";
          const macro = askAndLeave();
          dns.lookup("also not a hostname", err => console.log("the callback of the program:", err?.code, macro));
        `,
      });
      assert.deepStrictEqual(result, {
        stdout: "the callback of the program: ENOTFOUND asked\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test("a macro that waits for its callback gets it while a callback of the program waits", async () => {
      const result = await runFiles({
        "macro.ts": `
          import dns from "node:dns";
          export function lookupCode() {
            return new Promise(resolve => dns.lookup("not a hostname", err => resolve(err?.code ?? "no error")));
          }
        `,
        "uses-macro.ts": `
          import { lookupCode } from "./macro.ts" with { type: "macro" };
          export const code = lookupCode();
        `,
        "main.ts": `
          import dns from "node:dns";
          dns.lookup("also not a hostname", err => console.log("the callback of the program:", err?.code));
          const { code } = require("./uses-macro.ts");
          console.log("the macro:", code);
        `,
      });
      assert.deepStrictEqual(result, {
        stdout: "the macro: ENOTFOUND\nthe callback of the program: ENOTFOUND\n",
        stderr: "",
        exitCode: 0,
      });
    });
  });

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
