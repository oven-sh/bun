import { heapStats } from "bun:jsc";
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tls as tlsCerts } from "harness";
import { createHash, X509Certificate } from "node:crypto";
import { once } from "node:events";
import net, { type AddressInfo } from "node:net";
import tls from "node:tls";
import { Worker } from "node:worker_threads";
import { WebSocket as WsPackageWebSocket } from "ws";
import { clientEvents, startRecordingProxy, startRenegotiatingWssServer } from "./proxy-test-utils";

// NO_PROXY applies to explicit proxies too. An ambient
// NO_PROXY=localhost,127.0.0.1,... would bypass the proxy tests below.
const prevNoProxy = process.env.NO_PROXY;
const prevNoProxyLower = process.env.no_proxy;
process.env.NO_PROXY = "";
process.env.no_proxy = "";
afterAll(() => {
  if (prevNoProxy === undefined) delete process.env.NO_PROXY;
  else process.env.NO_PROXY = prevNoProxy;
  if (prevNoProxyLower === undefined) delete process.env.no_proxy;
  else process.env.no_proxy = prevNoProxyLower;
});

// A TLS server that records the SNI of every handshake and answers one
// WebSocket upgrade per connection. The harness certificate has CN=server-bun
// and SAN DNS:localhost, IP:127.0.0.1, IP:::1. With `hold`, a handshake that
// sends SNI stops at the ClientHello until `hold` resolves.
function startSniServer({
  requestCert = false,
  hold,
  version,
}: { requestCert?: boolean; hold?: Promise<void>; version?: tls.SecureVersion } = {}) {
  const sni: (string | null)[] = [];
  const clientCertificates: (string | undefined)[] = [];
  let applicationData = "";
  const connectionEnded = Promise.withResolvers<void>();
  const clientHello = Promise.withResolvers<void>();
  const server = tls.createServer(
    {
      key: tlsCerts.key,
      cert: tlsCerts.cert,
      minVersion: version,
      maxVersion: version,
      // The client certificate is recorded, not verified.
      requestCert,
      rejectUnauthorized: false,
      SNICallback(servername, cb) {
        sni.push(servername);
        clientHello.resolve();
        const resume = () => cb(null, tls.createSecureContext({ key: tlsCerts.key, cert: tlsCerts.cert }));
        if (hold) hold.then(resume);
        else resume();
      },
    },
    socket => {
      let buffered = "";
      socket.on("data", chunk => {
        applicationData += chunk.toString("latin1");
        buffered += chunk.toString("latin1");
        const end = buffered.indexOf("\r\n\r\n");
        if (end === -1) return;
        const key = buffered
          .slice(0, end)
          .split("\r\n")
          .find(line => line.toLowerCase().startsWith("sec-websocket-key:"))
          ?.split(":", 2)[1]
          .trim();
        if (!key) {
          socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
          return;
        }
        const accept = createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        buffered = "";
      });
      socket.on("error", () => {});
      socket.on("close", () => connectionEnded.resolve());
    },
  );
  server.on("tlsClientError", () => connectionEnded.resolve());
  // A handshake with no server_name extension never reaches SNICallback.
  server.on("secureConnection", socket => {
    if (!socket.servername) sni.push(null);
    if (requestCert) clientCertificates.push(socket.getPeerCertificate()?.fingerprint256);
  });
  const { promise, resolve } = Promise.withResolvers<number>();
  server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  return {
    port: promise,
    sni,
    clientCertificates,
    // The server has the ClientHello of a handshake that sends SNI.
    clientHello: clientHello.promise,
    // What the client has sent over TLS so far.
    get received() {
      return applicationData;
    },
    // The same, once the server saw the connection end. A rejected peer must
    // get none of the upgrade request: it carries Authorization and Cookie.
    async receivedInTotal() {
      await connectionEnded.promise;
      return applicationData;
    },
    [Symbol.dispose]() {
      server.close();
    },
  };
}

function openSession(ws: WebSocket) {
  ws.addEventListener("open", () => ws.close(1000));
  return clientEvents(ws);
}

