// A copy of the Request that Bun.serve passed to the handler (`req.clone()`,
// `new Request(req)`, `new Request(req, init)`, `new Request(url, req)`) keeps
// the connection: server.requestIP(), server.timeout() and server.upgrade()
// accept it exactly like the original. The usual reason a copy exists is a
// framework or middleware that re-wraps the request before user code sees it.
import { describe, expect, test } from "bun:test";

type Copies = Record<string, Request>;

function makeCopies(req: Request): Copies {
  return {
    original: req,
    clone: req.clone(),
    construct: new Request(req),
    constructWithInit: new Request(req, { headers: { "x-rewrapped": "1" } }),
    constructWithUrl: new Request(req.url + "?rewritten", req),
  };
}

const requestIPs = (server: Bun.Server, copies: Copies) =>
  Object.fromEntries(Object.entries(copies).map(([name, request]) => [name, server.requestIP(request)]));

describe.concurrent("copies of the server's Request keep the connection", () => {
  test("server.requestIP()", async () => {
    let lastCopies: Copies | undefined;
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      routes: {
        "/routes/:id": (req, server) => {
          const clone = req.clone();
          return Response.json({
            params: clone.params,
            clone: server.requestIP(clone)?.address,
            construct: server.requestIP(new Request(req))?.address,
          });
        },
      },
      fetch(req, server) {
        lastCopies = makeCopies(req);
        return Response.json(requestIPs(server, lastCopies));
      },
    });

    const address = { address: "127.0.0.1", family: "IPv4", port: expect.any(Number) };
    expect(await fetch(new URL("/fetch", server.url)).then(r => r.json())).toEqual({
      original: address,
      clone: address,
      construct: address,
      constructWithInit: address,
      constructWithUrl: address,
    });

    expect(await fetch(new URL("/routes/42", server.url)).then(r => r.json())).toEqual({
      params: { id: "42" },
      clone: "127.0.0.1",
      construct: "127.0.0.1",
    });

    // Once the request has ended, every copy is detached like the original.
    expect(requestIPs(server, lastCopies!)).toEqual({
      original: null,
      clone: null,
      construct: null,
      constructWithInit: null,
      constructWithUrl: null,
    });
  });

  test("copies collected before the request ends are forgotten safely", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req, server) {
        let seen = 0;
        for (let i = 0; i < 200; i++) {
          if (server.requestIP(new Request(req))?.address === "127.0.0.1") seen++;
          if (i % 64 === 63) Bun.gc(true);
        }
        await Bun.sleep(0);
        Bun.gc(true);
        return Response.json({ seen, afterGC: server.requestIP(req.clone())?.address });
      },
    });
    for (let i = 0; i < 3; i++) {
      expect(await fetch(server.url).then(r => r.json())).toEqual({ seen: 200, afterGC: "127.0.0.1" });
      Bun.gc(true);
    }
  });

  const upgradeCopies = {
    "req.clone()": (req: Request) => req.clone(),
    "new Request(req, init)": (req: Request) => new Request(req, { headers: { "x-rewrapped": "1" } }),
    // https://github.com/oven-sh/bun/issues/11382: rewrite the URL behind a proxy, then upgrade.
    "new Request(url, req)": (req: Request) => new Request(req.url.replace("/ws", "/rewritten"), req),
  };
  for (const [kind, makeCopy] of Object.entries(upgradeCopies)) {
    test(`server.upgrade(${kind})`, async () => {
      let afterUpgrade: unknown;
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        websocket: {
          open(ws) {
            ws.send("hello");
          },
          message() {},
        },
        fetch(req, server) {
          const copy = makeCopy(req);
          if (server.upgrade(copy)) {
            // The upgrade consumed the connection, so the original is detached
            // too, with its url and headers captured first.
            afterUpgrade = {
              requestIP: server.requestIP(req),
              upgradeAgain: server.upgrade(req),
              url: req.url,
              key: typeof req.headers.get("sec-websocket-key"),
            };
            return;
          }
          return new Response("server.upgrade() returned false", { status: 400 });
        },
      });

      const { promise, resolve, reject } = Promise.withResolvers<unknown>();
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      ws.onmessage = e => resolve(e.data);
      ws.onerror = e => reject(new Error((e as ErrorEvent).message));
      ws.onclose = e => reject(new Error(`closed before a message: ${e.code} ${e.reason}`));
      expect(await promise).toBe("hello");
      ws.close();
      expect(afterUpgrade).toEqual({
        requestIP: null,
        upgradeAgain: false,
        url: `http://127.0.0.1:${server.port}/ws`,
        key: "string",
      });
    });
  }

  test("server.timeout(copy, seconds)", async () => {
    const { promise: aborted, resolve } = Promise.withResolvers<boolean>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      // Long enough that only the per-request timeout set below can fire.
      idleTimeout: 120,
      async fetch(req, server) {
        const copy = new Request(req, { headers: { "x-rewrapped": "1" } });
        req.signal.addEventListener("abort", () => resolve(true));
        // Shorten the idle timeout through the copy. With no connection behind
        // the copy this did nothing, and the request ran to the deadline below.
        server.timeout(copy, 1);
        resolve(await Promise.race([aborted, Bun.sleep(15_000).then(() => false)]));
        return new Response("too late");
      },
    });

    const response = fetch(server.url).then(
      r => r.text(),
      e => `fetch failed: ${e?.code ?? e}`,
    );
    expect(await aborted).toBe(true);
    expect(await response).toStartWith("fetch failed:");
  }, 30_000);
});
