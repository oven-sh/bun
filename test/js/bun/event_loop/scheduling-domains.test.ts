// Domain runs.
//
// A domain run turns Bun's one event loop from inside a synchronous frame while
// admitting only the work that frame caused; everything else that surfaces is
// parked and handed back, in order, when the run exits. These tests pin the two
// invariants from both vantage points:
//
//   inner: everything the run's domain schedules (transitively) executes before
//          the run returns;
//   outer: code that did not start the run observes none of its own callbacks
//          during the run, and observes them afterwards in the same relative
//          order and with unchanged deadlines.
//
// Driven through bun:jsc testing hooks (a permissive run around a thunk);
// skipped on builds whose JSC lacks domain drains. spawnSync's strict runs are
// covered in test/js/bun/spawn/spawnsync-isolated-event-loop.test.ts.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const jsc = require("bun:jsc");
const hasDomains = typeof jsc.runUntilInDomainForTesting === "function";
const { runUntilInDomainForTesting, activeRunForTesting } = jsc as {
  runUntilInDomainForTesting: <T>(thunk: () => Promise<T>, timeoutMs?: number) => Promise<T>;
  activeRunForTesting: () => number;
};

/** Turn the loop inside a fresh (permissive) run until `thunk`'s promise settles; returns it settled. */
function runUntil<T>(thunk: () => Promise<T>): Promise<T> {
  const p = runUntilInDomainForTesting(thunk);
  // The run only returns once the promise is no longer pending.
  expect(Bun.peek.status(p)).not.toBe("pending");
  return p;
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const immediate = () => new Promise<void>(r => setImmediate(r));
/** Poll (with the run's own timers) until `file` exists: a condition another process controls. */
async function untilExists(file: string) {
  while (!existsSync(file)) await sleep(2);
}

describe.skipIf(!hasDomains)("domain runs: microtasks", () => {
  test("inner: everything the run queues runs before it returns, through every promise shape", () => {
    const log: string[] = [];
    const result = runUntil(async () => {
      log.push("thunk");
      queueMicrotask(() => {
        log.push("qm1");
        queueMicrotask(() => log.push("qm1.1"));
      });
      Promise.resolve()
        .then(() => log.push("then1"))
        .then(() => log.push("then2"));
      await null;
      log.push("await1");
      await new Promise<void>(r => queueMicrotask(r));
      log.push("await2");
      // Pass-through hops (no handler on the fired side) must not stall the chain.
      await Promise.resolve(1).catch(() => {});
      log.push("await3");
      await Promise.reject(new Error("x"))
        .then(() => {})
        .catch(() => {});
      log.push("await4");
      // Combinators resolve through context-less internal jobs.
      await Promise.all([Promise.resolve(1), (async () => 2)()]);
      log.push("all");
      await Promise.race([new Promise(r => queueMicrotask(() => r(1)))]);
      log.push("race");
      await Promise.allSettled([Promise.reject(1), Promise.resolve(2)]);
      log.push("allSettled");
      await Promise.any([Promise.reject(1), Promise.resolve(2)]);
      log.push("any");
      try {
        await Promise.resolve().finally(() => {});
      } finally {
        log.push("finally");
      }
      // A thenable, an async generator, and a sync iterable that rejects under for-await:
      // their continuations are queued by JSC without a captured context.
      log.push("thenable:" + (await { then: (r: (v: number) => void) => r(7) }));
      async function* gen() {
        yield 1;
        yield 2;
      }
      for await (const v of gen()) log.push("gen:" + v);
      try {
        for await (const v of [Promise.resolve("ok"), Promise.reject(new Error("no"))]) log.push("sync-iter:" + v);
      } catch (e: any) {
        log.push("sync-iter-threw:" + e.message);
      }
      return "done";
    });
    expect(Bun.peek(result)).toBe("done");
    expect(log).toEqual([
      "thunk",
      "qm1",
      "then1",
      "await1",
      "qm1.1",
      "then2",
      "await2",
      "await3",
      "await4",
      "all",
      "race",
      "allSettled",
      "any",
      "finally",
      "thenable:7",
      "gen:1",
      "gen:2",
      "sync-iter:ok",
      "sync-iter-threw:no",
    ]);
  });

  test("outer: reactions queued before the run do not run inside it, and run FIFO afterwards", async () => {
    const log: string[] = [];
    queueMicrotask(() => log.push("outer-qm1"));
    Promise.resolve().then(() => {
      log.push("outer-then1");
      queueMicrotask(() => log.push("outer-then1.qm"));
    });
    // Pass-through jobs queued before the run are the outer program's too.
    Promise.all([1, 2]).then(() => log.push("outer-all"));
    let resolveOuter!: () => void;
    const outerPromise = new Promise<void>(r => (resolveOuter = r));
    outerPromise.then(() => log.push("outer-resolved-by-inner"));

    runUntil(async () => {
      queueMicrotask(() => log.push("inner-qm"));
      await Promise.resolve().then(() => {
        log.push("inner-then");
        // A reaction the run itself makes ready is one of its consequences: it runs
        // inside, like anything else the run's code queues.
        resolveOuter();
      });
    });
    log.push("after-run");
    expect(log).toEqual(["inner-qm", "inner-then", "outer-resolved-by-inner", "after-run"]);

    await immediate();
    expect(log).toEqual([
      "inner-qm",
      "inner-then",
      "outer-resolved-by-inner",
      "after-run",
      "outer-qm1",
      "outer-then1",
      "outer-then1.qm",
      "outer-all",
    ]);
  });

  test("nested runs: the outer run's pending microtasks wait for the inner run; what the inner run makes ready runs inside it", () => {
    const log: string[] = [];
    queueMicrotask(() => log.push("root"));
    const outer = runUntil(async () => {
      await null;
      const gate = Promise.withResolvers<void>();
      gate.promise.then(() => log.push("outer-reaction-made-ready-by-inner"));
      queueMicrotask(() => log.push("outer-pending"));
      const inner = runUntil(async () => {
        await null;
        gate.resolve();
        queueMicrotask(() => log.push("inner-1"));
        await immediate();
        log.push("inner-2");
        return activeRunForTesting();
      });
      log.push("inner-returned");
      await gate.promise;
      log.push("outer-after-gate");
      return [activeRunForTesting(), await inner];
    });
    const [outerId, innerId] = Bun.peek(outer) as [number, number];
    expect(outerId).toBeGreaterThan(0);
    expect(innerId).not.toBe(outerId);
    expect(log).toEqual([
      "outer-reaction-made-ready-by-inner",
      "inner-1",
      "inner-2",
      "inner-returned",
      "outer-pending",
      "outer-after-gate",
    ]);
    expect(activeRunForTesting()).toBe(0);
  });

  test("AsyncLocalStorage: the run's own code inherits the caller's store, and the caller's context is restored", async () => {
    const als = new AsyncLocalStorage<string>();
    const seen: Array<string | undefined> = [];
    await als.run("outer", async () => {
      runUntil(async () => {
        seen.push(als.getStore());
        queueMicrotask(() => seen.push(als.getStore()));
        await als.run("inner", async () => {
          seen.push(als.getStore());
          await null;
          seen.push(als.getStore());
        });
        seen.push(als.getStore());
        new AsyncLocalStorage<number>().enterWith(1);
      });
      seen.push(als.getStore());
    });
    expect(seen).toEqual(["outer", "inner", "outer", "inner", "outer", "outer"]);
    expect(als.getStore()).toBeUndefined();
    expect(activeRunForTesting()).toBe(0);
  });

  test("an exception thrown by a microtask inside a run is reported, not swallowed, and the run continues", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { runUntilInDomainForTesting } = require("bun:jsc");
        process.on("uncaughtException", err => console.log("uncaught:" + err.message));
        runUntilInDomainForTesting(async () => {
          queueMicrotask(() => {
            console.log("a");
            throw new Error("boom");
          });
          queueMicrotask(() => console.log("b"));
          await new Promise(r => setImmediate(r));
        });
        console.log("after");
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("a\nuncaught:boom\nb\nafter\n");
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(!hasDomains)("domain runs: timers and immediates", () => {
  test("inner: the domain's timers, immediates and sleeps complete inside the run", () => {
    const log: string[] = [];
    const result = runUntil(async () => {
      log.push("start");
      await sleep(1);
      log.push("slept");
      await immediate();
      log.push("immediate");
      await Bun.sleep(1);
      log.push("bun.sleep");
      await new Promise<void>(r => {
        const t = setInterval(() => {
          log.push("interval");
          if (log.filter(x => x === "interval").length === 2) {
            clearInterval(t);
            r();
          }
        }, 1);
      });
      setImmediate(() => log.push("trailing-immediate"));
      return 42;
    });
    // Settled synchronously from the caller's point of view, including what the
    // final step made ready (the trailing immediate).
    expect(Bun.peek(result)).toBe(42);
    expect(log).toEqual(["start", "slept", "immediate", "bun.sleep", "interval", "interval", "trailing-immediate"]);
  });

  test("outer: due timers, immediates and microtasks do not run during the run, and all run afterwards", async () => {
    const log: string[] = [];
    const outerTimer = new Promise<void>(r =>
      setTimeout(() => {
        log.push("outer-timeout");
        r();
      }, 0),
    );
    const outerImmediate = new Promise<void>(r =>
      setImmediate(() => {
        log.push("outer-immediate");
        r();
      }),
    );
    queueMicrotask(() => log.push("outer-microtask"));
    process.nextTick(() => log.push("outer-nexttick"));

    runUntil(async () => {
      // Long enough for the outer 0ms timer to be well overdue.
      await sleep(20);
      log.push("inner-slept");
      await immediate();
      log.push("inner-immediate");
    });
    log.push("after-run");
    expect(log).toEqual(["inner-slept", "inner-immediate", "after-run"]);

    await Promise.all([outerTimer, outerImmediate]);
    expect(log.slice(3).sort()).toEqual(["outer-immediate", "outer-microtask", "outer-nexttick", "outer-timeout"]);
    // Ticks and microtasks queued before the run keep their usual precedence.
    expect(log.indexOf("outer-nexttick")).toBeLessThan(log.indexOf("outer-microtask"));
    expect(log.indexOf("outer-microtask")).toBeLessThan(log.indexOf("outer-timeout"));
  });

  test("outer timers keep their relative order and deadlines after being deferred", async () => {
    const fired: Array<[string, number]> = [];
    const t0 = performance.now();
    const mk = (name: string, ms: number) =>
      new Promise<void>(r =>
        setTimeout(() => {
          fired.push([name, performance.now() - t0]);
          r();
        }, ms),
      );
    // a and b become due during the run; c is due only after it.
    const a = mk("a", 1);
    const b = mk("b", 5);
    const b2 = mk("b2", 5);
    const c = mk("c", 80);

    runUntil(() => sleep(30));
    expect(fired).toEqual([]);

    await Promise.all([a, b, b2, c]);
    expect(fired.map(f => f[0])).toEqual(["a", "b", "b2", "c"]);
    // c was not made early by the run, nor pushed late by the deferred ones.
    expect(fired[3][1]).toBeGreaterThanOrEqual(79);
  });

  test("clearTimeout on a deferred outer timer during the run is honored", async () => {
    const log: string[] = [];
    const outer = setTimeout(() => log.push("outer-should-not-fire"), 1);
    const later = new Promise<void>(r => setTimeout(r, 40));

    runUntil(async () => {
      await sleep(20); // outer is overdue → deferred by the run
      clearTimeout(outer);
      log.push("cleared");
    });
    await later;
    expect(log).toEqual(["cleared"]);
  });

  test("nested runs: the inner run completes its own work; the middle run's timer waits for it", () => {
    const log: string[] = [];
    runUntil(async () => {
      const middleTimer = sleep(5).then(() => log.push("middle-timer"));
      await sleep(1);
      log.push("middle-before-inner");
      runUntil(async () => {
        await sleep(20); // middle's 5ms timer is overdue in here, but foreign
        log.push("inner-done");
      });
      log.push("middle-after-inner");
      await middleTimer;
      log.push("middle-done");
    });
    expect(log).toEqual(["middle-before-inner", "inner-done", "middle-after-inner", "middle-timer", "middle-done"]);
  });

  test("the domain's nextTicks run inside; outer nextTicks queued before wait, in order", async () => {
    const log: string[] = [];
    process.nextTick(() => log.push("outer-1"));
    process.nextTick(() => {
      log.push("outer-2");
      process.nextTick(() => log.push("outer-2.1"));
    });
    runUntil(async () => {
      process.nextTick(() => log.push("inner-tick-1"));
      await sleep(1);
      await new Promise<void>(r => process.nextTick(r));
      log.push("inner-after-tick");
      process.nextTick(() => log.push("inner-tick-2"));
    });
    log.push("after-run");
    expect(log).toEqual(["inner-tick-1", "inner-after-tick", "inner-tick-2", "after-run"]);
    await immediate();
    expect(log.slice(4)).toEqual(["outer-1", "outer-2", "outer-2.1"]);
  });

  test("the active run is visible inside and cleared after", () => {
    let inside!: number;
    let insideTimer!: number;
    runUntil(async () => {
      inside = activeRunForTesting();
      await sleep(1);
      insideTimer = activeRunForTesting();
    });
    expect(inside).toBeGreaterThan(0);
    expect(insideTimer).toBe(inside);
    expect(activeRunForTesting()).toBe(0);
  });

  test("a run whose condition is met by an immediate does not sit through a poll", async () => {
    // A listener keeps the loop active with nothing to wake it: if the run polled
    // after the immediate settled its promise it would block indefinitely.
    using server = Bun.serve({ port: 0, fetch: () => new Response("unused") });
    const t0 = performance.now();
    runUntil(async () => {
      await immediate();
      await immediate();
    });
    runUntil(() => new Promise<void>(r => process.nextTick(r)));
    runUntil(() => Promise.resolve().then(() => {}));
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

/**
 * A TCP echo server in a child process (so its timing is independent of this
 * process's loop): echoes each chunk back, then creates `marker`.
 */
async function spawnEchoServer(marker: string) {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { writeFileSync } = require("node:fs");
       const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: {
         // Echo, then record that the reply is on its way (in the peer's kernel
         // buffer by the time anyone sees the marker).
         data(socket, data) { socket.write(data); socket.flush(); writeFileSync(process.env.ECHO_MARKER, ""); },
       }});
       console.log(server.port);
       process.stdin.on("end", () => process.exit(0)).resume();`,
    ],
    env: { ...bunEnv, ECHO_MARKER: marker },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = proc.stdout.getReader();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  const port = Number(text.trim());
  expect(port).toBeGreaterThan(0);
  return {
    port,
    async [Symbol.asyncDispose]() {
      proc.stdin.end();
      await proc.exited;
    },
  };
}

// Readiness gating rides on FilePoll/usockets run epochs, which the libuv-backed
// Windows paths do not carry yet.
describe.skipIf(!hasDomains || process.platform === "win32")("domain runs: I/O", () => {
  test("outer connections ready during a run wait; a listener still accepts; inner I/O works", async () => {
    const log: string[] = [];
    using dir = tempDir("domain-run-io", {});
    const marker = join(String(dir), "replied");
    await using echo = await spawnEchoServer(marker);
    // A server created outside the run. Its listen socket keeps accepting inside
    // the run: a fetch from inside to it must not deadlock.
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        log.push("served:" + new URL(req.url).pathname);
        return new Response("hi:" + new URL(req.url).pathname);
      },
    });

    // An outer connection whose reply arrives while the run is active.
    const { promise: outerData, resolve: gotOuterData } = Promise.withResolvers<string>();
    const outer = await Bun.connect({
      hostname: "127.0.0.1",
      port: echo.port,
      socket: {
        data(_socket, data) {
          log.push("outer-data");
          gotOuterData(data.toString());
        },
      },
    });
    outer.write("ping");

    const inner = runUntil(async () => {
      await untilExists(marker); // the echo reply to `outer` is now sitting in the kernel
      log.push("inner-waited");
      const res = await fetch(`http://127.0.0.1:${server.port}/inner`);
      log.push("inner-fetched:" + (await res.text()));
      // A connection opened inside the run is the run's own.
      const { promise, resolve } = Promise.withResolvers<string>();
      const conn = await Bun.connect({
        hostname: "127.0.0.1",
        port: echo.port,
        socket: { data: (_s, d) => resolve(d.toString()) },
      });
      conn.write("inner-ping");
      log.push("inner-echo:" + (await promise));
      conn.end();
      return "done";
    });
    expect(Bun.peek(inner)).toBe("done");
    expect(log).toEqual(["inner-waited", "served:/inner", "inner-fetched:hi:/inner", "inner-echo:inner-ping"]);

    // The outer reply was held, not lost.
    expect(await outerData).toBe("ping");
    expect(log.at(-1)).toBe("outer-data");
    outer.end();
  });

  test("a request accepted inside a run does not see the entering frame's AsyncLocalStorage store", async () => {
    const als = new AsyncLocalStorage<string>();
    let seenInHandler: string | undefined = "unset";
    using server = Bun.serve({
      port: 0,
      fetch() {
        seenInHandler = als.getStore();
        return new Response("ok");
      },
    });
    const body = als.run("caller's store", () =>
      runUntil(async () => {
        expect(als.getStore()).toBe("caller's store"); // the run's own code inherits it
        return (await fetch(`http://127.0.0.1:${server.port}/`)).text();
      }),
    );
    expect(Bun.peek(body)).toBe("ok");
    expect(seenInHandler).toBeUndefined();
  });

  test("outer pipe readiness during a run waits and is delivered afterwards", async () => {
    const log: string[] = [];
    using dir = tempDir("domain-run-pipe", {});
    const [go, wrote] = [join(String(dir), "go"), join(String(dir), "wrote")];
    // An outer child that writes (and exits) once the run is active.
    await using child = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const fs = require("node:fs");
         while (!fs.existsSync(${JSON.stringify(go)})) Bun.sleepSync(2);
         fs.writeSync(1, "outer-child");
         fs.writeFileSync(${JSON.stringify(wrote)}, "");`,
      ],
      env: bunEnv,
      stdout: "pipe",
    });
    const outerRead = (async () => {
      const text = await child.stdout.text();
      log.push("outer-read:" + text);
      return text;
    })();

    runUntil(async () => {
      writeFileSync(go, "");
      await untilExists(wrote); // outer child's write happened in here
      log.push("inner-waited");
      await using innerChild = Bun.spawn({
        cmd: [bunExe(), "-e", "process.stdout.write('inner-child')"],
        env: bunEnv,
        stdout: "pipe",
      });
      log.push("inner-read:" + (await innerChild.stdout.text()));
      log.push("inner-exit:" + (await innerChild.exited));
    });
    expect(log).toEqual(["inner-waited", "inner-read:inner-child", "inner-exit:0"]);
    expect(await outerRead).toBe("outer-child");
    expect(await child.exited).toBe(0);
  });

  test("a socket that predates the run but is written by it gets its reply inside the run", async () => {
    // "The commons": a pooled/keep-alive connection created before the run and
    // reused by code inside it. Writing is the ownership transfer.
    using dir = tempDir("domain-run-commons", {});
    const marker = join(String(dir), "replied");
    await using echo = await spawnEchoServer(marker);
    let onData = (_: string) => {};
    const conn = await Bun.connect({
      hostname: "127.0.0.1",
      port: echo.port,
      socket: { data: (_s, d) => onData(d.toString()) },
    });
    const reply = runUntil(() => {
      const { promise, resolve } = Promise.withResolvers<string>();
      onData = resolve;
      conn.write("reused");
      return promise;
    });
    expect(Bun.peek(reply)).toBe("reused");

    // Same, but the socket first surfaces as foreign (a reply to an outer write
    // is parked), and only then is written by the run: adopting it must put it
    // back in the poll set. The parked outer reply arrives with it — the shared
    // connection is the one case where outer data is admitted, by construction.
    const seen: string[] = [];
    onData = d => seen.push(d);
    require("node:fs").rmSync(marker);
    conn.write("outer");
    const both = runUntil(async () => {
      await untilExists(marker); // "outer" echo has been sent...
      await sleep(5); // ...and this run has polled since: it is parked
      expect(seen).toEqual([]);
      const { promise, resolve } = Promise.withResolvers<void>();
      onData = d => (seen.push(d), seen.join("").includes("inner") && resolve());
      conn.write("inner");
      await promise;
      return seen.join("");
    });
    expect(Bun.peek(both)).toBe("outerinner");
    conn.end();
  });
});

describe.skipIf(!hasDomains || process.platform === "win32")("domain runs: modules, threads, nesting", () => {
  test("dynamic import and require work inside a run", () => {
    using dir = tempDir("domain-run-import", {
      "esm.mjs": "export const x = await Promise.resolve(42);",
      "cjs.cjs": "module.exports = { y: 7 };",
    });
    const result = runUntil(async () => {
      await sleep(1);
      const esm = await import(String(dir) + "/esm.mjs");
      const cjs = require(String(dir) + "/cjs.cjs");
      const builtin = await import("node:zlib");
      return [esm.x, cjs.y, typeof builtin.gzipSync];
    });
    expect(Bun.peek(result)).toEqual([42, 7, "function"]);
  });

  test("spawnSync inside a run nests", () => {
    const result = runUntil(async () => {
      await sleep(1);
      const { stdout } = Bun.spawnSync({ cmd: [bunExe(), "-e", "console.log('nested')"], env: bunEnv });
      await immediate();
      return stdout.toString().trim();
    });
    expect(Bun.peek(result)).toBe("nested");
    expect(activeRunForTesting()).toBe(0);
  });
});
