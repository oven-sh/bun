/**
 * All tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 */

import { describe, test } from "node:test";
import assert from "node:assert";
import diagnostics_channel from "node:diagnostics_channel";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http, { Agent, createServer, request as httpRequest } from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

// Helper to make a request and get the response.
// Uses a shared agent so that all requests go through the same TCP connection,
// which is critical for actually testing the keep-alive / proxy-URL bug.
function makeRequest(
  port: number,
  path: string,
  agent: Agent,
): Promise<{ statusCode: number; body: string; url: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET", agent }, res => {
      let body = "";
      res.on("data", chunk => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode!, body, url: path });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function listenOnRandomPort(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(addr.port);
    });
  });
}

describe("HTTP server with proxy-style absolute URLs", () => {
  test("sequential GET requests with absolute URL paths don't hang", async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(req.url);
    });

    const port = await listenOnRandomPort(server);

    try {
      // Make 3 sequential requests with proxy-style absolute URLs
      // Before the fix, request 2 would hang because the parser entered tunnel mode
      const r1 = await makeRequest(port, "http://example.com/test1", agent);
      assert.strictEqual(r1.statusCode, 200);
      assert.ok(r1.body.includes("example.com"), `Expected body to contain "example.com", got: ${r1.body}`);
      assert.ok(r1.body.includes("/test1"), `Expected body to contain "/test1", got: ${r1.body}`);

      const r2 = await makeRequest(port, "http://example.com/test2", agent);
      assert.strictEqual(r2.statusCode, 200);
      assert.ok(r2.body.includes("example.com"), `Expected body to contain "example.com", got: ${r2.body}`);
      assert.ok(r2.body.includes("/test2"), `Expected body to contain "/test2", got: ${r2.body}`);

      const r3 = await makeRequest(port, "http://other.com/test3", agent);
      assert.strictEqual(r3.statusCode, 200);
      assert.ok(r3.body.includes("other.com"), `Expected body to contain "other.com", got: ${r3.body}`);
      assert.ok(r3.body.includes("/test3"), `Expected body to contain "/test3", got: ${r3.body}`);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("sequential POST requests with absolute URL paths don't hang", async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", chunk => {
        body += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(`${req.method} ${req.url} body=${body}`);
      });
    });

    const port = await listenOnRandomPort(server);

    try {
      for (let i = 1; i <= 3; i++) {
        const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
          const req = httpRequest(
            {
              host: "127.0.0.1",
              port,
              path: `http://example.com/post${i}`,
              method: "POST",
              headers: { "Content-Type": "text/plain" },
              agent,
            },
            res => {
              let body = "";
              res.on("data", chunk => {
                body += chunk;
              });
              res.on("end", () => {
                resolve({ statusCode: res.statusCode!, body });
              });
            },
          );
          req.on("error", reject);
          req.write(`data${i}`);
          req.end();
        });
        assert.strictEqual(result.statusCode, 200);
        assert.ok(result.body.includes(`/post${i}`), `Expected body to contain "/post${i}", got: ${result.body}`);
        assert.ok(result.body.includes(`body=data${i}`), `Expected body to contain "body=data${i}", got: ${result.body}`);
      }
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("mixed normal and proxy-style URLs work sequentially", async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(req.url);
    });

    const port = await listenOnRandomPort(server);

    try {
      // Mix of normal and proxy-style URLs
      const r1 = await makeRequest(port, "/normal1", agent);
      assert.strictEqual(r1.statusCode, 200);
      assert.ok(r1.body.includes("/normal1"), `Expected body to contain "/normal1", got: ${r1.body}`);

      const r2 = await makeRequest(port, "http://example.com/proxy1", agent);
      assert.strictEqual(r2.statusCode, 200);
      assert.ok(r2.body.includes("example.com"), `Expected body to contain "example.com", got: ${r2.body}`);
      assert.ok(r2.body.includes("/proxy1"), `Expected body to contain "/proxy1", got: ${r2.body}`);

      const r3 = await makeRequest(port, "/normal2", agent);
      assert.strictEqual(r3.statusCode, 200);
      assert.ok(r3.body.includes("/normal2"), `Expected body to contain "/normal2", got: ${r3.body}`);

      const r4 = await makeRequest(port, "http://other.com/proxy2", agent);
      assert.strictEqual(r4.statusCode, 200);
      assert.ok(r4.body.includes("other.com"), `Expected body to contain "other.com", got: ${r4.body}`);
      assert.ok(r4.body.includes("/proxy2"), `Expected body to contain "/proxy2", got: ${r4.body}`);
    } finally {
      agent.destroy();
      server.close();
    }
  });
});

const { setGlobalProxyFromEnv } = http as any;

