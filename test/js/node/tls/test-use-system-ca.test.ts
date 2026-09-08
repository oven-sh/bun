import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, tls } from "harness";
import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { rootCertificates } from "node:tls";

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
  // on Linux, where the system store reads every regular file in SSL_CERT_DIR; the default store's
  // hashed-directory lookup skips a file not named <hash>.<n>, so only the system store has the CA.
  test.skipIf(!isLinux)(
    "a Worker's --use-system-ca / --no-use-system-ca governs the roots its own connections trust",
    async () => {
      using systemDir = tempDir("use-system-ca-dir", {
        "ca1.pem": readFileSync(join(keysDir, "ca1-cert.pem"), "utf8"),
      });
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
          SSL_CERT_FILE: "",
          SSL_CERT_DIR: String(systemDir),
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

  // The system store joins the default store only when asked, and --use-openssl-ca ignores it (node's
  // NewRootCertStore). A CA that only the system store can see: on Linux that loader reads every
  // regular file in SSL_CERT_DIR, while the default store's hashed-directory lookup (OpenSSL's default
  // paths, trusted in every mode but --use-openssl-ca's own) only opens <hash>.<n> names. On macOS /
  // Windows the system store is the OS one, so the file stays untrusted there under --use-system-ca.
  test.each([
    [[], "rejected:DEPTH_ZERO_SELF_SIGNED_CERT"],
    [["--no-use-system-ca"], "rejected:DEPTH_ZERO_SELF_SIGNED_CERT"],
    [["--use-openssl-ca"], "rejected:DEPTH_ZERO_SELF_SIGNED_CERT"],
    [["--use-system-ca"], isLinux ? "trusted" : "rejected:DEPTH_ZERO_SELF_SIGNED_CERT"],
  ])("a CA only the system store sees, with flags %j -> %s", async (flags, expected) => {
    using dir = tempDir("use-system-ca-only", {
      "cert.pem": tls.cert,
      "key.pem": tls.key,
      system: { "cert.pem": tls.cert },
    });
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
        SSL_CERT_FILE: "",
        SSL_CERT_DIR: join(String(dir), "system"),
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

  // getCACertificates('default') describes the store above, so it follows the same rules
  // (node's lib/tls.js cacheDefaultCACertificates): bundled by default, bundled plus system under
  // --use-system-ca, and nothing from either set under --use-openssl-ca, whose roots are not
  // enumerable. Counts are relative to 'bundled' so the host's own stores do not matter.
  test.each([
    [[], "bundled"],
    [["--no-use-system-ca"], "bundled"],
    [["--use-openssl-ca"], "none"],
    [["--use-system-ca"], "bundled+system"],
  ])("getCACertificates('default') with flags %j reports %s", async (flags, expected) => {
    using dir = tempDir("ca-report", { system: { "cert.pem": tls.cert } });
    await using proc = spawn({
      cmd: [
        bunExe(),
        ...flags,
        "-e",
        `
        const tls = require("tls");
        console.log(JSON.stringify({
          def: tls.getCACertificates("default").length,
          bundled: tls.getCACertificates("bundled").length,
          system: tls.getCACertificates("system").length,
        }));
        `,
      ],
      cwd: String(dir),
      env: {
        ...bunEnv,
        SSL_CERT_FILE: "",
        SSL_CERT_DIR: join(String(dir), "system"),
        NODE_USE_SYSTEM_CA: undefined,
        NODE_EXTRA_CA_CERTS: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { def, bundled, system } = JSON.parse(stdout);
    expect(bundled).toBeGreaterThan(0);
    expect(def).toBe({ none: 0, bundled, "bundled+system": bundled + system }[expected]);
    expect(exitCode).toBe(0);
  });

  // Clients that fall back to the thread's default client context (WebSocket has no per-connection
  // CA option) must follow the worker's --use-system-ca exactly like tls.connect and fetch do.
  // The harness cert (self-signed, 127.0.0.1 SAN) stands in as a system-only root: a non-hash file
  // name in SSL_CERT_DIR, which only the Linux system loader reads.
  test.skipIf(!isLinux)(
    "a Worker's --use-system-ca (flag, or its own env when flagless) governs its WebSocket connections too",
    async () => {
      using dir = tempDir("use-system-ca-ws", {
        "cert.pem": tls.cert,
        "key.pem": tls.key,
        system: { "cert.pem": tls.cert },
      });
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
          SSL_CERT_FILE: "",
          SSL_CERT_DIR: join(String(dir), "system"),
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
    },
  );

  // node_worker.cc: a nested Worker starts from its parent's resolved option, a custom env re-derives
  // it, and only flags (its own execArgv, or the parent's when it has none) carry over as flags — a
  // parent's env-derived decision is not inherited past a child's own env.
  test("nested Workers inherit CA flags but not env-derived decisions", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("worker_threads");
        const tls = require("tls");
        // Reports whether the thread's default store includes the system roots.
        const leaf = 'const tls = require("tls"); require("worker_threads").parentPort.postMessage(tls.getCACertificates("default").length > tls.getCACertificates("bundled").length);';
        // Spawns \`leaf\` with the given options and relays its answer.
        const middle = \`
          const { Worker, parentPort, workerData } = require("worker_threads");
          const w = new Worker(workerData.leaf, { eval: true, ...workerData.leafOptions });
          w.once("message", m => parentPort.postMessage(m));
        \`;
        const ask = (middleOptions, leafOptions) => new Promise((resolve, reject) => {
          const w = new Worker(middle, { eval: true, ...middleOptions, workerData: { leaf, leafOptions } });
          w.once("message", resolve);
          w.once("error", reject);
        });
        (async () => {
          if (tls.getCACertificates("system").length === 0) return console.log(JSON.stringify({ skipped: "no system certificates" }));
          const out = {
            envDecisionNotInheritedPastOwnEnv: await ask({ env: { ...process.env, NODE_USE_SYSTEM_CA: "1" } }, { env: {} }),
            ownEnvWinsOverParentDecision: await ask({}, { env: { NODE_USE_SYSTEM_CA: "1" } }),
            parentFlagInherited: await ask({ execArgv: ["--use-system-ca"] }, {}),
            parentFlagBeatsOwnEnv: await ask({ execArgv: ["--use-system-ca"] }, { env: {} }),
            ownExecArgvDropsParentFlag: await ask({ execArgv: ["--use-system-ca"] }, { execArgv: [], env: {} }),
          };
          console.log(JSON.stringify(out));
        })();
        `,
      ],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: undefined, NODE_EXTRA_CA_CERTS: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const out = JSON.parse(stdout.trim());
    if (out.skipped) return; // node's own tests skip here too
    expect({ out, stderr }).toEqual({
      out: {
        envDecisionNotInheritedPastOwnEnv: false,
        ownEnvWinsOverParentDecision: true,
        parentFlagInherited: true,
        parentFlagBeatsOwnEnv: true,
        ownExecArgvDropsParentFlag: false,
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

// On Linux the loader reads a superset of what Node's --use-system-ca reads ($SSL_CERT_FILE else /etc/ssl/cert.pem, and
// every regular file in $SSL_CERT_DIR else /etc/ssl/certs) plus the well-known distro bundle/dir paths, and reports
// each certificate once however many of those alias it.
describe.skipIf(!isLinux)("tls.getCACertificates('system')", () => {
  const fixtureCert = (name: string) =>
    readFileSync(join(import.meta.dir, "../test/fixtures/keys", `${name}-cert.pem`), "utf8");
  const fingerprint = (pem: string) => new X509Certificate(pem).fingerprint256;

  async function systemFingerprints(env: Record<string, string | undefined>, stdin?: Blob): Promise<string[]> {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { X509Certificate } = require("crypto");
         const certs = require("tls").getCACertificates("system");
         console.log(JSON.stringify(certs.map(pem => new X509Certificate(pem).fingerprint256)));`,
      ],
      env: { ...bunEnv, SSL_CERT_FILE: undefined, SSL_CERT_DIR: undefined, ...env },
      stdin,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const fingerprints = JSON.parse(stdout);
    expect(exitCode).toBe(0);
    return fingerprints;
  }

  test("reports each system root once", async () => {
    const hasDefaultStore = existsSync("/etc/ssl/cert.pem") || existsSync("/etc/ssl/certs");
    const fingerprints = await systemFingerprints({});
    if (hasDefaultStore) expect(fingerprints.length).toBeGreaterThan(0);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  test("reads SSL_CERT_FILE and every regular file in SSL_CERT_DIR, each certificate once", async () => {
    const [ca1, ca2, ca3, ca4, ca5, ca6, leaf1, leaf2, leaf3] = [
      "ca1",
      "ca2",
      "ca3",
      "ca4",
      "ca5",
      "ca6",
      "agent1",
      "agent2",
      "agent3",
    ].map(fixtureCert);
    // An encrypted key block carries header lines. PEM_read_bio_X509 decodes it, then skips it by name.
    const encryptedKey =
      "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00112233445566778899AABBCCDDEEFF\n\nQUJDREVGR0hJSktMTU5PUA==\n-----END RSA PRIVATE KEY-----\n";
    const badBlock = "-----BEGIN PRIVATE KEY-----\n!!! not base64 !!!\n-----END PRIVATE KEY-----\n";
    using dir = tempDir("system-ca", {
      "bundle.pem": ca1 + ca2,
      certs: {
        "a-again.pem": ca1, // already in the bundle
        "bad-block.pem": badBlock + leaf2, // a block that does not decode ends the file, whatever its name
        "c.pem": ca3,
        "encrypted-key.pem": encryptedKey + leaf3, // a block with another name is skipped, headers and all
        "multi.crt": ca5 + ca6, // every certificate in a file, not only the first
        "noext": ca4, // names are not filtered
        "README": "not a certificate\n",
        sub: { "d.pem": leaf1 }, // subdirectories are not entered
      },
    });
    // A second name for the same file.
    symlinkSync("c.pem", join(String(dir), "certs", "c-alias.pem"));

    const fingerprints = await systemFingerprints({
      SSL_CERT_FILE: join(String(dir), "bundle.pem"),
      SSL_CERT_DIR: join(String(dir), "certs"),
    });
    // The file first, then the directory in name order: a-again.pem (dropped), bad-block.pem (nothing),
    // c-alias.pem, c.pem (same file, skipped), encrypted-key.pem, multi.crt, noext.
    expect(fingerprints).toEqual([ca1, ca2, ca3, leaf3, ca5, ca6, ca4].map(fingerprint));

    // A variable that is set but empty turns that source off.
    expect(await systemFingerprints({ SSL_CERT_FILE: join(String(dir), "bundle.pem"), SSL_CERT_DIR: "" })).toEqual(
      [ca1, ca2].map(fingerprint),
    );
  });

  test("SSL_CERT_FILE can be a pipe", async () => {
    const ca1 = fixtureCert("ca1");
    const fingerprints = await systemFingerprints({ SSL_CERT_FILE: "/dev/stdin", SSL_CERT_DIR: "" }, new Blob([ca1]));
    expect(fingerprints).toEqual([fingerprint(ca1)]);
  });

  test.skipIf(!existsSync("/etc/ssl/certs"))("SSL_CERT_FILE alone keeps the default directory", async () => {
    using dir = tempDir("system-ca-file", { "bundle.pem": fixtureCert("ca1") });
    const bundle = join(String(dir), "bundle.pem");
    const withDefaultDir = await systemFingerprints({ SSL_CERT_FILE: bundle });
    const withExplicitDir = await systemFingerprints({ SSL_CERT_FILE: bundle, SSL_CERT_DIR: "/etc/ssl/certs" });
    expect(withDefaultDir[0]).toBe(fingerprint(fixtureCert("ca1")));
    // The default also walks the well-known distro directories, so it is a superset (in order) of the explicit one.
    let j = 0;
    for (const fp of withDefaultDir) if (fp === withExplicitDir[j]) j++;
    expect(j).toBe(withExplicitDir.length);
  });
});

// The default store also trusts what X509_STORE_set_default_paths would: $SSL_CERT_FILE (else /etc/ssl/cert.pem) and
// the $SSL_CERT_DIR (else /etc/ssl/certs) hash directory. The file is read lazily and deduplicated against the bundled
// roots, so these pin that the same certificates are still trusted.
describe.skipIf(isWindows)("default store and OpenSSL's default paths", () => {
  const keys = join(import.meta.dir, "../test/fixtures/keys");
  const ca1 = readFileSync(join(keys, "ca1-cert.pem"), "utf8");

  async function connectWith(env: Record<string, string | undefined>) {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const tls = require("tls"), fs = require("fs");
         const server = tls.createServer({ key: fs.readFileSync(${JSON.stringify(join(keys, "agent1-key.pem"))}), cert: fs.readFileSync(${JSON.stringify(join(keys, "agent1-cert.pem"))}) }, s => s.end());
         server.listen(0, () => {
           const socket = tls.connect({ port: server.address().port, host: "127.0.0.1", checkServerIdentity: () => undefined }, () => {
             console.log("authorized");
             socket.destroy();
             server.close();
           });
           socket.on("error", e => { console.log(e.code); server.close(); });
         });`,
      ],
      env: { ...bunEnv, SSL_CERT_FILE: "", SSL_CERT_DIR: "", NODE_USE_SYSTEM_CA: undefined, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return stdout.trim();
  }

  test("a private CA is not trusted without them", async () => {
    expect(await connectWith({})).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  });

  // only: the CA alone. mixed: after and before bundled roots, which the loader skips as already trusted.
  // bad: X509_load_cert_crl_file rejects the whole file when any block is bad, so nothing in it is trusted.
  test.each([
    ["only", "authorized"],
    ["mixed", "authorized"],
    ["bad", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
  ] as const)("a CA in $SSL_CERT_FILE (%s.pem) -> %s", async (file, expected) => {
    using dir = tempDir("default-ca-file", {
      "only.pem": ca1,
      "mixed.pem": rootCertificates.slice(0, 3).join("\n") + "\n" + ca1 + rootCertificates[3] + "\n",
      "bad.pem": ca1 + "-----BEGIN CERTIFICATE-----\n!!!!\n-----END CERTIFICATE-----\n",
    });
    expect(await connectWith({ SSL_CERT_FILE: join(String(dir), `${file}.pem`) })).toBe(expected);
  });

  // `openssl x509 -subject_hash -in ca1-cert.pem` is 468820ba; the hash-dir lookup only opens <hash>.<n> names.
  test.each([
    ["468820ba.0", "authorized"],
    ["ca1.pem", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
  ] as const)("a CA in the $SSL_CERT_DIR hash directory as %s -> %s", async (name, expected) => {
    using dir = tempDir("default-ca-dir", { [name]: ca1 });
    expect(await connectWith({ SSL_CERT_DIR: String(dir) })).toBe(expected);
  });
});
