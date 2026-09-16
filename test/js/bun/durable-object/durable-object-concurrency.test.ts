// Event delivery, lifecycle and isolation of Bun.DurableObject.
//
// Every object is a tenant: a call, a continuation or a callback that runs in
// another object's context is a data-loss bug, so these tests overlap many
// objects and assert at every hop WHICH object the code is running in.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";

const RESET = "ERR_DURABLE_OBJECT_RESET";

async function until<T>(condition: () => T | Promise<T>, what: string, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await condition();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for " + what);
    await Bun.sleep(2);
  }
}

/** Leaves the object alone for longer than its idleTimeout, then calls it, until the call constructed a new instance. */
async function untilReconstructed(call: () => Promise<unknown>, made: () => number, idleTimeout: number) {
  const before = made();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await Bun.sleep(idleTimeout * 3 + 5);
    await call();
    if (made() > before) return;
  }
  throw new Error("the object was not evicted");
}

function track<T>(promise: Promise<T>) {
  const tracked = {
    state: "pending" as "pending" | "fulfilled" | "rejected",
    value: undefined as T | undefined,
    reason: undefined as any,
  };
  promise.then(
    value => ((tracked.state = "fulfilled"), (tracked.value = value)),
    reason => ((tracked.state = "rejected"), (tracked.reason = reason)),
  );
  return tracked;
}

async function rejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected the promise to reject");
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("ordering", () => {
  test("calls made in one tick are delivered in order", async () => {
    const log: string[] = [];
    class Fifo extends Bun.DurableObject<{ log: string[] }> {
      push(i: number) {
        this.env.log.push("sync" + i);
        return i;
      }
      async pushAsync(i: number) {
        this.env.log.push("start" + i);
        await Bun.sleep(1);
        this.env.log.push("end" + i);
        return i;
      }
      get last() {
        return this.env.log.at(-1);
      }
    }
    await using ns = new Bun.DurableObjectNamespace<Fifo>({ class: Fifo, env: { log } });
    const stub = ns.getByName("a");
    // The same object through another stub: one queue.
    const other = ns.get(ns.idFromName("a"));

    const calls = range(30).map(i => (i % 2 ? other : stub).push(i));
    expect(await Promise.all(calls)).toEqual(range(30));
    expect(log).toEqual(range(30).map(i => "sync" + i));

    log.length = 0;
    const mixed = range(12).map(i => (i % 3 === 0 ? stub.push(i) : other.pushAsync(i)));
    expect(await Promise.all(mixed)).toEqual(range(12));
    // Events start in the order the calls were made, whatever their ends do.
    expect(log.filter(entry => !entry.startsWith("end")).map(entry => +entry.replace(/\D+/, ""))).toEqual(range(12));
    expect(log.filter(entry => entry.startsWith("end")).length).toBe(8);
  });

  test("the first call on a loaded idle object starts on the caller's stack", async () => {
    const log: string[] = [];
    class SyncStart extends Bun.DurableObject<{ log: string[] }> {
      constructor(ctx: Bun.DurableObjectState, env: { log: string[] }) {
        super(ctx, env);
        env.log.push("constructor");
      }
      touch(what: string) {
        this.env.log.push(what);
        return what;
      }
      async touchAsync(what: string) {
        this.env.log.push(what + ":before-await");
        await 1;
        this.env.log.push(what + ":after-await");
      }
    }
    await using ns = new Bun.DurableObjectNamespace<SyncStart>({ class: SyncStart, env: { log } });
    const stub = ns.getByName("a");
    expect(log).toEqual([]);

    // Not loaded, class mode: constructs and runs right here.
    const first = stub.touch("first");
    expect(log).toEqual(["constructor", "first"]);
    expect(first).toBeInstanceOf(Promise);
    expect(await first).toBe("first");

    // Loaded and idle: runs right here.
    const second = stub.touch("second");
    expect(log).toEqual(["constructor", "first", "second"]);
    await second;

    const third = stub.touchAsync("third");
    expect(log.at(-1)).toBe("third:before-await");
    // Busy now: the next one waits.
    const fourth = stub.touch("fourth");
    expect(log.at(-1)).toBe("third:before-await");
    await Promise.all([third, fourth]);
    expect(log.slice(3)).toEqual(["third:before-await", "third:after-await", "fourth"]);

    // Another object of the same namespace is not loaded by any of this.
    expect(log.filter(entry => entry === "constructor")).toHaveLength(1);
    const otherFirst = ns.getByName("b").touch("b-first");
    expect(log.slice(-2)).toEqual(["constructor", "b-first"]);
    await otherFirst;
  });

  test("50 concurrent increments through awaited storage lose nothing", async () => {
    class Inc extends Bun.DurableObject {
      async inc() {
        const n = ((await this.ctx.storage.get<number>("n")) ?? 0) + 1;
        await this.ctx.storage.put("n", n);
        return n;
      }
      async total() {
        return await this.ctx.storage.get<number>("n");
      }
    }
    await using ns = new Bun.DurableObjectNamespace<Inc>({ class: Inc });
    const a = ns.getByName("a");
    const b = ns.getByName("b");
    const calls: Promise<number>[] = [];
    for (let i = 0; i < 50; i++) {
      calls.push(a.inc());
      if (i % 5 === 0) calls.push(b.inc());
    }
    const results = await Promise.all(calls);
    expect(await a.total()).toBe(50);
    expect(await b.total()).toBe(10);
    // Every value 1..50 handed out once, in order.
    const seenA: number[] = [];
    const seenB: number[] = [];
    let at = 0;
    for (let i = 0; i < 50; i++) {
      seenA.push(results[at++]);
      if (i % 5 === 0) seenB.push(results[at++]);
    }
    expect(seenA).toEqual(range(50).map(i => i + 1));
    expect(seenB).toEqual(range(10).map(i => i + 1));
  });

  test("awaits on real I/O let other events in", async () => {
    class Interleave extends Bun.DurableObject<{ log: string[] }> {
      flag = false;
      async waitForFlag() {
        this.env.log.push("wait:start");
        const deadline = Date.now() + 5000;
        while (!this.flag && Date.now() < deadline) await Bun.sleep(1);
        this.env.log.push("wait:end");
        return this.flag;
      }
      setFlag() {
        this.env.log.push("setFlag");
        this.flag = true;
      }
      async slowInc() {
        const n = (await this.ctx.storage.get<number>("n")) ?? 0;
        await Bun.sleep(5);
        await this.ctx.storage.put("n", n + 1);
        return n + 1;
      }
    }
    const log: string[] = [];
    await using ns = new Bun.DurableObjectNamespace<Interleave>({ class: Interleave, env: { log } });
    const stub = ns.getByName("a");
    const [flag] = await Promise.all([stub.waitForFlag(), stub.setFlag()]);
    expect(flag).toBe(true);
    expect(log).toEqual(["wait:start", "setFlag", "wait:end"]);
    // Like Cloudflare: read, sleep, write is not atomic.
    expect(await Promise.all([stub.slowInc(), stub.slowInc(), stub.slowInc()])).toEqual([1, 1, 1]);
  });

  test("a synchronous method still gives a promise", async () => {
    class Plain extends Bun.DurableObject {
      number() {
        return 7;
      }
      nothing() {}
      object() {
        return { then: undefined, a: 1 };
      }
      throws() {
        throw new RangeError("sync throw");
      }
      get getter() {
        return "got";
      }
    }
    await using ns = new Bun.DurableObjectNamespace<Plain>({ class: Plain });
    const stub = ns.getByName("a");
    for (const promise of [stub.number(), stub.nothing(), stub.object()]) expect(promise).toBeInstanceOf(Promise);
    expect(await stub.number()).toBe(7);
    expect(await stub.nothing()).toBeUndefined();
    expect(await stub.object()).toEqual({ then: undefined, a: 1 });
    // A synchronous throw is a rejection, not an exception at the call site.
    const thrown = stub.throws();
    expect(thrown).toBeInstanceOf(Promise);
    expect(await rejection(thrown)).toBeInstanceOf(RangeError);
    expect(await stub.getter).toBe("got");
    expect(await stub.number()).toBe(7);
  });
});

describe("re-entrancy", () => {
  type Env = { log: string[]; ns?: Bun.DurableObjectNamespace<any> };
  class Reentrant extends Bun.DurableObject<Env> {
    graph = Bun.ModuleGraph.current;
    get self() {
      return this.env.ns!.get(this.ctx.id);
    }
    inner(tag: string) {
      this.env.log.push(`inner(${tag}) in-own-graph=${Bun.ModuleGraph.current === this.graph}`);
      return tag;
    }
    async outer() {
      this.env.log.push("outer:start");
      const nested = this.self.inner("from-method");
      this.env.log.push("outer:after-call");
      const result = await nested;
      this.env.log.push(`outer:end in-own-graph=${Bun.ModuleGraph.current === this.graph}`);
      return result;
    }
    async outerTwice() {
      // Two nested calls and one from outside, all while this event is running.
      const [a, b] = await Promise.all([this.self.inner("n1"), this.self.inner("n2")]);
      return [a, b];
    }
    async fromTimer() {
      this.env.log.push("timer:armed");
      const result = await new Promise<string>((resolve, reject) => {
        setTimeout(() => {
          this.env.log.push(`timer:fired in-own-graph=${Bun.ModuleGraph.current === this.graph}`);
          const nested = this.self.inner("from-timer");
          this.env.log.push("timer:after-call");
          nested.then(resolve, reject);
        }, 1);
      });
      this.env.log.push("timer:end");
      return result;
    }
    armIdleTimer() {
      // Fires after this event is over.
      setTimeout(async () => {
        const before = Bun.ModuleGraph.current === this.graph;
        const result = await this.self.inner("from-idle-timer");
        this.env.log.push(`idle-timer:done ${result} in-own-graph=${before && Bun.ModuleGraph.current === this.graph}`);
      }, 1);
    }
  }

  test("an object calling its own stub is queued behind the running event and does not deadlock", async () => {
    const env: Env = { log: [] };
    await using ns = new Bun.DurableObjectNamespace<Reentrant>({ class: Reentrant, env });
    env.ns = ns;
    const stub = ns.getByName("a");
    expect(await stub.outer()).toBe("from-method");
    expect(env.log).toEqual([
      "outer:start",
      "outer:after-call",
      "inner(from-method) in-own-graph=true",
      "outer:end in-own-graph=true",
    ]);

    env.log.length = 0;
    const [nested, outside] = await Promise.all([stub.outerTwice(), stub.inner("outside")]);
    expect(nested).toEqual(["n1", "n2"]);
    expect(outside).toBe("outside");
    expect(env.log.map(entry => entry.slice(0, entry.indexOf(")") + 1))).toEqual([
      "inner(n1)",
      "inner(n2)",
      "inner(outside)",
    ]);
  });

  test("from a timer of the object too", async () => {
    const env: Env = { log: [] };
    await using ns = new Bun.DurableObjectNamespace<Reentrant>({ class: Reentrant, env });
    env.ns = ns;
    const stub = ns.getByName("a");
    expect(await stub.fromTimer()).toBe("from-timer");
    expect(env.log).toEqual([
      "timer:armed",
      "timer:fired in-own-graph=true",
      "timer:after-call",
      "inner(from-timer) in-own-graph=true",
      "timer:end",
    ]);

    env.log.length = 0;
    await stub.armIdleTimer();
    await until(() => env.log.some(entry => entry.startsWith("idle-timer:done")), "the idle timer's call");
    expect(env.log).toEqual([
      "inner(from-idle-timer) in-own-graph=true",
      "idle-timer:done from-idle-timer in-own-graph=true",
    ]);
  });
});

