import { expect, test } from "bun:test";

function waitForNextEvent<T>(arr: T[], pred: (a: T[]) => boolean, timeoutMs = 2000) {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (pred(arr)) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("event wait timed out"));
      setTimeout(tick, 0);
    };
    tick();
  });
}

function waitForEventCount<T>(arr: T[], n: number, timeoutMs = 2000) {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (arr.length >= n) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("event count wait timed out"));
      setTimeout(tick, 0);
    };
    tick();
  });
}

test("accept control: returns previous state and emits coalesced notifications", async () => {
  const events: string[] = [];
  (globalThis as any).__bun_acceptStateChanged = (kind: "block" | "allow") => {
    events.push(kind);
  };

  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("ok");
    },
  });

  try {
    // Initial state: not blocked
    expect(server.isAcceptBlocked).toBe(false);

    // blockAccept returns previous state (false → now true)
    const prev1 = server.blockAccept();
    expect(prev1).toBe(false);

    // Back-to-back block calls coalesce and do not re-emit
    const prev1b = server.blockAccept();
    expect(prev1b).toBe(true);

    await waitForEventCount(events, 1);
    expect(events).toEqual(["block"]);
    expect(server.isAcceptBlocked).toBe(true);

    // allowAccept returns previous state (true → now false)
    const prev2 = server.allowAccept();
    expect(prev2).toBe(true);

    // duplicate allow should be idempotent
    const prev2b = server.allowAccept();
    expect(prev2b).toBe(false);

    await waitForEventCount(events, 2);
    expect(events).toEqual(["block", "allow"]);
    expect(server.isAcceptBlocked).toBe(false);

    // No extra emits on redundant allow while unblocked
    const seen = events.length;
    expect(server.allowAccept()).toBe(false);
    await new Promise(r => setTimeout(r, 0));
    expect(events.length).toBe(seen);
  } finally {
    // stop is idempotent
    server.stop(true);
    server.stop(true);
    delete (globalThis as any).__bun_acceptStateChanged;
  }
});

async function getText(url: string, timeoutMs = 1500) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Connection: "close" }, signal: ac.signal });
    return res.text();
  } finally {
    clearTimeout(t);
  }
}

test("reusePort: block A → new connections go to B; allow A → A can accept again", async () => {
  const events: string[] = [];
  (globalThis as any).__bun_acceptStateChanged = (kind: "block" | "allow") => {
    events.push(kind);
  };

  // Skip on platforms without SO_REUSEPORT (e.g., Windows CI)
  // @ts-ignore
  if (typeof process !== "undefined" && process.platform === "win32") {
    delete (globalThis as any).__bun_acceptStateChanged;
    return;
  }

  const A = Bun.serve({
    port: 0,
    reusePort: true,
    fetch() {
      return new Response("A", { headers: { "x-worker": "A", Connection: "close" } });
    },
  });
  const port = A.port;

  const B = Bun.serve({
    port,
    reusePort: true,
    fetch() {
      return new Response("B", { headers: { "x-worker": "B", Connection: "close" } });
    },
  });

  const url = `http://127.0.0.1:${port}`;

  try {
    // warm up
    await getText(url);

    // Block A — returns previous false; wait for block emit
    const prev = A.blockAccept();
    expect(prev).toBe(false);
    const seen0 = events.length;
    await waitForEventCount(events, seen0 + 1);
    expect(events.at(-1)).toBe("block");
    expect(A.isAcceptBlocked).toBe(true);

    // New connections should hit B
    const tries = await Promise.all([getText(url), getText(url), getText(url), getText(url), getText(url)]);
    expect(tries.every(t => t === "B")).toBe(true);

    // Allow A — returns previous true; wait for allow emit
    const prev2 = A.allowAccept();
    expect(prev2).toBe(true);
    await waitForEventCount(events, seen0 + 2);
    expect(events.at(-1)).toBe("allow");
    expect(A.isAcceptBlocked).toBe(false);

    const tries2 = await Promise.all([getText(url), getText(url), getText(url), getText(url)]);
    expect(tries2.includes("A")).toBe(true);
  } finally {
    A.stop(true);
    B.stop(true);
    delete (globalThis as any).__bun_acceptStateChanged;
  }
});

// Optional: deterministic rebind-failure path if a native test knob exists
test("reusePort: rebind failure keeps server blocked (test knob)", async () => {
  if (!("BUN_TEST_REBIND_FAIL" in Bun.env)) return;

  // @ts-ignore
  if (typeof process !== "undefined" && process.platform === "win32") return;

  const events: string[] = [];
  (globalThis as any).__bun_acceptStateChanged = (kind: "block" | "allow") => {
    events.push(kind);
  };

  const S = Bun.serve({
    port: 0,
    reusePort: true,
    fetch() {
      return new Response("ok");
    },
  });

  try {
    S.blockAccept();
    const seen0 = events.length;
    await waitForEventCount(events, seen0 + 1);

    Bun.env.BUN_TEST_REBIND_FAIL = "1";
    const seen = events.length;
    const prev = S.allowAccept();
    expect(prev).toBe(true);

    // Give a microtick; ensure we did not allow
    await new Promise(r => setTimeout(r, 0));
    expect(S.isAcceptBlocked).toBe(true);
    expect(events.includes("allow")).toBe(false);
    expect(events.length).toBe(seen);
  } finally {
    S.stop(true);
    delete (globalThis as any).__bun_acceptStateChanged;
    delete Bun.env.BUN_TEST_REBIND_FAIL;
  }
});

// Optional: flip storm coalescing
test("accept control: flip storm coalesces to last state", async () => {
  const events: string[] = [];
  (globalThis as any).__bun_acceptStateChanged = (k: "block" | "allow") => events.push(k);

  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  try {
    // Rapid flips
    server.blockAccept();
    server.allowAccept();
    server.blockAccept();
    server.allowAccept();

    await waitForNextEvent(events, e => e.length >= 1);
    await new Promise(r => setTimeout(r, 0));

    expect(events.at(-1)).toBe("allow");
    expect(server.isAcceptBlocked).toBe(false);
  } finally {
    server.stop(true);
    delete (globalThis as any).__bun_acceptStateChanged;
  }
});
