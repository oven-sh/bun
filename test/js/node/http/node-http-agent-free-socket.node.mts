/**
 * Runs under both `node --test` and `bun test` (see "http.Agent free keep-alive
 * socket" in node-http.test.ts). Do not use anything Bun-only in here.
 *
 * A keep-alive socket parked in agent.freeSockets has no parser and no reader
 * attached. Bytes that arrive while it is idle are unsolicited: the next
 * request that reuses the socket would parse them as the start of its own
 * response (response queue poisoning). Node guards against this since
 * nodejs/node 179ddaedfb (v26.4.0, CVE-2026-48931), reworked by 57a4932a9d.
 */
import assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo, Server as NetServer, Socket as NetSocket } from "node:net";
import { createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { createServer as createTlsServer } from "node:tls";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const cert = readFileSync(join(fixtures, "cert.pem"), "utf8");
const key = readFileSync(join(fixtures, "cert.key"), "utf8");

// Node ships the guard from v26.4.0. An older Node reuses a poisoned socket, so
// the guard cases only describe it from that version on. Bun always runs them.
const runtimeHasGuard = (() => {
  if (process.versions.bun) return true;
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 26 || (major === 26 && minor >= 4);
})();
const guardTest = runtimeHasGuard ? test : test.skip;
// Node (as of v26.4.0) checks a freed socket for buffered bytes only on its way
// into the pool, not when it goes straight to a queued request. Bun checks both.
const queuedGuardTest = process.versions.bun ? test : test.skip;

const poisonedResponse =
  "HTTP/1.1 200 OK\r\nX-Poisoned: 1\r\nConnection: keep-alive\r\nContent-Length: 6\r\n\r\npoison";

type Transport = {
  createServer: (onConnection: (socket: NetSocket) => void) => NetServer;
  createAgent: (options: http.AgentOptions) => http.Agent;
  get: typeof http.get;
  options: object;
};
const transports: Record<string, Transport> = {
  http: {
    createServer: onConnection => createNetServer(onConnection),
    createAgent: options => new http.Agent({ keepAlive: true, ...options }),
    get: http.get,
    options: {},
  },
  https: {
    createServer: onConnection => createTlsServer({ cert, key }, onConnection) as NetServer,
    createAgent: options => new https.Agent({ keepAlive: true, ...options }),
    get: https.get,
    options: { ca: cert },
  },
};

// Answers every request with its own path as the body and keeps the
// connection alive.
function respondToRequests(socket: NetSocket) {
  let buffered = "";
  socket.on("data", chunk => {
    buffered += chunk;
    let headersEnd: number;
    while ((headersEnd = buffered.indexOf("\r\n\r\n")) !== -1) {
      const body = buffered.slice(0, buffered.indexOf("\r\n")).split(" ")[1];
      buffered = buffered.slice(headersEnd + 4);
      socket.write(`HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
    }
  });
  socket.on("error", () => {});
}

async function pollUntil(condition: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!condition() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function theFreeSocket(agent: http.Agent, name: string): Promise<NetSocket> {
  await pollUntil(() => agent.freeSockets[name]?.length === 1);
  const freeSockets = agent.freeSockets[name];
  assert.strictEqual(freeSockets?.length, 1);
  return freeSockets[0];
}

type Response = { body: string; poisoned: string | undefined; reusedSocket: boolean };
type Context = {
  agent: http.Agent;
  name: string;
  serverSockets: NetSocket[];
  // `beforeFree` runs in the response's 'end' handler: the parser is already
  // detached and the agent frees the socket on the next tick.
  request: (path: string, beforeFree?: (socket: NetSocket) => void) => Promise<Response>;
};

async function withAgent(
  transport: Transport,
  body: (context: Context) => Promise<void>,
  agentOptions: http.AgentOptions = {},
) {
  const serverSockets: NetSocket[] = [];
  const server = transport.createServer(socket => {
    serverSockets.push(socket);
    respondToRequests(socket);
  });
  const agent = transport.createAgent(agentOptions);
  try {
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    const options = { host: "127.0.0.1", port, agent, ...transport.options };
    await body({
      agent,
      name: agent.getName(options),
      serverSockets,
      request: (path, beforeFree) =>
        new Promise<Response>((resolve, reject) => {
          const req = transport.get({ ...options, path }, res => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", chunk => (body += chunk));
            res.on("end", () => {
              beforeFree?.(req.socket!);
              resolve({
                body,
                poisoned: res.headers["x-poisoned"] as string | undefined,
                reusedSocket: req.reusedSocket,
              });
            });
          });
          req.on("error", reject);
        }),
    });
  } finally {
    agent.destroy();
    server.close();
    for (const socket of serverSockets) socket.destroy();
  }
}

for (const [protocol, transport] of Object.entries(transports)) {
  describe(`http.Agent free keep-alive socket over ${protocol}`, () => {
    guardTest("destroys a free socket that receives unsolicited data", async () => {
      await withAgent(transport, async ({ agent, name, serverSockets, request }) => {
        assert.deepStrictEqual(await request("/first"), { body: "/first", poisoned: undefined, reusedSocket: false });

        const freeSocket = await theFreeSocket(agent, name);
        // The guard adds no public stream listener: node-fetch and others
        // read these counts while a response is closing.
        assert.strictEqual(freeSocket.listenerCount("data"), 0);
        assert.strictEqual(freeSocket.listenerCount("readable"), 0);

        serverSockets[0].write(poisonedResponse);

        await pollUntil(() => freeSocket.destroyed && agent.freeSockets[name] === undefined);
        assert.strictEqual(freeSocket.destroyed, true);
        assert.strictEqual(agent.freeSockets[name], undefined);

        // The next request dials a new connection and reads the real response.
        assert.deepStrictEqual(await request("/second"), { body: "/second", poisoned: undefined, reusedSocket: false });
        assert.strictEqual(serverSockets.length, 2);
      });
    });

    guardTest("does not pool a socket that holds unsolicited data when it is freed", async () => {
      await withAgent(transport, async ({ agent, name, serverSockets, request }) => {
        let firstSocket: NetSocket | undefined;
        // push() stands in for bytes the transport delivered after the parser
        // detached: they sit in the socket's read buffer when the agent frees it.
        const first = await request("/first", socket => {
          firstSocket = socket;
          socket.push(Buffer.from(poisonedResponse));
        });
        assert.deepStrictEqual(first, { body: "/first", poisoned: undefined, reusedSocket: false });
        assert.ok(firstSocket);
        const freed: NetSocket = firstSocket;

        // Node pools the destroyed socket until its 'close' prunes it; Bun
        // never pools it. Either way it must end up destroyed and unpooled.
        await pollUntil(() => freed.destroyed && agent.freeSockets[name] === undefined);
        assert.strictEqual(freed.destroyed, true);
        assert.strictEqual(agent.freeSockets[name], undefined);

        assert.deepStrictEqual(await request("/second"), { body: "/second", poisoned: undefined, reusedSocket: false });
        assert.strictEqual(serverSockets.length, 2);
      });
    });

    queuedGuardTest("does not hand a freed socket that holds unsolicited data to a queued request", async () => {
      await withAgent(
        transport,
        async ({ serverSockets, request }) => {
          let firstSocket: NetSocket | undefined;
          const first = request("/first", socket => {
            firstSocket = socket;
            socket.push(Buffer.from(poisonedResponse));
          });
          // maxSockets is 1, so this request waits in agent.requests for the
          // first socket to be freed.
          const second = request("/second");

          assert.deepStrictEqual(await first, { body: "/first", poisoned: undefined, reusedSocket: false });
          assert.deepStrictEqual(await second, { body: "/second", poisoned: undefined, reusedSocket: false });
          assert.ok(firstSocket);
          assert.strictEqual(firstSocket.destroyed, true);
          assert.strictEqual(serverSockets.length, 2);
        },
        { maxSockets: 1 },
      );
    });

    test("reuses a free socket that received nothing", async () => {
      await withAgent(transport, async ({ agent, name, serverSockets, request }) => {
        assert.deepStrictEqual(await request("/first"), { body: "/first", poisoned: undefined, reusedSocket: false });

        const freeSocket = await theFreeSocket(agent, name);

        assert.deepStrictEqual(await request("/second"), { body: "/second", poisoned: undefined, reusedSocket: true });
        assert.strictEqual(freeSocket.destroyed, false);
        assert.strictEqual(serverSockets.length, 1);
      });
    });
  });
}