describe(
  "ERR_PROXY_INVALID_CONFIG for a proxy URL that does not parse",
  { skip: typeof setGlobalProxyFromEnv !== "function" },
  () => {
    // Node prints the userinfo of the proxy URL in these messages. Bun removes it.
    const printsUserinfo = process.versions.bun === undefined;

    // [name, proxy URL, the same URL without its userinfo]
    const cases = [
      ["no credentials", "http://proxy.example.com:99999", "http://proxy.example.com:99999"],
      ["no credentials, LF in the host", "http://proxy.exa\nmple.com:8080", "http://proxy.exa\nmple.com:8080"],
      ["port out of range", "http://user:s3cret@proxy.example.com:99999", "http://proxy.example.com:99999"],
      ["LF in the password", "http://user:s3c\nret@proxy.example.com:8080", "http://proxy.example.com:8080"],
      ["unescaped / in the password", "http://user:s3/cret@proxy.example.com:8080", "http://proxy.example.com:8080"],
      ["unescaped @ in the password", "http://user:s3@cret@proxy.example.com:99999", "http://proxy.example.com:99999"],
      ["space in the host", "http://user:s3cret@proxy example.com:8080", "http://proxy example.com:8080"],
    ];

    for (const [name, proxyUrl, withoutUserinfo] of cases) {
      test(name, () => {
        const printed = printsUserinfo ? proxyUrl : withoutUserinfo;
        const prefixed = `Invalid proxy URL: ${printed}`;

        assert.throws(() => new Agent({ proxyEnv: { HTTP_PROXY: proxyUrl } } as any), {
          code: "ERR_PROXY_INVALID_CONFIG",
          message: prefixed,
        });
        assert.throws(() => new https.Agent({ proxyEnv: { HTTPS_PROXY: proxyUrl } } as any), {
          code: "ERR_PROXY_INVALID_CONFIG",
          message: prefixed,
        });

        // setGlobalProxyFromEnv() prints the bare URL. CR and LF are the exception: the shared
        // environment parser rejects them first, with the prefix.
        const message = /[\r\n]/.test(proxyUrl) ? prefixed : printed;
        for (const variable of ["HTTP_PROXY", "HTTPS_PROXY"]) {
          // Call the returned restore function, so that a missing throw does not replace the global agents.
          assert.throws(() => setGlobalProxyFromEnv({ [variable]: proxyUrl })(), {
            code: "ERR_PROXY_INVALID_CONFIG",
            message,
          });
        }
      });
    }
  },
);

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
// Self-signed, for localhost and 127.0.0.1.
const cert = readFileSync(join(fixtures, "cert.pem"), "utf8");
const key = readFileSync(join(fixtures, "cert.key"), "utf8");

function proxiedAgent(proxyUrl: string, options: https.AgentOptions = {}, AgentClass = https.Agent) {
  return new AgentClass({ ...options, proxyEnv: { https_proxy: proxyUrl } } as any);
}

// What the request emits, in order, up to and including its 'close'.
function eventsOf(req: http.ClientRequest) {
  const events: unknown[] = [];
  const { promise, resolve } = Promise.withResolvers<unknown[]>();
  req.on("socket", () => events.push("socket"));
  req.on("response", res => {
    events.push(`response ${res.statusCode}`);
    res.resume();
  });
  req.on("abort", () => events.push("abort"));
  req.on("error", (err: NodeJS.ErrnoException) => events.push({ code: err.code, message: err.message }));
  req.on("close", () => {
    events.push("close");
    resolve(events);
  });
  return promise;
}

// Counts the turns of the process.nextTick queue, from the failure callback of agent.createConnection() on.
function countTurns(agent: Agent) {
  const turns = { count: -1 };
  const createConnection = agent.createConnection;
  agent.createConnection = function (this: Agent, options: any, callback: any) {
    return createConnection.call(this, options, (err: Error | null, socket: Duplex) => {
      if (err && turns.count === -1) {
        turns.count = 0;
        const next = () => {
          if (++turns.count < 8) process.nextTick(next);
        };
        // Queued before the callback runs. What the callback queues runs on turn 1.
        process.nextTick(next);
      }
      callback(err, socket);
    });
  };
  return turns;
}

// On which turn the request emits 'error' and 'close'.
function turnsOf(req: http.ClientRequest, turns: { count: number }) {
  const events: string[] = [];
  const { promise, resolve } = Promise.withResolvers<string[]>();
  req.on("error", () => events.push(`error @${turns.count}`));
  req.on("close", () => {
    events.push(`close @${turns.count}`);
    resolve(events);
  });
  return promise;
}

