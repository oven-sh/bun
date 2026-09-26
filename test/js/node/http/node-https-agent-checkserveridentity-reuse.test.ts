/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * An https.Agent hands a connection from one request to the next in three ways:
 * a keep-alive socket from its pool (keepAlive: true), a cached TLS session on a
 * new socket, which skips the identity check (keepAlive: false), and a socket
 * made for a queued request with the options of the request before it. None may
 * carry the verdict of one request's `checkServerIdentity` to a request that has
 * a different check. Node fixed this in nodejs/node 52a8ace880 (CVE-2026-58040):
 * a request with its own callback gets a socket and a session that nothing else
 * shares.
 */
import assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import { describe, test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const keys = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "keys");
const readKey = (name: string) => readFileSync(join(keys, name), "utf8");
// The target: CN=agent1, no subjectAltName, signed by ca1.
const key = readKey("agent1-key.pem");
const cert = readKey("agent1-cert.pem");
const ca = readKey("ca1-cert.pem");
// The https proxy: CN=localhost, signed by the fake StartCom root.
const proxyKey = readKey("agent9-key.pem");
const proxyCert = readKey("agent9-cert.pem");
const proxyRoot = readKey("fake-startcom-root-cert.pem");

// Node ships the fix in v22.23.2, v24.18.1 and v26.5.1. An older Node shares the
// connection, so the cases below only describe it from those versions on. Bun
// always runs them.
const [nodeMajor, nodeMinor, nodePatch] = process.versions.node.split(".").map(Number);
const runtimeHasFix = (() => {
  if (process.versions.bun) return true;
  if (nodeMajor > 26) return true;
  const fixedIn = ({ 22: [23, 2], 24: [18, 1], 26: [5, 1] } as Record<number, number[]>)[nodeMajor];
  return fixedIn !== undefined && (nodeMinor > fixedIn[0] || (nodeMinor === fixedIn[0] && nodePatch >= fixedIn[1]));
})();
const fixTest = runtimeHasFix ? test : test.skip;
// The Agent `proxyEnv` option is newer than Node 22.
const tunnelFixTest = runtimeHasFix && (process.versions.bun || nodeMajor >= 24) ? test : test.skip;
const proxyTest = process.versions.bun || nodeMajor >= 24 ? test : test.skip;
// Where Bun goes further than Node (as of v26.5.1). Each case says what Node does.
const bunOnlyTest = process.versions.bun ? test : test.skip;

type Exchange = { status?: number; reusedSocket?: boolean; sessionReused?: boolean; error?: string };
type Scenario = {
  agent: http.Agent;
  /** How many TLS connections the requests the server has answered came in on. */
  connections: () => number;
  exchange: (options?: https.RequestOptions, request?: typeof https.request) => Promise<Exchange>;
  /** Resolves when the server has a request for "/hold". It answers that one on release(). */
  held: () => Promise<void>;
  release: () => void;
};
type ScenarioOptions = {
  /** Tunnel through a CONNECT proxy of this kind, set through the Agent's `proxyEnv`. */
  proxy?: "http" | "https";
  /** The proxy answers the nth CONNECT (from 1) with 503 when this returns true. */
  proxyRefuses?: (nth: number) => boolean;
  createAgent?: (options: https.AgentOptions) => http.Agent;
};

async function listenProxy(kind: "http" | "https", refuses: (nth: number) => boolean) {
  const sockets = new Set<Duplex>();
  let connects = 0;
  const proxy = kind === "https" ? https.createServer({ key: proxyKey, cert: proxyCert }) : http.createServer();
  proxy.on("connect", (req, clientSocket, head) => {
    if (refuses(++connects)) {
      return clientSocket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    }
    const [host, port] = req.url!.split(":");
    const targetSocket = net.connect(Number(port), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) targetSocket.write(head);
      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
    });
    for (const socket of [clientSocket, targetSocket]) {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => sockets.delete(socket));
    }
  });
  // The https proxy's certificate names "localhost", whichever address that is here.
  const host = kind === "https" ? "localhost" : "127.0.0.1";
  await once(kind === "https" ? proxy.listen(0) : proxy.listen(0, host), "listening");
  // The Agent takes no TLS options for its connection to the proxy, so the
  // proxy's root has to be a default CA while the scenario runs.
  const defaultCAs = kind === "https" ? tls.getCACertificates("default") : undefined;
  if (defaultCAs) tls.setDefaultCACertificates([...defaultCAs, proxyRoot]);
  return {
    url: `${kind}://${host}:${(proxy.address() as AddressInfo).port}`,
    async close() {
      if (defaultCAs) tls.setDefaultCACertificates(defaultCAs);
      for (const socket of sockets) socket.destroy();
      proxy.close();
      proxy.closeAllConnections();
      await once(proxy, "close");
    },
  };
}

