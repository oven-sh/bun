// https://github.com/oven-sh/bun/issues/19868
// https://github.com/oven-sh/bun/issues/21792
//
// When tls.serverName (or SNI entries) are configured, Bun.serve() registers
// routes on both the default uWS router and an SNI-specific one.
// server.reload() used to only clear + re-register the default router,
// leaving the SNI router holding handlers that pointed at freed route
// objects (StaticRoute / UserRoute). The next request that matched that
// SNI crashed with a use-after-free ("Invalid pointer tag" / segfault).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";

const cert = JSON.stringify(tls.cert);
const key = JSON.stringify(tls.key);

function fixture(tlsConfig: string, routeKind: "static" | "function") {
  const before = routeKind === "static" ? `new Response("before-reload")` : `() => new Response("before-reload")`;
  const after = routeKind === "static" ? `new Response("after-reload")` : `() => new Response("after-reload")`;
  return /* ts */ `
    const server = Bun.serve({
      port: 0,
      tls: ${tlsConfig},
      routes: {
        "/status": ${before},
      },
      fetch() {
        return new Response("fallback");
      },
    });

    server.reload({
      routes: {
        "/status": ${after},
      },
      fetch() {
        return new Response("fallback2");
      },
    });

    const res = await fetch(\`https://localhost:\${server.port}/status\`, {
      tls: { rejectUnauthorized: false },
    });
    console.log(JSON.stringify({ status: res.status, body: await res.text() }));

    // A second request to make sure the connection is reusable and the
    // SNI router didn't just happen to dispatch once.
    const res2 = await fetch(\`https://localhost:\${server.port}/status\`, {
      tls: { rejectUnauthorized: false },
    });
    console.log(JSON.stringify({ status: res2.status, body: await res2.text() }));

    server.stop(true);
  `;
}

describe("server.reload() with TLS serverName / SNI routers", () => {
  const tlsConfigs = [
    ["tls.serverName", `{ cert: ${cert}, key: ${key}, serverName: "localhost" }`],
    ["tls SNI array", `[{ cert: ${cert}, key: ${key}, serverName: "localhost" }]`],
  ] as const;

  test.concurrent.each(tlsConfigs)(
    "static route served from SNI router after reload (%s)",
    async (_label, tlsConfig) => {
      await run(tlsConfig, "static");
    },
  );

  test.concurrent.each(tlsConfigs)(
    "function route served from SNI router after reload (%s)",
    async (_label, tlsConfig) => {
      await run(tlsConfig, "function");
    },
  );

  async function run(tlsConfig: string, routeKind: "static" | "function") {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture(tlsConfig, routeKind)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const lines = stdout
      .trim()
      .split("\n")
      .map(l => JSON.parse(l));
    expect(lines).toEqual([
      { status: 200, body: "after-reload" },
      { status: 200, body: "after-reload" },
    ]);
    expect(exitCode).toBe(0);
  }
});