describe(
  "https request through a proxy that ends the connection before the TLS handshake is done",
  { skip: typeof setGlobalProxyFromEnv !== "function" },
  () => {
    const disconnected = {
      code: "ECONNRESET",
      message: "Client network socket disconnected before secure TLS connection was established",
    };
    const target = { host: "example.invalid", port: 443, path: "/" };
    const established = "HTTP/1.1 200 Connection established\r\n\r\n";

    // Every proxy ends its side with end(), after it read all that the client sent. A destroy()
    // with unread bytes is a reset, and a reset takes another path through the client.
    function endWithThe200(socket: net.Socket) {
      socket.on("error", () => {});
      socket.once("data", () => socket.end(established));
    }
    function endOnTheClientHello(socket: net.Socket) {
      socket.on("error", () => {});
      socket.once("data", () => {
        socket.write(established);
        socket.once("data", () => socket.end());
      });
    }
    function endOnTheFirstBytes(socket: net.Socket) {
      socket.on("error", () => {});
      socket.once("data", () => socket.end());
    }

    const routes = [
      { name: "the 200 and the end together", scheme: "http", createProxy: () => net.createServer(endWithThe200) },
      {
        name: "the end when the ClientHello arrives",
        scheme: "http",
        createProxy: () => net.createServer(endOnTheClientHello),
      },
      {
        name: "an https proxy that ends during its own TLS handshake",
        scheme: "https",
        createProxy: () => net.createServer(endOnTheFirstBytes),
      },
      {
        name: "an https proxy, the end when the ClientHello arrives",
        scheme: "https",
        createProxy: () => tls.createServer({ key, cert }, endOnTheClientHello).on("tlsClientError", () => {}),
        trusted: true,
      },
    ];

    for (const { name, scheme, createProxy, trusted } of routes) {
      test(name, async () => {
        const defaults = trusted ? tls.getCACertificates("default") : undefined;
        const proxy = createProxy();
        const agent = proxiedAgent(`${scheme}://127.0.0.1:${await listenOnRandomPort(proxy)}`);
        const turns = countTurns(agent);
        try {
          if (defaults) tls.setDefaultCACertificates([...defaults, cert]);
          const req = https.get({ ...target, agent });
          const ticks = turnsOf(req, turns);
          assert.deepStrictEqual(
            { events: await eventsOf(req), turns: await ticks },
            { events: [disconnected, "close"], turns: ["error @1", "close @1"] },
          );
          assert.strictEqual((agent as any).totalSocketCount, 0);
        } finally {
          agent.destroy();
          proxy.close();
          if (defaults) tls.setDefaultCACertificates(defaults);
        }
      });
    }

    // Runs `makeRequest` against a proxy that ends when the ClientHello arrives.
    async function eventsThroughProxy(makeRequest: (agent: https.Agent, proxyUrl: string) => http.ClientRequest) {
      const proxy = net.createServer(endOnTheClientHello);
      const proxyUrl = `http://127.0.0.1:${await listenOnRandomPort(proxy)}`;
      const agent = proxiedAgent(proxyUrl);
      try {
        return await eventsOf(makeRequest(agent, proxyUrl));
      } finally {
        agent.destroy();
        proxy.close();
      }
    }

    test("a request that was destroyed before the tunnel failed", async () => {
      const events = await eventsThroughProxy(agent => {
        const req = https.get({ ...target, agent });
        req.destroy(new Error("destroyed by the user"));
        return req;
      });
      assert.deepStrictEqual(events, [disconnected, "close"]);
    });

    test("a request that was aborted before the tunnel failed", async () => {
      const events = await eventsThroughProxy(agent => {
        const req = https.get({ ...target, agent });
        req.abort();
        return req;
      });
      assert.deepStrictEqual(events, ["abort", disconnected, "close"]);
    });

    test("new http.ClientRequest with the https: protocol", async () => {
      const events = await eventsThroughProxy(agent => {
        const req = new http.ClientRequest({ ...target, protocol: "https:", agent });
        req.end();
        return req;
      });
      assert.deepStrictEqual(events, [disconnected, "close"]);
    });

    test("the global agent after http.setGlobalProxyFromEnv()", async () => {
      let restore: (() => void) | undefined;
      try {
        const events = await eventsThroughProxy((_agent, proxyUrl) => {
          restore = setGlobalProxyFromEnv({ https_proxy: proxyUrl });
          return https.get(target);
        });
        assert.deepStrictEqual(events, [disconnected, "close"]);
      } finally {
        restore?.();
      }
    });

    test("the error is published once on http.client.request.error", async () => {
      const published: unknown[] = [];
      let request: http.ClientRequest | undefined;
      function onRequestError(message: any) {
        if (message.request === request) published.push(message.error.code);
      }
      diagnostics_channel.subscribe("http.client.request.error", onRequestError);
      try {
        const events = await eventsThroughProxy(agent => (request = https.get({ ...target, agent })));
        assert.deepStrictEqual({ events, published }, { events: [disconnected, "close"], published: ["ECONNRESET"] });
      } finally {
        diagnostics_channel.unsubscribe("http.client.request.error", onRequestError);
      }
    });

    test("a request that waited for a socket behind maxSockets", async () => {
      const answer = Promise.withResolvers<void>();
      // "close", so that the second request cannot take the socket of the first.
      const server = https.createServer({ key, cert }, async (_req, res) => {
        await answer.promise;
        res.setHeader("connection", "close");
        res.end("ok");
      });
      const serverPort = await listenOnRandomPort(server);

      // The first CONNECT gets a tunnel to the server. Each later one gets the 200 and the end.
      let connects = 0;
      const proxy = createServer().on("connect", (_req, socket: net.Socket, head: Buffer) => {
        if (++connects > 1) {
          socket.on("error", () => {});
          socket.write(established);
          socket.once("data", () => socket.end());
          return;
        }
        const upstream = net.connect(serverPort, "127.0.0.1", () => {
          socket.write(established);
          if (head.length > 0) upstream.write(head);
          upstream.pipe(socket);
          socket.pipe(upstream);
        });
        upstream.on("error", () => socket.destroy());
        socket.on("error", () => upstream.destroy());
      });
      const agent = proxiedAgent(`http://127.0.0.1:${await listenOnRandomPort(proxy)}`, { maxSockets: 1 });
      const turns = countTurns(agent);
      try {
        const options = { host: "127.0.0.1", port: serverPort, path: "/", agent, rejectUnauthorized: false };
        const first = https.get(options);
        const firstEvents = eventsOf(first);
        await once(first, "socket");

        const second = https.get(options);
        const secondEvents = eventsOf(second);
        const secondTurns = turnsOf(second, turns);
        assert.strictEqual(Object.values(agent.requests).flat().length, 1);

        // The socket of the first request closes after its response. Only then the agent opens one for the second.
        answer.resolve();
        assert.deepStrictEqual(
          { first: await firstEvents, second: await secondEvents, turns: await secondTurns, connects },
          {
            first: ["socket", "response 200", "close"],
            second: [disconnected, "close"],
            turns: ["error @1", "close @1"],
            connects: 2,
          },
        );
      } finally {
        answer.resolve();
        agent.destroy();
        proxy.close();
        server.close();
      }
    });
  },
);

