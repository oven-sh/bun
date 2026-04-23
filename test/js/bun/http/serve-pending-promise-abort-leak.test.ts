import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

async function waitForPendingRequests(server: ReturnType<typeof Bun.serve>, expected: number) {
  for (let i = 0; i < 100; i++) {
    if (server.pendingRequests === expected) return;
    Bun.gc(true);
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for pendingRequests === ${expected}; got ${server.pendingRequests}`);
}

test("RequestContext is freed when client aborts before Promise<Response> settles", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "serve-pending-promise-abort-leak-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  expect(result.pending).toBe(0);
  expect(result.abortCount).toBe(result.iterations);
  expect(exitCode).toBe(0);
});

test("Promise<Response> still works normally when not aborted", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Promise<Response>(resolve => {
        queueMicrotask(() => resolve(new Response("hello")));
      });
    },
  });

  const res = await fetch(server.url);
  expect(await res.text()).toBe("hello");
  expect(res.status).toBe(200);
  expect(server.pendingRequests).toBe(0);
});

test("resolve() inside abort handler is handled safely", async () => {
  let aborted = false;
  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      return new Promise<Response>(resolve => {
        req.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            // Resolving after abort is safe but the response is dropped
            // since the client is already gone.
            resolve(new Response("too late"));
          },
          { once: true },
        );
      });
    },
  });

  const ac = new AbortController();
  const p = fetch(server.url, { signal: ac.signal }).catch(() => {});
  await waitForPendingRequests(server, 1);
  ac.abort();
  await p;
  await waitForPendingRequests(server, 0);

  expect(aborted).toBe(true);
  expect(server.pendingRequests).toBe(0);
});

test("resolve() after abort does not crash and cleans up", async () => {
  // UAF safety: while the resolve function is reachable, the Promise stays
  // alive, the NativePromiseContext cell stays alive, and the RequestContext
  // stays alive. Calling resolve() after abort triggers onResolve, which sees
  // the aborted state, bails safely, and derefs.
  let capturedResolve: ((r: Response) => void) | undefined;
  const { promise: abortObserved, resolve: signalAbort } = Promise.withResolvers<void>();

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      return new Promise<Response>(resolve => {
        capturedResolve = resolve;
        req.signal.addEventListener("abort", () => signalAbort(), { once: true });
      });
    },
  });

  const ac = new AbortController();
  const p = fetch(server.url, { signal: ac.signal }).catch(() => {});
  await waitForPendingRequests(server, 1);
  ac.abort();
  await p;
  await abortObserved;

  // While capturedResolve is held, the Promise (and its reaction, and the
  // cell, and the RequestContext) stay alive. This is the safety guarantee:
  // no UAF because the ctx outlives any possible resolve() call.
  Bun.gc(true);
  await Bun.sleep(0);
  expect(server.pendingRequests).toBe(1);

  // Resolving after abort: onResolve takes the ctx, handleResolve sees
  // isAbortedOrEnded() and bails, then derefs. Context is freed.
  capturedResolve!(new Response("very late"));
  capturedResolve = undefined;
  await waitForPendingRequests(server, 0);

  expect(server.pendingRequests).toBe(0);
});