describe("object to object", () => {
  type Env = {
    log: string[];
    made: Record<string, number>;
    ticks: Record<string, number>;
    next?: Bun.DurableObjectNamespace<any>;
    release?: boolean;
    held?: string[];
  };
  class Link extends Bun.DurableObject<Env> {
    graph = Bun.ModuleGraph.current;
    label: string;
    constructor(ctx: Bun.DurableObjectState, env: Env) {
      super(ctx, env);
      this.label = ctx.id.name!;
      env.made[this.label] = (env.made[this.label] ?? 0) + 1;
    }
    here(hop: string) {
      const current = Bun.ModuleGraph.current;
      this.env.log.push(`${this.label}:${hop}:${current !== undefined && current === this.graph ? "own" : "WRONG"}`);
    }
    // a -> b -> c: every object appends its name on the way back.
    async chain(path: string[]): Promise<{ path: string; graphs: unknown[] }> {
      this.here("enter");
      const [, ...rest] = path;
      if (rest.length === 0) {
        await Bun.sleep(1);
        this.here("leaf-after-sleep");
        return { path: this.label, graphs: [this.graph] };
      }
      const pending = this.env.next!.getByName(rest[0]).chain(rest);
      // The callee may have started on this stack; this is still this object.
      this.here("after-call");
      const result = await pending;
      this.here("after-await");
      await this.ctx.storage.put("last", result.path);
      this.here("after-storage");
      return { path: this.label + ">" + result.path, graphs: [this.graph, ...result.graphs] };
    }
    async hang() {
      this.here("hang");
      await Bun.sleep(60_000);
      return "never";
    }
    async callHang(target: string) {
      try {
        return await this.env.next!.getByName(target).hang();
      } finally {
        this.here("callHang-finally");
      }
    }
    async callThrow(target: string, error: Error) {
      return await this.env.next!.getByName(target).fail(error);
    }
    fail(error: Error) {
      throw error;
    }
    die(reason: string | Error) {
      this.ctx.abort(reason);
    }
    startTicking() {
      setInterval(() => {
        this.env.ticks[this.label] = (this.env.ticks[this.label] ?? 0) + 1;
        if (Bun.ModuleGraph.current !== this.graph) this.env.log.push(`${this.label}:tick:WRONG`);
      }, 2);
    }
    async hold() {
      this.env.held!.push(this.label + ":holding");
      while (!this.env.release) await Bun.sleep(2);
      this.env.held!.push(this.label + ":released");
    }
    async startOther(target: string) {
      this.startTicking();
      const other = this.env.next!.getByName(target);
      await other.startTicking();
      // Not awaited: keeps the other object busy after this one is gone.
      other.hold();
    }
    ping() {
      return this.label;
    }
  }

  test("a calls b calls c and results flow back, every hop in its own object", async () => {
    const env: Env = { log: [], made: {}, ticks: {} };
    await using ns = new Bun.DurableObjectNamespace<Link>({ class: Link, env });
    env.next = ns;
    const result = await ns.getByName("a").chain(["a", "b", "c"]);
    expect(Bun.ModuleGraph.current).toBeUndefined();
    expect(result.path).toBe("a>b>c");
    expect(new Set(result.graphs).size).toBe(3);
    expect(result.graphs.every(graph => graph instanceof Bun.ModuleGraph)).toBe(true);
    expect(env.log.filter(entry => entry.endsWith("WRONG"))).toEqual([]);
    expect(env.log.slice().sort()).toEqual(
      [
        "a:enter:own",
        "a:after-call:own",
        "a:after-await:own",
        "a:after-storage:own",
        "b:enter:own",
        "b:after-call:own",
        "b:after-await:own",
        "b:after-storage:own",
        "c:enter:own",
        "c:leaf-after-sleep:own",
      ].sort(),
    );
    expect(env.made).toEqual({ a: 1, b: 1, c: 1 });

    // Now that all three are loaded and idle the whole descent is synchronous; same answers.
    env.log.length = 0;
    const again = await Promise.all([
      ns.getByName("a").chain(["a", "b", "c"]),
      ns.getByName("c").chain(["c", "a"]),
      ns.getByName("b").chain(["b"]),
    ]);
    expect(again.map(r => r.path)).toEqual(["a>b>c", "c>a", "b"]);
    expect(env.log.filter(entry => entry.endsWith("WRONG"))).toEqual([]);
    expect(env.made).toEqual({ a: 1, b: 1, c: 1 });
  });

  test("a ring of objects relaying 8 messages at once: every hop runs in the object it was sent to", async () => {
    type RingEnv = { ns?: Bun.DurableObjectNamespace<any>; size: number; bad: string[]; hops: number };
    class Node extends Bun.DurableObject<RingEnv> {
      graph = Bun.ModuleGraph.current;
      index = Number(this.ctx.id.name);
      received = 0;
      check(hop: string, expected: number) {
        this.env.hops++;
        const current = Bun.ModuleGraph.current;
        if (current !== this.graph || current === undefined) this.env.bad.push(`node ${expected} ${hop}: wrong graph`);
        if (this.index !== expected) this.env.bad.push(`node ${expected} ${hop}: ran in node ${this.index}`);
      }
      async relay(expected: number, hopsLeft: number, trail: number[]): Promise<number[]> {
        this.check("enter", expected);
        this.received++;
        trail.push(this.index);
        this.ctx.storage.kv.put("received", (this.ctx.storage.kv.get<number>("received") ?? 0) + 1);
        if (hopsLeft === 0) return trail;
        if (hopsLeft % 3 === 0) {
          await Bun.sleep(1);
          this.check("after sleep", expected);
        }
        const next = (this.index + 1) % this.env.size;
        // The same array goes all the way round: arguments are passed as they are.
        const pending = this.env.ns!.getByName(String(next)).relay(next, hopsLeft - 1, trail);
        this.check("after call", expected);
        const result = await pending;
        this.check("after await", expected);
        if (result !== trail) this.env.bad.push(`node ${expected}: got somebody else's trail back`);
        return result;
      }
      count() {
        return [this.received, this.ctx.storage.kv.get<number>("received")];
      }
    }
    const size = 8;
    const hops = 20;
    const env: RingEnv = { size, bad: [], hops: 0 };
    await using ns = new Bun.DurableObjectNamespace<Node>({ class: Node, env });
    env.ns = ns;
    const trails = await Promise.all(range(size).map(start => ns.getByName(String(start)).relay(start, hops, [])));
    expect(Bun.ModuleGraph.current).toBeUndefined();
    expect(env.bad).toEqual([]);
    for (const [start, trail] of trails.entries()) expect(trail).toEqual(range(hops + 1).map(i => (start + i) % size));
    // 8 messages x 21 visits, spread evenly over the ring.
    for (const index of range(size)) expect(await ns.getByName(String(index)).count()).toEqual([21, 21]);
  });

  test("an error thrown by the callee arrives as the same object; an aborted callee rejects the caller's call", async () => {
    const env: Env = { log: [], made: {}, ticks: {} };
    await using ns = new Bun.DurableObjectNamespace<Link>({ class: Link, env });
    env.next = ns;
    const a = ns.getByName("a");
    const b = ns.getByName("b");
    const error = new TypeError("from b");
    expect(await rejection(a.callThrow("b", error))).toBe(error);

    const waiting = track(a.callHang("b"));
    await until(() => env.log.includes("b:hang:own"), "b to be in hang()");
    expect(waiting.state).toBe("pending");
    const aborted = await rejection(b.die("b was reset"));
    expect(aborted.code).toBe(RESET);
    await until(() => waiting.state !== "pending", "a's call to settle");
    expect(waiting.state).toBe("rejected");
    expect(waiting.reason.code).toBe(RESET);
    expect(waiting.reason.message).toContain("b was reset");
    // a saw the rejection in its own context and is still the same instance.
    expect(env.log).toContain("a:callHang-finally:own");
    expect(await a.ping()).toBe("a");
    expect(await b.ping()).toBe("b");
    expect(env.made).toEqual({ a: 1, b: 2 });
  });

  test("an object started by another object is not owned by it", async () => {
    const envA: Env = { log: [], made: {}, ticks: {} };
    const envB: Env = { log: envA.log, made: envA.made, ticks: envA.ticks, held: [], release: false };
    await using starters = new Bun.DurableObjectNamespace<Link>({
      class: Link,
      name: "starters",
      env: envA,
      idleTimeout: 20,
    });
    await using started = new Bun.DurableObjectNamespace<Link>({
      class: Link,
      name: "started",
      env: envB,
      idleTimeout: 20,
    });
    envA.next = started;
    const a = starters.getByName("a");
    await a.startOther("b");
    await until(() => envB.held!.includes("b:holding"), "b to be holding");
    await until(() => envA.ticks.a > 0 && envA.ticks.b > 0, "both to tick");

    // a has nothing to do and is evicted; its own timer goes with it.
    await untilReconstructed(
      () => a.ping(),
      () => envA.made.a,
      20,
    );
    expect(envA.made).toEqual({ a: 2, b: 1 });
    const aTicks = envA.ticks.a;

    // b was loaded from inside a's context. It is its own object: still busy, still ticking.
    const bTicks = envA.ticks.b;
    await until(() => envA.ticks.b >= bTicks + 10, "b to keep ticking after a was evicted");
    expect(envB.held).toEqual(["b:holding"]);
    expect(envA.ticks.a).toBe(aTicks);
    expect(await started.getByName("b").ping()).toBe("b");
    expect(envA.made).toEqual({ a: 2, b: 1 });

    envB.release = true;
    await until(() => envB.held!.includes("b:released"), "b's hold() to finish");
    expect(envA.log.filter(entry => entry.endsWith("WRONG"))).toEqual([]);

    // With nothing left to do b goes too, and takes its timer.
    await untilReconstructed(
      () => started.getByName("b").ping(),
      () => envA.made.b,
      20,
    );
    const after = envA.ticks.b;
    await untilReconstructed(
      () => started.getByName("b").ping(),
      () => envA.made.b,
      20,
    );
    expect(envA.ticks.b).toBe(after);
  });
});