describe(
  "https.Agent and a proxy that refuses the CONNECT and holds the connection",
  { skip: typeof setGlobalProxyFromEnv !== "function" },
  () => {
    // Node leaves the destroy to req.onSocket, which does not get the socket, so the connection stays open:
    // https://github.com/nodejs/node/blob/v26.3.0/lib/https.js#L389-L393
    // https://github.com/nodejs/node/blob/v26.3.0/lib/_http_agent.js#L383-L385
    // Bun closes the connection.
    const closesTheConnection = process.versions.bun !== undefined;
    const target = { host: "example.invalid", port: 443, servername: "example.invalid" };

    async function holdingProxy(statusLine: string) {
      const closed = Promise.withResolvers<void>();
      const sockets: net.Socket[] = [];
      const proxy = net.createServer(socket => {
        sockets.push(socket);
        socket.on("error", () => {});
        socket.on("close", () => closed.resolve());
        socket.once("data", () => socket.write(`${statusLine}\r\nContent-Length: 0\r\n\r\n`));
      });
      return {
        url: `http://127.0.0.1:${await listenOnRandomPort(proxy)}`,
        // Resolves when the client closed the connection.
        closed: closed.promise,
        close() {
          for (const socket of sockets) socket.destroy();
          proxy.close();
        },
      };
    }

    test("a request gets 'error' at once and 'close' on the next turn", async () => {
      const proxy = await holdingProxy("HTTP/1.1 407 Proxy Authentication Required");
      const agent = proxiedAgent(proxy.url);
      const turns = countTurns(agent);
      try {
        const req = https.get({ ...target, path: "/", agent });
        const ticks = turnsOf(req, turns);
        const message = `Failed to establish tunnel to example.invalid:443 via ${proxy.url}: HTTP/1.1 407 Proxy Authentication Required`;
        assert.deepStrictEqual(
          { events: await eventsOf(req), turns: await ticks },
          { events: [{ code: "ERR_PROXY_TUNNEL", message }, "close"], turns: ["error @0", "close @1"] },
        );
        if (closesTheConnection) await proxy.closed;
      } finally {
        agent.destroy();
        proxy.close();
      }
    });

    test("createConnection() gives its caller the socket", async () => {
      const proxy = await holdingProxy("HTTP/1.1 407 Proxy Authentication Required");
      const agent = proxiedAgent(proxy.url);
      try {
        const called = Promise.withResolvers<unknown>();
        agent.createConnection(target, (err: any, socket: Duplex) =>
          called.resolve({ code: err.code, statusCode: err.statusCode, destroyed: socket.destroyed }),
        );
        assert.deepStrictEqual(await called.promise, {
          code: "ERR_PROXY_TUNNEL",
          statusCode: 407,
          destroyed: closesTheConnection,
        });
        if (closesTheConnection) await proxy.closed;
      } finally {
        agent.destroy();
        proxy.close();
      }
    });

    test("createConnection() closes the connection when the status line has no code, like node", async () => {
      const proxy = await holdingProxy("HTTP/1.1 abc Nope");
      const agent = proxiedAgent(proxy.url);
      try {
        const called = Promise.withResolvers<unknown>();
        agent.createConnection(target, (err: any, socket: Duplex) =>
          called.resolve({ code: err.code, statusCode: err.statusCode, destroyed: socket.destroyed }),
        );
        assert.deepStrictEqual(await called.promise, { code: "ERR_PROXY_TUNNEL", statusCode: NaN, destroyed: true });
        await proxy.closed;
      } finally {
        agent.destroy();
        proxy.close();
      }
    });

    test("createSocket() gives its caller only the error", async () => {
      const proxy = await holdingProxy("HTTP/1.1 407 Proxy Authentication Required");
      const agent = proxiedAgent(proxy.url);
      try {
        const called = Promise.withResolvers<any[]>();
        (agent as any).createSocket({ getHeader() {} }, target, (...args: any[]) => called.resolve(args));
        const args = await called.promise;
        assert.deepStrictEqual(
          { length: args.length, code: args[0].code, statusCode: args[0].statusCode },
          { length: 1, code: "ERR_PROXY_TUNNEL", statusCode: 407 },
        );
        if (closesTheConnection) await proxy.closed;
      } finally {
        agent.destroy();
        proxy.close();
      }
    });

    test("an agent that passes on only the error of createConnection()", async () => {
      class OnlyTheError extends https.Agent {
        createConnection(options: any, callback: any) {
          return super.createConnection(options, (err: Error | null, socket: Duplex) =>
            err ? callback(err) : callback(null, socket),
          );
        }
      }
      const proxy = await holdingProxy("HTTP/1.1 407 Proxy Authentication Required");
      const agent = proxiedAgent(proxy.url, {}, OnlyTheError);
      try {
        const message = `Failed to establish tunnel to example.invalid:443 via ${proxy.url}: HTTP/1.1 407 Proxy Authentication Required`;
        assert.deepStrictEqual(await eventsOf(https.get({ ...target, path: "/", agent })), [
          { code: "ERR_PROXY_TUNNEL", message },
          "close",
        ]);
        if (closesTheConnection) await proxy.closed;
      } finally {
        agent.destroy();
        proxy.close();
      }
    });
  },
);

