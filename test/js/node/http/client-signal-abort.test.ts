import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";

// `options.signal` aborting an in-flight `http.request` must emit 'error'
// with an AbortError matching Node.js (`name: 'AbortError'`, `code:
// 'ABORT_ERR'`, `cause: signal.reason`). Without this, callers awaiting
// `req.on('error', reject)` hang until the underlying socket times out.
//
// Regression for #31167.
describe("http.request options.signal", () => {
  it("emits 'error' with AbortError when the signal fires mid-request", async () => {
    const server = createServer(() => {
      // Never respond, so the abort is what settles the request.
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    try {
      const signal = AbortSignal.timeout(20);
      const { promise, resolve, reject } = Promise.withResolvers<Error>();

      const req = request(`http://127.0.0.1:${port}`, { signal }, () => {
        reject(new Error("unexpected response"));
      });
      req.on("error", resolve);
      req.end();

      const err = await promise;
      expect(err.name).toBe("AbortError");
      expect((err as any).code).toBe("ABORT_ERR");
      // `cause` should be the signal's reason — a DOMException of type
      // 'TimeoutError' for `AbortSignal.timeout()`.
      expect((err as any).cause).toBeDefined();
      expect((err as any).cause.name).toBe("TimeoutError");
    } finally {
      server.close();
    }
  });

  it("emits 'error' when the signal was already aborted before the request ran", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<Error>();
    const server = createServer(() => {
      reject(new Error("server should not be contacted"));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    try {
      const controller = new AbortController();
      const reason = new Error("already aborted");
      controller.abort(reason);

      const req = request(`http://127.0.0.1:${port}`, { signal: controller.signal }, () => {
        reject(new Error("unexpected response"));
      });
      req.on("error", resolve);
      req.end();

      const err = await promise;
      expect(err.name).toBe("AbortError");
      expect((err as any).code).toBe("ABORT_ERR");
      expect((err as any).cause).toBe(reason);
    } finally {
      server.close();
    }
  });

  it("does not emit 'error' when the signal fires after the response completes", async () => {
    // A long-lived signal (AbortSignal.timeout(N) used as a request deadline)
    // must not emit AbortError on a request whose response has already come
    // back successfully. Prior iterations of the fix for #31167 double-emitted
    // here and could crash the process when no 'error' listener was attached.
    const server = createServer((_req, res) => {
      res.end("ok");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    try {
      const controller = new AbortController();
      const errors: Error[] = [];
      const { promise, resolve } = Promise.withResolvers<void>();

      const req = request(`http://127.0.0.1:${port}`, { signal: controller.signal }, res => {
        res.resume();
        res.on("end", resolve);
      });
      req.on("error", err => errors.push(err));
      req.end();

      // Wait for the response to fully complete first, then fire the signal.
      // Using an explicit controller (not `AbortSignal.timeout`) avoids racing
      // the response against a timer, which flakes badly under debug builds.
      await promise;
      controller.abort();
      // Drain the nextTick queue — the error path (if any) runs on nextTick,
      // so yielding once is enough to observe a spurious emission.
      await Bun.sleep(0);

      expect(errors).toEqual([]);
    } finally {
      server.close();
    }
  });

  it("emits 'error' before 'close' when the signal fires", async () => {
    // Node.js emits 'error' before the terminal 'close' event so that stream
    // consumers (stream.finished(), pipeline) observe the error. The 'abort'
    // event is legacy and trails both.
    const server = createServer(() => {
      // Never respond.
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    try {
      const events: string[] = [];
      const { promise, resolve } = Promise.withResolvers<void>();

      const req = request(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(20) });
      req.on("error", () => events.push("error"));
      req.on("abort", () => events.push("abort"));
      req.on("close", () => {
        events.push("close");
        resolve();
      });
      req.end();

      await promise;
      // Assert both fired first — `indexOf` returns -1 for a missing entry
      // and -1 < anything, so the ordering check alone could green-light a
      // missing 'error' emission.
      expect(events).toContain("error");
      expect(events).toContain("close");
      expect(events.indexOf("error")).toBeLessThan(events.indexOf("close"));
    } finally {
      server.close();
    }
  });

  it("does not emit 'error' when the signal fires after req.destroy() with no end()", async () => {
    // Destroy-before-end with a still-pending signal is a real-world pattern
    // (external cancellation / retry logic that gives up before flushing).
    // The signal listener must be removed on `destroy()` so a late-firing
    // timeout doesn't resurface as a spurious AbortError on a request the
    // caller already tore down.
    const server = createServer(() => {
      // Never gets hit — request is destroyed before any I/O starts.
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    try {
      const signal = AbortSignal.timeout(20);
      // Block until the signal has definitely fired so the assertion can
      // only run after the late-abort path has had its chance to (wrongly)
      // re-enter `onAbort`. We can't use `events.once(signal, "abort")` here
      // — `AbortSignal` is an `EventTarget`, not an `EventEmitter`, and
      // Node's `once()` hangs on one after destroy has already removed
      // every listener. Attach a dedicated listener instead.
      const signalFired = new Promise<void>(resolve => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });

      const errors: Error[] = [];
      const req = request(`http://127.0.0.1:${port}`, { signal });
      req.on("error", err => errors.push(err));
      req.destroy();

      await signalFired;
      // Drain the nextTick queue where a stray `emitSignalAbortNT` would
      // run if the listener-removal regressed.
      await Bun.sleep(0);

      expect(errors).toEqual([]);
    } finally {
      server.close();
    }
  });
});
