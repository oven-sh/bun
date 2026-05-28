import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";

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

  test("a request queued by maxTotalSockets is dequeued across origins when a slot frees", async () => {
    // maxSockets: 1 per origin, maxTotalSockets: 2 global. removeSocket's
    // cross-origin scan must `continue` past an origin that is at its own
    // maxSockets (not `break`), otherwise a request queued purely by
    // maxTotalSockets under a different origin is starved behind it.
    //
    // Setup — three origins A, B, C:
    //   A: a1 holds A's only slot (server A never responds) + a2 queued on A
    //   B: b1 holds the 2nd/last global slot; B has NO queued request
    //   C: cQueued queued purely by maxTotalSockets (both slots were full)
    // When b1 frees, removeSocket(name=B) finds requests[B] empty and scans
    // Object.keys(requests) = [A, C]. With `break` it aborts at A (which has an
    // active socket) and cQueued is never serviced. With `continue` it skips A
    // and dispatches cQueued into the freed global slot — the Node behavior.
    const agent = new http.Agent({ maxSockets: 1, maxTotalSockets: 2 });

    const heldA: Array<() => void> = [];
    let hitsC = 0;
    const serverA = http.createServer(() => {}); // never responds — holds A's slot
    const serverB = http.createServer((req, res) => res.end("b"));
    const serverC = http.createServer((req, res) => {
      hitsC++;
      res.end("c");
    });
    serverA.listen(0);
    serverB.listen(0);
    serverC.listen(0);
    try {
      await Promise.all([once(serverA, "listening"), once(serverB, "listening"), once(serverC, "listening")]);
      const portA = (serverA.address() as AddressInfo).port;
      const portB = (serverB.address() as AddressInfo).port;
      const portC = (serverC.address() as AddressInfo).port;
      const nameC = agent.getName({ port: portC });

      const get = (port: number) => {
        const req = http.get({ port, agent }, res => res.resume());
        req.on("error", () => {});
        return req;
      };

      // a1 takes origin A's only slot; wait until it actually reaches A so the
      // socket is tracked before we saturate the global limit.
      const a1Hit = once(serverA, "request");
      get(portA);
      await a1Hit;

      // a2 queued under A (A is at maxSockets=1). Insert A into requests first.
      get(portA);

      // b1 takes the 2nd and last global slot.
      const b1Hit = once(serverB, "request");
      const b1 = get(portB);
      const b1Closed = once(b1, "close");
      await b1Hit;

      // cQueued queued under C purely by maxTotalSockets (total is now 2).
      const cQueued = get(portC);
      const cQueuedClosed = once(cQueued, "close");

      expect(agent.requests[agent.getName({ port: portA })]?.length).toBe(1);
      expect(agent.requests[nameC]?.length).toBe(1);

      // b1 completes → frees a global slot under origin B (no queued request on
      // B) → cross-origin scan must reach C.
      await b1Closed;
      await cQueuedClosed;

      expect(cQueued.destroyed).toBe(false);
      expect(hitsC).toBe(1); // cQueued reached server C
      expect(nameC in agent.requests).toBe(false); // C's queue drained

      heldA.shift()?.();
    } finally {
      agent.destroy();
      serverA.close();
      serverB.close();
      serverC.close();
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

  test("aborting a queued request's signal removes it from the queue and never dispatches it", async () => {
    const agent = new http.Agent({ maxSockets: 1 });

    let hits = 0;
    const { promise: firstHit, resolve: onFirstHit } = Promise.withResolvers<void>();
    const responses: Array<() => void> = [];
    const server = http.createServer((req, res) => {
      hits++;
      if (hits === 1) onFirstHit();
      // Hold the response so the first request keeps the only slot until we
      // release it; the second request stays queued.
      responses.push(() => res.end("ok"));
    });
    server.listen(0);
    try {
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;
      const name = agent.getName({ port });

      // r1 takes the only slot.
      const r1 = http.get({ port, agent }, res => res.resume());
      r1.on("error", () => {});

      // r2 is queued behind maxSockets: no socket slot, no AbortController yet.
      const ac = new AbortController();
      const r2 = http.get({ port, agent, signal: ac.signal }, () => {});
      r2.on("error", () => {});
      const r2Closed = once(r2, "close");

      await firstHit;
      expect(agent.requests[name]!.length).toBe(1);

      // Aborting the queued request's signal must destroy it and drop it from
      // the queue — not leave it to be dispatched when r1's slot frees. The
      // AbortController is still null here, so aborting it alone would be a
      // no-op.
      ac.abort();
      await r2Closed;
      expect(r2.destroyed).toBe(true);
      expect(name in agent.requests).toBe(false);

      // Free r1's slot. If r2 were still queued it would now be dispatched,
      // pushing hits to 2.
      responses.shift()!();
      await once(r1, "close");
      await new Promise<void>(r => setImmediate(() => setImmediate(r)));

      // Only r1 ever reached the server.
      expect(hits).toBe(1);
      expect(agent.totalSocketCount).toBe(0);
      expect(name in agent.sockets).toBe(false);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("a queued request with an already-aborted signal is never dispatched", async () => {
    const agent = new http.Agent({ maxSockets: 1 });

    let hits = 0;
    const { promise: firstHit, resolve: onFirstHit } = Promise.withResolvers<void>();
    const responses: Array<() => void> = [];
    const server = http.createServer((req, res) => {
      hits++;
      if (hits === 1) onFirstHit();
      responses.push(() => res.end("ok"));
    });
    server.listen(0);
    try {
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;
      const name = agent.getName({ port });

      // r1 takes the only slot.
      const r1 = http.get({ port, agent }, res => res.resume());
      r1.on("error", () => {});
      await firstHit;

      // r2's signal is ALREADY aborted when the request is created. A plain
      // addEventListener('abort') listener never fires for an already-aborted
      // signal, so the request would stay queued and get dispatched once r1's
      // slot frees. The pre-aborted case must be handled explicitly.
      const ac = new AbortController();
      ac.abort();
      const r2 = http.get({ port, agent, signal: ac.signal }, () => {});
      r2.on("error", () => {});
      const r2Closed = once(r2, "close");

      await r2Closed;
      expect(r2.destroyed).toBe(true);
      expect(name in agent.requests).toBe(false);

      // Free r1's slot. If r2 were still queued it would now be dispatched.
      responses.shift()!();
      await once(r1, "close");
      await new Promise<void>(r => setImmediate(() => setImmediate(r)));

      // Only r1 ever reached the server.
      expect(hits).toBe(1);
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
        http.get({ host: "example.test", port: 80, agent, lookup } as any, () => {}).on("error", () => {});

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

  test("a malformed Content-Length response releases the agent slot", async () => {
    const agent = new http.Agent({ maxSockets: 1 });
    const server = net.createServer(s => {
      s.on("data", () => s.end("HTTP/1.1 200 OK\r\nContent-Length: 5, 7\r\n\r\nhello"));
    });
    server.listen(0);
    try {
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;
      const name = agent.getName({ port });

      const { promise, resolve } = Promise.withResolvers<string>();
      http.get({ port, agent }, () => resolve("response")).on("error", (e: any) => resolve(e?.code ?? "error"));
      const result = await promise;
      // The response is rejected with a parse error before 'response' fires,
      // so the res 'end'/'close' hooks never run; the slot must be released
      // on the error path.
      expect(result).toBe("HPE_UNEXPECTED_CONTENT_LENGTH");

      await new Promise<void>(r => setImmediate(() => setImmediate(r)));
      expect(agent.totalSocketCount).toBe(0);
      expect(name in agent.sockets).toBe(false);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("a request with an already-aborted signal releases the agent slot", async () => {
    const agent = new http.Agent({ maxSockets: 1 });
    const server = http.createServer((req, res) => res.end("ok"));
    server.listen(0);
    try {
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;
      const name = agent.getName({ port });

      // With a pre-aborted signal, the fetch resolves but the .then handler
      // sees this.aborted=true and returns early before installing the
      // res 'end'/'close' release hooks. The slot must still be released.
      const ac = new AbortController();
      ac.abort();
      const { promise, resolve } = Promise.withResolvers<void>();
      const req = http.get({ port, agent, signal: ac.signal }, () => {});
      req.on("error", () => {});
      req.on("close", resolve);
      await promise;

      await new Promise<void>(r => setImmediate(() => setImmediate(r)));
      expect(agent.totalSocketCount).toBe(0);
      expect(name in agent.sockets).toBe(false);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("a pre-aborted signal does not dispatch and keeps 'close' terminal", async () => {
    const agent = new http.Agent({ maxSockets: 1 });
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits++;
      res.end("ok");
    });
    server.listen(0);
    try {
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;

      const ac = new AbortController();
      ac.abort();

      const events: string[] = [];
      const req = http.get({ port, agent, signal: ac.signal });
      for (const e of ["socket", "prefinish", "finish", "close", "abort"]) {
        req.on(e, () => events.push(e));
      }
      req.on("error", () => {});

      await once(req, "close");
      // Give any stray deferred ticks (finish/prefinish) a chance to fire.
      await new Promise<void>(r => setImmediate(() => setImmediate(r)));

      // The stream-completion events must not fire for an aborted request, and
      // in particular must not appear after 'close' (which breaks the terminal
      // contract). 'abort' after 'close' matches req.abort()'s own ordering.
      expect(events).not.toContain("prefinish");
      expect(events).not.toContain("finish");
      const closeIdx = events.indexOf("close");
      expect(closeIdx).toBeGreaterThanOrEqual(0);
      // Nothing but (optionally) 'abort' may follow 'close'.
      expect(events.slice(closeIdx + 1).filter(e => e !== "abort")).toEqual([]);

      // An already-aborted request is never dispatched to the server.
      expect(hits).toBe(0);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("a shared signal aborted after a request completes does not re-abort it", async () => {
    const agent = new http.Agent({ maxSockets: 2 });
    const server = http.createServer((req, res) => res.end("ok"));
    server.listen(0);
    try {
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;

      // One signal shared across a batch (e.g. AbortSignal.timeout). The
      // request finishes well before the signal fires.
      const ac = new AbortController();

      let aborted = false;
      const req = http.get({ port, agent, signal: ac.signal }, res => res.resume());
      req.on("error", () => {});
      req.on("abort", () => {
        aborted = true;
      });
      await once(req, "close");

      expect(req.complete).toBe(true);
      expect(req.destroyed).toBe(false);

      // Firing the shared signal now must be a no-op for the already-completed
      // request: no 'abort' event, no post-completion destroy().
      ac.abort();
      await new Promise<void>(r => setImmediate(() => setImmediate(r)));

      expect(aborted).toBe(false);
      expect(req.destroyed).toBe(false);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("agent.destroy() destroys every tracked socket", async () => {
    // FakeSocket.destroy() → req.destroy() → onAbort → releaseAgentSocket
    // splices the live agent.sockets[name] array synchronously; iterating
    // by forward index would skip every other entry.
    const agent = new http.Agent({ maxSockets: 10 });
    const server = http.createServer(() => {});
    server.listen(0);
    try {
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;
      const name = agent.getName({ port });

      const reqs: http.ClientRequest[] = [];
      for (let i = 0; i < 6; i++) {
        const r = http.get({ port, agent }, () => {});
        r.on("error", () => {});
        reqs.push(r);
      }
      expect(agent.sockets[name]!.length).toBe(6);
      expect(agent.totalSocketCount).toBe(6);

      agent.destroy();
      await new Promise<void>(r => setImmediate(() => setImmediate(r)));

      for (const r of reqs) expect(r.destroyed).toBe(true);
      expect(agent.totalSocketCount).toBe(0);
      expect(name in agent.sockets).toBe(false);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("requests that omit port are tracked under the defaulted port key", () => {
    const agent = new http.Agent();
    try {
      // Don't need a real server — addRequest populates agent.sockets
      // synchronously. Just check the key format.
      http.get({ host: "127.0.0.1", agent }, () => {}).on("error", () => {});
      const keys = Object.keys(agent.sockets);
      // Node.js writes the defaulted port back onto options, so the key is
      // '127.0.0.1:80:' — not '127.0.0.1::'. If the port weren't written
      // back, requests with and without an explicit port: 80 would land in
      // separate maxSockets pools for the same origin.
      expect(keys).toEqual(["127.0.0.1:80:"]);
      expect(agent.sockets["127.0.0.1::"]).toBeUndefined();
    } finally {
      agent.destroy();
    }
  });

  test("agent.on('keylog', ...) does not throw when sockets are tracked", () => {
    // maybeEnableKeylog iterates Object.values(this.sockets), which is
    // Socket[][] — each value is an array of sockets. Before agent.sockets
    // was populated this was dead code; now calling .on() on an array
    // would throw.
    const agent = new http.Agent();
    try {
      http.get({ host: "127.0.0.1", agent }, () => {}).on("error", () => {});
      expect(Object.keys(agent.sockets).length).toBeGreaterThan(0);
      expect(() => agent.on("keylog", () => {})).not.toThrow();
    } finally {
      agent.destroy();
    }
  });

  test("flushHeaders() on a bodiless GET that gets a response before end() releases the slot", async () => {
    const agent = new http.Agent({ maxSockets: 1 });
    const { promise: serverGotRequest, resolve: onServerRequest } = Promise.withResolvers<void>();
    const server = http.createServer((req, res) => {
      res.end("ok");
      onServerRequest();
    });
    server.listen(0);
    try {
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;
      const name = agent.getName({ port });

      const { promise: responseEnded, resolve: onResponseEnd } = Promise.withResolvers<void>();
      const req = http.request({ port, agent }, res => {
        res.on("end", onResponseEnd);
        res.on("error", onResponseEnd);
        res.resume();
      });
      req.on("error", () => {});
      // flushHeaders() starts a duplex fetch with no body generator for a
      // GET with no write()s. If the server responds before end(), the
      // .then handler runs while onEnd is still the initial no-op, so
      // handleResponse() (which installs the res 'end'/'close' release
      // hooks) would never be called.
      req.flushHeaders();
      // Wait for the server to have responded. There is no JS-observable
      // signal that the client's .then handler has stashed handleResponse
      // (that's the point of this test), so after the server fires we
      // yield real time to the OS scheduler so the HTTP client thread can
      // post the response — setImmediate alone would only yield to other
      // JS tasks on this thread.
      await serverGotRequest;
      for (let i = 0; i < 20; i++) await Bun.sleep(1);
      req.end();

      // After end(), send() reassigns onEnd and calls it, which invokes
      // handleResponse → 'response' fires → res consumed → slot released.
      await responseEnded;
      while (agent.totalSocketCount > 0) await Bun.sleep(1);
      expect(agent.totalSocketCount).toBe(0);
      expect(name in agent.sockets).toBe(false);
    } finally {
      agent.destroy();
      server.close();
    }
  });
});
