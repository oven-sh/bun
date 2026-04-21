import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tls as validTls } from "harness";
import { join } from "node:path";

setDefaultTimeout(30_000);

describe("TLS keepalive for custom SSL configs", () => {
  test("keepalive reuses connections with same TLS config", async () => {
    using server = Bun.serve({
      port: 0,
      tls: validTls,
      hostname: "127.0.0.1",
      fetch(req, server) {
        const ip = server.requestIP(req);
        return new Response(String(ip?.port ?? 0));
      },
    });

    const url = `https://127.0.0.1:${server.port}`;
    const tlsOpts = { ca: validTls.cert, rejectUnauthorized: false };

    // Make sequential requests with keepalive enabled.
    // With our fix: connections reuse → same client port.
    // Without fix: disable_keepalive=true → new connection each time → different ports.
    const ports: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await fetch(url, { tls: tlsOpts, keepalive: true });
      ports.push(parseInt(await res.text(), 10));
    }

    const uniquePorts = new Set(ports);
    // Keepalive working: at most 2 unique ports (allowing one reconnect)
    expect(uniquePorts.size).toBeLessThanOrEqual(2);
  });

  test("different TLS configs use separate connections", async () => {
    using server = Bun.serve({
      port: 0,
      tls: validTls,
      hostname: "127.0.0.1",
      fetch(req, server) {
        const ip = server.requestIP(req);
        return new Response(String(ip?.port ?? 0));
      },
    });

    const url = `https://127.0.0.1:${server.port}`;

    // Two configs that differ (serverName makes them different SSLConfigs)
    const tlsA = { ca: validTls.cert, rejectUnauthorized: false };
    const tlsB = { ca: validTls.cert, rejectUnauthorized: false, serverName: "127.0.0.1" };

    const resA = await fetch(url, { tls: tlsA, keepalive: true });
    const portA = parseInt(await resA.text(), 10);

    const resB = await fetch(url, { tls: tlsB, keepalive: true });
    const portB = parseInt(await resB.text(), 10);

    // Different SSL configs must not share keepalive connections
    expect(portA).not.toBe(portB);
  });

  test("stress test - many sequential requests reuse connections", async () => {
    using server = Bun.serve({
      port: 0,
      tls: validTls,
      hostname: "127.0.0.1",
      fetch(req, server) {
        const ip = server.requestIP(req);
        return new Response(String(ip?.port ?? 0));
      },
    });

    const url = `https://127.0.0.1:${server.port}`;
    const tlsOpts = { ca: validTls.cert, rejectUnauthorized: false };

    const ports: number[] = [];
    for (let i = 0; i < 50; i++) {
      const res = await fetch(url, { tls: tlsOpts, keepalive: true });
      ports.push(parseInt(await res.text(), 10));
    }

    const uniquePorts = new Set(ports);
    // 50 requests through keepalive should use very few connections
    expect(uniquePorts.size).toBeLessThanOrEqual(3);
  });

  test("keepalive disabled creates new connections each time", async () => {
    using server = Bun.serve({
      port: 0,
      tls: validTls,
      hostname: "127.0.0.1",
      fetch(req, server) {
        const ip = server.requestIP(req);
        return new Response(String(ip?.port ?? 0));
      },
    });

    const url = `https://127.0.0.1:${server.port}`;
    const tlsOpts = { ca: validTls.cert, rejectUnauthorized: false };

    // With keepalive explicitly disabled, each request should open a new connection
    const ports: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await fetch(url, { tls: tlsOpts, keepalive: false });
      ports.push(parseInt(await res.text(), 10));
    }

    const uniquePorts = new Set(ports);
    // Every request should use a different connection → different port
    expect(uniquePorts.size).toBeGreaterThan(1);
  });
});

describe.skipIf(isASAN)("TLS custom config memory leak detection", () => {
  test("repeated fetches with same custom TLS config do not leak memory", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", join(import.meta.dir, "tls-keepalive-leak-fixture.js")],
      env: {
        ...bunEnv,
        TLS_CERT: validTls.cert,
        TLS_KEY: validTls.key,
        NUM_REQUESTS: "100000",
        MODE: "same",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const result = JSON.parse(stdout.trim());
    console.log(`Same config: ${result.numRequests} requests, growth: ${result.growthMB} MB`);

    if (exitCode !== 0) {
      console.error(stderr);
    }
    expect(result.growthMB).toBeLessThan(50);
    expect(exitCode).toBe(0);
  });

  test("many distinct TLS configs stay bounded by cache eviction", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", join(import.meta.dir, "tls-keepalive-leak-fixture.js")],
      env: {
        ...bunEnv,
        TLS_CERT: validTls.cert,
        TLS_KEY: validTls.key,
        NUM_REQUESTS: "200",
        MODE: "distinct",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const result = JSON.parse(stdout.trim());
    console.log(`Distinct configs: ${result.numRequests} configs, growth: ${result.growthMB} MB`);

    if (exitCode !== 0) {
      console.error(stderr);
    }
    expect(result.growthMB).toBeLessThan(75 * (isASAN ? 8 : 1));
    expect(exitCode).toBe(0);
  });
});
