import { describe, expect, test } from "bun:test";
import { tls as serverTls } from "harness";
import https from "node:https";

const nodeFetch = require("node-fetch");

// https://github.com/oven-sh/bun/issues/7332
// https://github.com/oven-sh/bun/issues/10642
// https://github.com/oven-sh/bun/issues/16546
// https://github.com/oven-sh/bun/issues/19754
describe("node-fetch with https.Agent TLS options", () => {
  test("rejects self-signed certificate without a trusted CA", async () => {
    using server = Bun.serve({
      tls: serverTls,
      port: 0,
      fetch: () => new Response("ok"),
    });
    expect(nodeFetch(`https://localhost:${server.port}/`)).rejects.toThrow();
  });

  test("uses ca from agent.options to verify the server", async () => {
    using server = Bun.serve({
      tls: serverTls,
      port: 0,
      fetch: () => new Response("ok"),
    });
    const agent = new https.Agent({ ca: serverTls.cert });
    try {
      const res = await nodeFetch(`https://localhost:${server.port}/`, { agent });
      expect(await res.text()).toBe("ok");
      expect(res.status).toBe(200);
    } finally {
      agent.destroy();
    }
  });

  test("uses rejectUnauthorized: false from agent.options", async () => {
    using server = Bun.serve({
      tls: serverTls,
      port: 0,
      fetch: () => new Response("ok"),
    });
    const agent = new https.Agent({ rejectUnauthorized: false });
    try {
      const res = await nodeFetch(`https://localhost:${server.port}/`, { agent });
      expect(await res.text()).toBe("ok");
      expect(res.status).toBe(200);
    } finally {
      agent.destroy();
    }
  });

  test("accepts agent as a function", async () => {
    using server = Bun.serve({
      tls: serverTls,
      port: 0,
      fetch: () => new Response("ok"),
    });
    const agent = new https.Agent({ ca: serverTls.cert });
    try {
      let receivedUrl: { protocol?: string } | undefined;
      const res = await nodeFetch(`https://localhost:${server.port}/`, {
        agent: (parsedUrl: { protocol?: string }) => {
          receivedUrl = parsedUrl;
          return agent;
        },
      });
      expect(await res.text()).toBe("ok");
      expect(receivedUrl?.protocol).toBe("https:");
    } finally {
      agent.destroy();
    }
  });

  test("presents client certificate from agent.options", async () => {
    // Server requires a client certificate signed by `ca`; without one the TLS
    // handshake is rejected. This is the mTLS path @kubernetes/client-node uses.
    using server = Bun.serve({
      tls: {
        cert: serverTls.cert,
        key: serverTls.key,
        ca: serverTls.cert,
        requestCert: true,
        rejectUnauthorized: true,
      },
      port: 0,
      fetch: () => new Response("have-cert"),
    });

    // No client cert: handshake fails.
    {
      const agent = new https.Agent({ ca: serverTls.cert });
      try {
        expect(nodeFetch(`https://localhost:${server.port}/`, { agent })).rejects.toThrow();
      } finally {
        agent.destroy();
      }
    }

    // With client cert/key on the agent: succeeds.
    {
      const agent = new https.Agent({
        ca: serverTls.cert,
        cert: serverTls.cert,
        key: serverTls.key,
      });
      try {
        const res = await nodeFetch(`https://localhost:${server.port}/`, { agent });
        expect(await res.text()).toBe("have-cert");
        expect(res.status).toBe(200);
      } finally {
        agent.destroy();
      }
    }
  });

  test("does not override an explicit tls option", async () => {
    using server = Bun.serve({
      tls: serverTls,
      port: 0,
      fetch: () => new Response("ok"),
    });
    // Agent has no ca (would fail verification), but the explicit tls option does.
    const agent = new https.Agent({ rejectUnauthorized: true });
    try {
      const res = await nodeFetch(`https://localhost:${server.port}/`, {
        agent,
        tls: { ca: serverTls.cert },
      });
      expect(await res.text()).toBe("ok");
    } finally {
      agent.destroy();
    }
  });

  test("reads options from agent.connectOpts (proxy-agent shape)", async () => {
    using server = Bun.serve({
      tls: serverTls,
      port: 0,
      fetch: () => new Response("ok"),
    });
    const agent = { connectOpts: { ca: serverTls.cert } };
    const res = await nodeFetch(`https://localhost:${server.port}/`, { agent });
    expect(await res.text()).toBe("ok");
  });
});
