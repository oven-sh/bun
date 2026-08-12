// Native -> JS callback calls (timers, Bun.serve handlers, HTMLRewriter handlers, ...) go through
// Bun::hostCall (src/jsc/bindings/HostCall.cpp), which links plain JS callees into the VM's
// MicrotaskCallCache and enters them directly on later calls. These tests drive each wired call
// site and, in builds that keep the counters, check which path every call took.
//
// The counters are process-wide, so the tests in this file have to stay sequential: a concurrent
// test would add its own calls to another test's before/after window.
import { hostCallCacheStats } from "bun:internal-for-testing";
import { numberOfDFGCompiles, optimizeNextInvocation } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// MicrotaskCallCache::cacheSize (WebKit, interpreter/MicrotaskCall.h).
const CACHE_SIZE = 8;

type Stats = NonNullable<ReturnType<typeof hostCallCacheStats>>;

// Builds without assertions do not keep the counters and return undefined. The behaviour
// assertions below run everywhere; the counter assertions only where there are counters.
const hasStats = hostCallCacheStats() !== undefined;

function snapshot(): Stats {
  return hostCallCacheStats() ?? { hits: 0, misses: 0, replacements: 0, fallbacks: 0 };
}

function delta(before: Stats, after: Stats = snapshot()): Stats {
  return {
    hits: after.hits - before.hits,
    misses: after.misses - before.misses,
    replacements: after.replacements - before.replacements,
    fallbacks: after.fallbacks - before.fallbacks,
  };
}

/**
 * Has the timer code path (Bun__JSTimeout__call) call `callback` itself with `args`, and resolves
 * once it ran. Counter-wise this is one hit or miss for `callback`, plus one fallback for `resolve`,
 * which is a host function.
 */
function callFromTimer(callback: (...args: any[]) => unknown, ...args: unknown[]): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(callback, ...args);
  setImmediate(resolve);
  return promise;
}

/** Has the HTMLRewriter (Bun__JSValue__call, synchronous for string input) call `handler` once per <p>. */
function rewrite(handler: (element: HTMLRewriterTypes.Element) => void, html = "<p></p>"): string {
  return new HTMLRewriter().on("p", { element: handler }).transform(html);
}

