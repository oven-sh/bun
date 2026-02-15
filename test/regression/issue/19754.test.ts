import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import https from "node:https";
import { join } from "path";

const fixturesDir = join(import.meta.dir, "..", "..", "js", "node", "http", "fixtures");

const cert = readFileSync(join(fixturesDir, "cert.pem"), "utf8");
const key = readFileSync(join(fixturesDir, "cert.key"), "utf8");

describe("GitHub issue #19754: node-fetch with https.Agent TLS options", () => {
  test("node-fetch rejects self-signed cert without ca", async () => {
    using server = Bun.serve({
      tls: { cert, key },
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });

    const nodeFetch = require("node-fetch");
    await expect(nodeFetch(`https://localhost:${server.port}/`)).rejects.toThrow();
  });

  test("node-fetch extracts TLS options from agent", async () => {
    using server = Bun.serve({
      tls: { cert, key },
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });

    const nodeFetch = require("node-fetch");
    const agent = new https.Agent({
      ca: cert,
      rejectUnauthorized: true,
    });

    const response = await nodeFetch(`https://localhost:${server.port}/`, { agent });
    expect(await response.text()).toBe("OK");
    agent.destroy();
  });

  test("node-fetch extracts TLS options from agent function", async () => {
    using server = Bun.serve({
      tls: { cert, key },
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });

    const nodeFetch = require("node-fetch");
    const agent = new https.Agent({
      ca: cert,
      rejectUnauthorized: true,
    });

    const response = await nodeFetch(`https://localhost:${server.port}/`, {
      agent: (_url: URL) => agent,
    });
    expect(await response.text()).toBe("OK");
    agent.destroy();
  });

  test("node-fetch extracts TLS options from agent.connectOpts", async () => {
    using server = Bun.serve({
      tls: { cert, key },
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });

    const nodeFetch = require("node-fetch");
    const agent = { connectOpts: { ca: cert, rejectUnauthorized: true } };

    const response = await nodeFetch(`https://localhost:${server.port}/`, { agent });
    expect(await response.text()).toBe("OK");
  });

  test("node-fetch does not override explicit tls option with agent", async () => {
    using server = Bun.serve({
      tls: { cert, key },
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });

    const nodeFetch = require("node-fetch");
    const agent = new https.Agent({
      rejectUnauthorized: true,
    });

    const response = await nodeFetch(`https://localhost:${server.port}/`, {
      agent,
      tls: { ca: cert, rejectUnauthorized: true },
    });
    expect(await response.text()).toBe("OK");
    agent.destroy();
  });
});