describe("Agent: socket creation that calls back with an error and a second argument", () => {
  const failed = [{ code: "ERR_TEST_NO_CONNECTION", message: "no connection" }, "close"];

  // The request reports the error and leaves the second argument alone.
  async function eventsWith(second: unknown) {
    class FailingAgent extends Agent {
      createConnection(_options: any, callback: any): undefined {
        const err = Object.assign(new Error("no connection"), { code: "ERR_TEST_NO_CONNECTION" });
        process.nextTick(callback, err, second);
      }
    }
    const agent = new FailingAgent();
    try {
      const req = httpRequest({ host: "example.invalid", port: 80, path: "/", agent });
      req.end();
      return await eventsOf(req);
    } finally {
      agent.destroy();
    }
  }

  for (const [name, value] of [
    ["a string", "socket"],
    ["a number", 42],
    ["an object with no destroy()", {}],
  ] as const) {
    test(name, async () => {
      assert.deepStrictEqual(await eventsWith(value), failed);
    });
  }

  test("an object with a destroy()", async () => {
    let destroyCalls = 0;
    const second = {
      destroy() {
        destroyCalls++;
      },
    };
    assert.deepStrictEqual({ events: await eventsWith(second), destroyCalls }, { events: failed, destroyCalls: 0 });
  });

  test("a connected socket", async () => {
    const server = net.createServer(socket => socket.on("error", () => {}));
    const socket = net.connect(await listenOnRandomPort(server), "127.0.0.1");
    try {
      await once(socket, "connect");
      const events = await eventsWith(socket);
      assert.deepStrictEqual({ events, destroyed: socket.destroyed }, { events: failed, destroyed: false });
    } finally {
      socket.destroy();
      server.close();
    }
  });

  // Resolves to a TLS socket that reported ECONNRESET, and counts the destroy() calls on it from then on.
  async function endedDuringTheHandshake() {
    const server = net.createServer(socket => {
      socket.on("error", () => {});
      socket.once("data", () => socket.end());
    });
    const socket = tls.connect({ host: "127.0.0.1", port: await listenOnRandomPort(server) });
    try {
      const [err] = await once(socket, "error");
      assert.strictEqual(err.code, "ECONNRESET");
    } finally {
      server.close();
    }
    const calls = { destroy: 0 };
    const destroy = socket.destroy;
    socket.destroy = function (this: tls.TLSSocket, ...args: any[]) {
      calls.destroy++;
      return destroy.apply(this, args as []);
    };
    return { socket, calls };
  }

  test("a TLS socket that the server ended during the handshake", async () => {
    const { socket, calls } = await endedDuringTheHandshake();
    assert.deepStrictEqual({ events: await eventsWith(socket), calls }, { events: failed, calls: { destroy: 0 } });
  });

  test("createSocket() that calls back with an error and a socket, for a request that waited", async () => {
    const answer = Promise.withResolvers<void>();
    // "close", so that the second request cannot take the socket of the first.
    const server = createServer(async (_req, res) => {
      await answer.promise;
      res.setHeader("connection", "close");
      res.end("ok");
    });
    const { socket, calls } = await endedDuringTheHandshake();
    let created = 0;
    class FailsTheSecond extends Agent {
      createSocket(req: any, options: any, callback: any) {
        if (++created === 1) return (Agent.prototype as any).createSocket.call(this, req, options, callback);
        const err = Object.assign(new Error("no connection"), { code: "ERR_TEST_NO_CONNECTION" });
        process.nextTick(callback, err, socket);
      }
    }
    const agent = new FailsTheSecond({ maxSockets: 1 });
    try {
      const options = { host: "127.0.0.1", port: await listenOnRandomPort(server), path: "/", agent };
      const first = httpRequest(options);
      const firstEvents = eventsOf(first);
      first.end();
      await once(first, "socket");

      const second = httpRequest(options);
      const secondEvents = eventsOf(second);
      second.end();
      assert.strictEqual(Object.values((agent as any).requests).flat().length, 1);

      answer.resolve();
      assert.deepStrictEqual(
        { first: await firstEvents, second: await secondEvents, created, calls },
        { first: ["socket", "response 200", "close"], second: failed, created: 2, calls: { destroy: 0 } },
      );
    } finally {
      answer.resolve();
      agent.destroy();
      server.close();
    }
  });
});