describe("timers", () => {
  test("this and the arguments arrive on the linking call and on cached calls alike", async () => {
    const seen: unknown[] = [];
    function callback(this: object, a: unknown, b: unknown) {
      seen.push([this.constructor.name, a, b]);
    }

    const before = snapshot();
    for (let i = 0; i < 3; i++) await callFromTimer(callback, i, `arg-${i}`);

    expect(seen).toEqual([
      ["Immediate", 0, "arg-0"],
      ["Immediate", 1, "arg-1"],
      ["Immediate", 2, "arg-2"],
    ]);
    if (hasStats) {
      expect(delta(before)).toEqual({ hits: 2, misses: 1, replacements: expect.any(Number), fallbacks: 3 });
    }
  });

  test("one entry serves every argument count the register-passing entry points exist for", async () => {
    let received: unknown[][] = [];
    // `arguments` instead of parameters, so the arity check never applies.
    const callee = function () {
      received.push(Array.from(arguments));
    };

    for (let count = 0; count <= 6; count++) {
      const args = Array.from({ length: count }, (_, i) => i * 10);
      received = [];

      const before = snapshot();
      for (let i = 0; i < 3; i++) await callFromTimer(callee, ...args);

      expect(received).toEqual([args, args, args]);
      if (hasStats) {
        // Entries are keyed by FunctionExecutable, so the callee is linked once (by the first call
        // with zero arguments) and every later argument count hits that same entry.
        const { hits, misses, fallbacks } = delta(before);
        expect({ count, hits, misses, fallbacks }).toEqual(
          count === 0 ? { count, hits: 2, misses: 1, fallbacks: 3 } : { count, hits: 3, misses: 0, fallbacks: 3 },
        );
      }
    }
  });

  test("closures of the same function literal share an entry", async () => {
    const seen: string[] = [];
    const makeCallee = (tag: string) => () => {
      seen.push(tag);
    };

    const before = snapshot();
    for (const tag of ["a", "b", "c"]) await callFromTimer(makeCallee(tag));

    expect(seen).toEqual(["a", "b", "c"]);
    if (hasStats) {
      // Three JSFunctions, one FunctionExecutable: linked once, and each call uses its own closure's
      // scope (the tags differ), since the callee object is passed to the linked code on every call.
      expect(delta(before)).toEqual({ hits: 2, misses: 1, replacements: expect.any(Number), fallbacks: 3 });
    }
  });

  test("seven arguments take the generic path and all arrive", async () => {
    const received: unknown[][] = [];
    const callee = function () {
      received.push(Array.from(arguments));
    };

    const before = snapshot();
    for (let i = 0; i < 3; i++) await callFromTimer(callee, 1, 2, 3, 4, 5, 6, 7);

    expect(received).toEqual([
      [1, 2, 3, 4, 5, 6, 7],
      [1, 2, 3, 4, 5, 6, 7],
      [1, 2, 3, 4, 5, 6, 7],
    ]);
    if (hasStats) {
      expect(delta(before)).toEqual({ hits: 0, misses: 0, replacements: 0, fallbacks: 6 });
    }
  });

  test("a callee declaring more parameters than it is passed takes the generic path and sees undefined for the rest", async () => {
    const received: unknown[][] = [];
    const callee = (a: unknown, b: unknown, c: unknown) => {
      received.push([a, b, c]);
    };

    const before = snapshot();
    for (let i = 0; i < 3; i++) await callFromTimer(callee, "only");

    expect(received).toEqual([
      ["only", undefined, undefined],
      ["only", undefined, undefined],
      ["only", undefined, undefined],
    ]);
    if (hasStats) {
      // The callee is still looked up and linked, but the linked entry point skips the arity fixup,
      // so each of the three calls additionally goes through the generic path (3 + 3 for resolve).
      expect(delta(before)).toEqual({ hits: 2, misses: 1, replacements: expect.any(Number), fallbacks: 6 });
    }
  });

  test("a callee declaring fewer parameters than it is passed takes the cached path", async () => {
    const received: unknown[] = [];
    const callee = (a: unknown) => {
      received.push(a);
    };

    const before = snapshot();
    for (let i = 0; i < 3; i++) await callFromTimer(callee, "first", "ignored", "ignored too");

    expect(received).toEqual(["first", "first", "first"]);
    if (hasStats) {
      expect(delta(before)).toEqual({ hits: 2, misses: 1, replacements: expect.any(Number), fallbacks: 3 });
    }
  });

  test("a bound function takes the generic path", async () => {
    const received: unknown[][] = [];
    const bound = function (this: { tag: string }, a: unknown) {
      received.push([this.tag, a]);
    }.bind({ tag: "bound this" });

    const before = snapshot();
    for (let i = 0; i < 3; i++) await callFromTimer(bound, i);

    expect(received).toEqual([
      ["bound this", 0],
      ["bound this", 1],
      ["bound this", 2],
    ]);
    if (hasStats) {
      // A bound function's executable is native, so the lookup never matches and nothing is linked.
      expect(delta(before)).toEqual({ hits: 0, misses: 0, replacements: 0, fallbacks: 6 });
    }
  });

  test("an async callee is a plain JSFunction and takes the cached path", async () => {
    const results: string[] = [];
    let resolveAll!: () => void;
    const all = new Promise<void>(resolve => (resolveAll = resolve));
    const callee = async function (value: string) {
      await null;
      results.push(value);
      if (results.length === 3) resolveAll();
    };

    const before = snapshot();
    setImmediate(callee, "v0");
    setImmediate(callee, "v1");
    setImmediate(callee, "v2");
    await all;

    expect(results).toEqual(["v0", "v1", "v2"]);
    if (hasStats) {
      expect(delta(before)).toEqual({ hits: 2, misses: 1, replacements: expect.any(Number), fallbacks: 0 });
    }
  });

  test("the entry follows the callee while it tiers up", async () => {
    let sum = 0;
    let calls = 0;
    function hot(iterations: number, resolve: () => void) {
      let local = 0;
      for (let i = 0; i < iterations; i++) local += i;
      sum += local;
      calls++;
      resolve();
    }
    const call = () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setImmediate(hot, 50, resolve);
      return promise;
    };

    const before = snapshot();
    for (let i = 0; i < 20; i++) await call();
    // numberOfDFGCompiles() becomes 1 once an optimized CodeBlock is installed for `hot` (or right
    // away when the JIT is disabled). Every call that gets it there is made through the entry that
    // was linked to the interpreter CodeBlock; optimizeNextInvocation() only takes effect once the
    // baseline JIT has kicked in, and the compile itself runs concurrently, hence the polling.
    for (let rounds = 0; numberOfDFGCompiles(hot) < 1 && rounds < 500; rounds++) {
      optimizeNextInvocation(hot);
      for (let i = 0; i < 10; i++) await call();
    }
    expect(numberOfDFGCompiles(hot)).toBeGreaterThanOrEqual(1);

    const optimized = snapshot();
    for (let i = 0; i < 50; i++) await call();

    expect(sum).toBe(calls * ((50 * 49) / 2));
    expect(calls).toBeGreaterThanOrEqual(70);
    if (hasStats) {
      const total = delta(before);
      expect(total.fallbacks).toBe(0);
      expect(total.hits + total.misses).toBe(calls);
      // Each tier-up upgrades the entry in place. A collection between two calls can additionally
      // jettison a CodeBlock that is not on the stack (JSC ages them), which costs one relink, so
      // the total is bounded rather than exact; the window after the optimized code was installed is.
      expect(total.misses).toBeLessThanOrEqual(3);
      expect(delta(optimized)).toEqual({ hits: 50, misses: 0, replacements: 0, fallbacks: 0 });
    }
  });
});