const opened = [{ code: 1000, reason: "", wasClean: true }];
const expectedFingerprint256 = new X509Certificate(tlsCerts.cert).fingerprint256;
const tlsFailed = (url: string) => [
  { error: `WebSocket connection to '${url}' failed: TLS handshake failed` },
  { code: 1015, reason: "TLS handshake failed", wasClean: false },
];

describe.concurrent("WebSocket tls.serverName", () => {
  // `servername` is the node spelling of the same option.
  test.each(["serverName", "servername"] as const)(
    "%s is sent as SNI when the URL host is an IP address",
    async key => {
      using server = startSniServer();
      const url = `wss://127.0.0.1:${await server.port}/`;
      const ws = new WebSocket(url, { tls: { ca: tlsCerts.cert, [key]: "localhost" } });
      expect(await openSession(ws)).toEqual(opened);
      expect(server.sni).toEqual(["localhost"]);
    },
  );

  test("is the name the certificate is verified against", async () => {
    using server = startSniServer();
    const url = `wss://127.0.0.1:${await server.port}/`;
    // 127.0.0.1 is in the SAN, evil.test is not. Without serverName this would open.
    const ws = new WebSocket(url, { tls: { ca: tlsCerts.cert, serverName: "evil.test" } });
    expect(await openSession(ws)).toEqual(tlsFailed(url));
    expect(server.sni).toEqual(["evil.test"]);
    expect(await server.receivedInTotal()).toBe("");
  });

  test("is the bare address when it is an IPv6 literal in brackets, like fetch", async () => {
    using server = startSniServer();
    const url = `wss://127.0.0.1:${await server.port}/`;
    // ::1 is in the SAN as an IP address, and an IP address is never sent as SNI.
    const ws = new WebSocket(url, { tls: { ca: tlsCerts.cert, serverName: "[::1]" } });
    expect(await openSession(ws)).toEqual(opened);
    const hostnames: string[] = [];
    const withCallback = new WebSocket(url, {
      tls: { ca: tlsCerts.cert, serverName: "[::1]", checkServerIdentity: hostname => void hostnames.push(hostname) },
    });
    expect(await openSession(withCallback)).toEqual(opened);
    expect({ sni: server.sni, hostnames }).toEqual({ sni: [null, null], hostnames: ["::1"] });
  });

  test("is used for the tunnel handshake through an HTTP proxy", async () => {
    using server = startSniServer();
    using proxy = await startRecordingProxy();
    const url = `wss://127.0.0.1:${await server.port}/`;
    const ws = new WebSocket(url, {
      proxy: `http://127.0.0.1:${proxy.port}`,
      tls: { ca: tlsCerts.cert, serverName: "localhost" },
    });
    expect(await openSession(ws)).toEqual(opened);
    expect(server.sni).toEqual(["localhost"]);
    expect(proxy.requests).toHaveLength(1);
  });

  // The proxy is dialed by IP address, so its handshake has no SNI and its certificate is
  // checked against 127.0.0.1. `serverName` is for the handshake with the target.
  test.each([
    ["a name the certificate has", "localhost", undefined],
    ["a name that only the callback accepts", "target.test", () => undefined],
  ] as const)("names the target and not an HTTPS proxy: %s", async (_label, serverName, checkServerIdentity) => {
    using server = startSniServer();
    using proxy = await startRecordingProxy({ tls: true });
    const ws = new WebSocket(`wss://127.0.0.1:${await server.port}/`, {
      proxy: `https://127.0.0.1:${proxy.port}`,
      tls: { ca: tlsCerts.cert, serverName, checkServerIdentity },
    });
    expect(await openSession(ws)).toEqual(opened);
    expect({ proxy: proxy.sni, target: server.sni }).toEqual({ proxy: [null], target: [serverName] });
    expect(proxy.requests).toHaveLength(1);
  });
});

