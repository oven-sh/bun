/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * An https.Agent with a proxy calls tls.connect() when the proxy has answered
 * the CONNECT. That is after https.request() returned, so nothing catches what
 * tls.connect() throws for the TLS options of the request. nodejs/node#66096
 * gives it to the request, and closes the connection to the proxy.
 */
import assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
// Self-signed, for localhost and 127.0.0.1.
const cert = readFileSync(join(fixtures, "cert.pem"), "utf8");
const key = readFileSync(join(fixtures, "cert.key"), "utf8");
const encryptedKey = readFileSync(join(fixtures, "cert.encrypted.key"), "utf8");

const established = "HTTP/1.1 200 Connection established\r\n\r\n";
const target = { host: "example.invalid", port: 443, path: "/" };
const invalidVersion = { minVersion: "TLSv9" };
const rejected = [
  { name: "minVersion", options: invalidVersion, code: "ERR_TLS_INVALID_PROTOCOL_VERSION" },
  { name: "ciphers", options: { ciphers: 123 }, code: "ERR_INVALID_ARG_TYPE" },
  { name: "secureProtocol", options: { secureProtocol: "TLSv9_method" }, code: "ERR_TLS_INVALID_PROTOCOL_METHOD" },
  { name: "checkServerIdentity", options: { checkServerIdentity: "not a function" }, code: "ERR_INVALID_ARG_TYPE" },
  { name: "wrong passphrase", options: { key: encryptedKey, cert, passphrase: "wrong" }, code: "ERR_OSSL_BAD_DECRYPT" },
];

// No Node release has nodejs/node#66096: v26.10.0 throws uncaught. It is on Node main, so v27 runs these
// tests, and on v26.x-staging (33e4ba358b), which is not in a v26 release.
const runtimeHasFix = typeof Bun !== "undefined" || Number(process.versions.node.split(".")[0]) > 26;

function listen(server: net.Server): Promise<number> {
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function proxiedAgent(proxyUrl: string, options: https.AgentOptions = {}) {
  return new https.Agent({ ...options, proxyEnv: { https_proxy: proxyUrl } } as any);
}

// The error that tls.connect() throws for these options when nothing is between it and its caller.
function thrownByTlsConnect(options: object) {
  try {
    tls.connect({ ...options } as any);
  } catch (err: any) {
    return { code: err.code, message: err.message };
  }
}

// A CONNECT proxy. With `relay` it connects each tunnel to the host that the CONNECT names.
// Without it, it answers 200 and then holds the connection.
function createProxy(scheme: string, relay = false) {
  const sockets = new Set<net.Socket>();
  const connects: string[] = [];
  // What the client sent on a held connection after the CONNECT.
  const afterConnect: Buffer[] = [];
  // Settles when the first connection is closed. A proxy that holds it does not close it, so the client did.
  const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();

  function onTunnel(socket: net.Socket) {
    let head = "";
    socket.on("error", () => {});
    socket.on("data", function onHead(chunk: Buffer) {
      head += chunk.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      socket.removeListener("data", onHead);
      const requestLine = head.slice(0, head.indexOf("\r\n"));
      connects.push(requestLine);
      if (!relay) {
        socket.on("data", (chunk: Buffer) => afterConnect.push(chunk));
        socket.write(established);
        return;
      }
      socket.pause();
      const [host, port] = requestLine.split(" ")[1].split(":");
      const upstream = net.connect(Number(port), host, () => {
        socket.write(established);
        socket.pipe(upstream).pipe(socket);
      });
      upstream.on("error", () => socket.destroy());
      upstream.on("close", () => socket.destroy());
      socket.on("close", () => upstream.destroy());
    });
  }

  const proxy = scheme === "https" ? tls.createServer({ key, cert }, onTunnel) : net.createServer(onTunnel);
  // The TCP connection, for an https proxy too.
  proxy.on("connection", (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      onClosed();
    });
  });

  function close() {
    for (const socket of sockets) socket.destroy();
    proxy.close();
  }
  return { proxy, connects, afterConnect, closed, close };
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
  req.on("timeout", () => events.push("timeout"));
  req.on("error", (err: NodeJS.ErrnoException) => events.push({ code: err.code, message: err.message }));
  req.on("close", () => {
    events.push("close");
    resolve(events);
  });
  return promise;
}

