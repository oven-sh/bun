import { expect, test } from "bun:test";
import { tls as COMMON_CERT } from "harness";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import tlsModule from "node:tls";

async function listen(server: { listen: Function; address: Function }): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server as any, "listening");
  return server.address().port;
}

type Probe = { alpnProtocol: string | false | null; body: string } | { error: string };

/** Opens one TLS connection offering `ALPNProtocols` and reads a single response. */
function probe(port: number, ALPNProtocols?: string[]): Promise<Probe> {
  return new Promise(resolve => {
    let body = "";
    const socket = tlsModule.connect(
      { port, host: "127.0.0.1", servername: "localhost", ca: [COMMON_CERT.cert], ALPNProtocols },
      () => socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"),
    );
    socket.on("data", chunk => (body += chunk));
    socket.on("error", error => resolve({ error: (error as NodeJS.ErrnoException).code! }));
    socket.on("close", () => resolve({ alpnProtocol: socket.alpnProtocol, body: body.split("\r\n\r\n")[1] ?? "" }));
  });
}

/** Echoes the negotiated protocol back so the server side is asserted too. */
function alpnServer(options: Record<string, unknown> = {}) {
  const server = https.createServer({ ...COMMON_CERT, ...options }, (req, res) =>
    res.end(String((req.socket as any).alpnProtocol)),
  );
  // A rejected handshake never produces a request; keep the failure quiet.
  server.on("tlsClientError", () => {});
  return server;
}

const NO_OVERLAP = { error: "ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL" };

test("https server defaults its ALPN offer to http/1.1", async () => {
  const server = alpnServer();
  try {
    const port = await listen(server);
    expect(await probe(port, ["http/1.1"])).toEqual({ alpnProtocol: "http/1.1", body: "http/1.1" });
  } finally {
    server.close();
  }
});

test("https server serves a client that offers no ALPN at all", async () => {
  const server = alpnServer();
  try {
    const port = await listen(server);
    expect(await probe(port)).toEqual({ alpnProtocol: false, body: "false" });
  } finally {
    server.close();
  }
});

test("https server sends no_application_protocol when nothing overlaps", async () => {
  const server = alpnServer();
  try {
    const port = await listen(server);
    // RFC 7301 §3.2 requires a fatal alert rather than an unnegotiated handshake.
    expect(await probe(port, ["bogus/9"])).toEqual(NO_OVERLAP);
  } finally {
    server.close();
  }
});

test("https server honors an ALPNProtocols array, in server preference order", async () => {
  const server = alpnServer({ ALPNProtocols: ["bun/2", "bun/1"] });
  try {
    const port = await listen(server);
    expect(await probe(port, ["bun/1", "bun/2"])).toEqual({ alpnProtocol: "bun/2", body: "bun/2" });
    expect(await probe(port, ["bun/1"])).toEqual({ alpnProtocol: "bun/1", body: "bun/1" });
    expect(await probe(port, ["bun/3"])).toEqual(NO_OVERLAP);
  } finally {
    server.close();
  }
});

test("https server honors an ALPNProtocols wire-format buffer", async () => {
  const server = alpnServer({ ALPNProtocols: Buffer.from("\x05bun/1", "latin1") });
  try {
    const port = await listen(server);
    expect(await probe(port, ["bun/1"])).toEqual({ alpnProtocol: "bun/1", body: "bun/1" });
  } finally {
    server.close();
  }
});

test("https server honors ALPNProtocols passed to listen()", async () => {
  const server = alpnServer();
  try {
    server.listen({ port: 0, host: "127.0.0.1", tls: { ...COMMON_CERT, ALPNProtocols: ["bun/7"] } });
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    expect(await probe(port, ["bun/7"])).toEqual({ alpnProtocol: "bun/7", body: "bun/7" });
    expect(await probe(port, ["http/1.1"])).toEqual(NO_OVERLAP);
  } finally {
    server.close();
  }
});

test("plain http server has no alpnProtocol on its sockets", async () => {
  const server = http.createServer((req, res) => res.end(String((req.socket as any).alpnProtocol)));
  try {
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(await response.text()).toBe("undefined");
  } finally {
    server.close();
  }
});