describe.concurrent("WebSocket tls.checkServerIdentity", () => {
  test("is called with the hostname and the peer certificate", async () => {
    using server = startSniServer();
    const url = `wss://localhost:${await server.port}/`;
    const calls: { hostname: string; subject: string; altnames: string; fingerprint256: string; raw: boolean }[] = [];
    const ws = new WebSocket(url, {
      tls: {
        ca: tlsCerts.cert,
        checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
          calls.push({
            hostname,
            subject: cert.subject.CN,
            altnames: cert.subjectaltname,
            fingerprint256: cert.fingerprint256,
            raw: Buffer.isBuffer(cert.raw),
          });
          return undefined;
        },
      },
    });
    expect(await openSession(ws)).toEqual(opened);
    expect(calls).toEqual([
      {
        hostname: "localhost",
        subject: "server-bun",
        altnames: "DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1",
        fingerprint256: expectedFingerprint256,
        raw: true,
      },
    ]);
    // Control for the rejection tests: the server does record the request.
    // It read all of it before the 101, so no wait for the connection to end.
    expect(server.received).toStartWith("GET / HTTP/1.1\r\n");
  });

  test("drains microtasks queued by the callback before the open event", async () => {
    using server = startSniServer();
    const url = `wss://localhost:${await server.port}/`;
    const order: string[] = [];
    const ws = new WebSocket(url, {
      tls: {
        ca: tlsCerts.cert,
        checkServerIdentity() {
          order.push("callback");
          queueMicrotask(() => order.push("microtask"));
          return undefined;
        },
      },
    });
    ws.addEventListener("open", () => order.push("open"));
    expect(await openSession(ws)).toEqual(opened);
    expect(order).toEqual(["callback", "microtask", "open"]);
  });

  test.each(["TLSv1.2", "TLSv1.3"] as const)("rejects the connection when it returns an Error: %s", async version => {
    using server = startSniServer({ version });
    const url = `wss://localhost:${await server.port}/`;
    let calls = 0;
    const ws = new WebSocket(url, {
      headers: { Authorization: "Bearer secret" },
      tls: {
        ca: tlsCerts.cert,
        checkServerIdentity() {
          calls++;
          return new Error("PIN-REJECT");
        },
      },
    });
    expect(await openSession(ws)).toEqual(tlsFailed(url));
    expect(calls).toBe(1);
    // Rejected before the upgrade: the peer never sees the request.
    expect(await server.receivedInTotal()).toBe("");
  });

  // The client runs in a child process: the exception it throws is reported as
  // uncaught, which would fail this test run.
  test("rejects the connection when it throws, and reports the exception", async () => {
    using server = startSniServer();
    const url = `wss://localhost:${await server.port}/`;
    await using client = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const events = [];
          process.on("uncaughtException", error => events.push("uncaught: " + error.message));
          const ws = new WebSocket(process.env.WS_URL, {
            tls: {
              ca: process.env.WS_CA,
              checkServerIdentity() {
                throw new Error("PIN-REJECT");
              },
            },
          });
          ws.onopen = () => {
            events.push("open");
            ws.close();
          };
          ws.onerror = event => events.push("error: " + event.message);
          ws.onclose = event => {
            events.push("close " + event.code);
            console.log(JSON.stringify(events));
          };
        `,
      ],
      env: { ...bunEnv, WS_URL: url, WS_CA: tlsCerts.cert },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([client.stdout.text(), client.stderr.text(), client.exited]);
    expect({ stderr, events: JSON.parse(stdout || "null") }).toEqual({
      stderr: "",
      events: [
        "uncaught: PIN-REJECT",
        `error: WebSocket connection to '${url}' failed: TLS handshake failed`,
        "close 1015",
      ],
    });
    expect(exitCode).toBe(0);
    expect(await server.receivedInTotal()).toBe("");
  });

  test("runs in the Bun.ModuleGraph that opened the WebSocket, so a throw goes to its onError", async () => {
    using server = startSniServer();
    const url = `wss://localhost:${await server.port}/`;
    const errors: unknown[] = [];
    const graph = new Bun.ModuleGraph({ onError: (error, kind) => errors.push([kind, (error as Error).message]) });
    try {
      let current: unknown;
      const events = await graph.run(() => {
        const ws = new WebSocket(url, {
          tls: {
            ca: tlsCerts.cert,
            checkServerIdentity() {
              current = Bun.ModuleGraph.current;
              throw new Error("PIN-REJECT");
            },
          },
        });
        return openSession(ws);
      });
      expect({ events, errors, ranInGraph: current === graph }).toEqual({
        events: tlsFailed(url),
        errors: [["uncaughtException", "PIN-REJECT"]],
        ranInGraph: true,
      });
    } finally {
      graph.dispose();
    }
  });

  describe.each(["direct", "through an HTTP proxy"] as const)("from inside the callback, %s", route => {
    test.each(["close", "terminate"] as const)("may %s() the WebSocket", async method => {
      using server = startSniServer();
      using proxy = await startRecordingProxy();
      const url = `wss://localhost:${await server.port}/`;
      const ws = new WebSocket(url, {
        headers: { Authorization: "Bearer secret" },
        proxy: route === "direct" ? undefined : `http://127.0.0.1:${proxy.port}`,
        tls: {
          ca: tlsCerts.cert,
          checkServerIdentity() {
            ws[method]();
            return undefined;
          },
        },
      });
      const reason = "WebSocket is closed before the connection is established";
      expect(await clientEvents(ws)).toEqual([
        { error: `WebSocket connection to '${url}' failed: ${reason}` },
        { code: 1006, reason, wasClean: false },
      ]);
      expect(await server.receivedInTotal()).toBe("");
    });
  });

  test("replaces the built-in hostname check, like fetch", async () => {
    using server = startSniServer();
    const url = `wss://127.0.0.1:${await server.port}/`;
    const calls: string[] = [];
    // evil.test is not in the SAN. The callback approves it anyway.
    const ws = new WebSocket(url, {
      tls: {
        ca: tlsCerts.cert,
        serverName: "evil.test",
        checkServerIdentity(hostname: string) {
          calls.push(hostname);
          return undefined;
        },
      },
    });
    expect(await openSession(ws)).toEqual(opened);
    expect(calls).toEqual(["evil.test"]);
  });

  // mTLS. The callback, not the built-in check, still decides on the name.
  test("replaces the built-in hostname check when the server asks for a client certificate", async () => {
    using server = startSniServer({ requestCert: true });
    const url = `wss://127.0.0.1:${await server.port}/`;
    const calls: string[] = [];
    const ws = new WebSocket(url, {
      tls: {
        ca: tlsCerts.cert,
        cert: tlsCerts.cert,
        key: tlsCerts.key,
        serverName: "evil.test",
        checkServerIdentity(hostname: string) {
          calls.push(hostname);
          return undefined;
        },
      },
    });
    expect(await openSession(ws)).toEqual(opened);
    expect(calls).toEqual(["evil.test"]);
    expect(server.clientCertificates).toEqual([expectedFingerprint256]);
  });

  // The verdict is read as tls.connect() reads it: any truthy value rejects. An async
  // callback returns a Promise, which is never an Error, so it must not pass for approval.
  test.each([
    ["a Promise, from an async callback", async () => new Error("PIN-REJECT")],
    ["a string", () => "pin mismatch"],
  ] as const)("rejects the connection when it returns %s", async (_label, checkServerIdentity) => {
    using server = startSniServer();
    const url = `wss://localhost:${await server.port}/`;
    const ws = new WebSocket(url, {
      headers: { Authorization: "Bearer secret" },
      tls: { ca: tlsCerts.cert, checkServerIdentity: checkServerIdentity as never },
    });
    expect(await openSession(ws)).toEqual(tlsFailed(url));
    expect(await server.receivedInTotal()).toBe("");
  });

  test.each([
    ["undefined", undefined],
    ["false", false],
  ] as const)("approves when it returns %s, as tls.connect() does", async (_label, verdict) => {
    using server = startSniServer();
    const url = `wss://localhost:${await server.port}/`;
    let calls = 0;
    const checkServerIdentity = () => (calls++, verdict);
    const ws = new WebSocket(url, { tls: { ca: tlsCerts.cert, checkServerIdentity: checkServerIdentity as never } });
    expect(await openSession(ws)).toEqual(opened);
    expect(calls).toBe(1);
  });

  test.each([
    ["a string", "pin"],
    ["an object", {}],
  ] as const)("throws when it is %s, like fetch", (_label, value) => {
    let error: unknown;
    try {
      new WebSocket("wss://localhost:1/", { tls: { checkServerIdentity: value as never } });
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.stringContaining('The "tls.checkServerIdentity" property must be of type function'),
    });
  });

  test("is ignored when it is null, and the built-in check applies", async () => {
    using server = startSniServer();
    const url = `wss://127.0.0.1:${await server.port}/`;
    const ws = new WebSocket(url, {
      tls: { ca: tlsCerts.cert, serverName: "evil.test", checkServerIdentity: null as never },
    });
    expect(await openSession(ws)).toEqual(tlsFailed(url));
  });

  test("is found on the prototype of the tls object, like the other tls options", async () => {
    using server = startSniServer();
    const url = `wss://localhost:${await server.port}/`;
    let calls = 0;
    const tlsOptions = Object.create({
      checkServerIdentity() {
        calls++;
        return new Error("PIN-REJECT");
      },
    });
    tlsOptions.ca = tlsCerts.cert;
    const ws = new WebSocket(url, { tls: tlsOptions });
    expect(await openSession(ws)).toEqual(tlsFailed(url));
    expect(calls).toBe(1);
  });

  describe("with rejectUnauthorized: false, like fetch", () => {
    test("runs only on a chain that verified, and its verdict is not enforced", async () => {
      using server = startSniServer();
      const url = `wss://localhost:${await server.port}/`;
      const calls: string[] = [];
      // Without `ca` the chain fails: the harness certificate is self-signed.
      for (const [label, ca] of [
        ["verified", tlsCerts.cert],
        ["unverified", undefined],
      ] as const) {
        const ws = new WebSocket(url, {
          tls: {
            ca,
            rejectUnauthorized: false,
            checkServerIdentity(hostname: string) {
              calls.push(`${label}: ${hostname}`);
              return new Error("PIN-REJECT");
            },
          },
        });
        expect(await openSession(ws)).toEqual(opened);
      }
      expect(calls).toEqual(["verified: localhost"]);
    });

    test("does the same for the target inside a proxy tunnel", async () => {
      using server = startSniServer();
      using proxy = await startRecordingProxy();
      const url = `wss://localhost:${await server.port}/`;
      const calls: string[] = [];
      const ws = new WebSocket(url, {
        proxy: `http://127.0.0.1:${proxy.port}`,
        tls: {
          ca: tlsCerts.cert,
          rejectUnauthorized: false,
          checkServerIdentity(hostname: string) {
            calls.push(hostname);
            return new Error("PIN-REJECT");
          },
        },
      });
      expect(await openSession(ws)).toEqual(opened);
      expect(calls).toEqual(["localhost"]);
      expect(proxy.requests).toHaveLength(1);
    });
  });

  // On a renegotiation BoringSSL requires the same certificate, so the verdict
  // of the callback still holds and the callback does not run again.
  (nodeExe() ? test : test.skip).each([
    ["a name the certificate does not have", { serverName: "evil.test" }, "evil.test"],
    ["an IP URL, which has no SNI", {}, "127.0.0.1"],
  ] as const)("a certificate it approved survives a TLS 1.2 renegotiation: %s", async (_label, names, hostname) => {
    await using server = await startRenegotiatingWssServer("after the 101");

    const calls: string[] = [];
    const ws = new WebSocket(`wss://127.0.0.1:${server.port}/`, {
      tls: {
        ca: tlsCerts.cert,
        ...names,
        checkServerIdentity(name: string) {
          calls.push(name);
          return undefined;
        },
      },
    });
    ws.addEventListener("open", () => ws.send("ready"));
    ws.addEventListener("message", () => ws.close(1000));
    expect(await clientEvents(ws)).toEqual(["after renegotiation", ...opened]);
    expect(calls).toEqual([hostname]);
  });

  test("is called for the target certificate through an HTTP proxy", async () => {
    using server = startSniServer();
    using proxy = await startRecordingProxy();
    const url = `wss://localhost:${await server.port}/`;
    const calls: string[] = [];
    const ws = new WebSocket(url, {
      proxy: `http://127.0.0.1:${proxy.port}`,
      tls: {
        ca: tlsCerts.cert,
        checkServerIdentity(hostname: string) {
          calls.push(hostname);
          return new Error("PIN-REJECT");
        },
      },
    });
    expect(await openSession(ws)).toEqual(tlsFailed(url));
    expect(calls).toEqual(["localhost"]);
    expect(proxy.requests).toHaveLength(1);
    expect(await server.receivedInTotal()).toBe("");
  });

  test("is not called for the certificate of an HTTPS proxy", async () => {
    using server = startSniServer();
    using proxy = await startRecordingProxy({ tls: true });
    const url = `wss://localhost:${await server.port}/`;
    const calls: string[] = [];
    // The proxy presents the harness certificate too. The built-in check
    // verifies it against 127.0.0.1; the callback sees only the target.
    const ws = new WebSocket(url, {
      proxy: `https://127.0.0.1:${proxy.port}`,
      tls: {
        ca: tlsCerts.cert,
        checkServerIdentity(hostname: string) {
          calls.push(hostname);
          return undefined;
        },
      },
    });
    expect(await openSession(ws)).toEqual(opened);
    expect(calls).toEqual(["localhost"]);
    expect(proxy.requests).toHaveLength(1);
  });

  // A call into a VM that is stopping is a no-op that returns undefined, which is also how the callback approves.
  test("does not approve when the handshake ends in a worker that terminate() has stopped", async () => {
    using server = startSniServer();
    const serverPort = await server.port;
    // Holds the server's first flight, so that the test decides when the handshake can end.
    const flight = Promise.withResolvers<() => Promise<void>>();
    const relay = net.createServer(client => {
      const upstream = net.connect(serverPort, "127.0.0.1");
      client.on("error", () => {});
      client.on("close", () => upstream.destroy());
      upstream.on("error", () => {});
      client.pipe(upstream);
      upstream.once("data", bytes =>
        flight.resolve(() => new Promise(sent => client.write(bytes, () => (upstream.pipe(client), sent())))),
      );
    });
    const other = Promise.withResolvers<net.Socket>();
    const otherServer = net.createServer(other.resolve);
    relay.listen(0, "127.0.0.1");
    otherServer.listen(0, "127.0.0.1");
    await Promise.all([once(relay, "listening"), once(otherServer, "listening")]);

    const [STAGE, BOTH_READABLE, STOPPED] = [0, 1, 2];
    const flags = new Int32Array(new SharedArrayBuffer(12));
    const stage = async (value: number) => {
      while (Atomics.load(flags, STAGE) !== value) await new Promise(resolve => setImmediate(resolve));
    };
    const raise = (flag: number) => (Atomics.store(flags, flag, 1), Atomics.notify(flags, flag));
    const worker = new Worker(
      `
        const { parentPort, workerData } = require("node:worker_threads");
        const { url, ca, otherPort, flags } = workerData;
        globalThis.ws = new WebSocket(url, {
          headers: { Authorization: "Bearer secret" },
          tls: { ca, checkServerIdentity: () => new Error("PIN-REJECT") },
        });
        Bun.connect({
          hostname: "127.0.0.1",
          port: otherPort,
          socket: {
            data() {
              Atomics.store(flags, ${STAGE}, 2);
              Atomics.wait(flags, ${STOPPED}, 0);
            },
          },
        });
        parentPort.on("message", () => {
          Atomics.store(flags, ${STAGE}, 1);
          Atomics.wait(flags, ${BOTH_READABLE}, 0);
        });
      `,
      {
        eval: true,
        workerData: {
          url: `wss://127.0.0.1:${(relay.address() as AddressInfo).port}/`,
          ca: tlsCerts.cert,
          otherPort: (otherServer.address() as AddressInfo).port,
          flags,
        },
      },
    );
    try {
      const [deliverFlight, otherSocket] = await Promise.all([flight.promise, other.promise]);
      // While the worker's thread is blocked, both of its sockets become readable, the other one first.
      worker.postMessage("block");
      await stage(1);
      await new Promise(sent => otherSocket.write("x", sent));
      await deliverFlight();
      raise(BOTH_READABLE);
      // One pass of the worker's event loop now reads both. terminate() lands between the two.
      await stage(2);
      const terminated = worker.terminate();
      raise(STOPPED);
      expect(await server.receivedInTotal()).toBe("");
      await terminated;
    } finally {
      raise(BOTH_READABLE);
      raise(STOPPED);
      await worker.terminate();
      relay.close();
      otherServer.close();
    }
  });

  // The `ws` package passes its `tls` object to the native client as it is.
  test("applies through the ws package, with tls.serverName", async () => {
    using server = startSniServer();
    const calls: string[] = [];
    const ws = new WsPackageWebSocket(`wss://127.0.0.1:${await server.port}/`, {
      tls: {
        ca: tlsCerts.cert,
        serverName: "localhost",
        checkServerIdentity(hostname: string) {
          calls.push(hostname);
          return new Error("PIN-REJECT");
        },
      },
    });
    // The first event decides. A close with no error before it must fail the assertion, not hang.
    const outcome = await new Promise<string>(resolve => {
      ws.on("open", () => resolve("open"));
      ws.on("error", () => resolve("error"));
      ws.on("close", code => resolve(`close ${code}`));
    });
    expect({ outcome, calls, sni: server.sni }).toEqual({ outcome: "error", calls: ["localhost"], sni: ["localhost"] });
    expect(await server.receivedInTotal()).toBe("");
  });
});