describe("Bun.ModuleGraph.current", () => {
  type Env = {
    bad: string[];
    hops: { n: number };
    made: Record<string, number>;
    graphs: Map<string, unknown[]>;
  };

  // The same body for `class:` and `module:` namespaces; the module fixture adds module-level state.
  const tenantSource = (extraCheck: string) => `
    graph = Bun.ModuleGraph.current;
    name;
    calls = 0;
    constructor(ctx, env) {
      super(ctx, env);
      this.name = ctx.id.name;
      env.made[this.name] = (env.made[this.name] ?? 0) + 1;
      if (!env.graphs.has(this.name)) env.graphs.set(this.name, []);
      env.graphs.get(this.name).push(this.graph);
      if (this.graph === undefined) env.bad.push(this.name + ": no graph in the constructor");
    }
    check(hop, expected) {
      this.env.hops.n++;
      const current = Bun.ModuleGraph.current;
      if (current === undefined) this.env.bad.push(expected + ":" + hop + " ran in the host's context");
      else if (current !== this.graph) this.env.bad.push(expected + ":" + hop + " ran in another graph");
      if (this.name !== expected || this.ctx.id.name !== expected) this.env.bad.push(expected + ":" + hop + " ran in the object " + this.name);
      ${extraCheck}
    }
    async work(expected, seq) {
      this.check("entry", expected);
      await Bun.sleep(seq % 3);
      this.check("after sleep", expected);
      const n = (await this.ctx.storage.get("n")) ?? 0;
      this.check("after storage.get", expected);
      await this.ctx.storage.put("n", n + 1);
      this.check("after storage.put", expected);
      await new Promise(resolve => queueMicrotask(() => (this.check("microtask", expected), resolve())));
      await new Promise(resolve => setTimeout(() => (this.check("setTimeout", expected), resolve()), (seq + 1) % 3));
      await Promise.resolve(seq).then(() => this.check("then reaction", expected));
      await new Promise(resolve => setImmediate(() => (this.check("setImmediate", expected), resolve())));
      await new Promise(resolve => process.nextTick(() => (this.check("nextTick", expected), resolve())));
      await Promise.reject(new Error("x")).catch(() => this.check("catch reaction", expected));
      await this.ctx.storage.sync();
      this.check("after storage.sync", expected);
      this.calls++;
      this.ctx.storage.kv.put("calls", (this.ctx.storage.kv.get("calls") ?? 0) + 1);
      this.check("exit", expected);
      return { name: this.name, seq };
    }
    totals() {
      return { n: this.ctx.storage.kv.get("n"), calls: this.ctx.storage.kv.get("calls"), inMemory: this.calls };
    }
  `;
  const HOPS_PER_CALL = 12;

  const Tenant = new Function("DurableObject", `return class Tenant extends DurableObject {${tenantSource("")}}`)(
    Bun.DurableObject,
  );

  const newEnv = (): Env => ({ bad: [], hops: { n: 0 }, made: {}, graphs: new Map() });

  async function hammer(ns: Bun.DurableObjectNamespace<any>, env: Env, objects: number, callsEach: number) {
    const names = range(objects).map(i => "tenant-" + i);
    const hostBad: string[] = [];
    const calls: Promise<unknown>[] = [];
    // Round-robin so that every object's events overlap every other object's.
    for (let seq = 0; seq < callsEach; seq++) {
      for (const name of names) {
        const call = ns.getByName(name).work(name, seq);
        if (Bun.ModuleGraph.current !== undefined) hostBad.push("host is in a graph right after calling " + name);
        calls.push(
          call.then((result: { name: string; seq: number }) => {
            if (Bun.ModuleGraph.current !== undefined) hostBad.push("host reaction ran in a graph after " + name);
            if (result.name !== name || result.seq !== seq)
              hostBad.push(`${name}#${seq} was answered by ${result.name}#${result.seq}`);
          }),
        );
      }
    }
    await Promise.all(calls);
    expect(Bun.ModuleGraph.current).toBeUndefined();
    expect(hostBad).toEqual([]);
    expect(env.bad).toEqual([]);
    return names;
  }

  test("20 objects x 10 overlapping calls: every continuation, timer, microtask and reaction runs in its own object", async () => {
    const env = newEnv();
    await using ns = new Bun.DurableObjectNamespace<any>({ class: Tenant, env });
    const names = await hammer(ns, env, 20, 10);
    expect(env.hops.n).toBe(20 * 10 * HOPS_PER_CALL);
    for (const name of names) {
      expect(await ns.getByName(name).totals()).toEqual({ n: 10, calls: 10, inMemory: 10 });
      expect(Bun.ModuleGraph.current).toBeUndefined();
    }
    expect(env.made).toEqual(Object.fromEntries(names.map(name => [name, 1])));
    const graphs = [...env.graphs.values()].flat();
    expect(graphs).toHaveLength(20);
    expect(new Set(graphs).size).toBe(20);
    expect(graphs.every(graph => graph instanceof Bun.ModuleGraph)).toBe(true);
  }, 30_000);

  test("with evictions between the waves: a new instance has a new graph and the counters still add up", async () => {
    const env = newEnv();
    await using ns = new Bun.DurableObjectNamespace<any>({ class: Tenant, env, idleTimeout: 5 });
    const waves = 3;
    let names: string[] = [];
    for (let wave = 0; wave < waves; wave++) {
      names = await hammer(ns, env, 10, 4);
      if (wave < waves - 1)
        await untilReconstructed(
          () => ns.getByName("tenant-0").totals(),
          () => env.made["tenant-0"],
          5,
        );
    }
    // Storage is the truth; the in-memory count is only what the last instance saw.
    let reconstructed = 0;
    for (const name of names) {
      const totals = await ns.getByName(name).totals();
      expect({ n: totals.n, calls: totals.calls }).toEqual({ n: 12, calls: 12 });
      if (totals.inMemory < 12) reconstructed++;
      const graphs = env.graphs.get(name)!;
      expect(new Set(graphs).size).toBe(graphs.length);
    }
    expect(reconstructed).toBeGreaterThan(0);
    const all = [...env.graphs.values()].flat();
    expect(new Set(all).size).toBe(all.length);
    expect(env.bad).toEqual([]);
  }, 30_000);

  test("module mode: every object has its own module state too", async () => {
    using dir = tempDir("do-concurrency-module", {
      "tenant.ts": `
        // Per object: the first caller owns this module instance.
        let owner;
        let moduleCalls = 0;
        const moduleGraph = Bun.ModuleGraph.current;
        export class Tenant extends Bun.DurableObject {${tenantSource(`
          owner ??= expected;
          moduleCalls++;
          if (owner !== expected) this.env.bad.push(expected + ":" + hop + " ran in " + owner + "'s module instance");
          if (moduleGraph !== current) this.env.bad.push(expected + ":" + hop + " module was evaluated in another graph");
        `)}
          moduleState() { return { owner, moduleCalls }; }
        }
      `,
    });
    const env = newEnv();
    await using ns = new Bun.DurableObjectNamespace<any>({
      module: join(String(dir), "tenant.ts"),
      export: "Tenant",
      env,
    });
    const names = await hammer(ns, env, 12, 6);
    for (const name of names) {
      expect(await ns.getByName(name).totals()).toEqual({ n: 6, calls: 6, inMemory: 6 });
      expect(await ns.getByName(name).moduleState()).toEqual({ owner: name, moduleCalls: 6 * HOPS_PER_CALL });
    }
    expect(env.made).toEqual(Object.fromEntries(names.map(name => [name, 1])));
    expect(new Set([...env.graphs.values()].flat()).size).toBe(12);
  }, 30_000);

  test("is undefined in the host after awaiting a call, and inside host callbacks the object calls", async () => {
    const seen: unknown[] = [];
    class Caller extends Bun.DurableObject<{ hostFunction: () => void; hostAsync: () => Promise<void> }> {
      graph = Bun.ModuleGraph.current;
      async run() {
        // A host function the object calls runs in the object's context (it is the caller's).
        this.env.hostFunction();
        await this.env.hostAsync();
        return Bun.ModuleGraph.current === this.graph;
      }
      current() {
        return Bun.ModuleGraph.current;
      }
    }
    const env = {
      hostFunction: () => void seen.push(Bun.ModuleGraph.current),
      hostAsync: async () => {
        await Bun.sleep(1);
        seen.push(Bun.ModuleGraph.current);
      },
    };
    await using ns = new Bun.DurableObjectNamespace<Caller>({ class: Caller, env });
    const a = ns.getByName("a");
    const b = ns.getByName("b");
    expect(Bun.ModuleGraph.current).toBeUndefined();
    const pending = a.run();
    expect(Bun.ModuleGraph.current).toBeUndefined();
    expect(await pending).toBe(true);
    expect(Bun.ModuleGraph.current).toBeUndefined();
    const graphA = await a.current();
    const graphB = await b.current();
    expect(Bun.ModuleGraph.current).toBeUndefined();
    expect(graphA).toBeInstanceOf(Bun.ModuleGraph);
    expect(graphB).toBeInstanceOf(Bun.ModuleGraph);
    expect(graphA).not.toBe(graphB);
    expect(seen).toEqual([graphA, graphA]);
    await Promise.all([a.current(), b.current()]).then(() => expect(Bun.ModuleGraph.current).toBeUndefined());
    setTimeout(() => seen.push("host timer", Bun.ModuleGraph.current), 0);
    await a.run();
    await until(() => seen.includes("host timer"), "the host's timer");
    expect(seen[seen.indexOf("host timer") + 1]).toBeUndefined();
    expect(seen.filter(entry => entry === graphA)).toHaveLength(4);
  });
});

