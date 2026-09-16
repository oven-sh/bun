/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * An https.Agent reuses a connection in two ways: a keep-alive socket from its
 * pool (keepAlive: true), or a cached TLS session on a new socket, which skips
 * the identity check (keepAlive: false). Neither may carry the verdict of one
 * request's `checkServerIdentity` to a request that has a different check.
 * Node fixed this in nodejs/node 52a8ace880 (CVE-2026-58040): a request with its
 * own callback gets a socket and a session that nothing else shares.
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

// CN=agent1, no subjectAltName, signed by ca1.
const keys = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "keys");
const key = readFileSync(join(keys, "agent1-key.pem"), "utf8");
const cert = readFileSync(join(keys, "agent1-cert.pem"), "utf8");
const ca = readFileSync(join(keys, "ca1-cert.pem"), "utf8");

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

type Exchange = { status?: number; reusedSocket?: boolean; sessionReused?: boolean; error?: string };
type Scenario = {
  agent: https.Agent;
  /** How many TLS connections the requests the server has answered came in on. */
  connections: () => number;
  exchange: (options?: https.RequestOptions) => Promise<Exchange>;
};

// An HTTP proxy that tunnels CONNECT requests, for an Agent with `proxyEnv`.
async function listenProxy() {
  const sockets = new Set<Duplex>();
  const proxy = http.createServer();
  proxy.on("connect", (req, clientSocket, head) => {
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
  await once(proxy.listen(0, "127.0.0.1"), "listening");
  return {
    url: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      proxy.close();
      await once(proxy, "close");
    },
  };
}

async function scenario(
  agentOptions: https.AgentOptions,
  run: (scenario: Scenario) => Promise<void>,
  { throughProxy = false } = {},
) {
  const clientPorts = new Set<number | undefined>();
  // TLS 1.2 delivers the session during the handshake, so the Agent has cached
  // it before the response ends. A TLS 1.3 ticket arrives at some later point.
  const server = https.createServer({ key, cert, maxVersion: "TLSv1.2" }, (req, res) => {
    clientPorts.add(req.socket.remotePort);
    res.end("ok");
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const proxy = throughProxy ? await listenProxy() : undefined;
  const agent = new https.Agent(proxy ? { ...agentOptions, proxyEnv: { HTTPS_PROXY: proxy.url } } : agentOptions);
  const { port } = server.address() as AddressInfo;

  // Resolves after the Agent has dealt with the socket ("free" for a keep-alive
  // socket, "close" for the rest), so the next exchange finds the pool and the
  // session cache in their final state.
  async function exchange(options: https.RequestOptions = {}): Promise<Exchange> {
    const req = https.request({ host: "127.0.0.1", port, agent, ca, servername: "agent1", ...options });
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
    await run({ agent, connections: () => clientPorts.size, exchange });
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
        let calls = 0;
        const first = await exchange();
        const second = await exchange({ checkServerIdentity: () => (calls++, new Error("PIN MISMATCH")) });
        // The rejected request took nothing from the requests around it.
        const third = await exchange();
        assert.deepStrictEqual(
          { first, second, third, calls },
          { first: fresh, second: rejected, third: reused, calls: 1 },
        );
      });
    });

    // "not-agent1" does not match CN=agent1: only the callback lets the first
    // request through, and the default check must still reject the second.
    fixTest(`the default check does not ride the ${carrier} of a permissive callback`, async () => {
      await scenario({ keepAlive }, async ({ exchange }) => {
        const first = await exchange({ servername: "not-agent1", checkServerIdentity: () => undefined });
        const second = await exchange({ servername: "not-agent1" });
        assert.deepStrictEqual({ first, second }, { first: fresh, second: { error: "ERR_TLS_CERT_ALTNAME_INVALID" } });
      });
    });

    // Also for one function passed twice: the Agent does not compare callbacks.
    fixTest(`every request with its own callback gets its own connection and caches no session`, async () => {
      await scenario({ keepAlive }, async ({ agent, exchange, connections }) => {
        let calls = 0;
        const checkServerIdentity = () => void calls++;
        const first = await exchange({ checkServerIdentity });
        const second = await exchange({ checkServerIdentity });
        const cachedSessions: string[] = [...(agent as any)._sessionCache.list];
        assert.deepStrictEqual(
          { first, second, calls, connections: connections(), cachedSessions },
          { first: fresh, second: fresh, calls: 2, connections: 2, cachedSessions: [] },
        );
      });
    });

    // In Bun the tunnel path caches the target's TLS session on its own, in
    // establishTunnel. Node caches no session there.
    tunnelFixTest(
      `a rejecting callback does not ride the ${carrier} of a permissive callback through a proxy tunnel`,
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
          { throughProxy: true },
        );
      },
    );

    // Agent options override request options, so every request on this Agent
    // has the same check and the request's own callback never runs.
    test(`an Agent-level callback still shares its ${carrier}`, async () => {
      await scenario({ keepAlive, checkServerIdentity: () => undefined }, async ({ exchange }) => {
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