describe(
  "https.request through a proxy from proxyEnv, with TLS options that tls.connect() rejects",
  { skip: !runtimeHasFix },
  () => {
    for (const scheme of ["http", "https"]) {
      for (const { name, options, code } of rejected) {
        test(`${scheme} proxy: ${name}`, async () => {
          const defaults = scheme === "https" ? tls.getCACertificates("default") : undefined;
          const { proxy, connects, closed, close } = createProxy(scheme);
          const agent = proxiedAgent(`${scheme}://127.0.0.1:${await listen(proxy)}`);
          try {
            // The client has to trust the certificate of an https proxy.
            if (defaults) tls.setDefaultCACertificates([...defaults, cert]);
            const expected = { code, message: thrownByTlsConnect(options)?.message };
            const req = https.get({ ...target, agent, ...options } as any);
            assert.deepStrictEqual(await eventsOf(req), [expected, "close"]);
            await closed;
            assert.deepStrictEqual(connects, ["CONNECT example.invalid:443 HTTP/1.1"]);
          } finally {
            agent.destroy();
            close();
            if (defaults) tls.setDefaultCACertificates(defaults);
          }
        });
      }
    }

    test("agent.createConnection() gives its callback the error and the closed proxy socket", async () => {
      const { proxy, closed, close } = createProxy("http");
      const agent = proxiedAgent(`http://127.0.0.1:${await listen(proxy)}`);
      try {
        const calls: unknown[] = [];
        const { promise: called, resolve: onCalled } = Promise.withResolvers<void>();
        const proxySocket = (agent as any).createConnection(
          { ...target, ...invalidVersion },
          (err: NodeJS.ErrnoException, socket: net.Socket) => {
            calls.push({ code: err.code, proxySocket: socket === proxySocket, destroyed: socket.destroyed });
            onCalled();
          },
        );
        await called;
        assert.deepStrictEqual(calls, [
          { code: "ERR_TLS_INVALID_PROTOCOL_VERSION", proxySocket: true, destroyed: true },
        ]);
        await closed;
      } finally {
        agent.destroy();
        close();
      }
    });

    test("a falsy value thrown by tls.connect(): the proxy gets nothing of the request", async () => {
      const { proxy, afterConnect, closed, close } = createProxy("http");
      const agent = proxiedAgent(`http://127.0.0.1:${await listen(proxy)}`);
      try {
        const throwingKey = [
          {
            get pem() {
              throw null;
            },
          },
        ];
        const req = https.request({ ...target, agent, method: "POST", key: throwingKey } as any);
        const events = eventsOf(req);
        req.end("for the target only");
        // The Agent takes a falsy error for success. The socket that it gives the request is closed.
        const [socket] = await once(req, "socket");
        assert.strictEqual(socket.destroyed, true);
        assert.deepStrictEqual(await events, ["socket", { code: "ECONNRESET", message: "socket hang up" }, "close"]);
        await closed;
        assert.strictEqual(Buffer.concat(afterConnect).toString("latin1"), "");
      } finally {
        agent.destroy();
        close();
      }
    });

    test("http.setGlobalProxyFromEnv()", async () => {
      const { proxy, connects, closed, close } = createProxy("http");
      const restore = (http as any).setGlobalProxyFromEnv({ https_proxy: `http://127.0.0.1:${await listen(proxy)}` });
      try {
        const req = https.get({ ...target, ...invalidVersion } as any);
        assert.deepStrictEqual(await eventsOf(req), [thrownByTlsConnect(invalidVersion), "close"]);
        await closed;
        assert.deepStrictEqual(connects, ["CONNECT example.invalid:443 HTTP/1.1"]);
      } finally {
        restore();
        close();
      }
    });

    test("a request with a timeout gets the error and no 'timeout'", async () => {
      const { proxy, closed, close } = createProxy("http");
      const agent = proxiedAgent(`http://127.0.0.1:${await listen(proxy)}`);
      try {
        // The tunnel takes the timeout of the request. It is far longer than the test.
        const req = https.get({ ...target, agent, ...invalidVersion, timeout: 600_000 } as any);
        assert.deepStrictEqual(await eventsOf(req), [thrownByTlsConnect(invalidVersion), "close"]);
        await closed;
      } finally {
        agent.destroy();
        close();
      }
    });

    test("a request that waited behind maxTotalSockets", async () => {
      const server = https.createServer({ key, cert }, (req, res) => res.end("OK"));
      const port = await listen(server);
      const { proxy, connects, close } = createProxy("http", true);
      const agent = proxiedAgent(`http://127.0.0.1:${await listen(proxy)}`, { ca: cert, maxTotalSockets: 1 });
      try {
        const request = { host: "127.0.0.1", port, path: "/", agent };
        const first = https.get(request);
        const firstEvents = eventsOf(first);
        // The Agent counts the socket of a tunnel from when the tunnel is there. Later requests then wait.
        await once(first, "socket");
        const rejectedEvents = eventsOf(https.get({ ...request, ...invalidVersion } as any));
        const lastEvents = eventsOf(https.get(request));
        assert.strictEqual(Object.values(agent.requests).flat().length, 2);

        assert.deepStrictEqual(await rejectedEvents, [thrownByTlsConnect(invalidVersion), "close"]);
        assert.deepStrictEqual(await firstEvents, ["socket", "response 200", "close"]);
        assert.deepStrictEqual(await lastEvents, ["socket", "response 200", "close"]);
        assert.deepStrictEqual(connects, Array(3).fill(`CONNECT 127.0.0.1:${port} HTTP/1.1`));
      } finally {
        agent.destroy();
        close();
        server.close();
      }
    });
  },
);

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, bunExe, nodeExe } = await import("harness");
  const node = nodeExe();

  describe("https.request through a proxy from NODE_USE_ENV_PROXY=1", () => {
    test("the request gets what tls.connect() throws, and the process exits", async () => {
      const { proxy, close } = createProxy("http");
      const port = await listen(proxy);
      try {
        // The global agent takes the proxy from the environment when node:https loads.
        const script = `
          const events = [];
          const req = require("node:https").get("https://example.invalid/", { minVersion: "TLSv9" });
          req.on("error", err => events.push(err.code));
          req.on("close", () => {
            events.push("close");
            console.log(JSON.stringify(events));
          });
        `;
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", script],
          env: {
            ...bunEnv,
            NODE_USE_ENV_PROXY: "1",
            HTTPS_PROXY: `http://127.0.0.1:${port}`,
            https_proxy: undefined,
            NO_PROXY: undefined,
            no_proxy: undefined,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        // The proxy holds the connection. The process can only exit when the client closed it.
        assert.deepStrictEqual(
          { stdout: stdout.trim(), stderr, exitCode },
          { stdout: JSON.stringify(["ERR_TLS_INVALID_PROTOCOL_VERSION", "close"]), stderr: "", exitCode: 0 },
        );
      } finally {
        close();
      }
    });
  });

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