describe("AsyncLocalStorage", () => {
  const als = new AsyncLocalStorage<string>();
  type Env = { other?: Bun.DurableObjectNamespace<any> };
  class Reader extends Bun.DurableObject<Env> {
    read() {
      return als.getStore();
    }
    async readAfterAwait() {
      const before = als.getStore();
      await Bun.sleep(1);
      return [before, als.getStore()];
    }
    async ownStore(target: string) {
      return await als.run("object " + this.ctx.id.name, async () => {
        const other = this.env.other!.getByName(target);
        const pending = other.read();
        const afterCall = als.getStore();
        const theirs = await pending;
        const theirsLater = await other.readAfterAwait();
        return { afterCall, theirs, theirsLater, mine: als.getStore() };
      });
    }
  }

  test("the caller's store is not visible inside the object and is intact after the await", async () => {
    const env: Env = {};
    await using ns = new Bun.DurableObjectNamespace<Reader>({ class: Reader, env });
    env.other = ns;
    const stub = ns.getByName("a");
    await als.run("host store", async () => {
      // Constructing, synchronous start.
      expect(await stub.read()).toBeUndefined();
      expect(als.getStore()).toBe("host store");
      // Loaded and idle, synchronous start.
      const pending = stub.read();
      expect(als.getStore()).toBe("host store");
      expect(await pending).toBeUndefined();
      // Queued.
      expect(await Promise.all([stub.readAfterAwait(), stub.read(), stub.read()])).toEqual([
        [undefined, undefined],
        undefined,
        undefined,
      ]);
      expect(als.getStore()).toBe("host store");
      await als.run("nested host store", async () => {
        expect(await stub.read()).toBeUndefined();
        expect(als.getStore()).toBe("nested host store");
      });
      expect(als.getStore()).toBe("host store");
    });
    expect(als.getStore()).toBeUndefined();
  });

  test("one object's store is not visible in another object it calls", async () => {
    const env: Env = {};
    await using ns = new Bun.DurableObjectNamespace<Reader>({ class: Reader, env });
    env.other = ns;
    await ns.getByName("b").read();
    const results = await Promise.all([
      ns.getByName("a").ownStore("b"),
      ns.getByName("c").ownStore("b"),
      ns.getByName("b").ownStore("a"),
    ]);
    expect(results).toEqual(
      ["a", "c", "b"].map(name => ({
        afterCall: "object " + name,
        theirs: undefined,
        theirsLater: [undefined, undefined],
        mine: "object " + name,
      })),
    );
  });
});

