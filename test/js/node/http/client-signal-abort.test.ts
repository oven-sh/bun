import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";

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
    // A long-lived signal used as a request deadline must not emit AbortError
    // on a request whose response has already completed successfully.
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

      await promise;
      controller.abort();
      await Bun.sleep(0);

      expect(errors).toEqual([]);
    } finally {
      server.close();
    }
  });

  it("emits 'error' before 'close' when the signal fires", async () => {
    // Node.js emits 'error' before the terminal 'close' event so that stream
    // consumers (stream.finished(), pipeline) observe the error.
    const server = createServer(() => {
      // Never respond.
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    try {
      const signal = AbortSignal.timeout(20);
      const events: string[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<void>();

      const req = request(`http://127.0.0.1:${port}`, { signal }, () => {
        reject(new Error("unexpected response"));
      });
      req.on("error", err => {
        expect(err.name).toBe("AbortError");
        events.push("error");
      });
      req.on("close", () => {
        events.push("close");
        resolve();
      });
      req.end();

      await promise;
      expect(events).toEqual(["error", "close"]);
    } finally {
      server.close();
    }
  });

  it("does not re-emit 'error' after a connection failure when the signal fires later", async () => {
    const controller = new AbortController();
    const errors: Error[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();

    const req = request(
      {
        hostname: "127.0.0.1",
        port: 1,
        signal: controller.signal,
      },
      () => {
        throw new Error("unexpected response");
      },
    );
    req.on("error", err => {
      errors.push(err);
      resolve();
    });
    req.end();

    await promise;
    controller.abort();
    await Bun.sleep(0);

    expect(errors.length).toBe(1);
    expect((errors[0] as any).code).toBe("ECONNREFUSED");
  });

  it("aborts a streaming response when the signal fires after headers but before end", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("chunk-1");
      // Leave the response open until the client aborts.
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    try {
      const controller = new AbortController();
      const { promise, resolve, reject } = Promise.withResolvers<Error>();

      const req = request(`http://127.0.0.1:${port}`, { signal: controller.signal }, res => {
        res.on("data", () => {
          controller.abort();
        });
        res.on("end", () => {
          reject(new Error("response should not complete after abort"));
        });
      });
      req.on("error", resolve);
      req.end();

      const err = await promise;
      expect(err.name).toBe("AbortError");
      expect((err as any).code).toBe("ABORT_ERR");
    } finally {
      server.close();
    }
  });

  it("emits 'error' with AbortError when AbortSignal.timeout fires during connect to an unreachable host", async () => {
    // Original #31167 repro: connect hangs (blackhole / no SYN-ACK) and the
    // signal must still settle `req.on('error')` promptly. If no timeout is set,
    // callers hang until the OS TCP timeout.
    const signal = AbortSignal.timeout(150);
    const t0 = Date.now();
    const { promise, resolve, reject } = Promise.withResolvers<Error>();

    const req = request("http://10.255.255.1/hang", { signal }, () => {
      reject(new Error("unexpected response from unreachable host"));
    });
    req.on("error", resolve);
    req.end();

    const err = await promise;
    expect(err.name).toBe("AbortError");
    expect((err as any).code).toBe("ABORT_ERR");
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
