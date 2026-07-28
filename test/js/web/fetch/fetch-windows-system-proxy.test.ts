// On Windows, when none of the `http_proxy`/`HTTPS_PROXY` env vars are set,
// Bun's HTTP client should fall back to the system proxy configuration
// (WinINet Internet Settings, as read by WinHttpGetIEProxyConfigForCurrentUser).
//
// The system config is exposed as WINHTTP_CURRENT_USER_IE_PROXY_CONFIG
// (fAutoDetect, lpszAutoConfigUrl, lpszProxy, lpszProxyBypass). Modifying the
// real per-user registry value in CI would leak state across tests, so these
// tests drive the code path through BUN_INTERNAL_WINHTTP_IE_PROXY_CONFIG which
// substitutes for the WinHTTP call with the same field shape. That hook is
// honoured on every platform so the gate can verify the wiring.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import net from "node:net";

function envWithoutProxy(extra: Record<string, string>) {
  const env = { ...bunEnv, ...extra } as Record<string, string | undefined>;
  for (const k of [
    "http_proxy",
    "HTTP_PROXY",
    "https_proxy",
    "HTTPS_PROXY",
    "no_proxy",
    "NO_PROXY",
    "all_proxy",
    "ALL_PROXY",
  ]) {
    delete env[k];
  }
  return env as Record<string, string>;
}

async function makeHttpProxy() {
  let sawHost = "";
  let connections = 0;
  const server = net.createServer(sock => {
    connections++;
    let buf = Buffer.alloc(0);
    sock.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      const head = buf.subarray(0, end).toString("latin1");
      const m = head.split("\r\n")[0].match(/^GET (\S+) HTTP/);
      if (m) sawHost = m[1];
      sock.end(
        "HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\nFROM_PROXY",
      );
    });
    sock.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;
  return {
    url: `127.0.0.1:${port}`,
    get sawHost() {
      return sawHost;
    },
    get connections() {
      return connections;
    },
    [Symbol.dispose]() {
      server.close();
    },
  };
}

const CHILD = `
  const res = await fetch(process.env.TARGET_URL);
  process.stdout.write(await res.text());
`;

describe.concurrent("Windows system proxy fallback", () => {
  test("fetch uses a static system proxy when no env vars are set", async () => {
    using proxy = await makeHttpProxy();
    await using direct = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("DIRECT"),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", CHILD],
      env: envWithoutProxy({
        BUN_INTERNAL_WINHTTP_IE_PROXY_CONFIG: `0||${proxy.url}|`,
        TARGET_URL: `http://127.0.0.1:${direct.port}/hello`,
      }),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("FROM_PROXY");
    // Absolute-form request-target proves the client spoke forward-proxy HTTP.
    expect(proxy.sawHost).toStartWith("http://127.0.0.1:");
    expect(exitCode).toBe(0);
  });

  test("per-scheme system proxy: http= used for http://", async () => {
    using proxy = await makeHttpProxy();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", CHILD],
      env: envWithoutProxy({
        BUN_INTERNAL_WINHTTP_IE_PROXY_CONFIG:
          `0||http=${proxy.url};https=192.0.2.1:1;ftp=ignored:1|`,
        TARGET_URL: `http://127.0.0.1:1/x`,
      }),
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stdout).toBe("FROM_PROXY");
    expect(exitCode).toBe(0);
  });

  test("bypass list: <local> does not bypass dotted hosts", async () => {
    // `<local>` is "intranet hostnames with no dot". `127.0.0.1` has dots so
    // it still routes through the proxy.
    using proxy = await makeHttpProxy();
    await using direct = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("DIRECT"),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", CHILD],
      env: envWithoutProxy({
        BUN_INTERNAL_WINHTTP_IE_PROXY_CONFIG:
          `0||${proxy.url}|*.example.com;<local>`,
        TARGET_URL: `http://127.0.0.1:${direct.port}/`,
      }),
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stdout).toBe("FROM_PROXY");
    expect(proxy.connections).toBe(1);
    expect(exitCode).toBe(0);
  });

  test("bypass list: explicit host entry", async () => {
    using proxy = await makeHttpProxy();
    await using direct = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("DIRECT"),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", CHILD],
      env: envWithoutProxy({
        BUN_INTERNAL_WINHTTP_IE_PROXY_CONFIG: `0||${proxy.url}|127.0.0.1`,
        TARGET_URL: `http://127.0.0.1:${direct.port}/`,
      }),
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stdout).toBe("DIRECT");
    expect(proxy.connections).toBe(0);
    expect(exitCode).toBe(0);
  });

  test("HTTP_PROXY env var wins over system proxy", async () => {
    using envProxy = await makeHttpProxy();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", CHILD],
      env: {
        ...envWithoutProxy({
          BUN_INTERNAL_WINHTTP_IE_PROXY_CONFIG: `0||192.0.2.1:1|`,
          TARGET_URL: `http://127.0.0.1:1/x`,
        }),
        HTTP_PROXY: `http://${envProxy.url}`,
      },
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stdout).toBe("FROM_PROXY");
    expect(envProxy.connections).toBe(1);
    expect(exitCode).toBe(0);
  });

  test("NO_PROXY=* from env overrides a system proxy", async () => {
    using proxy = await makeHttpProxy();
    await using direct = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("DIRECT"),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", CHILD],
      env: {
        ...envWithoutProxy({
          BUN_INTERNAL_WINHTTP_IE_PROXY_CONFIG: `0||${proxy.url}|`,
          TARGET_URL: `http://127.0.0.1:${direct.port}/`,
        }),
        NO_PROXY: "*",
      },
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stdout).toBe("DIRECT");
    expect(proxy.connections).toBe(0);
    expect(exitCode).toBe(0);
  });
});
