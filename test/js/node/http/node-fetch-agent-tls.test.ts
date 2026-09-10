// https://github.com/oven-sh/bun/issues/7332
// https://github.com/oven-sh/bun/issues/19754
// @kubernetes/client-node passes an https.Agent (with ca/cert/key) to node-fetch.
// Bun's node-fetch shim must apply those TLS options like node-fetch does on Node.
// This file uses node:test so it runs unchanged on Node: `node --test <file>`.
import assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { describe, test } from "node:test";
import type { TLSSocket } from "node:tls";
import nodeFetch from "node-fetch";

const fixturesDir = path.join(import.meta.dirname, "..", "tls", "fixtures");
const ca1 = readFileSync(path.join(fixturesDir, "ca1-cert.pem"), "utf8");
const serverKey = readFileSync(path.join(fixturesDir, "agent1-key.pem"), "utf8");
const serverCert = readFileSync(path.join(fixturesDir, "agent1-cert.pem"), "utf8");
// agent1-cert has CN=agent1 and no SAN, so clients verify it under that servername.
const servername = "agent1";

async function listen(server: http.Server | https.Server) {
  server.on("tlsClientError", () => {});
  server.listen(0);
  await once(server, "listening");
  return {
    port: (server.address() as AddressInfo).port,
    async [Symbol.asyncDispose]() {
      server.close();
      await once(server, "close");
    },
  };
}

function serve(options: https.ServerOptions) {
  return listen(
    https.createServer(options, (req, res) => {
      const socket = req.socket as TLSSocket;
      res.writeHead(200, { "content-type": "application/json", connection: "close" });
      res.end(JSON.stringify({ authorized: socket.authorized }));
    }),
  );
}

function serveSelfSigned() {
  return serve({ key: serverKey, cert: serverCert });
}

async function fetchWith(port: number, agent: https.Agent | ((url: URL) => https.Agent)) {
  const res = await nodeFetch(`https://localhost:${port}/`, { agent });
  assert.strictEqual(res.status, 200);
  return (await res.json()) as { authorized: boolean };
}

describe("node-fetch applies TLS options from the agent", () => {
  test("rejects a server signed by an unknown CA when no agent is given (baseline)", async () => {
    await using server = await serveSelfSigned();
    await assert.rejects(nodeFetch(`https://localhost:${server.port}/`), (err: Error & { code?: string }) => {
      assert.match(String(err.code), /UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|SELF_SIGNED/);
      return true;
    });
  });

  test("verifies the server via agent.options.ca and servername", async () => {
    await using server = await serveSelfSigned();
    const agent = new https.Agent({ ca: ca1, servername });
    try {
      assert.deepStrictEqual(await fetchWith(server.port, agent), { authorized: false });
    } finally {
      agent.destroy();
    }
  });

  test("sends the client cert and key for mTLS via the agent", async () => {
    await using server = await serve({
      key: serverKey,
      cert: serverCert,
      ca: ca1,
      requestCert: true,
      rejectUnauthorized: false,
    });
    const anonAgent = new https.Agent({ ca: ca1, servername });
    const agent = new https.Agent({ ca: ca1, cert: serverCert, key: serverKey, servername });
    // Node also accepts the key as [{ pem }] objects.
    const pemAgent = new https.Agent({ ca: ca1, cert: serverCert, key: [{ pem: serverKey }], servername });
    try {
      // Without cert/key on the agent the server sees an unauthenticated client.
      assert.deepStrictEqual(await fetchWith(server.port, anonAgent), { authorized: false });
      assert.deepStrictEqual(await fetchWith(server.port, agent), { authorized: true });
      assert.deepStrictEqual(await fetchWith(server.port, pemAgent), { authorized: true });
    } finally {
      anonAgent.destroy();
      agent.destroy();
      pemAgent.destroy();
    }
  });

  test("applies rejectUnauthorized: false from the agent", async () => {
    await using server = await serveSelfSigned();
    const agent = new https.Agent({ rejectUnauthorized: false });
    try {
      assert.deepStrictEqual(await fetchWith(server.port, agent), { authorized: false });
    } finally {
      agent.destroy();
    }
  });

  test("accepts string minVersion and maxVersion on the agent", async () => {
    await using server = await serveSelfSigned();
    const agent = new https.Agent({ ca: ca1, servername, minVersion: "TLSv1.2", maxVersion: "TLSv1.3" });
    try {
      assert.deepStrictEqual(await fetchWith(server.port, agent), { authorized: false });
    } finally {
      agent.destroy();
    }
  });

  test("accepts agent as a function of the request URL", async () => {
    await using server = await serveSelfSigned();
    const agent = new https.Agent({ ca: ca1, servername });
    // node-fetch v2 passes a legacy url.parse() object and v3 a WHATWG URL. Both have these fields.
    let calledWith: { protocol: string; hostname: string; port: string } | undefined;
    try {
      const body = await fetchWith(server.port, url => {
        calledWith = url;
        return agent;
      });
      assert.deepStrictEqual(body, { authorized: false });
      assert.deepStrictEqual(
        { protocol: calledWith?.protocol, hostname: calledWith?.hostname, port: String(calledWith?.port) },
        { protocol: "https:", hostname: "localhost", port: String(server.port) },
      );
    } finally {
      agent.destroy();
    }
  });

  test("a plain http request with an http.Agent still works", async () => {
    await using server = await listen(
      http.createServer((req, res) => {
        res.writeHead(200, { connection: "close" });
        res.end("OK");
      }),
    );
    const agent = new http.Agent();
    try {
      const res = await nodeFetch(`http://localhost:${server.port}/`, { agent });
      assert.strictEqual(await res.text(), "OK");
    } finally {
      agent.destroy();
    }
  });
});