describe("garbage collection", () => {
  test("a live callee stays linked across a full collection", () => {
    const handler = (element: HTMLRewriterTypes.Element) => element.setAttribute("seen", "");
    expect(rewrite(handler)).toBe('<p seen=""></p>');

    const before = snapshot();
    Bun.gc(true);
    expect(rewrite(handler)).toBe('<p seen=""></p>');
    if (hasStats) {
      expect(delta(before)).toEqual({ hits: 1, misses: 0, replacements: 0, fallbacks: 0 });
    }
  });

  // Each callee is created with `new Function` so that it owns its FunctionExecutable; a function
  // literal in this file would share its executable's lifetime with this module's code.
  function callFreshCallees(count: number) {
    const callees = Array.from(
      { length: count },
      (_, i) =>
        new Function("element", `element.setAttribute("n", "${i}")`) as (element: HTMLRewriterTypes.Element) => void,
    );
    const results = callees.map(callee => rewrite(callee));
    expect(results).toEqual(Array.from({ length: count }, (_, i) => `<p n="${i}"></p>`));
    return callees;
  }

  test.skipIf(!hasStats)("entries whose callee was collected are released rather than evicted", () => {
    // Fill every slot, then keep those callees alive while another batch goes in: each of them has
    // to evict a live callee.
    const firstBatch = callFreshCallees(CACHE_SIZE);
    const filled = snapshot();
    let secondBatch: unknown[] | null = callFreshCallees(CACHE_SIZE);
    expect(delta(filled)).toEqual({ hits: 0, misses: CACHE_SIZE, replacements: CACHE_SIZE, fallbacks: 0 });
    expect(firstBatch).toHaveLength(CACHE_SIZE);

    // Now every slot holds a second-batch callee; drop them. The HTMLRewriter objects protect their
    // handlers until they are finalized, so it takes one collection to finalize the rewriters and a
    // second one to collect the callees, at which point VM::finalizeUnconditionally() clears the
    // entries. The conservative stack scan may still see a pointer to one of them.
    secondBatch = null;
    Bun.gc(true);
    Bun.gc(true);

    const collected = snapshot();
    callFreshCallees(CACHE_SIZE);
    const d = delta(collected);
    expect({ hits: d.hits, misses: d.misses, fallbacks: d.fallbacks }).toEqual({
      hits: 0,
      misses: CACHE_SIZE,
      fallbacks: 0,
    });
    expect(d.replacements).toBeLessThanOrEqual(1);
  });
});

