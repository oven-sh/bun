// https://github.com/oven-sh/bun/issues/7332
// https://github.com/oven-sh/bun/issues/19754
// @kubernetes/client-node passes an https.Agent (with ca/cert/key) to node-fetch.
// Bun's node-fetch shim must forward those TLS options to the underlying fetch.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { tls as harnessTls } from "harness";
import nodeFetch from "node-fetch";
import { once } from "node:events";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "path";

const fixturesDir = join(import.meta.dir, "..", "tls", "fixtures");
const ca1 = readFileSync(join(fixturesDir, "ca1-cert.pem"), "utf8");
const serverKey = readFileSync(join(fixturesDir, "agent1-key.pem"), "utf8");
const serverCert = readFileSync(join(fixturesDir, "agent1-cert.pem"), "utf8");

describe("node-fetch honors TLS options from agent", () => {
  test("rejects self-signed server cert when agent has no ca (baseline)", async () => {
    using server = Bun.serve({
      tls: harnessTls,
      port: 0,
      fetch: () => new Response("OK"),
    });
    await expect(nodeFetch(`https://localhost:${server.port}/`)).rejects.toThrow(
      expect.objectContaining({ code: expect.stringMatching(/SELF_SIGNED|UNABLE_TO_VERIFY/) }),
    );
  });

  test("verifies server via agent.options.ca", async () => {
    using server = Bun.serve({
      tls: harnessTls,
      port: 0,
      fetch: () => new Response("OK"),
    });
    const agent = new https.Agent({ ca: harnessTls.cert });
    try {
      const res = await nodeFetch(`https://localhost:${server.port}/`, { agent });
      expect(await res.text()).toBe("OK");
      expect(res.status).toBe(200);
    } finally {
      agent.destroy();
    }
  });

  test("sends client cert/key for mTLS via agent", async () => {
    const server = https.createServer(
      {
        key: serverKey,
        cert: serverCert,
        ca: ca1,
        requestCert: true,
        rejectUnauthorized: false,
      },
      (req, res) => {
        const socket = req.socket as import("node:tls").TLSSocket;
        res.writeHead(200, { "content-type": "application/json", connection: "close" });
        res.end(JSON.stringify({ authorized: socket.authorized }));
      },
    );
    server.on("clientError", () => {});
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const anonAgent = new https.Agent({ ca: ca1, servername: "agent1" });
    const agent = new https.Agent({
      ca: ca1,
      cert: serverCert,
      key: serverKey,
      servername: "agent1",
    });
    try {
      // Without cert/key on the agent the server sees an unauthenticated client.
      const anon = await nodeFetch(`https://localhost:${port}/`, { agent: anonAgent });
      expect(await anon.json()).toEqual({ authorized: false });

      const res = await nodeFetch(`https://localhost:${port}/`, { agent });
      expect(await res.json()).toEqual({ authorized: true });

      // Node also accepts the key as [{ pem }] objects.
      const pemAgent = new https.Agent({
        ca: ca1,
        cert: serverCert,
        key: [{ pem: serverKey }],
        servername: "agent1",
      });
      try {
        const pemRes = await nodeFetch(`https://localhost:${port}/`, { agent: pemAgent });
        expect(await pemRes.json()).toEqual({ authorized: true });
      } finally {
        pemAgent.destroy();
      }
    } finally {
      anonAgent.destroy();
      agent.destroy();
      server.close();
      await once(server, "close");
    }
  });

  test("forwards rejectUnauthorized: false from agent", async () => {
    using server = Bun.serve({
      tls: harnessTls,
      port: 0,
      fetch: () => new Response("OK"),
    });
    const agent = new https.Agent({ rejectUnauthorized: false });
    try {
      const res = await nodeFetch(`https://localhost:${server.port}/`, { agent });
      expect(await res.text()).toBe("OK");
    } finally {
      agent.destroy();
    }
  });

  test("converts string minVersion/maxVersion from agent options", async () => {
    using server = Bun.serve({
      tls: harnessTls,
      port: 0,
      fetch: () => new Response("OK"),
    });
    const agent = new https.Agent({ ca: harnessTls.cert, minVersion: "TLSv1.2", maxVersion: "TLSv1.3" });
    try {
      const res = await nodeFetch(`https://localhost:${server.port}/`, { agent });
      expect(await res.text()).toBe("OK");
    } finally {
      agent.destroy();
    }
  });

  test("accepts agent as a function", async () => {
    using server = Bun.serve({
      tls: harnessTls,
      port: 0,
      fetch: () => new Response("OK"),
    });
    const agent = new https.Agent({ ca: harnessTls.cert });
    let calledWith: URL | undefined;
    try {
      const res = await nodeFetch(`https://localhost:${server.port}/`, {
        agent: (url: URL) => {
          calledWith = url;
          return agent;
        },
      });
      expect(await res.text()).toBe("OK");
      expect(calledWith).toBeInstanceOf(URL);
      expect(calledWith!.protocol).toBe("https:");
    } finally {
      agent.destroy();
    }
  });

  test("reads ca from agent.connectOpts (proxy-agent shape)", async () => {
    using server = Bun.serve({
      tls: harnessTls,
      port: 0,
      fetch: () => new Response("OK"),
    });
    const agent = { connectOpts: { ca: harnessTls.cert } };
    const res = await nodeFetch(`https://localhost:${server.port}/`, { agent });
    expect(await res.text()).toBe("OK");
  });

  test("explicit tls in init is not overridden by agent options", async () => {
    using server = Bun.serve({
      tls: harnessTls,
      port: 0,
      fetch: () => new Response("OK"),
    });
    // agent with a wrong CA; explicit tls with the right one should win
    const agent = new https.Agent({ ca: ca1 });
    try {
      const res = await nodeFetch(`https://localhost:${server.port}/`, {
        agent,
        // @ts-expect-error Bun extension
        tls: { ca: harnessTls.cert },
      });
      expect(await res.text()).toBe("OK");
    } finally {
      agent.destroy();
    }
  });

  test("a plain http request with an agent still works", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("OK"),
    });
    const agent = new https.Agent({ ca: harnessTls.cert });
    try {
      const res = await nodeFetch(`http://localhost:${server.port}/`, { agent });
      expect(await res.text()).toBe("OK");
    } finally {
      agent.destroy();
    }
  });
});
