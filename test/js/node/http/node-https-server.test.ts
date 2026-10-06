import { describe, expect, test } from "bun:test";
import { tls as validCert } from "harness";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import tls from "node:tls";

function listen(server: http.Server): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  return promise;
}

// Resolves with everything the server wrote back to a bare HTTP/1.1 request.
function plaintextRequest(port: number): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  let received = "";
  const socket = net.connect(port, "127.0.0.1", () => {
    socket.write("GET /secret HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  });
  socket.on("data", chunk => (received += chunk.toString("latin1")));
  socket.on("error", () => {});
  socket.on("close", () => resolve(received));
  return promise;
}

function tlsRequest(port: number): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  let received = "";
  const socket = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => {
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  });
  socket.on("data", chunk => (received += chunk));
  socket.on("error", (err: NodeJS.ErrnoException) => resolve(String(err.code)));
  socket.on("close", () => resolve(received));
  return promise;
}

describe.concurrent("https.Server with no usable key and cert", () => {
  test.each<[string, (handler: http.RequestListener) => http.Server]>([
    ["createServer(requestListener)", handler => https.createServer(handler)],
    ["createServer({}, requestListener)", handler => https.createServer({}, handler)],
    ["createServer(undefined, requestListener)", handler => https.createServer(undefined, handler)],
    ["createServer({ key: undefined, cert: undefined })", handler => https.createServer({ key: undefined, cert: undefined }, handler)], // prettier-ignore
    ["createServer({ requestCert: true })", handler => https.createServer({ requestCert: true }, handler)],
    ["new https.Server({}, requestListener)", handler => new https.Server({}, handler)],
    ["https.Server(requestListener)", handler => (https.Server as any)(handler)],
  ])("%s is a TLS listener that refuses every connection", async (_label, createServer) => {
    let requests = 0;
    await using server = createServer((_req, res) => {
      requests++;
      res.end("SECRET");
    });
    const port = await listen(server);

    const cleartext = await plaintextRequest(port);
    expect(cleartext).not.toContain("HTTP/");
    expect(cleartext).not.toContain("SECRET");
    // A cleartext listener yields ERR_SSL_WRONG_VERSION_NUMBER or ECONNRESET here.
    expect(await tlsRequest(port)).toContain("_ALERT_");
    expect(requests).toBe(0);
  });
});

test("https.Server is its own class and still serves TLS only when it has a key and cert", async () => {
  expect(https.Server).not.toBe(http.Server);
  expect(http.createServer()).not.toBeInstanceOf(https.Server);
  await using server = https.createServer({ ...validCert }, (req, res) => res.end(`encrypted=${(req.socket as tls.TLSSocket).encrypted}`)); // prettier-ignore
  expect(server).toBeInstanceOf(https.Server);
  const port = await listen(server);

  expect(await plaintextRequest(port)).not.toContain("HTTP/");
  expect(await tlsRequest(port)).toEndWith("encrypted=true");
});

// Bun only: Node's http.Server ignores key and cert. Deployments rely on this, it must never become cleartext.
test.skipIf(!process.versions.bun).each<[string, () => object]>([
  ["key and cert", () => ({ ...validCert })],
  ["key, cert and ca", () => ({ ...validCert, ca: validCert.cert })],
])("http.createServer() with %s serves TLS and never cleartext", async (_label, options) => {
  await using server = http.createServer(options(), (req, res) => res.end(`encrypted=${(req.socket as tls.TLSSocket).encrypted}`)); // prettier-ignore
  const port = await listen(server);

  expect(await plaintextRequest(port)).not.toContain("HTTP/");
  expect(await tlsRequest(port)).toEndWith("encrypted=true");
});

describe("new https.Server() applies the ALPN defaults of createServer()", () => {
  function wire(protocols: string[]) {
    const out = {} as { ALPNProtocols: Buffer };
    tls.convertALPNProtocols(protocols, out);
    return out.ALPNProtocols;
  }

  test("defaults ALPNProtocols to http/1.1", () => {
    const server = new https.Server() as https.Server & { ALPNProtocols?: Buffer; ALPNCallback?: unknown };
    expect(server.ALPNProtocols).toEqual(wire(["http/1.1"]));
    expect(server.ALPNCallback).toBeUndefined();
  });

  test("keeps an explicit ALPNProtocols", () => {
    const server = new https.Server({ ALPNProtocols: ["h2", "http/1.1"] }) as https.Server & { ALPNProtocols?: Buffer };
    expect(server.ALPNProtocols).toEqual(wire(["h2", "http/1.1"]));
  });

  test("stores ALPNCallback and skips the default protocol list", () => {
    const ALPNCallback = () => "http/1.1";
    const server = new https.Server({ ALPNCallback }) as https.Server & { ALPNProtocols?: Buffer; ALPNCallback?: unknown }; // prettier-ignore
    expect(server.ALPNCallback).toBe(ALPNCallback);
    expect(server.ALPNProtocols).toBeUndefined();
  });
});