describe("exceptions", () => {
  // Plain JS, unlike expect().toThrow(), which calls its argument from native code and would show
  // up in the counters itself.
  function messageThrownBy(fn: () => unknown): string | undefined {
    try {
      fn();
    } catch (error) {
      return (error as Error).message;
    }
  }

  test("a throwing callee propagates from the linking call and from a cached call, then keeps working", () => {
    let calls = 0;
    const handler = () => {
      calls++;
      if (calls <= 2) throw new Error(`thrown on call ${calls}`);
    };

    const before = snapshot();
    const outcomes = [
      messageThrownBy(() => rewrite(handler)),
      messageThrownBy(() => rewrite(handler)),
      rewrite(handler),
    ];

    expect(outcomes).toEqual(["thrown on call 1", "thrown on call 2", "<p></p>"]);
    expect(calls).toBe(3);
    if (hasStats) {
      expect(delta(before)).toEqual({ hits: 2, misses: 1, replacements: expect.any(Number), fallbacks: 0 });
    }
  });

  test("a class constructor is a JS callee whose call CodeBlock throws, on the linking call and on cached calls", () => {
    class Handler {
      constructor() {
        throw new Error("constructed");
      }
    }

    const before = snapshot();
    const messages = [
      messageThrownBy(() => rewrite(Handler as unknown as (element: HTMLRewriterTypes.Element) => void)),
      messageThrownBy(() => rewrite(Handler as unknown as (element: HTMLRewriterTypes.Element) => void)),
    ];

    expect(messages).toEqual([
      "Cannot call a class constructor Handler without |new|",
      "Cannot call a class constructor Handler without |new|",
    ]);
    if (hasStats) {
      expect(delta(before)).toEqual({ hits: 1, misses: 1, replacements: expect.any(Number), fallbacks: 0 });
    }
  });

  test("a callee invoked near stack exhaustion throws a RangeError, and the cache works afterwards", () => {
    let handlerCalls = 0;
    const handler = () => {
      handlerCalls++;
    };
    let depth = 0;
    // Spreading 4096 arguments into every level makes each frame ~32 KiB, so the stack runs out
    // after a couple of hundred levels instead of tens of thousands (each level is a full rewrite,
    // which is slow in debug builds).
    const padding = new Array<number>(4096).fill(0);
    function recurse(...pad: number[]): number {
      depth++;
      // Every level makes one native -> JS call, so one of them happens right at the limit.
      rewrite(handler);
      // Not `return recurse(...)`: this is strict mode code, where JSC would make that a proper
      // tail call and the stack would never grow.
      return recurse(...pad) + 1;
    }

    let caught: unknown;
    try {
      recurse(...padding);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RangeError);
    expect((caught as RangeError).message).toBe("Maximum call stack size exceeded.");
    expect(depth).toBeGreaterThan(20);
    // Either the deepest level's native -> JS call was refused (handler not run for that level) or
    // the recursion itself overflowed right after it ran.
    expect(handlerCalls).toBeOneOf([depth, depth - 1]);

    const before = snapshot();
    expect(rewrite(handler)).toBe("<p></p>");
    expect(rewrite(element => element.setAttribute("fresh", ""))).toBe('<p fresh=""></p>');
    expect(handlerCalls).toBeOneOf([depth + 1, depth]);
    if (hasStats) {
      // The refused call left the handler's entry alone, so it is still a hit; the new arrow links.
      expect(delta(before)).toEqual({ hits: 1, misses: 1, replacements: expect.any(Number), fallbacks: 0 });
    }
  });
});