async function scenario(
  agentOptions: https.AgentOptions,
  run: (scenario: Scenario) => Promise<void>,
  {
    proxy: proxyKind,
    proxyRefuses = () => false,
    createAgent = options => new https.Agent(options),
  }: ScenarioOptions = {},
) {
  const clientPorts = new Set<number | undefined>();
  // TLS 1.2 delivers the session during the handshake, so the Agent has cached
  // it before the response ends. A TLS 1.3 ticket arrives at some later point.
  let heldResponse: http.ServerResponse | undefined;
  let onHeld: (() => void) | undefined;
  const server = https.createServer({ key, cert, maxVersion: "TLSv1.2" }, (req, res) => {
    clientPorts.add(req.socket.remotePort);
    if (req.url !== "/hold") return res.end("ok");
    heldResponse = res;
    onHeld?.();
  });
  const held = () => (heldResponse ? Promise.resolve() : new Promise<void>(resolve => (onHeld = resolve)));
  const release = () => {
    heldResponse!.end("ok");
    heldResponse = onHeld = undefined;
  };
  await once(server.listen(0, "127.0.0.1"), "listening");
  const proxy = proxyKind ? await listenProxy(proxyKind, proxyRefuses) : undefined;
  const proxyEnv = proxy && ({ HTTPS_PROXY: proxy.url } as http.ProxyEnv);
  const agent = createAgent(proxyEnv ? { ...agentOptions, proxyEnv } : agentOptions);
  const { port } = server.address() as AddressInfo;

  // Resolves after the Agent has dealt with the socket ("free" for a keep-alive
  // socket, "close" for the rest), so the next exchange finds the pool and the
  // session cache in their final state.
  async function exchange(options: https.RequestOptions = {}, request = https.request): Promise<Exchange> {
    const req = request({ protocol: "https:", host: "127.0.0.1", port, agent, ca, servername: "agent1", ...options });
    const released = new Promise<void>(resolve => {
      req.once("socket", socket => {
        socket.once("free", resolve);
        socket.once("close", resolve);
      });
    });
    req.end();
    try {
      const [res] = await once(req, "response");
      // Read now: a destroyed socket no longer reports it.
      const sessionReused: boolean = res.socket.isSessionReused();
      res.resume();
      await once(res, "end");
      await released;
      return { status: res.statusCode, reusedSocket: req.reusedSocket, sessionReused };
    } catch (err: any) {
      return { error: err.code ?? err.message };
    }
  }

  try {
    await run({ agent, connections: () => clientPorts.size, exchange, held, release });
  } finally {
    agent.destroy();
    await proxy?.close();
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
}

const fresh: Exchange = { status: 200, reusedSocket: false, sessionReused: false };
const rejected: Exchange = { error: "PIN MISMATCH" };
const permissive = () => undefined;
const rejecting = () => new Error("PIN MISMATCH");

for (const { keepAlive, carrier, reused } of [
  { keepAlive: true, carrier: "pooled socket", reused: { status: 200, reusedSocket: true, sessionReused: false } },
  {
    keepAlive: false,
    carrier: "cached TLS session",
    reused: { status: 200, reusedSocket: false, sessionReused: true },
  },
]) {
  describe(`https.Agent({ keepAlive: ${keepAlive} }) and a request's own checkServerIdentity`, () => {
    fixTest(`a rejecting callback does not ride the ${carrier} of a permissive callback`, async () => {
      await scenario({ keepAlive }, async ({ exchange }) => {
        const calls: string[] = [];
        const first = await exchange({ checkServerIdentity: () => void calls.push("permissive") });
        const second = await exchange({
          checkServerIdentity: () => (calls.push("rejecting"), new Error("PIN MISMATCH")),
        });
        assert.deepStrictEqual(
          { first, second, calls },
          { first: fresh, second: rejected, calls: ["permissive", "rejecting"] },
        );
      });
    });

    fixTest(`a rejecting callback does not ride the ${carrier} of the default check`, async () => {
      await scenario({ keepAlive }, async ({ exchange }) => {
        const first = await exchange();
        const second = await exchange({ checkServerIdentity: rejecting });
        // The rejected request took nothing from the requests around it.
        const third = await exchange();
        assert.deepStrictEqual({ first, second, third }, { first: fresh, second: rejected, third: reused });
      });
    });

    // "not-agent1" does not match CN=agent1: only the callback lets the first
    // request through, and the default check must still reject the second.
    fixTest(`the default check does not ride the ${carrier} of a permissive callback`, async () => {
      await scenario({ keepAlive }, async ({ exchange }) => {
        const first = await exchange({ servername: "not-agent1", checkServerIdentity: permissive });
        const second = await exchange({ servername: "not-agent1" });
        assert.deepStrictEqual({ first, second }, { first: fresh, second: { error: "ERR_TLS_CERT_ALTNAME_INVALID" } });
      });
    });

    // Node marks the request in https.request() only, so this route still shares there.
    bunOnlyTest(`http.request({ protocol: "https:", agent }) gets the same rule for the ${carrier}`, async () => {
      await scenario({ keepAlive }, async ({ exchange }) => {
        const first = await exchange({ checkServerIdentity: permissive }, http.request);
        const second = await exchange({ checkServerIdentity: rejecting }, http.request);
        const third = await exchange({ servername: "not-agent1", checkServerIdentity: permissive }, http.request);
        const fourth = await exchange({ servername: "not-agent1" }, http.request);
        assert.deepStrictEqual(
          { first, second, third, fourth },
          { first: fresh, second: rejected, third: fresh, fourth: { error: "ERR_TLS_CERT_ALTNAME_INVALID" } },
        );
      });
    });

    // Also for one function passed twice: the Agent does not compare callbacks.
    fixTest(`every request with its own callback gets its own connection, parked nowhere`, async () => {
      await scenario({ keepAlive }, async ({ agent, exchange, connections }) => {
        let calls = 0;
        const checkServerIdentity = () => void calls++;
        const first = await exchange({ checkServerIdentity });
        const second = await exchange({ checkServerIdentity });
        assert.deepStrictEqual(
          {
            first,
            second,
            calls,
            connections: connections(),
            freeSockets: Object.keys(agent.freeSockets),
            cachedSessions: [...(agent as any)._sessionCache.list],
          },
          { first: fresh, second: fresh, calls: 2, connections: 2, freeSockets: [], cachedSessions: [] },
        );
      });
    });

    // In Bun the tunnel path caches the target's TLS session on its own, in
    // establishTunnel, and a session offered over the TLS socket to an https
    // proxy is resumed. Node caches no session on this path.
    for (const proxy of ["http", "https"] as const) {
      tunnelFixTest(
        `a rejecting callback does not ride the ${carrier} of a permissive callback through an ${proxy} proxy`,
        async () => {
          await scenario(
            { keepAlive },
            async ({ agent, exchange }) => {
              const calls: string[] = [];
              const first = await exchange({ checkServerIdentity: () => void calls.push("permissive") });
              const cachedSessions: string[] = [...(agent as any)._sessionCache.list];
              const second = await exchange({
                checkServerIdentity: () => (calls.push("rejecting"), new Error("PIN MISMATCH")),
              });
              assert.deepStrictEqual(
                { first, cachedSessions, second, calls },
                { first: fresh, cachedSessions: [], second: rejected, calls: ["permissive", "rejecting"] },
              );
            },
            { proxy },
          );
        },
      );
    }

    // Agent options override request options, so every request on this Agent
    // has the same check and the request's own callback never runs.
    test(`an Agent-level callback still shares its ${carrier}`, async () => {
      await scenario({ keepAlive, checkServerIdentity: permissive }, async ({ exchange }) => {
        let ownCallbackRan = false;
        const first = await exchange({ servername: "not-agent1" });
        const second = await exchange({
          servername: "not-agent1",
          checkServerIdentity: () => ((ownCallbackRan = true), new Error("PIN MISMATCH")),
        });
        assert.deepStrictEqual(
          { first, second, ownCallbackRan },
          { first: fresh, second: reused, ownCallbackRan: false },
        );
      });
    });

    test(`a request that passes tls.checkServerIdentity itself still shares its ${carrier}`, async () => {
      await scenario({ keepAlive }, async ({ exchange }) => {
        const first = await exchange({ checkServerIdentity: tls.checkServerIdentity });
        const second = await exchange({ checkServerIdentity: tls.checkServerIdentity });
        assert.deepStrictEqual({ first, second }, { first: fresh, second: reused });
      });
    });
  });
}

// No pool and no session cache: what is left is Agent#removeSocket, which makes
// the socket of a queued request with the same name from the options of the
// socket that closed. maxSockets queues by name, maxTotalSockets across names.
describe("https.Agent with a full socket budget and a request's own checkServerIdentity", () => {
  for (const limit of [{ maxSockets: 1 }, { maxTotalSockets: 1 }]) {
    const agentOptions = { keepAlive: false, maxCachedSessions: 0, ...limit };

    fixTest(`a queued request runs its own callback (${Object.keys(limit)})`, async () => {
      await scenario(agentOptions, async ({ agent, exchange }) => {
        const calls: string[] = [];
        const results = await Promise.all([
          exchange(),
          exchange({ checkServerIdentity: () => void calls.push("permissive") }),
          exchange({ checkServerIdentity: () => (calls.push("rejecting"), new Error("PIN MISMATCH")) }),
          exchange(),
        ]);
        assert.deepStrictEqual(
          { results: results.map(r => r.status ?? r.error), calls: calls.sort(), queued: Object.keys(agent.requests) },
          { results: [200, 200, "PIN MISMATCH", 200], calls: ["permissive", "rejecting"], queued: [] },
        );
      });
    });

    fixTest(
      `a queued default check does not get the callback of the request ahead (${Object.keys(limit)})`,
      async () => {
        await scenario(agentOptions, async ({ agent, exchange }) => {
          let calls = 0;
          const results = await Promise.all([
            exchange({ servername: "not-agent1", checkServerIdentity: () => void calls++ }),
            exchange({ servername: "not-agent1" }),
          ]);
          assert.deepStrictEqual(
            { results: results.map(r => r.status ?? r.error), calls, queued: Object.keys(agent.requests) },
            { results: [200, "ERR_TLS_CERT_ALTNAME_INVALID"], calls: 1, queued: [] },
          );
        });
      },
    );
  }
});

describe("what the unique Agent name of such a request leaves behind", () => {
  // Node waits here until the server closes the idle socket: nothing else frees the slot.
  bunOnlyTest("an idle pooled socket gives up its slot when only maxTotalSockets blocks the request", async () => {
    await scenario({ keepAlive: true, maxTotalSockets: 1 }, async ({ agent, exchange, connections }) => {
      const first = await exchange();
      const second = await exchange({ checkServerIdentity: permissive });
      const third = await exchange();
      assert.deepStrictEqual(
        { first, second, third, connections: connections(), queued: Object.keys(agent.requests) },
        // The third request is on a new socket too: the first one's socket is gone, its session is not.
        {
          first: fresh,
          second: fresh,
          third: { status: 200, reusedSocket: false, sessionReused: true },
          connections: 3,
          queued: [],
        },
      );
    });
  });

  // The failed request stays at the head of its own queue in Node. removeSocket()
  // only looks at the first queue, so the request behind it is never served. A
  // createConnection() that throws there is an uncaught exception in Node.
  class SecondConnectionThrows extends https.Agent {
    connections = 0;
    createConnection(...args: Parameters<https.Agent["createConnection"]>) {
      if (++this.connections === 2) throw new Error("createConnection threw");
      return super.createConnection(...args);
    }
  }
  for (const [failure, error, options] of [
    ["proxy tunnel is refused", "ERR_PROXY_TUNNEL", { proxy: "http", proxyRefuses: nth => nth === 2 }],
    ["createConnection throws", "createConnection threw", { createAgent: o => new SecondConnectionThrows(o) }],
  ] as [string, string, ScenarioOptions][]) {
    bunOnlyTest(`a queued request whose ${failure} does not block the queue behind it`, async () => {
      await scenario(
        { keepAlive: false, maxTotalSockets: 1 },
        async ({ agent, exchange, held, release }) => {
          // Each pair: the first request holds the only slot while the second one joins the queue.
          const results: Exchange[] = [];
          for (let pair = 0; pair < 2; pair++) {
            const holdsTheSlot = exchange({ path: "/hold" });
            await held();
            const queued = exchange({ checkServerIdentity: permissive });
            release();
            results.push(await holdsTheSlot, await queued);
          }
          assert.deepStrictEqual(
            {
              results: results.map(r => r.status ?? r.error),
              queued: Object.keys(agent.requests),
              sockets: Object.keys(agent.sockets),
            },
            { results: [200, error, 200, 200], queued: [], sockets: [] },
          );
        },
        options,
      );
    });
  }

  proxyTest("agent.sockets has the entry of a request whose proxy tunnel is still connecting", async () => {
    await scenario(
      { keepAlive: false },
      async ({ agent, exchange }) => {
        const pending = exchange({ checkServerIdentity: permissive });
        const whileConnecting = Object.values(agent.sockets).map(sockets => sockets!.length);
        assert.deepStrictEqual({ whileConnecting, result: await pending }, { whileConnecting: [0], result: fresh });
      },
      { proxy: "http" },
    );
  });

  // Agent#addRequest in Node makes the agent.sockets entry before a socket
  // exists. No socket comes out of a refused tunnel, so nothing removes it.
  bunOnlyTest("a refused proxy tunnel leaves no entry in agent.sockets", async () => {
    await scenario(
      { keepAlive: true },
      async ({ agent, exchange }) => {
        const results = [
          await exchange({ checkServerIdentity: permissive }),
          await exchange({ checkServerIdentity: permissive }),
          await exchange(),
        ];
        assert.deepStrictEqual(
          { results: results.map(r => r.error), sockets: Object.keys(agent.sockets) },
          { results: ["ERR_PROXY_TUNNEL", "ERR_PROXY_TUNNEL", "ERR_PROXY_TUNNEL"], sockets: [] },
        );
      },
      { proxy: "http", proxyRefuses: () => true },
    );
  });

  // Node refuses the socket in https.Agent#keepSocketAlive, from a mark that
  // https.Agent's createConnection puts on it. These Agents get the unique name
  // without the mark, and park one socket per request that nothing can take.
  class BorrowsGetName extends http.Agent {
    // What agent-base does (https-proxy-agent, socks-proxy-agent, ...).
    getName(options: https.RequestOptions) {
      return https.Agent.prototype.getName.call(this, options);
    }
    createConnection(options: tls.ConnectionOptions) {
      return tls.connect(options);
    }
  }
  class ReplacesCreateConnection extends https.Agent {
    createConnection(options: tls.ConnectionOptions) {
      return tls.connect(options);
    }
  }
  for (const [name, createAgent] of [
    [
      "an http.Agent that borrows https.Agent#getName",
      (options: https.AgentOptions) => new BorrowsGetName({ ...options, protocol: "https:", defaultPort: 443 } as any),
    ],
    [
      "an https.Agent that replaces createConnection",
      (options: https.AgentOptions) => new ReplacesCreateConnection(options),
    ],
  ] as const) {
    bunOnlyTest(`${name} parks no socket for it`, async () => {
      await scenario(
        { keepAlive: true },
        async ({ agent, exchange, connections }) => {
          const first = await exchange({ checkServerIdentity: permissive });
          const second = await exchange({ checkServerIdentity: rejecting });
          // The pool still works for the requests that can share it.
          const third = await exchange();
          const fourth = await exchange();
          assert.deepStrictEqual(
            {
              first,
              second,
              third,
              fourth,
              connections: connections(),
              freeSockets: Object.keys(agent.freeSockets).length,
            },
            {
              first: fresh,
              second: rejected,
              third: fresh,
              fourth: { status: 200, reusedSocket: true, sessionReused: false },
              connections: 2,
              freeSockets: 1,
            },
          );
        },
        { createAgent },
      );
    });
  }
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExe } = await import("harness");
  const node = nodeExe();

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