describe("blockConcurrencyWhile", () => {
  test("in the constructor: events wait for it and see what it loaded", async () => {
    const log: string[] = [];
    class Init extends Bun.DurableObject<{ log: string[] }> {
      loaded?: string;
      graph = Bun.ModuleGraph.current;
      constructor(ctx: Bun.DurableObjectState, env: { log: string[] }) {
        super(ctx, env);
        env.log.push("constructor");
        ctx.blockConcurrencyWhile(async () => {
          env.log.push("init:start");
          await Bun.sleep(5);
          this.loaded = (await ctx.storage.get<string>("value")) ?? "default";
          env.log.push(`init:end in-own-graph=${Bun.ModuleGraph.current === this.graph}`);
        });
        env.log.push("constructor:end");
      }
      get(tag: string) {
        this.env.log.push("get:" + tag);
        return this.loaded;
      }
      async set(value: string) {
        await this.ctx.storage.put("value", value);
      }
    }
    await using ns = new Bun.DurableObjectNamespace<Init>({ class: Init, env: { log }, idleTimeout: 10 });
    const stub = ns.getByName("a");
    const calls = [stub.get("1"), stub.get("2"), stub.get("3")];
    // The constructor ran on this stack; the events did not.
    expect(log).toEqual(["constructor", "init:start", "constructor:end"]);
    expect(await Promise.all(calls)).toEqual(["default", "default", "default"]);
    expect(log).toEqual([
      "constructor",
      "init:start",
      "constructor:end",
      "init:end in-own-graph=true",
      "get:1",
      "get:2",
      "get:3",
    ]);

    await stub.set("stored");
    await untilReconstructed(
      () => stub.get("again"),
      () => log.filter(entry => entry === "constructor").length,
      10,
    );
    expect(await stub.get("after")).toBe("stored");
  });

  test("in a method: other events wait; gives the callback's value; synchronous callbacks; nesting", async () => {
    const log: string[] = [];
    class Blocker extends Bun.DurableObject<{ log: string[] }> {
      async locked() {
        this.env.log.push("locked:start");
        const value = await this.ctx.blockConcurrencyWhile(async () => {
          this.env.log.push("block:start");
          // Real I/O: without the block the next event would come in here.
          await Bun.sleep(10);
          this.env.log.push("block:end");
          return "from callback";
        });
        return value;
      }
      other(tag: string) {
        this.env.log.push("other:" + tag);
        return tag;
      }
      async syncCallback() {
        const pending = this.ctx.blockConcurrencyWhile(() => 7);
        return [pending instanceof Promise, await pending];
      }
      async nested() {
        return await this.ctx.blockConcurrencyWhile(async () => {
          this.env.log.push("outer:start");
          const inner = await this.ctx.blockConcurrencyWhile(async () => {
            this.env.log.push("inner:start");
            await Bun.sleep(5);
            this.env.log.push("inner:end");
            return 1;
          });
          await Bun.sleep(5);
          this.env.log.push("outer:end");
          return inner + 1;
        });
      }
    }
    await using ns = new Bun.DurableObjectNamespace<Blocker>({ class: Blocker, env: { log } });
    const stub = ns.getByName("a");
    expect(await Promise.all([stub.locked(), stub.other("1"), stub.other("2")])).toEqual(["from callback", "1", "2"]);
    expect(log).toEqual(["locked:start", "block:start", "block:end", "other:1", "other:2"]);

    expect(await stub.syncCallback()).toEqual([true, 7]);

    log.length = 0;
    expect(await Promise.all([stub.nested(), stub.other("3")])).toEqual([2, "3"]);
    expect(log).toEqual(["outer:start", "inner:start", "inner:end", "outer:end", "other:3"]);

    // Another object is not blocked by this one's block.
    log.length = 0;
    const [, fromB] = await Promise.all([stub.locked(), ns.getByName("b").other("b")]);
    expect(fromB).toBe("b");
    expect(log.indexOf("other:b")).toBeLessThan(log.indexOf("block:end"));
  });

  test("a rejection resets the object: running and queued calls reject with that error, the next call constructs again", async () => {
    let made = 0;
    const log: string[] = [];
    const ticks: number[] = [];
    class Resets extends Bun.DurableObject {
      generation = ++made;
      mem = 0;
      async failBlock(error: unknown, rejectAfter: number) {
        this.mem = 1;
        setInterval(() => ticks.push(this.generation), 2);
        return await this.ctx.blockConcurrencyWhile(async () => {
          if (rejectAfter) await Bun.sleep(rejectAfter);
          throw error;
        });
      }
      async slow() {
        log.push("slow:start");
        await Bun.sleep(60_000);
        return "never";
      }
      quick() {
        log.push("quick");
        return [this.generation, this.mem];
      }
    }
    await using ns = new Bun.DurableObjectNamespace<Resets>({ class: Resets });
    const stub = ns.getByName("a");
    const bystander = ns.getByName("bystander");
    expect(await bystander.quick()).toEqual([1, 0]);

    // Rejecting after real I/O, and rejecting without having awaited anything.
    for (const rejectAfter of [5, 0]) {
      log.length = 0;
      const error = new Error("init failed " + rejectAfter);
      const running = stub.slow();
      const before = made;
      await until(() => log.includes("slow:start"), "slow() to start");
      const results = await Promise.allSettled([
        running,
        stub.failBlock(error, rejectAfter),
        stub.quick(),
        stub.quick(),
      ]);
      expect(results.map(result => result.status)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
      for (const result of results) expect((result as PromiseRejectedResult).reason).toBe(error);
      expect(log).toEqual(["slow:start"]);
      expect(made).toBe(before);

      // A new instance: the field and the timer of the old one are gone.
      expect(await stub.quick()).toEqual([before + 1, 0]);
      expect(made).toBe(before + 1);
      const last = ticks.length;
      await bystander.quick();
      expect(ticks.slice(last)).toEqual([]);
    }
    expect(await bystander.quick()).toEqual([1, 0]);
  });

  // A failed block is reported to the callers, by their calls rejecting. These run in a process of their
  // own to see that nothing else is reported: a stray unhandled rejection takes a server down.
  const prelude = `
    process.on("uncaughtException", e => console.log("PROCESS uncaughtException:", e?.message));
    process.on("unhandledRejection", e => console.log("PROCESS unhandledRejection:", e?.message));
    const settle = async calls => (await Promise.allSettled(calls)).map(r => (r.status === "rejected" ? "rejected: " + r.reason?.message : r.value));
    const turns = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); Bun.gc(true); await Bun.sleep(1); };
  `;

  test.each([false, true])(
    "a rejection in the constructor's block fails the waiting calls, and only them (onError: %p)",
    async withOnError => {
      const script = `${prelude}
      let made = 0;
      const error = new Error("cannot load");
      class FailsFirst extends Bun.DurableObject {
        constructor(ctx, env) {
          super(ctx, env);
          const attempt = ++made;
          // Ignoring the promise, as constructors do.
          ctx.blockConcurrencyWhile(async () => {
            await Bun.sleep(2);
            if (attempt === 1) throw error;
          });
        }
        ok() { return "ok from instance " + made; }
      }
      const ns = new Bun.DurableObjectNamespace({ class: FailsFirst, onError: ${withOnError} ? (e, id) => console.error("onError:", e?.message, id.name) : undefined });
      const stub = ns.getByName("a");
      const results = await Promise.allSettled([stub.ok(), stub.ok(), stub.ok()]);
      console.log("same error object:", results.every(r => r.status === "rejected" && r.reason === error), "made:", made);
      await turns();
      console.log(JSON.stringify(await settle([stub.ok(), stub.ok()])), "made:", made);
      await turns();
      await ns.close();
      console.log("closed");
    `;
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.split("\n")).toEqual([
        "same error object: true made: 1",
        '["ok from instance 2","ok from instance 2"] made: 2',
        "closed",
        "",
      ]);
      if (!withOnError) expect(stderr).not.toContain("cannot load");
      expect(exitCode).toBe(0);
    },
  );

  test("a callback that throws synchronously resets the object like a rejection, and is reported to the callers only", async () => {
    const script = `${prelude}
      let made = 0;
      const error = new Error("sync fail");
      class Resets extends Bun.DurableObject {
        generation = ++made;
        async slow() { await Bun.sleep(60_000); return "never"; }
        quick() { return "quick from instance " + this.generation; }
        async failBlock() {
          // Awaited: whatever it gives back is handled.
          return await this.ctx.blockConcurrencyWhile(() => { throw error; });
        }
      }
      const ns = new Bun.DurableObjectNamespace({ class: Resets });
      const stub = ns.getByName("a");
      const results = await Promise.allSettled([stub.slow(), stub.failBlock(), stub.quick(), stub.quick()]);
      console.log("same error object:", results.every(r => r.status === "rejected" && r.reason === error), "made:", made);
      await turns();
      console.log(JSON.stringify(await settle([stub.quick()])), "made:", made);
      await turns();
      await ns.close();
      console.log("closed");
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.split("\n")).toEqual([
      "same error object: true made: 1",
      '["quick from instance 2"] made: 2',
      "closed",
      "",
    ]);
    expect(stderr).not.toContain("sync fail");
    expect(exitCode).toBe(0);
  });
});

describe("abort", () => {
  class MyError extends Error {
    name = "MyError";
  }
  type Env = { made: number; ticks: number[]; leaked: Bun.DurableObjectState[]; caught?: unknown; log: string[] };
  class Abortable extends Bun.DurableObject<Env> {
    generation: number;
    constructor(ctx: Bun.DurableObjectState, env: Env) {
      super(ctx, env);
      this.generation = ++env.made;
      env.leaked.push(ctx);
      const generation = this.generation;
      setInterval(() => env.ticks.push(generation), 2);
    }
    die(reason?: string | Error) {
      this.ctx.storage.kv.put("uncommitted", "written right before abort()");
      try {
        this.ctx.abort(reason);
      } catch (e) {
        this.env.caught = e;
        throw e;
      }
      this.env.log.push("abort() returned");
    }
    async sleeper(tag: string) {
      this.env.log.push("sleeper:" + tag);
      await Bun.sleep(60_000);
      this.env.log.push("sleeper woke");
      return "never";
    }
    async write(value: string) {
      await this.ctx.storage.put("committed", value);
    }
    read() {
      return {
        generation: this.generation,
        committed: this.ctx.storage.kv.get("committed"),
        uncommitted: this.ctx.storage.kv.get("uncommitted"),
      };
    }
  }
  const newEnv = (): Env => ({ made: 0, ticks: [], leaked: [], log: [] });

  test("throws inside the method; in-flight and queued calls reject; the next call is a fresh instance", async () => {
    const env = newEnv();
    await using ns = new Bun.DurableObjectNamespace<Abortable>({ class: Abortable, env });
    const stub = ns.getByName("a");
    const bystander = ns.getByName("bystander");
    await stub.write("kept");
    await bystander.write("bystander's");
    const bystanderSleeping = track(bystander.sleeper("bystander"));

    const sleeping = [stub.sleeper("1"), stub.sleeper("2")];
    await until(() => env.log.includes("sleeper:2"), "both sleepers to be in flight");
    const results = await Promise.allSettled([...sleeping, stub.die("enough"), stub.read()]);
    expect(results.map(result => result.status)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
    for (const result of results) {
      const reason = (result as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(Error);
      expect(reason.code).toBe(RESET);
      expect(reason.message).toContain("enough");
    }
    expect(env.caught).toBe((results[2] as PromiseRejectedResult).reason);
    expect(env.log).not.toContain("abort() returned");
    expect(env.made).toBe(2);

    // Generation 1's timer is dead. Generation 3 (constructed by read()) ticks; when it has ticked 10 times, generation 1 must not have.
    const mark = env.ticks.length;
    expect(await stub.read()).toEqual({ generation: 3, committed: "kept", uncommitted: undefined });
    expect(env.made).toBe(3);
    await until(
      () => env.ticks.slice(mark).filter(generation => generation === 3).length >= 10,
      "the new instance's timer",
    );
    expect(env.ticks.slice(mark).filter(generation => generation === 1)).toEqual([]);
    expect(env.log).not.toContain("sleeper woke");

    // The other object never noticed.
    expect(bystanderSleeping.state).toBe("pending");
    expect(await bystander.read()).toEqual({ generation: 2, committed: "bystander's", uncommitted: undefined });
    expect(env.ticks.slice(mark)).toContain(2);
    await rejection(bystander.die());
  });

  test("with 12 objects busy, aborting half of them fails their calls and nobody else's", async () => {
    const env = newEnv();
    await using ns = new Bun.DurableObjectNamespace<Abortable>({ class: Abortable, env });
    const names = range(12).map(i => "object-" + i);
    for (const name of names) await ns.getByName(name).write("value of " + name);
    class Doomed extends Error {}
    const sleepers = names.flatMap(name => [
      track(ns.getByName(name).sleeper(name + "/1")),
      track(ns.getByName(name).sleeper(name + "/2")),
    ]);
    await until(() => env.log.length === 24, "all 24 sleepers to be in flight");
    const reasons = new Map(names.filter((_, i) => i % 2 === 1).map(name => [name, new Doomed(name + " is doomed")]));
    const aborts = await Promise.allSettled([...reasons].map(([name, reason]) => ns.getByName(name).die(reason)));
    expect(aborts.map(result => (result as PromiseRejectedResult).reason)).toEqual([...reasons.values()]);
    await until(
      () => sleepers.filter(sleeper => sleeper.state !== "pending").length >= 12,
      "the doomed objects' calls to reject",
    );
    for (const [i, sleeper] of sleepers.entries()) {
      const name = names[i >> 1];
      if (reasons.has(name)) {
        expect(sleeper.state).toBe("rejected");
        // Its own object's reason, not a neighbour's.
        expect(sleeper.reason).toBe(reasons.get(name));
      } else {
        expect(sleeper.state).toBe("pending");
      }
    }
    const generations = new Map(env.leaked.map((ctx, i) => [ctx.id.name!, i + 1]));
    for (const name of names) {
      const read = await ns.getByName(name).read();
      expect(read.committed).toBe("value of " + name);
      // The survivors are the instances they were; the doomed are new ones.
      if (reasons.has(name)) expect(read.generation).toBeGreaterThan(12);
      else expect(read.generation).toBe(generations.get(name)!);
    }
    expect(env.made).toBe(18);
    expect(env.log).not.toContain("sleeper woke");
    // Let close() finish: the survivors are still asleep.
    await Promise.allSettled(names.filter(name => !reasons.has(name)).map(name => ns.getByName(name).die()));
  });

  test("an Error reason is what the calls reject with", async () => {
    const env = newEnv();
    await using ns = new Bun.DurableObjectNamespace<Abortable>({ class: Abortable, env });
    const stub = ns.getByName("a");
    const mine = new MyError("my own");
    const sleeping = stub.sleeper("1");
    await until(() => env.log.includes("sleeper:1"), "the sleeper to be in flight");
    const results = await Promise.allSettled([sleeping, stub.die(mine), stub.read()]);
    expect(results.map(result => (result as PromiseRejectedResult).reason)).toEqual([mine, mine, mine]);
    expect(env.caught).toBe(mine);
    expect(mine.message).toBe("my own");
    expect((await stub.read()).generation).toBe(2);

    // Without a reason it is still a reset.
    const plain = await rejection(stub.die());
    expect(plain.code).toBe(RESET);
    expect((await stub.read()).generation).toBe(3);
  });

  test("from an async method, before or after its first await: the calls reject and nothing else is reported", async () => {
    // In a process of its own to see what reaches the process: a stray unhandled rejection takes a server down.
    const script = `
      process.on("uncaughtException", e => console.log("PROCESS uncaughtException:", e?.message));
      process.on("unhandledRejection", e => console.log("PROCESS unhandledRejection:", e?.message));
      let made = 0;
      class Abortable extends Bun.DurableObject {
        generation = ++made;
        async beforeAwait() { this.ctx.abort("before the first await"); }
        async afterAwait() { await Bun.sleep(1); this.ctx.abort("after an await"); }
        async afterStorage() { await this.ctx.storage.put("k", 1); this.ctx.abort("after a storage await"); }
        async sleeper() { await Bun.sleep(60_000); }
        ping() { return "instance " + this.generation; }
      }
      const ns = new Bun.DurableObjectNamespace({ class: Abortable, onError: (e, id) => console.log("onError:", e?.message) });
      const stub = ns.getByName("a");
      for (const method of ["beforeAwait", "afterAwait", "afterStorage"]) {
        const results = await Promise.allSettled([stub.sleeper(), stub[method](), stub.ping()]);
        console.log(method + ":", JSON.stringify(results.map(r => r.status === "rejected" ? r.reason?.code + ": " + r.reason?.message : r.value)));
        for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
        Bun.gc(true);
        console.log(await stub.ping());
      }
      await ns.close();
      console.log("closed");
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const all = (message: string) => JSON.stringify(range(3).map(() => `${RESET}: ${message}`));
    expect(stdout.split("\n")).toEqual([
      "beforeAwait: " + all("before the first await"),
      "instance 2",
      // ping() got in while afterAwait() slept; it was over before the reset.
      "afterAwait: " + JSON.stringify([`${RESET}: after an await`, `${RESET}: after an await`, "instance 2"]),
      "instance 3",
      "afterStorage: " + all("after a storage await"),
      "instance 4",
      "closed",
      "",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("references to the old ctx throw ERR_DURABLE_OBJECT_RESET", async () => {
    const env = newEnv();
    await using ns = new Bun.DurableObjectNamespace<Abortable>({ class: Abortable, env });
    const stub = ns.getByName("a");
    await stub.write("kept");
    const old = env.leaked[0];
    const oldStorage = old.storage;
    const oldKv = oldStorage.kv;
    const oldSql = oldStorage.sql;
    await rejection(stub.die("reset"));
    expect((await stub.read()).generation).toBe(2);

    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e: any) {
        return e.code;
      }
      return "did not throw";
    };
    expect(code(() => old.storage.kv.get("committed"))).toBe(RESET);
    expect(code(() => oldKv.get("committed"))).toBe(RESET);
    expect(code(() => oldKv.put("committed", "from a dead instance"))).toBe(RESET);
    expect(code(() => oldKv.delete("committed"))).toBe(RESET);
    expect(code(() => oldSql.exec("SELECT 1"))).toBe(RESET);
    expect(code(() => oldStorage.transactionSync(() => {}))).toBe(RESET);
    expect((await rejection((async () => oldStorage.get("committed"))())).code).toBe(RESET);
    expect((await rejection((async () => oldStorage.put("committed", "dead"))())).code).toBe(RESET);
    expect((await rejection((async () => oldStorage.deleteAll())())).code).toBe(RESET);
    expect((await rejection((async () => oldStorage.setAlarm(Date.now() + 1000))())).code).toBe(RESET);
    expect((await rejection((async () => old.blockConcurrencyWhile(async () => {}))())).code).toBe(RESET);
    expect(code(() => old.abort("again"))).toBe(RESET);
    // Either way is fine for these; they must not reach the new instance or crash.
    code(() => old.getWebSockets());
    code(() => old.waitUntil(Promise.resolve()));
    expect(old.id.name).toBe("a");

    // The new instance and its ctx are unharmed.
    expect(await stub.read()).toEqual({ generation: 2, committed: "kept", uncommitted: undefined });
    expect(env.leaked).toHaveLength(2);
    expect(env.leaked[1]).not.toBe(old);
  });
});

describe("a constructor that throws", () => {
  test("class mode: the call rejects with the error and a later call constructs again", async () => {
    const env = { made: 0, fail: true };
    class Fragile extends Bun.DurableObject<typeof env> {
      constructor(ctx: Bun.DurableObjectState, e: typeof env) {
        super(ctx, e);
        const attempt = ++e.made;
        if (e.fail) throw new Error("constructor failed #" + attempt);
      }
      ok() {
        return this.env.made;
      }
    }
    await using ns = new Bun.DurableObjectNamespace<Fragile>({ class: Fragile, env });
    const stub = ns.getByName("a");
    let calls!: Promise<number>[];
    // Not an exception at the call site.
    expect(() => (calls = [stub.ok(), stub.ok(), stub.ok()])).not.toThrow();
    const results = await Promise.allSettled(calls);
    expect(results.map(result => (result as PromiseRejectedResult).reason?.message)).toEqual([
      "constructor failed #1",
      "constructor failed #2",
      "constructor failed #3",
    ]);
    env.fail = false;
    expect(await stub.ok()).toBe(4);
    expect(await stub.ok()).toBe(4);
  });

  test("module mode: every call that was queued while it loaded rejects with that error", async () => {
    using dir = tempDir("do-concurrency-ctor", {
      "fragile.ts": `
        export default class Fragile extends Bun.DurableObject {
          constructor(ctx, env) {
            super(ctx, env);
            env.made++;
            if (env.made === 1) throw env.error;
          }
          ok() { return this.env.made; }
        }
      `,
    });
    const env = { made: 0, error: new Error("constructor failed once") };
    await using ns = new Bun.DurableObjectNamespace<any>({ module: join(String(dir), "fragile.ts"), env });
    const stub = ns.getByName("a");
    const results = await Promise.allSettled([stub.ok(), stub.ok(), stub.ok()]);
    expect(results.map(result => (result as PromiseRejectedResult).reason)).toEqual([env.error, env.error, env.error]);
    expect(env.made).toBe(1);
    expect(await Promise.all([stub.ok(), stub.ok()])).toEqual([2, 2]);
  });
});

describe("eviction", () => {
  test("an idle object is evicted: fields are gone, storage stays", async () => {
    let made = 0;
    class Forgetful extends Bun.DurableObject {
      generation = ++made;
      mem: string | undefined;
      async remember(value: string) {
        this.mem = value;
        await this.ctx.storage.put("value", value);
      }
      async recall() {
        return { generation: this.generation, mem: this.mem, stored: await this.ctx.storage.get("value") };
      }
    }
    await using ns = new Bun.DurableObjectNamespace<Forgetful>({ class: Forgetful, idleTimeout: 10 });
    const a = ns.getByName("a");
    const b = ns.getByName("b");
    await a.remember("a's");
    await b.remember("b's");
    expect(await a.recall()).toEqual({ generation: 1, mem: "a's", stored: "a's" });
    expect(await b.recall()).toEqual({ generation: 2, mem: "b's", stored: "b's" });
    await untilReconstructed(
      () => a.recall(),
      () => made,
      10,
    );
    const recalled = await a.recall();
    expect(recalled).toEqual({ generation: recalled.generation, mem: undefined, stored: "a's" });
    expect(recalled.generation).toBeGreaterThan(2);
    const recalledB = await b.recall();
    expect({ mem: recalledB.mem, stored: recalledB.stored }).toEqual({ mem: undefined, stored: "b's" });
  });

  test("an object with a call in progress is not evicted, however long the call takes", async () => {
    let made = 0;
    const ticks: number[] = [];
    class Busy extends Bun.DurableObject {
      generation = ++made;
      mem = "";
      async long(ms: number) {
        this.mem = "set before the wait";
        const timer = setInterval(() => ticks.push(this.generation), 2);
        const before = ticks.length;
        await Bun.sleep(ms);
        clearInterval(timer);
        return { mem: this.mem, made, generation: this.generation, ticked: ticks.length - before };
      }
      peek() {
        return { mem: this.mem, generation: this.generation };
      }
    }
    await using ns = new Bun.DurableObjectNamespace<Busy>({ class: Busy, idleTimeout: 20 });
    const stub = ns.getByName("a");
    // 5 x idleTimeout, and events keep arriving meanwhile or not: both.
    const result = await stub.long(100);
    expect(result).toEqual({ mem: "set before the wait", made: 1, generation: 1, ticked: result.ticked });
    expect(result.ticked).toBeGreaterThan(5);
    expect(await stub.peek()).toEqual({ mem: "set before the wait", generation: 1 });
    const [second, peeked] = await Promise.all([stub.long(100), stub.peek()]);
    expect(second.generation).toBe(1);
    expect(peeked.generation).toBe(1);
    expect(made).toBe(1);
  });

  test("waitUntil() keeps the object loaded until the promise settles", async () => {
    let made = 0;
    const steps: string[] = [];
    class Background extends Bun.DurableObject {
      generation = ++made;
      graph = Bun.ModuleGraph.current;
      start(count: number) {
        this.ctx.waitUntil(
          (async () => {
            for (let i = 0; i < count; i++) {
              // Timers of an evicted object never fire: this would stop short.
              await Bun.sleep(10);
              steps.push(`${i}:${this.generation}:${Bun.ModuleGraph.current === this.graph}`);
            }
          })(),
        );
        return "started";
      }
      ping() {
        return this.generation;
      }
    }
    await using ns = new Bun.DurableObjectNamespace<Background>({ class: Background, idleTimeout: 10 });
    const stub = ns.getByName("a");
    expect(await stub.start(12)).toBe("started");
    await until(() => steps.length >= 12, "the background work to finish (it takes 12 x idleTimeout)");
    expect(steps).toEqual(range(12).map(i => `${i}:1:true`));
    expect(made).toBe(1);
    // Then it is like any idle object.
    await untilReconstructed(
      () => stub.ping(),
      () => made,
      10,
    );
  });

  test("what the object opened is closed with it; the host's is not", async () => {
    type Env = { made: number; ticks: string[]; gate: Promise<void> };
    class Opener extends Bun.DurableObject<Env> {
      graph = Bun.ModuleGraph.current;
      generation: number;
      constructor(ctx: Bun.DurableObjectState, env: Env) {
        super(ctx, env);
        this.generation = ++env.made;
      }
      open() {
        const name = this.ctx.id.name;
        const inGraph = () => (Bun.ModuleGraph.current === this.graph ? "own graph" : "WRONG graph");
        setInterval(() => this.env.ticks.push(name + " " + inGraph()), 2);
        const http = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch: () => new Response(`http from ${name} in ${inGraph()}`),
        });
        const tcp = Bun.listen({
          port: 0,
          hostname: "127.0.0.1",
          socket: {
            open: socket => {
              socket.end(`tcp from ${name} in ${inGraph()}`);
            },
            data() {},
          },
        });
        // Stay loaded until the host says so.
        this.ctx.waitUntil(this.env.gate);
        return { http: http.port!, tcp: tcp.port };
      }
      ping() {
        return this.generation;
      }
    }

    const tcpRead = (port: number) =>
      new Promise<string>((resolve, reject) => {
        let received = "";
        Bun.connect({
          hostname: "127.0.0.1",
          port,
          socket: {
            data: (_, chunk) => void (received += chunk.toString()),
            close: () => resolve(received),
            error: (_, error) => reject(error),
            connectError: (_, error) => reject(error),
          },
        }).catch(reject);
      });
    const httpRead = (port: number) => fetch(`http://127.0.0.1:${port}/`).then(response => response.text());

    const gate = Promise.withResolvers<void>();
    const env: Env = { made: 0, ticks: [], gate: gate.promise };
    let hostTicks = 0;
    const hostTimer = setInterval(() => hostTicks++, 2);
    using hostServer = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("http from the host") });
    try {
      await using ns = new Bun.DurableObjectNamespace<Opener>({ class: Opener, env, idleTimeout: 10 });
      const a = await ns.getByName("a").open();
      const b = await ns.getByName("b").open();
      expect(await httpRead(a.http)).toBe("http from a in own graph");
      expect(await httpRead(b.http)).toBe("http from b in own graph");
      expect(await tcpRead(a.tcp)).toBe("tcp from a in own graph");
      expect(await tcpRead(b.tcp)).toBe("tcp from b in own graph");
      await until(() => env.ticks.includes("a own graph") && env.ticks.includes("b own graph"), "both objects' timers");
      // Held by waitUntil(): many idleTimeouts later everything is still there.
      const mark = env.ticks.length;
      await until(() => env.ticks.length >= mark + 40, "more ticks");
      expect(await httpRead(a.http)).toBe("http from a in own graph");
      expect(env.made).toBe(2);

      gate.resolve();
      const refused = async (read: Promise<string>) => {
        try {
          await read;
          return false;
        } catch {
          return true;
        }
      };
      await until(() => refused(httpRead(a.http)), "a's HTTP server to stop accepting");
      await until(() => refused(httpRead(b.http)), "b's HTTP server to stop accepting");
      await until(() => refused(tcpRead(a.tcp)), "a's TCP server to stop accepting");
      await until(() => refused(tcpRead(b.tcp)), "b's TCP server to stop accepting");
      // Their timers went as well: the host's timer runs on, theirs do not.
      const ticksAfter = env.ticks.length;
      const hostTicksAfter = hostTicks;
      await until(() => hostTicks >= hostTicksAfter + 20, "the host's timer");
      expect(env.ticks.length).toBe(ticksAfter);
      expect(env.ticks.filter(tick => tick.includes("WRONG"))).toEqual([]);
      expect(await httpRead(hostServer.port!)).toBe("http from the host");
      // And they come back as new instances that opened nothing.
      expect(await ns.getByName("a").ping()).toBe(3);
      expect(await ns.getByName("b").ping()).toBe(4);
      expect(await refused(httpRead(a.http))).toBe(true);
    } finally {
      clearInterval(hostTimer);
    }
  }, 30_000);

  test("idleTimeout: 0 evicts as soon as there is nothing to do, and no sooner", async () => {
    let made = 0;
    class Ephemeral extends Bun.DurableObject {
      generation = ++made;
      async inc() {
        const n = ((await this.ctx.storage.get<number>("n")) ?? 0) + 1;
        await Bun.sleep(1);
        await this.ctx.storage.put("n", n);
        return [this.generation, made];
      }
      async total() {
        return await this.ctx.storage.get<number>("n");
      }
    }
    await using ns = new Bun.DurableObjectNamespace<Ephemeral>({ class: Ephemeral, idleTimeout: 0 });
    const stub = ns.getByName("a");
    // Busy the whole time: one instance.
    expect(await stub.inc()).toEqual([1, 1]);
    await untilReconstructed(
      () => stub.total(),
      () => made,
      0,
    );
    const before = made;
    const results = await Promise.all(range(10).map(() => stub.inc()));
    expect(new Set(results.map(([generation]) => generation)).size).toBe(1);
    expect(made).toBeLessThanOrEqual(before + 1);
    await untilReconstructed(
      () => stub.total(),
      () => made,
      0,
    );
    expect(await stub.total()).toBeGreaterThanOrEqual(2);
  });
});

