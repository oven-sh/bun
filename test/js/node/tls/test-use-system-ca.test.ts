import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir, tls } from "harness";
import { join } from "path";

// node's test CA and a leaf it signed (CN=agent1).
const keysDir = join(import.meta.dir, "../test/fixtures/keys");

describe("--use-system-ca", () => {
  test("flag loads system certificates", async () => {
    // Test that --use-system-ca loads system certificates
    await using proc = spawn({
      cmd: [bunExe(), "--use-system-ca", "-e", "console.log('OK')"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });

  test("NODE_USE_SYSTEM_CA=1 loads system certificates", async () => {
    // Test that NODE_USE_SYSTEM_CA environment variable works
    await using proc = spawn({
      cmd: [bunExe(), "-e", "console.log('OK')"],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });

  test("NODE_USE_SYSTEM_CA=0 doesn't load system certificates", async () => {
    // Test that NODE_USE_SYSTEM_CA=0 doesn't load system certificates
    await using proc = spawn({
      cmd: [bunExe(), "-e", "console.log('OK')"],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });

  // node makes --use-system-ca a per-Environment option: a Worker's execArgv decides which roots the
  // TLS contexts *it* creates trust, independently of the parent and of sibling workers. Hermetic
  // on Linux, where SSL_CERT_FILE defines the system store; the parent trusts only the bundled roots.
  test.skipIf(!isLinux)(
    "a Worker's --use-system-ca / --no-use-system-ca governs the roots its own connections trust",
    async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const tls = require("tls");
          const fs = require("fs");
          const { Worker } = require("worker_threads");
          const keys = process.env.KEYS_DIR;
          const server = tls.createServer({
            key: fs.readFileSync(keys + "/agent1-key.pem"),
            cert: fs.readFileSync(keys + "/agent1-cert.pem"),
          }, s => s.end("hi"));
          const http = require("https").createServer({
            key: fs.readFileSync(keys + "/agent1-key.pem"),
            cert: fs.readFileSync(keys + "/agent1-cert.pem"),
          }, (req, res) => res.end("ok"));
          server.listen(0, () => http.listen(0, async () => {
            const workerSrc = \`
              const tls = require("tls");
              const { parentPort, workerData } = require("worker_threads");
              const connect = () => new Promise(resolve => {
                const s = tls.connect({ port: workerData.tlsPort, host: "127.0.0.1", servername: "agent1",
                  checkServerIdentity: () => undefined }, () => { resolve("authorized"); s.destroy(); });
                s.on("error", e => resolve(e.code || e.message));
              });
              const doFetch = () => fetch("https://127.0.0.1:" + workerData.httpPort, {
                tls: { checkServerIdentity: () => undefined } }).then(r => r.text(), e => e.code || e.message);
              (async () => parentPort.postMessage({
                connect: await connect(),
                fetch: await doFetch(),
                reportedDefault: tls.getCACertificates("default").length,
                reportedBundled: tls.getCACertificates("bundled").length,
              }))();
            \`;
            const run = execArgv => new Promise((resolve, reject) => {
              const w = new Worker(workerSrc, { eval: true, execArgv,
                workerData: { tlsPort: server.address().port, httpPort: http.address().port } });
              w.once("message", resolve);
              w.once("error", reject);
            });
            const withSystem = await run(["--use-system-ca"]);
            const withoutSystem = await run(["--no-use-system-ca"]);
            console.log(JSON.stringify({ withSystem, withoutSystem }));
            server.close();
            http.close();
          }));
          `,
        ],
        env: {
          ...bunEnv,
          SSL_CERT_FILE: join(keysDir, "ca1-cert.pem"),
          KEYS_DIR: keysDir,
          NODE_USE_SYSTEM_CA: "0",
          // An ambient NODE_EXTRA_CA_CERTS would join every store and skew the counts.
          NODE_EXTRA_CA_CERTS: undefined,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const result = JSON.parse(stdout.trim());
      // The --use-system-ca worker trusts ca1 (the "system" root here) for both its own tls.connect and
      // fetch, and reports it; the --no-use-system-ca worker in the same process trusts only the
      // bundled roots, so the same server fails verification.
      expect(result.withSystem.connect).toBe("authorized");
      expect(result.withSystem.fetch).toBe("ok");
      expect(result.withSystem.reportedDefault).toBe(result.withSystem.reportedBundled + 1);
      expect(result.withoutSystem.connect).not.toBe("authorized");
      expect(result.withoutSystem.fetch).not.toBe("ok");
      expect(result.withoutSystem.reportedDefault).toBe(result.withoutSystem.reportedBundled);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    },
  );

  // OpenSSL's default lookups (SSL_CERT_FILE here) are part of the default store only under
  // --use-system-ca / --use-openssl-ca, as in node; the bare default trusts the bundled roots alone.
  test.each([
    [[], "rejected:DEPTH_ZERO_SELF_SIGNED_CERT"],
    [["--use-openssl-ca"], "trusted"],
    [["--use-system-ca"], "trusted"],
  ])("SSL_CERT_FILE with flags %j -> %s", async (flags, expected) => {
    using dir = tempDir("use-openssl-ca", { "cert.pem": tls.cert, "key.pem": tls.key });
    await using proc = spawn({
      cmd: [
        bunExe(),
        ...flags,
        "-e",
        `
        const tls = require("tls");
        const fs = require("fs");
        const server = tls.createServer({ cert: fs.readFileSync("cert.pem"), key: fs.readFileSync("key.pem") }, s => s.end());
        server.listen(0, "127.0.0.1", () => {
          const c = tls.connect({ port: server.address().port, host: "127.0.0.1" }, () => { console.log("trusted"); c.destroy(); server.close(); });
          c.on("error", e => { console.log("rejected:" + e.code); server.close(); });
        });
        `,
      ],
      cwd: String(dir),
      env: {
        ...bunEnv,
        SSL_CERT_FILE: join(String(dir), "cert.pem"),
        NODE_USE_SYSTEM_CA: undefined,
        NODE_EXTRA_CA_CERTS: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: expected, stderr: "" });
    expect(exitCode).toBe(0);
  });

  // Clients that fall back to the thread's default client context (WebSocket has no per-connection
  // CA option) must follow the worker's --use-system-ca exactly like tls.connect and fetch do.
  // The harness cert is self-signed with a 127.0.0.1 SAN, so it can stand in as the "system" root
  // via SSL_CERT_FILE on every platform.
  test("a Worker's --use-system-ca (flag, or its own env when flagless) governs its WebSocket connections too", async () => {
    using dir = tempDir("use-system-ca-ws", { "cert.pem": tls.cert, "key.pem": tls.key });
    await using proc = spawn({
      cmd: [
        bunExe(),
        "--no-use-system-ca",
        "-e",
        `
        const { Worker } = require("worker_threads");
        const server = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          tls: { cert: Bun.file(process.env.CERT), key: Bun.file(process.env.KEY) },
          fetch(req, s) { return s.upgrade(req) ? undefined : new Response("http"); },
          websocket: { open(ws) { ws.send("hello"); ws.close(); }, message() {} },
        });
        const workerSrc = \`
          const tls = require("tls");
          const { parentPort, workerData: { port } } = require("worker_threads");
          const ws = new WebSocket("wss://127.0.0.1:" + port);
          const outcome = new Promise(resolve => {
            ws.onmessage = m => resolve("message:" + m.data);
            ws.onerror = () => {};
            ws.onclose = e => resolve("closed:" + e.code);
          });
          const socket = new Promise(resolve => {
            const s = tls.connect({ port, host: "127.0.0.1" }, () => { resolve("authorized"); s.destroy(); });
            s.on("error", e => resolve(e.code));
          });
          Promise.all([outcome, socket]).then(([webSocket, tlsConnect]) => parentPort.postMessage({ webSocket, tlsConnect }));
        \`;
        const run = (execArgv, env) => new Promise((resolve, reject) => {
          const w = new Worker(workerSrc, { eval: true, execArgv, env, workerData: { port: server.port } });
          w.once("message", resolve);
          w.once("error", reject);
        });
        (async () => {
          const withSystem = await run(["--use-system-ca"]);
          const withoutSystem = await run(["--no-use-system-ca"]);
          // Flagless workers resolve from their own env, not from the parent's --no-use-system-ca.
          const viaEnv = await run([], { ...process.env, NODE_USE_SYSTEM_CA: "1" });
          const viaEnvUnset = await run([], { ...process.env, NODE_USE_SYSTEM_CA: undefined });
          console.log(JSON.stringify({ withSystem, withoutSystem, viaEnv, viaEnvUnset }));
          server.stop(true);
        })();
        `,
      ],
      env: {
        ...bunEnv,
        SSL_CERT_FILE: join(String(dir), "cert.pem"),
        CERT: join(String(dir), "cert.pem"),
        KEY: join(String(dir), "key.pem"),
        NODE_USE_SYSTEM_CA: "0",
        NODE_EXTRA_CA_CERTS: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ result: JSON.parse(stdout.trim()), stderr }).toEqual({
      result: {
        withSystem: { webSocket: "message:hello", tlsConnect: "authorized" },
        withoutSystem: { webSocket: "closed:1015", tlsConnect: "DEPTH_ZERO_SELF_SIGNED_CERT" },
        viaEnv: { webSocket: "message:hello", tlsConnect: "authorized" },
        viaEnvUnset: { webSocket: "closed:1015", tlsConnect: "DEPTH_ZERO_SELF_SIGNED_CERT" },
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // A worker whose --use-system-ca differs from the process default must not make TLS-less
  // options parse as a TLS config: Bun.serve({ port: 0, fetch }) inside such a worker has to
  // stay a plain HTTP server instead of silently becoming an HTTPS server with no certificate.
  test("a differing --use-system-ca worker still serves plain HTTP without tls options", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("worker_threads");
        const w = new Worker(\`
          const { parentPort } = require("worker_threads");
          (async () => {
            const server = Bun.serve({ port: 0, fetch: () => new Response("plain") });
            const body = await (await fetch(server.url)).text();
            parentPort.postMessage({ protocol: server.url.protocol, body });
            server.stop(true);
          })();
        \`, { eval: true, execArgv: ["--use-system-ca"] });
        w.once("message", m => console.log(JSON.stringify(m)));
        w.once("error", e => { console.error(e); process.exit(1); });
        `,
      ],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ protocol: "http:", body: "plain" });
    expect(exitCode).toBe(0);
  });

  test("--use-system-ca overrides NODE_USE_SYSTEM_CA=0", async () => {
    // Test that CLI flag takes precedence over environment variable
    await using proc = spawn({
      cmd: [bunExe(), "--use-system-ca", "-e", "console.log('OK')"],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });
});
