import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("NODE_EXTRA_CA_CERTS", () => {
  test("loads additional certificates from file", async () => {
    // Create a test certificate file
    const testCert = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKLdQVPy90WjMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
BAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX
aWRnaXRzIFB0eSBMdGQwHhcNMTgwNDEwMDgwNzQ4WhcNMjgwNDA3MDgwNzQ4WjBF
MQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50
ZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB
CgKCAQEAyOB7tY2Uo2lTNjJgGEhJAVZDWnHbLjbmTMP4pSXLlNMr9KdyaKE+J3xn
xAz7TbGPHUBH5dqMzlWqEkZxcY9u9GL19SJPpC7dl8K8V5dKBwvgOubcLp4qLvZU
-----END CERTIFICATE-----`;

    await using dir = tempDir("test-extra-ca", {
      "extra-ca.pem": testCert,
      "test.js": `console.log('OK');`,
    });

    const certPath = join(dir, "extra-ca.pem");

    // Test that NODE_EXTRA_CA_CERTS loads the certificate
    await using proc = spawn({
      cmd: [bunExe(), "test.js"],
      env: { ...bunEnv, NODE_EXTRA_CA_CERTS: certPath },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
  });

  test("handles missing certificate file gracefully", async () => {
    await using dir = tempDir("test-missing-ca", {
      "test.js": `console.log('OK');`,
    });

    const nonExistentPath = join(dir, "non-existent.pem");

    // Test that missing file doesn't crash the process
    await using proc = spawn({
      cmd: [bunExe(), "test.js"],
      env: { ...bunEnv, NODE_EXTRA_CA_CERTS: nonExistentPath },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Process should still run successfully even with missing cert file
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    // Bun may or may not warn about the missing file in stderr
    // The important thing is that the process doesn't crash
  });

  test("works with both NODE_EXTRA_CA_CERTS and --use-system-ca", async () => {
    const testCert = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKLdQVPy90WjMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
BAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX
aWRnaXRzIFB0eSBMdGQwHhcNMTgwNDEwMDgwNzQ4WhcNMjgwNDA3MDgwNzQ4WjBF
-----END CERTIFICATE-----`;

    await using dir = tempDir("test-extra-and-system", {
      "extra-ca.pem": testCert,
      "test.js": `console.log('OK');`,
    });

    const certPath = join(dir, "extra-ca.pem");

    // Test that both work together
    await using proc = spawn({
      cmd: [bunExe(), "--use-system-ca", "test.js"],
      env: { ...bunEnv, NODE_EXTRA_CA_CERTS: certPath },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
  });

  // One failed load is one warning, worded as Node words it, whichever API needs the extra CA list first.
  describe("a file that cannot be loaded warns once", () => {
    const missingWarning = "Warning: Ignoring extra certs from `missing.pem`, load failed: No such file or directory\n";

    // Accepts one connection, drops it and closes, so a TLS client fails its handshake without leaving the process.
    const deadEnd = `
      function deadEnd(connect) {
        const server = require("node:net").createServer(socket => {
          socket.destroy();
          server.close();
        });
        server.listen(0, "127.0.0.1", () => connect(server.address().port));
      }
    `;
    const users = {
      "tls.connect": `${deadEnd}
        deadEnd(port => require("node:tls").connect(port, "127.0.0.1").on("error", () => {}));`,
      "tls.createServer": `require("node:tls").createServer({});`,
      "fetch": `${deadEnd}
        deadEnd(port => fetch("https://127.0.0.1:" + port).catch(() => {}));`,
      "fetch, then node:tls": `${deadEnd}
        deadEnd(async port => {
          await fetch("https://127.0.0.1:" + port).catch(() => {});
          require("node:tls").createSecureContext();
        });`,
    };

    // NODE_EXTRA_CA_CERTS is relative to the child's cwd, so the warning names the same path on every platform.
    async function run(extraCACerts: string, files: Record<string, string>, code: string) {
      using dir = tempDir("extra-ca-warning", files);
      await using proc = spawn({
        cmd: [bunExe(), "-e", code],
        env: { ...bunEnv, NODE_EXTRA_CA_CERTS: extraCACerts },
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      return { stderr, exitCode };
    }

    for (const [user, code] of Object.entries(users)) {
      test.concurrent(user, async () => {
        expect(await run("missing.pem", {}, code)).toEqual({ stderr: missingWarning, exitCode: 0 });
      });
    }

    // Not concurrent: two VMs that each load node:tls make this the slow case on a debug build.
    test("node:tls in a Worker, then on the main thread", async () => {
      const code = `
        new (require("node:worker_threads").Worker)('require("node:tls").createSecureContext()', { eval: true })
          .on("exit", () => require("node:tls").createSecureContext());`;
      expect(await run("missing.pem", {}, code)).toEqual({ stderr: missingWarning, exitCode: 0 });
    });

    // Node warns for this file too. The reason is the TLS library's error string, which BoringSSL words differently.
    test.concurrent("a certificate that does not parse", async () => {
      const files = {
        "malformed.pem": "-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----\n",
      };
      expect(await run("malformed.pem", files, `require("node:tls").createSecureContext();`)).toEqual({
        stderr: expect.stringMatching(
          /^Warning: Ignoring extra certs from `malformed\.pem`, load failed: error:[^\n]+\n$/,
        ),
        exitCode: 0,
      });
    });

    test.concurrent("when the load fails, not when the process exits", async () => {
      using dir = tempDir("extra-ca-warning", {});
      const stderrPath = join(String(dir), "stderr.txt");
      // Bun.connect reaches the loader without node:tls. The child reports the attempt, then lives until stdin closes.
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `${deadEnd}
          deadEnd(port =>
            Bun.connect({ hostname: "127.0.0.1", port, tls: true, socket: { data() {}, error() {}, connectError() {} } })
              .catch(() => {})
              .finally(() => console.log("attempted")),
          );
          process.stdin.on("data", () => {});`,
        ],
        env: { ...bunEnv, NODE_EXTRA_CA_CERTS: "missing.pem" },
        cwd: String(dir),
        stdin: "pipe",
        stdout: "pipe",
        stderr: Bun.file(stderrPath),
      });
      const decoder = new TextDecoder();
      let stdout = "";
      for await (const chunk of proc.stdout) {
        stdout += decoder.decode(chunk, { stream: true });
        if (stdout.includes("\n")) break;
      }

      expect({ stdout, stderr: await Bun.file(stderrPath).text(), exitCode: proc.exitCode }).toEqual({
        stdout: "attempted\n",
        stderr: missingWarning,
        exitCode: null,
      });
    });
  });
});

test("explicit ca option replaces the default trust store instead of appending to it", async () => {
  const fixtures = join(import.meta.dir, "fixtures");

  await using dir = tempDir("ca-replaces-default", {
    "main.js": `
      const tls = require("node:tls");
      const fs = require("node:fs");
      const path = require("node:path");

      const fixtures = process.env.TLS_FIXTURES_DIR;
      const read = name => fs.readFileSync(path.join(fixtures, name), "utf8");

      // ca1 issued the server certificate AND is part of the default trust
      // store for this process (via NODE_EXTRA_CA_CERTS).
      const issuerCa = read("ca1-cert.pem");
      // ca2 did not issue the server certificate.
      const unrelatedCa = read("ca2-cert.pem");

      const server = tls.createServer(
        { key: read("agent1-key.pem"), cert: read("agent1-cert.pem") },
        socket => socket.end(),
      );

      function attempt(ca) {
        return new Promise(resolve => {
          const socket = tls.connect(
            {
              host: "127.0.0.1",
              port: server.address().port,
              ca,
              rejectUnauthorized: true,
              // The fixture cert is not issued for 127.0.0.1; this test is
              // about chain validation, not hostname verification.
              checkServerIdentity: () => undefined,
            },
            () => {
              socket.end();
              resolve("connected");
            },
          );
          socket.on("error", () => resolve("rejected"));
        });
      }

      server.listen(0, "127.0.0.1", async () => {
        console.log("pinned-to-unrelated-ca", await attempt(unrelatedCa));
        console.log("pinned-to-issuer", await attempt(issuerCa));
        server.close();
      });
    `,
  });

  await using proc = spawn({
    cmd: [bunExe(), "main.js"],
    env: {
      ...bunEnv,
      // Put the issuing CA into the *default* trust store. A connection that
      // supplies its own `ca` must validate exclusively against that `ca` and
      // must not fall back to the default store.
      NODE_EXTRA_CA_CERTS: join(fixtures, "ca1-cert.pem"),
      TLS_FIXTURES_DIR: fixtures,
    },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Pinning a CA that did not issue the server certificate must reject the
  // connection, even though the actual issuer is present in the default store.
  expect(stdout).toContain("pinned-to-unrelated-ca rejected");
  // Pinning the actual issuer still connects.
  expect(stdout).toContain("pinned-to-issuer connected");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