describe("onError", () => {
  type Report = { message: string; id: string; name: string | undefined; current: unknown };
  const faultySource = `
    export class Faulty extends Bun.DurableObject {
      throwLater(message, delay = 1) {
        setTimeout(() => {
          throw new Error(message);
        }, delay);
      }
      rejectWaitUntil(message) {
        this.ctx.waitUntil(Bun.sleep(1).then(() => Promise.reject(new Error(message))));
      }
      unhandledRejection(message) {
        Promise.reject(new Error(message));
      }
      unhandledLater(message) {
        void (async () => {
          await Bun.sleep(1);
          throw new Error(message);
        })();
      }
      ping() {
        return "pong";
      }
    }
  `;
  const collect = (reports: Report[]) => (error: any, id: Bun.DurableObjectId) =>
    void reports.push({ message: error?.message, id: String(id), name: id.name, current: Bun.ModuleGraph.current });

  // In this process only with `module:`. If one of these went to the process instead, bun:test would
  // blame whichever test is running then; `class:` namespaces get a process of their own below.
  test("uncaught errors of an object's timers, rejected waitUntil() promises and unhandled rejections come with that object's id", async () => {
    using dir = tempDir("do-concurrency-onerror", { "faulty.ts": faultySource });
    const reports: Report[] = [];
    await using ns = new Bun.DurableObjectNamespace<any>({
      module: join(String(dir), "faulty.ts"),
      export: "Faulty",
      onError: collect(reports),
    });
    const idOf = (name: string) => String(ns.idFromName(name));

    await ns.getByName("timer").throwLater("from a timer");
    await until(() => reports.length === 1, "the timer's error");
    expect(reports[0]).toEqual({ message: "from a timer", id: idOf("timer"), name: "timer", current: undefined });

    await ns.getByName("background").rejectWaitUntil("from waitUntil");
    await until(() => reports.length === 2, "the waitUntil() rejection");
    expect(reports[1]).toEqual({
      message: "from waitUntil",
      id: idOf("background"),
      name: "background",
      current: undefined,
    });

    await ns.getByName("rejection").unhandledRejection("nobody handles this");
    await until(() => reports.length === 3, "the unhandled rejection");
    expect(reports[2]).toEqual({
      message: "nobody handles this",
      id: idOf("rejection"),
      name: "rejection",
      current: undefined,
    });

    await ns.getByName("later").unhandledLater("nobody handles this either");
    await until(() => reports.length === 4, "the later unhandled rejection");
    expect(reports[3]).toEqual({
      message: "nobody handles this either",
      id: idOf("later"),
      name: "later",
      current: undefined,
    });

    // The objects live on.
    for (const name of ["timer", "background", "rejection", "later"])
      expect(await ns.getByName(name).ping()).toBe("pong");
  });

  test("interleaved failures of many objects are each reported with the right id", async () => {
    using dir = tempDir("do-concurrency-onerror", { "faulty.ts": faultySource });
    const reports: Report[] = [];
    await using ns = new Bun.DurableObjectNamespace<any>({
      module: join(String(dir), "faulty.ts"),
      export: "Faulty",
      onError: collect(reports),
    });
    const names = range(10).map(i => "faulty-" + i);
    const calls: Promise<unknown>[] = [];
    for (let round = 0; round < 4; round++) {
      for (const name of names) {
        const stub = ns.getByName(name);
        const message = `${name} round ${round}`;
        calls.push(
          [
            () => stub.throwLater(message, 2),
            () => stub.rejectWaitUntil(message),
            () => stub.unhandledLater(message),
            () => stub.unhandledRejection(message),
          ][round](),
        );
      }
    }
    await Promise.all(calls);
    await until(() => reports.length >= 40, "40 reports");
    expect(reports).toHaveLength(40);
    for (const report of reports) {
      expect(report.message.startsWith(report.name + " round ")).toBe(true);
      expect(report.id).toBe(String(ns.idFromName(report.name!)));
    }
    expect(new Set(reports.map(report => report.message)).size).toBe(40);
  });

  // [how the namespace gets the class] x [no onError | onError | onError that throws]
  describe.each(["module", "class"])("in a process of its own (%s:)", how => {
    const hostSource = `
      import { Faulty } from "./faulty.ts";
      const [how, mode] = process.argv.slice(-2);
      let seen = 0;
      const toProcess = kind => e => (seen++, console.log("PROCESS:", e?.message));
      process.on("uncaughtException", toProcess());
      process.on("unhandledRejection", toProcess());
      const ns = new Bun.DurableObjectNamespace({
        ...(how === "class" ? { class: Faulty } : { module: import.meta.dir + "/faulty.ts", export: "Faulty" }),
        onError: mode === "none" ? undefined : (error, id) => {
          seen++;
          console.log("onError:", error?.message, "| id.name:", id.name);
          if (mode === "throws") throw new Error("onError itself failed");
        },
      });
      for (const method of ["throwLater", "rejectWaitUntil", "unhandledRejection", "unhandledLater"]) {
        for (const name of ["a", "b"]) {
          const before = seen;
          await ns.getByName(name)[method](method + " in " + name);
          const deadline = Date.now() + 10_000;
          while (seen === before && Date.now() < deadline) await Bun.sleep(2);
          console.log(await ns.getByName(name).ping());
        }
      }
      // What an onError threw is reported after it was called.
      const deadline = Date.now() + 5000;
      while (mode === "throws" && seen < 16 && Date.now() < deadline) await Bun.sleep(2);
      await ns.close();
      console.log("closed");
    `;
    const run = async (mode: string) => {
      using dir = tempDir("do-concurrency-onerror-host", { "faulty.ts": faultySource, "host.ts": hostSource });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "host.ts", how, mode],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return {
        stdout: stdout.trim().split("\n").sort(),
        stderr: / in [ab]\b/.test(stderr) ? stderr.slice(0, 2000) : "",
        exitCode,
      };
    };
    const failures = ["throwLater", "rejectWaitUntil", "unhandledRejection", "unhandledLater"].flatMap(method =>
      ["a", "b"].map(name => [`${method} in ${name}`, name]),
    );

    test.concurrent(
      "everything goes to onError and nothing to the process",
      async () => {
        expect(await run("reports")).toEqual({
          stdout: [
            ...failures.flatMap(([message, name]) => [`onError: ${message} | id.name: ${name}`, "pong"]),
            "closed",
          ].sort(),
          stderr: "",
          exitCode: 0,
        });
      },
      30_000,
    );

    test.concurrent(
      "without onError they are the process's uncaught errors",
      async () => {
        expect(await run("none")).toEqual({
          stdout: [...failures.flatMap(([message]) => [`PROCESS: ${message}`, "pong"]), "closed"].sort(),
          stderr: "",
          exitCode: 0,
        });
      },
      30_000,
    );

    test.concurrent(
      "an onError that throws does not break the namespace",
      async () => {
        // What onError throws is the host's own problem; every failure was still reported and the objects still answer.
        expect(await run("throws")).toEqual({
          stdout: [
            ...failures.flatMap(([message, name]) => [
              `onError: ${message} | id.name: ${name}`,
              "PROCESS: onError itself failed",
              "pong",
            ]),
            "closed",
          ].sort(),
          stderr: "",
          exitCode: 0,
        });
      },
      30_000,
    );
  });
});