// Not concurrent: these count every live WebSocket in the process, or force a full GC.
describe("WebSocket tls.checkServerIdentity lifetime", () => {
  test("survives a GC before the handshake ends when only the WebSocket refers to it", async () => {
    const release = Promise.withResolvers<void>();
    using server = startSniServer({ hold: release.promise });
    const url = `wss://127.0.0.1:${await server.port}/`;
    const calls: string[] = [];
    // Nothing in this scope refers to the callback or to the tls object. The built-in check
    // rejects evil.test, so the connection opens only if the callback is still there to run.
    const ws = (() =>
      new WebSocket(url, {
        tls: {
          ca: tlsCerts.cert,
          serverName: "evil.test",
          checkServerIdentity: (hostname: string) => void calls.push(hostname),
        },
      }))();
    const session = openSession(ws);
    // A connection that ends before its ClientHello fails the assertion below and does not hang here.
    await Promise.race([server.clientHello, session]);
    Bun.gc(true);
    release.resolve();
    expect(await session).toEqual(opened);
    expect(calls).toEqual(["evil.test"]);
  });

  test("does not keep a closed WebSocket alive when the callback captures it", async () => {
    using server = startSniServer();
    const url = `wss://localhost:${await server.port}/`;
    const liveWebSockets = () => {
      Bun.gc(true);
      return heapStats().objectTypeCounts.WebSocket || 0;
    };
    const before = liveWebSockets();
    const total = 16;
    let checks = 0;
    await Promise.all(
      Array.from({ length: total }, async () => {
        // The cycle: the WebSocket holds the callback, and the callback holds the WebSocket.
        const ws: WebSocket = new WebSocket(url, {
          tls: {
            ca: tlsCerts.cert,
            checkServerIdentity() {
              if (ws.readyState === WebSocket.CONNECTING) checks++;
              return undefined;
            },
          },
        });
        expect(await openSession(ws)).toEqual(opened);
      }),
    );
    expect(checks).toBe(total);
    // The WebSocket drops its pending activity in a task after the close event.
    let leaked = liveWebSockets() - before;
    for (let i = 0; i < 10 && leaked > 2; i++) {
      await new Promise(resolve => setImmediate(resolve));
      leaked = liveWebSockets() - before;
    }
    expect(leaked).toBeLessThanOrEqual(2);
  });
});
