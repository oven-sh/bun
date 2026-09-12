import { describe, expect, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, tls as certs, nodeExe } from "harness";
import net from "net";
import { join } from "path";
import tls from "tls";

test("should be able to upgrade a paused socket and also have backpressure on it #15438", async () => {
  // enought to trigger backpressure
  const payload = Buffer.alloc(16 * 1024 * 4, "b").toString("utf8");

  const server = tls.createServer(certs, socket => {
    // echo
    socket.on("data", data => {
      socket.write(data);
    });
  });

  await once(server.listen(0, "127.0.0.1"), "listening");

  const socket = net.connect({
    port: (server.address() as net.AddressInfo).port,
    host: "127.0.0.1",
  });
  await once(socket, "connect");

  // pause raw socket
  socket.pause();

  const tlsSocket = tls.connect({
    ca: certs.cert,
    servername: "localhost",
    socket,
  });
  await once(tlsSocket, "secureConnect");

  // do http request using tls socket
  async function doWrite(socket: net.Socket) {
    let downloadedBody = 0;
    const { promise, resolve, reject } = Promise.withResolvers();
    function onData(data: Buffer) {
      downloadedBody += data.byteLength;
      if (downloadedBody === payload.length * 2) {
        resolve();
      }
    }
    socket.pause();
    socket.write(payload);
    socket.write(payload, () => {
      socket.on("data", onData);
      socket.resume();
    });

    await promise;
    socket.off("data", onData);
  }
  for (let i = 0; i < 100; i++) {
    // upgrade the tlsSocket
    await doWrite(tlsSocket);
  }

  expect().pass();
});

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L723-L727
test.each([
  ["readable: false", () => ({ readable: false })],
  [
    "an onread buffer",
    (saw: string[]) => ({ onread: { buffer: Buffer.alloc(64), callback: (n: number) => saw.push(`onread ${n}`) } }),
  ],
  ["no reader", () => ({})],
])(
  "tls.connect({ socket }) over a net.Socket with %s keeps the TLS bytes off the wrapped socket",
  async (_, options) => {
    const server = tls.createServer(certs, socket => {
      socket.on("error", () => {});
      socket.write("banner");
      socket.on("data", data => socket.write("echo:" + data));
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const saw: string[] = [];
      const raw = net.connect({
        port: (server.address() as net.AddressInfo).port,
        host: "127.0.0.1",
        ...options(saw),
      });
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      raw.on("error", reject);
      await once(raw, "connect");
      const tlsSocket = tls.connect({ socket: raw, ca: certs.cert, servername: "localhost" });
      const closed = once(tlsSocket, "close");
      let got = "";
      tlsSocket.on("error", reject);
      tlsSocket.on("close", () => reject(new Error(`closed after ${JSON.stringify(got)}`)));
      tlsSocket.on("secureConnect", () => tlsSocket.write("hi"));
      tlsSocket.on("data", data => {
        got += data;
        if (got.endsWith("echo:hi")) resolve(got);
      });
      expect(await promise).toBe("bannerecho:hi");
      expect(saw).toEqual([]);
      expect(raw.readableLength).toBe(0);
      tlsSocket.destroy();
      await closed;
    } finally {
      server.close();
    }
  },
);

// Both peers keep their plaintext 'data' listener across the upgrade.
test("a STARTTLS exchange hands no TLS bytes to the 'data' listeners of the wrapped sockets (#32239)", async () => {
  const saw: string[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const server = net.createServer(socket => {
    socket.on("error", reject);
    let wrapped = false;
    socket.on("data", data => {
      if (wrapped) return void saw.push(`server data ${data.length}`);
      wrapped = true;
      socket.write("GO", () => {
        const tlsSocket = new tls.TLSSocket(socket, { isServer: true, secureContext: tls.createSecureContext(certs) });
        tlsSocket.on("error", reject);
        tlsSocket.on("data", data => tlsSocket.write("echo:" + data));
      });
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    const raw = net.connect({ port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" });
    raw.on("error", reject);
    let tlsSocket: tls.TLSSocket | undefined;
    raw.on("data", data => {
      if (tlsSocket) return void saw.push(`client data ${data.length}`);
      tlsSocket = tls.connect({ socket: raw, ca: certs.cert, servername: "localhost" });
      tlsSocket.on("error", reject);
      tlsSocket.on("secureConnect", () => tlsSocket!.write("hi"));
      tlsSocket.on("data", data => resolve(String(data)));
    });
    raw.write("STARTTLS");
    expect(await promise).toBe("echo:hi");
    expect(saw).toEqual([]);
    const closed = once(tlsSocket!, "close");
    tlsSocket!.destroy();
    await closed;
  } finally {
    server.close();
  }
});

// TLSWrap owns the reads of the handle it wraps, so the EOF or the read error of a connection that closes is the TLS
// socket's to report: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L723-L727
// The wrapped socket only closes, from TLSWrap.close(): https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L676-L688
// Each log is the ordered events of both sockets. The fixture runs on both runtimes so the logs are pinned to node.
describe.each([
  ["bun", bunExe()],
  ["node", nodeExe()],
])("the close of a connection under a TLS socket and the net.Socket it wraps (%s)", (_runtime, exe) => {
  async function run(...cell: string[]) {
    await using proc = Bun.spawn({
      cmd: [exe!, join(import.meta.dir, "tls-wrapped-socket-close-fixture.mjs"), ...cell],
      env: { ...bunEnv, TLS_KEY: certs.key, TLS_CERT: certs.cert },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const events = JSON.parse(stdout);
    expect(exitCode).toBe(0);
    return events;
  }

  // The TLS socket has sent its FIN, so the peer's FIN closes the connection with no TLS-level EOF ahead of it.
  const eof = ["tls finish", "tls end", "raw close hadError=false", "tls close hadError=false"];
  const reset = ["tls error ECONNRESET", "raw close hadError=false", "tls close hadError=true"];

  test.concurrent.skipIf(!exe).each([
    ["tls", "process.nextTick"],
    ["tls", "setImmediate"],
    ["net", "process.nextTick"],
    ["net", "setImmediate"],
  ])(
    "new TLSSocket(socket, { isServer }) end()s before the handshake completes, %s peer, from %s",
    async (peer, when) => {
      expect(await run("end-before-handshake", peer, when)).toEqual(eof);
    },
  );

  test.concurrent.skipIf(!exe)(
    "new TLSSocket(socket, { isServer }) end()s, the peer answers 'end' with destroy()",
    async () => {
      expect(await run("end-after-handshake")).toEqual(eof);
    },
  );

  test.concurrent.skipIf(!exe)("tls.connect({ socket }) end()s, the peer answers 'end' with destroy()", async () => {
    expect(await run("client-end-after-handshake")).toEqual(eof);
  });

  test.concurrent.skipIf(!exe)("data that nothing read before the connection closed is still delivered", async () => {
    expect(await run("unread-data")).toEqual([
      "tls finish",
      "connection closed, unread=4",
      "tls data late",
      "tls end",
      "raw close hadError=false",
      "tls close hadError=false",
    ]);
  });

  test.concurrent.skipIf(!exe).each([
    ["new TLSSocket(socket, { isServer }), before the handshake completes", "reset-before-handshake"],
    ["new TLSSocket(socket, { isServer }), after the handshake", "reset-after-handshake"],
    ["tls.connect({ socket }), after the handshake", "client-reset-after-handshake"],
  ])("a peer reset is an 'error' on the TLS socket only: %s", async (_, cell) => {
    expect(await run(cell)).toEqual(reset);
  });

  test.concurrent.skipIf(!exe)(
    "a peer reset of a socket injected into a tls.Server is a 'tlsClientError'",
    async () => {
      expect(await run("tls-server-reset-before-handshake")).toEqual([
        "tlsClientError ECONNRESET",
        "raw close hadError=false",
        "tls close hadError=true",
      ]);
    },
  );
});