describe("a namespace made inside a Bun.ModuleGraph", () => {
  // In a process of its own: a crash here must not take the other tests with it.
  test("disposing the graph stops its objects", async () => {
    using dir = tempDir("do-concurrency-nested", {
      "tenant.ts": `
        // Runs in the tenant's graph: the namespace and its objects are the tenant's.
        let made = 0;
        class Inner extends Bun.DurableObject {
          graph = Bun.ModuleGraph.current;
          constructor(ctx, env) {
            super(ctx, env);
            made++;
            setInterval(() => host.tick(ctx.id.name), 2);
          }
          inc() {
            const n = (this.ctx.storage.kv.get("n") ?? 0) + 1;
            this.ctx.storage.kv.put("n", n);
            return n;
          }
          async sleeper() {
            host.log("sleeper started in " + this.ctx.id.name);
            await Bun.sleep(20);
            host.log("sleeper woke in " + this.ctx.id.name);
            return "woke";
          }
          where() {
            const current = Bun.ModuleGraph.current;
            return { own: current === this.graph, tenants: current === host.tenantGraph(), defined: current !== undefined };
          }
        }
        export const ns = new Bun.DurableObjectNamespace({ class: Inner, onError: (e, id) => host.log("onError " + e?.message) });
        export const call = (name, method, ...args) => ns.getByName(name)[method](...args);
        export const count = () => made;
      `,
      "host.ts": `
        process.on("uncaughtException", e => console.log("PROCESS uncaughtException:", e?.message));
        process.on("unhandledRejection", e => console.log("PROCESS unhandledRejection:", e?.message));
        const ticks = { a: 0, b: 0 };
        const log = [];
        let graph;
        const host = { tick: name => ticks[name]++, log: line => log.push(line), tenantGraph: () => graph };
        graph = new Bun.ModuleGraph({ globals: { host }, onError: (e, kind) => log.push("graph onError " + kind + " " + e?.message) });
        const tenant = await graph.import(import.meta.dir + "/tenant.ts");
        const until = async (condition, what) => {
          const deadline = Date.now() + 10_000;
          while (!condition()) {
            if (Date.now() > deadline) throw new Error("timed out waiting for " + what);
            await Bun.sleep(2);
          }
        };
        const track = promise => {
          const tracked = { state: "pending" };
          promise.then(value => (tracked.state = "fulfilled: " + value), e => (tracked.state = "rejected: " + e?.code + " " + e?.message));
          return tracked;
        };

        console.log("inc:", await graph.run(() => tenant.call("a", "inc")), await graph.run(() => tenant.call("b", "inc")));
        // Each object has a graph of its own, not the tenant's.
        console.log("where:", JSON.stringify(await graph.run(() => tenant.call("a", "where"))));
        await until(() => ticks.a > 2 && ticks.b > 2, "the objects' timers");

        const inFlight = [track(graph.run(() => tenant.call("a", "sleeper"))), track(tenant.call("b", "sleeper"))];
        await until(() => log.length === 2, "both sleepers");
        graph.dispose();
        const atDispose = { ...ticks };
        console.log("disposed");

        // The host's own timers are fine. Give the tenant's 50 chances to show they are not dead.
        let hostTicks = 0;
        const hostTimer = setInterval(() => hostTicks++, 2);
        await until(() => hostTicks >= 50, "the host's timer");
        clearInterval(hostTimer);
        console.log("ticks after dispose:", ticks.a - atDispose.a, ticks.b - atDispose.b);
        console.log("log:", JSON.stringify(log));
        // Like everything else a disposed graph was waiting for: they never settle.
        console.log("in flight:", JSON.stringify(inFlight.map(t => t.state)));

        // The host still holds the tenant's namespace. Whatever these do, they must do it without crashing,
        // and nothing of the tenant's may start running again.
        const late = [];
        for (const [name, method] of [["a", "inc"], ["fresh", "inc"], ["a", "sleeper"]]) {
          try {
            late.push(track(tenant.call(name, method)));
          } catch (e) {
            late.push({ state: "threw: " + e?.code });
          }
        }
        hostTicks = 0;
        const again = setInterval(() => hostTicks++, 2);
        await until(() => hostTicks >= 50, "the host's timer");
        clearInterval(again);
        console.log("late calls settled or not:", late.length);
        console.log("ticks after late calls:", ticks.a - atDispose.a, ticks.b - atDispose.b);
        const closing = track(tenant.ns.close());
        hostTicks = 0;
        const third = setInterval(() => hostTicks++, 2);
        await until(() => hostTicks >= 20, "the host's timer");
        clearInterval(third);
        console.error("late:", JSON.stringify(late.map(t => t.state)), "close():", closing.state, "made:", tenant.count());
        Bun.gc(true);
        console.log("done");
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "host.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.split("\n")).toEqual([
      "inc: 1 1",
      'where: {"own":true,"tenants":false,"defined":true}',
      "disposed",
      "ticks after dispose: 0 0",
      'log: ["sleeper started in a","sleeper started in b"]',
      'in flight: ["pending","pending"]',
      "late calls settled or not: 3",
      "ticks after late calls: 0 0",
      "done",
      "",
    ]);
    // What the late calls and close() did is informational.
    expect(stderr.split("\n").filter(line => !line.startsWith("late:"))).toEqual([""]);
    expect(exitCode).toBe(0);
  }, 30_000);
});

describe("many objects", () => {
  test("300 objects: call each, let all be evicted, call each again", async () => {
    const env = { made: 0 };
    class One extends Bun.DurableObject<typeof env> {
      constructor(ctx: Bun.DurableObjectState, e: typeof env) {
        super(ctx, e);
        e.made++;
        // How many instances this object has had; nobody else's.
        ctx.storage.kv.put("generation", (ctx.storage.kv.get<number>("generation") ?? 0) + 1);
      }
      async visit(expected: string) {
        const visits = ((await this.ctx.storage.get<number>("visits")) ?? 0) + 1;
        await this.ctx.storage.put("visits", visits);
        return {
          name: this.ctx.id.name,
          right: this.ctx.id.name === expected,
          visits,
          generation: this.ctx.storage.kv.get<number>("generation"),
        };
      }
    }
    await using ns = new Bun.DurableObjectNamespace<One>({ class: One, env, idleTimeout: 25 });
    const names = range(300).map(i => "object-" + i);
    const first = await Promise.all(names.map(name => ns.getByName(name).visit(name)));
    expect(first).toEqual(names.map(name => ({ name, right: true, visits: 1, generation: 1 })));
    expect(env.made).toBe(300);

    // An object that answers from its first instance was not evicted yet: ask it again later.
    const visits = new Map(names.map(name => [name, 1]));
    let waiting = names;
    await until(async () => {
      await Bun.sleep(80);
      const answers = await Promise.all(waiting.map(name => ns.getByName(name).visit(name)));
      for (const answer of answers) {
        expect(answer.right).toBe(true);
        visits.set(answer.name!, visits.get(answer.name!)! + 1);
        expect(answer.visits).toBe(visits.get(answer.name!)!);
        expect(answer.generation).toBeLessThanOrEqual(2);
      }
      waiting = answers.filter(answer => answer.generation === 1).map(answer => answer.name!);
      return waiting.length === 0;
    }, "every object to have been evicted once");
    expect(env.made).toBe(600);
  }, 60_000);
});

describe("garbage collection", () => {
  test("evicted objects and their graphs are collected", async () => {
    const { heapStats } = require("bun:jsc");
    const counts = () => {
      Bun.gc(true);
      const { ModuleGraph = 0, DurableObjectActor = 0, DurableObjectState = 0 } = heapStats().objectTypeCounts;
      return { ModuleGraph, DurableObjectActor, DurableObjectState };
    };
    class Garbage extends Bun.DurableObject {
      payload = new Array(1000).fill(this.ctx.id.name);
      async touch() {
        await this.ctx.storage.put("touched", true);
        setInterval(() => {}, 1000);
        return this.payload.length;
      }
    }
    const baseline = counts();
    const objects = 150;
    const slack = 10;
    {
      // Evicted by the idle timer.
      await using ns = new Bun.DurableObjectNamespace<Garbage>({
        class: Garbage,
        name: "garbage-idle",
        idleTimeout: 5,
      });
      await Promise.all(range(objects).map(i => ns.getByName("idle-" + i).touch()));
      const loaded = counts();
      expect(loaded.ModuleGraph).toBeGreaterThanOrEqual(baseline.ModuleGraph + objects - slack);
      await until(
        async () => {
          await Bun.sleep(10);
          const now = counts();
          return (
            now.ModuleGraph <= baseline.ModuleGraph + slack &&
            now.DurableObjectState <= baseline.DurableObjectState + slack
          );
        },
        "the evicted objects' graphs to be collected while the namespace is open",
        20_000,
      );
    }
    {
      // Evicted by close().
      const ns = new Bun.DurableObjectNamespace<Garbage>({
        class: Garbage,
        name: "garbage-close",
        idleTimeout: 60_000,
      });
      await Promise.all(range(objects).map(i => ns.getByName("close-" + i).touch()));
      await ns.close();
    }
    await until(
      async () => {
        await Bun.sleep(10);
        const now = counts();
        return (
          now.ModuleGraph <= baseline.ModuleGraph + slack &&
          now.DurableObjectActor <= baseline.DurableObjectActor + slack &&
          now.DurableObjectState <= baseline.DurableObjectState + slack
        );
      },
      "graphs, actors and states to be collected after close()",
      20_000,
    );
  }, 60_000);
});