describe("Bun.serve", () => {
  test("fetch handler (Bun__JSValue__call) and route handler (AsyncContextFrame::call)", async () => {
    const calls: string[] = [];
    using server = Bun.serve({
      port: 0,
      routes: {
        "/route/:name": (request, serverArgument) => {
          calls.push(`route ${request.params.name} ${serverArgument === server}`);
          return new Response(`route ${request.params.name}`);
        },
      },
      fetch(request, serverArgument) {
        const { pathname } = new URL(request.url);
        calls.push(`fetch ${pathname} ${serverArgument === server}`);
        return new Response(`fetch ${pathname}`);
      },
    });

    const before = snapshot();
    const bodies: string[] = [];
    for (const path of ["/a", "/b", "/route/x", "/route/y", "/c"]) {
      const response = await fetch(new URL(path, server.url));
      bodies.push(await response.text());
    }

    expect(bodies).toEqual(["fetch /a", "fetch /b", "route x", "route y", "fetch /c"]);
    expect(calls).toEqual(["fetch /a true", "fetch /b true", "route x true", "route y true", "fetch /c true"]);
    if (hasStats) {
      // Two callees, each linked by its first request. fetch() on the client side settles through
      // promises, not through a native -> JS call, so nothing else lands in the window.
      expect(delta(before)).toEqual({ hits: 3, misses: 2, replacements: expect.any(Number), fallbacks: 0 });
    }
  });

  test("a fetch handler that throws is reported per request and later requests still work", async () => {
    let calls = 0;
    using server = Bun.serve({
      port: 0,
      fetch() {
        calls++;
        if (calls <= 2) throw new Error(`request ${calls} failed`);
        return new Response(`request ${calls} ok`);
      },
      error(error) {
        return new Response(`caught: ${error.message}`, { status: 500 });
      },
    });

    const before = snapshot();
    const results: [number, string][] = [];
    for (let i = 0; i < 3; i++) {
      const response = await fetch(server.url);
      results.push([response.status, await response.text()]);
    }

    expect(results).toEqual([
      [500, "caught: request 1 failed"],
      [500, "caught: request 2 failed"],
      [200, "request 3 ok"],
    ]);
    if (hasStats) {
      // fetch: linked once, hit twice (the linking call is the one that throws first). error: linked
      // once, hit once.
      expect(delta(before)).toEqual({ hits: 3, misses: 2, replacements: expect.any(Number), fallbacks: 0 });
    }
  });

  test("handlers registered inside AsyncLocalStorage.run() see their store on every call", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { AsyncLocalStorage } = require("node:async_hooks");
        const als = new AsyncLocalStorage();
        (async () => {
          const server = als.run("store", () =>
            Bun.serve({
              port: 0,
              routes: { "/route": () => new Response(String(als.getStore())) },
              fetch() { return new Response(String(als.getStore())); },
            }),
          );
          const seen = [];
          for (const path of ["/route", "/route", "/fetch", "/fetch"]) {
            seen.push(await (await fetch(new URL(path, server.url))).text(), String(als.getStore()));
          }
          server.stop(true);
          console.log(JSON.stringify(seen));
        })();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    // Bun.serve() wraps both handlers in an AsyncContextFrame when it is called inside run(). The
    // route goes through AsyncContextFrame::call, fetch through Bun__JSValue__call; both restore the
    // store around the linking call and around the cached one, and the caller's context comes back.
    expect(JSON.parse(stdout)).toEqual([
      "store",
      "undefined",
      "store",
      "undefined",
      "store",
      "undefined",
      "store",
      "undefined",
    ]);
    expect(exitCode).toBe(0);
  });
});