// nodejs/node 84e367579e, in Node v26.9.0 and later.
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const limitsProxyResponseHeaders =
  process.versions.bun !== undefined || nodeMajor > 26 || (nodeMajor === 26 && nodeMinor >= 9);

describe(
  "https request through a proxy: limit on the headers of the CONNECT response",
  { skip: !limitsProxyResponseHeaders },
  () => {
    const target = { host: "example.invalid", port: 443, path: "/" };
    const refused = "HTTP/1.1 407 Proxy Authentication Required";

    // A complete response head of `length` bytes, with the status line of a refused CONNECT.
    function head(length: number) {
      const padding = length - `${refused}\r\nx-pad: \r\n\r\n`.length;
      return `${refused}\r\nx-pad: ${Buffer.alloc(padding, "a")}\r\n\r\n`;
    }

    // The error of a head that passed the limit: its status line decides.
    const refusedHead = {
      code: "ERR_PROXY_TUNNEL",
      message: `Failed to establish tunnel to example.invalid:443 via <proxy>: ${refused}`,
    };
    function exceeded(limit: number) {
      return { code: "ERR_PROXY_TUNNEL", message: `Proxy response headers exceeded ${limit} bytes` };
    }

    // A proxy that gives each connection to `answer` when the CONNECT arrives.
    async function startProxy(answer: (socket: net.Socket) => void, scheme = "http") {
      function onConnection(socket: net.Socket) {
        socket.on("error", () => {});
        socket.once("data", () => answer(socket));
      }
      const proxy = scheme === "https" ? tls.createServer({ key, cert }, onConnection) : net.createServer(onConnection);
      return { proxy, proxyUrl: `${scheme}://127.0.0.1:${await listenOnRandomPort(proxy)}` };
    }

    // What the request emits, with "<proxy>" for the URL of the proxy in an error message.
    async function outcome(req: http.ClientRequest, proxyUrl: string) {
      const events = (await eventsOf(req)) as any[];
      return events.map(event =>
        event.message === undefined ? event : { ...event, message: event.message.replace(proxyUrl, "<proxy>") },
      );
    }

    // The outcome of one request through a proxy that answers the CONNECT with `reply` and ends the connection.
    async function outcomeOf(reply: string, requestOptions: object = {}, agentOptions: object = {}) {
      const { proxy, proxyUrl } = await startProxy(socket => socket.end(reply));
      const agent = proxiedAgent(proxyUrl, agentOptions);
      try {
        return await outcome(https.get({ ...target, ...requestOptions, agent }), proxyUrl);
      } finally {
        agent.destroy();
        proxy.close();
      }
    }

    test("a head of exactly the limit passes, one byte more does not", async () => {
      const options = { maxHeaderSize: 1024 };
      assert.deepStrictEqual(await outcomeOf(head(1024), options), [refusedHead, "close"]);
      // The bytes after the head do not count.
      assert.deepStrictEqual(await outcomeOf(head(1024) + Buffer.alloc(4096, "b"), options), [refusedHead, "close"]);
      assert.deepStrictEqual(await outcomeOf(head(1025), options), [exceeded(1024), "close"]);
    });

    test("a head over the limit is refused when the proxy ends the connection before the end of the head", async () => {
      const reply = `HTTP/1.1 200 Connection established\r\nx-pad: ${Buffer.alloc(2000, "a")}`;
      assert.deepStrictEqual(await outcomeOf(reply, { maxHeaderSize: 1024 }), [exceeded(1024), "close"]);
    });

    test("the maxHeaderSize of the agent replaces the one of the request", async () => {
      const requestOptions = { maxHeaderSize: 1024 };
      const agentOptions = { maxHeaderSize: 2048 };
      assert.deepStrictEqual(await outcomeOf(head(2048), requestOptions, agentOptions), [refusedHead, "close"]);
      assert.deepStrictEqual(await outcomeOf(head(2049), requestOptions, agentOptions), [exceeded(2048), "close"]);
    });

    test("no maxHeaderSize and maxHeaderSize: 0 give the limit of the process", async () => {
      const limit = http.maxHeaderSize;
      for (const options of [{}, { maxHeaderSize: 0 }]) {
        assert.deepStrictEqual(await outcomeOf(head(limit), options), [refusedHead, "close"]);
        assert.deepStrictEqual(await outcomeOf(head(limit + 1), options), [exceeded(limit), "close"]);
      }
    });

    // Keeps the client's connection to the proxy, for its counters and events.
    class ProxySocketAgent extends https.Agent {
      proxySocket!: net.Socket;
      createConnection(options: any, callback?: any) {
        return (this.proxySocket = super.createConnection(options, callback) as net.Socket);
      }
    }

    // A head that does not end: header lines, then the end of the connection. A client with no limit reads all of it.
    const floodBytes = 4 * 1024 * 1024;
    function flood(socket: net.Socket) {
      socket.write("HTTP/1.1 200 Connection established\r\n");
      const lines = Buffer.alloc(64 * 1024, "x-pad: a\r\n");
      for (let sent = 0; sent < floodBytes; sent += lines.length) socket.write(lines);
      socket.end();
    }

    for (const destroyed of [false, true]) {
      test(`a head that does not end${destroyed ? ", request destroyed" : ""}: the client closes the connection at the limit`, async () => {
        const { promise: proxyClosed, resolve: onProxyClosed } = Promise.withResolvers<void>();
        const { proxy, proxyUrl } = await startProxy(socket => {
          socket.on("close", () => onProxyClosed());
          flood(socket);
        });
        const agent = proxiedAgent(proxyUrl, {}, ProxySocketAgent) as ProxySocketAgent;
        try {
          const req = https.get({ ...target, agent });
          if (destroyed) {
            // The tunnel does not stop for a destroyed request: the limit is what ends the read.
            req.on("error", () => {});
            req.destroy();
          } else {
            assert.deepStrictEqual(await outcome(req, proxyUrl), [exceeded(http.maxHeaderSize), "close"]);
          }
          await proxyClosed;
          const { bytesRead } = agent.proxySocket;
          assert.ok(bytesRead < floodBytes / 4, `the client read ${bytesRead} of ${floodBytes} bytes`);
        } finally {
          agent.destroy();
          proxy.close();
        }
      });
    }

    // Every route to a tunnel has the limit. The proxy answers with a head of 1025 bytes.
    const over = { ...target, maxHeaderSize: 1024 };
    const routes: { name: string; scheme?: string; run: (proxyUrl: string) => Promise<unknown> }[] = [
      {
        name: "an https:// proxy",
        scheme: "https",
        run: proxyUrl => outcome(https.get({ ...over, agent: proxiedAgent(proxyUrl) }), proxyUrl),
      },
      {
        name: "http.get() with an https.Agent",
        run: proxyUrl => outcome(http.get({ ...over, protocol: "https:", agent: proxiedAgent(proxyUrl) }), proxyUrl),
      },
      {
        name: "a subclass of https.Agent",
        run: proxyUrl => outcome(https.get({ ...over, agent: proxiedAgent(proxyUrl, {}, ProxySocketAgent) }), proxyUrl),
      },
      {
        name: "the global agent after http.setGlobalProxyFromEnv()",
        run: async proxyUrl => {
          const restore = setGlobalProxyFromEnv({ https_proxy: proxyUrl });
          try {
            return await outcome(https.get(over), proxyUrl);
          } finally {
            restore();
          }
        },
      },
      {
        name: "the second of two requests with maxSockets: 1",
        run: async proxyUrl => {
          const agent = proxiedAgent(proxyUrl, { maxSockets: 1 });
          const first = outcome(https.get({ ...over, agent }), proxyUrl);
          const second = outcome(https.get({ ...over, agent }), proxyUrl);
          assert.deepStrictEqual(await first, [exceeded(1024), "close"]);
          return await second;
        },
      },
    ];
    for (const { name, scheme, run } of routes) {
      test(name, async () => {
        // The Agent has no TLS options for its connection to the proxy: the certificate is a default CA for this test.
        const defaults = scheme === "https" ? tls.getCACertificates("default") : undefined;
        const { proxy, proxyUrl } = await startProxy(socket => socket.end(head(1025)), scheme);
        try {
          if (defaults) tls.setDefaultCACertificates([...defaults, cert]);
          assert.deepStrictEqual(await run(proxyUrl), [exceeded(1024), "close"]);
        } finally {
          proxy.close();
          if (defaults) tls.setDefaultCACertificates(defaults);
        }
      });
    }

    test("agent.createConnection() gives its callback the error and the socket that it returned", async () => {
      const { proxy, proxyUrl } = await startProxy(socket => socket.end(head(1025)));
      try {
        const { promise, resolve } = Promise.withResolvers<unknown[]>();
        const socket = proxiedAgent(proxyUrl).createConnection(over, (err: any, given: any) =>
          resolve([err.code, err.message, err.statusCode, given === socket, given.destroyed]),
        );
        assert.deepStrictEqual(await promise, [
          "ERR_PROXY_TUNNEL",
          "Proxy response headers exceeded 1024 bytes",
          undefined,
          true,
          true,
        ]);
      } finally {
        proxy.close();
      }
    });

    // Sends `fragments` one at a time. The next one leaves when the client has the previous one,
    // so the client reads each fragment as a chunk of its own.
    async function outcomeOfFragments(fragments: string[], requestOptions: object) {
      let proxySide: net.Socket | undefined;
      const { proxy, proxyUrl } = await startProxy(socket => {
        proxySide = socket;
        socket.write(fragments[0]);
      });
      const agent = proxiedAgent(proxyUrl, {}, ProxySocketAgent) as ProxySocketAgent;
      try {
        const req = https.get({ ...target, ...requestOptions, agent });
        const chunks: number[] = [];
        // This listener is before the one of the tunnel: it sees each chunk before the tunnel reads it.
        agent.proxySocket.on("readable", () => {
          const length = agent.proxySocket.readableLength;
          if (length === 0) return;
          chunks.push(length);
          if (chunks.length < fragments.length) proxySide!.write(fragments[chunks.length]);
          else proxySide!.end();
        });
        return { events: await outcome(req, proxyUrl), chunks };
      } finally {
        agent.destroy();
        proxySide?.destroy();
        proxy.close();
      }
    }

    test("the end of the head can be split over two chunks", async () => {
      for (const tail of [1, 2, 3]) {
        const fragments = [head(1024).slice(0, -tail), head(1024).slice(-tail)];
        const chunks = [1024 - tail, tail];
        assert.deepStrictEqual(await outcomeOfFragments(fragments, { maxHeaderSize: 1024 }), {
          events: [refusedHead, "close"],
          chunks,
        });
        assert.deepStrictEqual(await outcomeOfFragments(fragments, { maxHeaderSize: 1023 }), {
          events: [exceeded(1023), "close"],
          chunks,
        });
      }
    });

    test("only the bytes that arrived are searched for the end of the head", async () => {
      // Bun's reader has a buffer with more capacity than bytes. Every new buffer starts as CRLFs here.
      const allocUnsafe = Buffer.allocUnsafe;
      Buffer.allocUnsafe = size => allocUnsafe(size).fill("\r\n");
      try {
        const fragments = [head(1024).slice(0, 1000), head(1024).slice(1000, 1001), head(1024).slice(1001)];
        assert.deepStrictEqual(await outcomeOfFragments(fragments, { maxHeaderSize: 1024 }), {
          events: [refusedHead, "close"],
          chunks: [1000, 1, 23],
        });
      } finally {
        Buffer.allocUnsafe = allocUnsafe;
      }
    });

    test("a head can arrive one byte at a time", async () => {
      // The last chunk has the last byte of the head and the bytes after it.
      const fragments = [...head(64).slice(0, -1), "\nafter the head"];
      const chunks = fragments.map(fragment => fragment.length);
      assert.deepStrictEqual(await outcomeOfFragments(fragments, { maxHeaderSize: 64 }), {
        events: [refusedHead, "close"],
        chunks,
      });
      assert.deepStrictEqual(await outcomeOfFragments(fragments, { maxHeaderSize: 63 }), {
        events: [exceeded(63), "close"],
        chunks,
      });
    });
  },
);
