// node:tls — tls.setDefaultCACertificates(certs)
// https://github.com/oven-sh/bun/issues/24340
//
// Each scenario runs in a fresh subprocess because the override is
// process-global: once set, the bundled defaults cannot be restored without
// calling the function again, and we don't want one test case's trust store
// bleeding into the next.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";
import tls from "node:tls";

const keysDir = path.join(import.meta.dir, "..", "test", "fixtures", "keys");
const fakeRootCert = path.join(keysDir, "fake-startcom-root-cert.pem");
const agent8Cert = path.join(keysDir, "agent8-cert.pem");
const agent8Key = path.join(keysDir, "agent8-key.pem");

async function run(src: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("tls.setDefaultCACertificates", () => {
  test("is a function", () => {
    expect(typeof tls.setDefaultCACertificates).toBe("function");
  });

  test("rejects non-array input with ERR_INVALID_ARG_TYPE", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const tls = require("node:tls");
      const assert = require("node:assert");
      for (const bad of [null, undefined, "string", 42, {}, true]) {
        assert.throws(() => tls.setDefaultCACertificates(bad), {
          code: "ERR_INVALID_ARG_TYPE",
          message: /"certs".*Array/,
        });
      }
      console.log("ok");
    `);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("rejects invalid array elements with ERR_INVALID_ARG_TYPE", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const tls = require("node:tls");
      const assert = require("node:assert");
      const fs = require("node:fs");
      const cert = fs.readFileSync(${JSON.stringify(fakeRootCert)}, "utf8");
      for (const bad of [null, undefined, 42, {}, true]) {
        assert.throws(() => tls.setDefaultCACertificates([bad]), {
          code: "ERR_INVALID_ARG_TYPE",
          message: /"certs\\[0\\]".*string.*ArrayBufferView/,
        });
        assert.throws(() => tls.setDefaultCACertificates([cert, bad]), {
          code: "ERR_INVALID_ARG_TYPE",
          message: /"certs\\[1\\]".*string.*ArrayBufferView/,
        });
      }
      console.log("ok");
    `);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("replaces the default CA set and getCACertificates('default') reflects it", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const tls = require("node:tls");
      const fs = require("node:fs");
      const assert = require("node:assert");
      const { X509Certificate } = require("node:crypto");
      const pem = fs.readFileSync(${JSON.stringify(fakeRootCert)}, "utf8");

      const bundledBefore = tls.getCACertificates("bundled");

      tls.setDefaultCACertificates([pem]);

      const defaults = tls.getCACertificates("default");
      assert.strictEqual(defaults.length, 1);
      // Compare by identity (serial/issuer/subject) rather than raw PEM text;
      // OpenSSL may normalise line endings or trailing whitespace on round-trip.
      const a = new X509Certificate(defaults[0]);
      const b = new X509Certificate(pem);
      assert.strictEqual(a.serialNumber, b.serialNumber);
      assert.strictEqual(a.issuer, b.issuer);
      assert.strictEqual(a.subject, b.subject);

      // Implicit default matches too.
      assert.strictEqual(tls.getCACertificates().length, 1);

      // 'bundled' must be untouched — it's the compiled-in Mozilla set.
      const bundledAfter = tls.getCACertificates("bundled");
      assert.strictEqual(bundledAfter.length, bundledBefore.length);

      console.log("ok");
    `);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("accepts an empty array", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const tls = require("node:tls");
      const assert = require("node:assert");
      tls.setDefaultCACertificates([]);
      const defaults = tls.getCACertificates("default");
      assert(Array.isArray(defaults));
      assert.strictEqual(defaults.length, 0);
      console.log("ok");
    `);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("deduplicates repeated certificates", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const tls = require("node:tls");
      const fs = require("node:fs");
      const assert = require("node:assert");
      const pem = fs.readFileSync(${JSON.stringify(fakeRootCert)}, "utf8");
      tls.setDefaultCACertificates([pem, pem, pem]);
      assert.strictEqual(tls.getCACertificates("default").length, 1);
      console.log("ok");
    `);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("accepts Buffer, Uint8Array and DataView entries", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const tls = require("node:tls");
      const fs = require("node:fs");
      const assert = require("node:assert");
      const pem = fs.readFileSync(${JSON.stringify(fakeRootCert)}, "utf8");

      tls.setDefaultCACertificates([Buffer.from(pem)]);
      assert.strictEqual(tls.getCACertificates("default").length, 1);

      tls.setDefaultCACertificates([]);
      assert.strictEqual(tls.getCACertificates("default").length, 0);

      const u8 = new TextEncoder().encode(pem);
      tls.setDefaultCACertificates([u8]);
      assert.strictEqual(tls.getCACertificates("default").length, 1);

      tls.setDefaultCACertificates([]);
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      tls.setDefaultCACertificates([dv]);
      assert.strictEqual(tls.getCACertificates("default").length, 1);

      console.log("ok");
    `);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("throws on unparseable PEM and leaves defaults unchanged", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const tls = require("node:tls");
      const assert = require("node:assert");
      const before = tls.getCACertificates("default");
      assert.throws(() => tls.setDefaultCACertificates(["not a certificate"]), {
        code: "ERR_CRYPTO_OPERATION_FAILED",
      });
      const after = tls.getCACertificates("default");
      // The JS-side cache is only invalidated after the native store swap
      // succeeds, so 'after' must be the same frozen array instance.
      assert.strictEqual(after, before);
      console.log("ok");
    `);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("override set on the main thread is visible from a Worker", async () => {
    // The override is process-global in Bun (Node.js scopes it per-thread).
    // getCACertificates('default') must agree with what the TLS layer will
    // actually verify against, so a Worker that never called the setter
    // must still report the main thread's override — not the bundled set.
    const { stdout, stderr, exitCode } = await run(`
      const tls = require("node:tls");
      const fs = require("node:fs");
      const { Worker } = require("node:worker_threads");
      const pem = fs.readFileSync(${JSON.stringify(fakeRootCert)}, "utf8");
      tls.setDefaultCACertificates([pem]);
      const w = new Worker(
        'const tls = require("node:tls");' +
        'const { parentPort } = require("node:worker_threads");' +
        'parentPort.postMessage(tls.getCACertificates("default").length);',
        { eval: true },
      );
      w.on("message", n => {
        console.log("worker-default-count:" + n);
        w.terminate();
      });
      w.on("error", e => { console.log("worker-error:" + e.message); });
    `);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("worker-default-count:1");
    expect(exitCode).toBe(0);
  });

  test("overrides the trust store used for new TLS connections", async () => {
    // agent8-cert.pem is signed by fake-startcom-root-cert.pem. A client that
    // trusts only fake-startcom-root should verify the server; after swapping
    // to an empty trust set the next connection must fail verification.
    const { stdout, stderr, exitCode } = await run(`
      const tls = require("node:tls");
      const https = require("node:https");
      const fs = require("node:fs");
      const assert = require("node:assert");

      const server = https.createServer({
        cert: fs.readFileSync(${JSON.stringify(agent8Cert)}),
        key: fs.readFileSync(${JSON.stringify(agent8Key)}),
      }, (req, res) => {
        res.writeHead(200);
        res.end("hello");
      });

      server.listen(0, () => {
        const port = server.address().port;

        tls.setDefaultCACertificates([fs.readFileSync(${JSON.stringify(fakeRootCert)}, "utf8")]);

        const req1 = https.request({ hostname: "localhost", port, path: "/", method: "GET" }, res => {
          assert.strictEqual(res.statusCode, 200);
          let data = "";
          res.on("data", c => data += c);
          res.on("end", () => {
            assert.strictEqual(data, "hello");

            // Now drop all trust roots — the next connection must fail.
            tls.setDefaultCACertificates([]);
            const req2 = https.request({ hostname: "127.0.0.1", port, path: "/", method: "GET" }, () => {
              console.log("unexpected-success");
              server.close();
            });
            req2.on("error", err => {
              // Exact code varies between runtimes; what matters is that
              // verification fails now that the trust store is empty.
              assert(err, "expected verification error after clearing CA store");
              console.log("ok");
              server.close();
            });
            req2.end();
          });
        });
        req1.on("error", err => {
          console.log("req1-error:" + (err.code || err.message));
          server.close();
        });
        req1.end();
      });
    `);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });
});
