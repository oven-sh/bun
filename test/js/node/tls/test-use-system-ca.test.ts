import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
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
        env: { ...bunEnv, SSL_CERT_FILE: join(keysDir, "ca1-cert.pem"), KEYS_DIR: keysDir, NODE_USE_SYSTEM_CA: "0" },
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
