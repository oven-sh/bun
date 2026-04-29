import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

describe("node:http Agent socket accounting", () => {
  test("agent.sockets and agent.requests are populated and maxSockets is enforced", async () => {
    const agent = new http.Agent({ maxSockets: 1 });

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Length": "12" });
      res.end("hello world\n");
    });
    server.listen(0);
    try {
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;
      const name = agent.getName({ port });

      const snapshots: Array<{ sockets: number | undefined; requests: number | undefined }> = [];
      const done: Promise<void>[] = [];

      for (let i = 0; i < 3; i++) {
        const { promise, resolve } = Promise.withResolvers<void>();
        done.push(promise);
        http
          .get({ path: "/", headers: { connection: "keep-alive" }, port, agent }, res => {
            snapshots.push({
              sockets: agent.sockets[name]?.length,
              requests: agent.requests[name]?.length,
            });
            res.on("end", resolve);
            res.on("error", resolve);
            res.resume();
          })
          .on("error", resolve);
      }

      // Synchronously after issuing all three: one in-flight, two queued.
      expect(agent.sockets[name]).toBeDefined();
      expect(agent.sockets[name]!.length).toBe(1);
      expect(agent.requests[name]).toBeDefined();
      expect(agent.requests[name]!.length).toBe(2);
      expect(agent.totalSocketCount).toBe(1);

      await Promise.all(done);

      // Inside each 'response' callback the count was 1 and the queue drained
      // one at a time. The third request sees the queue key deleted.
      expect(snapshots).toEqual([
        { sockets: 1, requests: 2 },
        { sockets: 1, requests: 1 },
        { sockets: 1, requests: undefined },
      ]);

      // Let the last release happen (nextTick after the final 'end').
      await new Promise<void>(r => setImmediate(() => setImmediate(r)));
      expect(name in agent.sockets).toBe(false);
      expect(name in agent.requests).toBe(false);
      expect(agent.totalSocketCount).toBe(0);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("agent.sockets caps at maxSockets and overflow queues into agent.requests", async () => {
    const agent = new http.Agent({ maxSockets: 10 });

    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end("Hello World\n");
    });
    server.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;
      const name = agent.getName({ host: "127.0.0.1", port });

      const N = 20;
      const samples: Array<{ sockets: number; queued: number }> = [];
      const done: Promise<void>[] = [];

      for (let i = 0; i < N; i++) {
        const { promise, resolve } = Promise.withResolvers<void>();
        done.push(promise);
        http
          .get({ host: "127.0.0.1", port, agent }, res => {
            res.on("end", resolve);
            res.on("error", resolve);
            res.resume();
          })
          .on("error", resolve);

        samples.push({
          sockets: agent.sockets[name]?.length ?? 0,
          queued: agent.requests[name]?.length ?? 0,
        });
      }

      // 1..10 then capped at 10; queued 0×10 then 1..10.
      expect(samples).toEqual(
        Array.from({ length: N }, (_, i) => ({
          sockets: Math.min(i + 1, 10),
          queued: Math.max(0, i + 1 - 10),
        })),
      );
      const maxQueued = Math.max(...samples.map(s => s.queued));
      expect(maxQueued).toBeLessThanOrEqual(10);

      await Promise.all(done);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("socket emits 'connect' after the request 'socket' event", async () => {
    const agent = new http.Agent({ maxSockets: 1 });

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Length": "2", Connection: "close" });
      res.end("ok");
    });
    server.listen(0);
    try {
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;

      let connectCount = 0;
      const done: Promise<void>[] = [];
      for (let i = 0; i < 3; i++) {
        const { promise, resolve } = Promise.withResolvers<void>();
        done.push(promise);
        const req = http.request({ port, agent, headers: { connection: "keep-alive" } }, res => {
          res.on("end", resolve);
          res.on("error", resolve);
          res.resume();
        });
        req.on("error", resolve);
        req.on("socket", s => {
          s.on("connect", () => {
            connectCount++;
          });
        });
        req.end();
      }

      await Promise.all(done);
      expect(connectCount).toBe(3);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("aborting a request releases exactly one agent slot", async () => {
    const agent = new http.Agent({ maxSockets: 2 });

    const server = http.createServer(() => {
      // never respond
    });
    server.listen(0);
    try {
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;
      const name = agent.getName({ port });

      const reqs: http.ClientRequest[] = [];
      for (let i = 0; i < 2; i++) {
        const req = http.request({ port, agent });
        req.on("error", () => {});
        req.end();
        reqs.push(req);
      }

      expect(agent.totalSocketCount).toBe(2);
      expect(agent.sockets[name]!.length).toBe(2);

      for (const r of reqs) r.abort();
      await new Promise<void>(r => setImmediate(() => setImmediate(r)));

      // Each abort must decrement exactly once — not once for 'close' and
      // again for 'agentRemove'.
      expect(agent.totalSocketCount).toBe(0);
      expect(name in agent.sockets).toBe(false);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("destroying a queued request emits 'close' and removes it from agent.requests", async () => {
    const agent = new http.Agent({ maxSockets: 1 });

    const server = http.createServer(() => {
      // never respond
    });
    server.listen(0);
    try {
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;
      const name = agent.getName({ port });

      const r1 = http.get({ port, agent }, () => {});
      r1.on("error", () => {});
      const r2 = http.get({ port, agent }, () => {});
      r2.on("error", () => {});

      // r2 is queued (no socket slot yet, no AbortController created).
      expect(agent.requests[name]!.length).toBe(1);

      const closed = once(r2, "close");
      r2.destroy();
      // Must emit 'close' even though the onAbort path was never set up.
      await closed;

      expect(r2.destroyed).toBe(true);
      expect(name in agent.requests).toBe(false);
      // r1 still holds its slot.
      expect(agent.totalSocketCount).toBe(1);

      r1.destroy();
      await new Promise<void>(r => setImmediate(() => setImmediate(r)));
      expect(agent.totalSocketCount).toBe(0);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("onSocket(null, err) from a custom agent emits 'error' then 'close'", async () => {
    class FailingAgent extends http.Agent {
      addRequest(req: any) {
        process.nextTick(() => req.onSocket(null, new Error("tunnel failed")));
      }
    }
    const events: string[] = [];
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    const req = http.get({ host: "example.com", port: 80, agent: new FailingAgent() });
    req.on("error", e => events.push(`error:${(e as Error).message}`));
    req.on("close", () => {
      events.push("close");
      resolve();
    });
    await closed;
    expect(events).toEqual(["error:tunnel failed", "close"]);
    expect(req.destroyed).toBe(true);
  });

  test("a failing options.lookup releases the agent slot", async () => {
    const agent = new http.Agent({ maxSockets: 1 });
    try {
      const name = agent.getName({ host: "example.test", port: 80 });
      const makeReq = (lookup: (...a: any[]) => void) =>
        http
          .get({ host: "example.test", port: 80, agent, lookup } as any, () => {})
          .on("error", () => {});

      // Callback error
      makeReq((_h, _o, cb) => cb(new Error("boom")));
      await new Promise<void>(r => setImmediate(() => setImmediate(r)));
      expect(agent.totalSocketCount).toBe(0);
      expect(name in agent.sockets).toBe(false);

      // No records (ENOTFOUND)
      makeReq((_h, _o, cb) => cb(null, []));
      await new Promise<void>(r => setImmediate(() => setImmediate(r)));
      expect(agent.totalSocketCount).toBe(0);
      expect(name in agent.sockets).toBe(false);

      // Synchronous throw
      makeReq(() => {
        throw new Error("sync boom");
      });
      await new Promise<void>(r => setImmediate(() => setImmediate(r)));
      expect(agent.totalSocketCount).toBe(0);
      expect(name in agent.sockets).toBe(false);
      expect(name in agent.requests).toBe(false);
    } finally {
      agent.destroy();
    }
  });
});
