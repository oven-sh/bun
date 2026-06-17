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
    // agent8-cert.pem is signed by fake-startcom-root-cert.pem.
    //
    // 1. Connect BEFORE installing the root — must fail. This forces the
    //    HTTPS client's long-lived SSL_CTX (built once on the HTTP thread)
    //    to be created with the bundled store, so step 2 proves that
    //    setDefaultCACertificates() takes effect even for a cached CTX.
    // 2. Install the root and connect again — must succeed.
    // 3. Clear the roots and connect again — must fail.
    const { stdout, stderr, exitCode } = await run(`
      const tls = require("node:tls");
      const https = require("node:https");
      const fs = require("node:fs");
      const assert = require("node:assert");

      const ca = fs.readFileSync(${JSON.stringify(fakeRootCert)}, "utf8");

      const server = https.createServer({
        cert: fs.readFileSync(${JSON.stringify(agent8Cert)}),
        key: fs.readFileSync(${JSON.stringify(agent8Key)}),
      }, (req, res) => {
        res.writeHead(200);
        res.end("hello");
      });

      function request(opts) {
        return new Promise((resolve, reject) => {
          const req = https.request(opts, res => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => resolve({ status: res.statusCode, data }));
          });
          req.on("error", reject);
          req.end();
        });
      }

      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const port = server.address().port;

      // 1. No custom root yet — verification fails.
      try {
        await request({ hostname: "localhost", port, path: "/", method: "GET" });
        throw new Error("step1: connection unexpectedly succeeded without CA");
      } catch (err) {
        assert(err.code && err.code !== "ERR_ASSERTION", "step1: " + err.message);
      }

      // 2. Install the signing root — verification succeeds.
      tls.setDefaultCACertificates([ca]);
      const ok = await request({ hostname: "localhost", port, path: "/", method: "GET" });
      assert.strictEqual(ok.status, 200);
      assert.strictEqual(ok.data, "hello");

      // 3. Clear the roots — verification fails again. New Agent to avoid
      //    any keep-alive/session reuse masking the effect.
      tls.setDefaultCACertificates([]);
      try {
        await request({
          hostname: "localhost",
          port,
          path: "/",
          method: "GET",
          agent: new https.Agent(),
        });
        throw new Error("step3: connection unexpectedly succeeded with empty CA store");
      } catch (err) {
        assert(err.code && err.code !== "ERR_ASSERTION", "step3: " + err.message);
      }

      server.close();
      console.log("ok");
    `);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("addCACert after setDefaultCACertificates clones from the current defaults", async () => {
    // A SecureContext built with { requestCert: true, ca: undefined } holds
    // the process-shared default X509_STORE directly (openssl.c's
    // request_cert branch). setDefaultCACertificates() drops and rebuilds
    // that cached store, so comparing the CTX's store against the *current*
    // shared pointer no longer detects "this is the shared one". addCACert's
    // clone-on-write is driven by the per-CTX user-CA flag instead: on a
    // context that has never had its own CAs it builds a fresh private
    // store from the CURRENT process defaults (here [ca1]) and appends to
    // that, rather than mutating the stale shared store the CTX still holds
    // (which would leak the added CA into every sibling context sharing it
    // and leave the CTX verifying against a bundle that never contained
    // ca1).
    const { stdout, stderr, exitCode } = await run(`
      const tls = require("node:tls");
      const fs = require("node:fs");
      const { once } = require("node:events");
      const assert = require("node:assert");

      const ca1  = fs.readFileSync(${JSON.stringify(path.join(keysDir, "ca1-cert.pem"))}, "utf8");
      const ca2  = fs.readFileSync(${JSON.stringify(path.join(keysDir, "ca2-cert.pem"))}, "utf8");
      const agent1Key  = fs.readFileSync(${JSON.stringify(path.join(keysDir, "agent1-key.pem"))});
      const agent1Cert = fs.readFileSync(${JSON.stringify(path.join(keysDir, "agent1-cert.pem"))});

      // requestCert with no explicit ca -> CTX store is the shared default
      // (the bundled roots at this point).
      const ctx = tls.createSecureContext({ requestCert: true });

      // Invalidate the cached shared store; the current default is now [ca1].
      tls.setDefaultCACertificates([ca1]);

      // Must clone-on-write into a private store seeded from the *current*
      // defaults ([ca1]) and then append ca2 -> [ca1, ca2]. A stale
      // pointer-identity check against the new shared store would miss the
      // clone and append to the old bundled-root store instead (no ca1).
      ctx.context.addCACert(ca2);

      // Connect with this context to a server presenting agent1 (signed by
      // ca1). addCACert marked the CTX with user CAs, so the per-SSL
      // default-store overlay is skipped and verification runs against the
      // CTX's own private store: it must contain ca1.
      const server = tls.createServer({ key: agent1Key, cert: agent1Cert }, s => s.end());
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const port = server.address().port;

      const client = tls.connect({
        port,
        host: "127.0.0.1",
        servername: "agent1",
        secureContext: ctx,
        rejectUnauthorized: false,
      });
      client.on("error", () => {});
      await once(client, "secureConnect");
      const authorized = client.authorized;
      const err = client.authorizationError;
      client.destroy();
      server.close();

      assert.strictEqual(authorized, true,
        "addCACert did not seed the private store from the current defaults: " + err);
      console.log("ok");
    `);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("an mTLS server built before setDefaultCACertificates honours the override", async () => {
    // The server accept path gets the same per-SSL verify-store refresh as
    // the client path: a requestCert server whose SSL_CTX was built before
    // setDefaultCACertificates() (and so still points at the stale shared
    // store) verifies each accepted connection against the CURRENT process
    // defaults, not the bundled roots it was built with.
    const { stdout, stderr, exitCode } = await run(`
      const tls = require("node:tls");
      const fs = require("node:fs");
      const { once } = require("node:events");
      const assert = require("node:assert");

      const ca1  = fs.readFileSync(${JSON.stringify(path.join(keysDir, "ca1-cert.pem"))}, "utf8");
      const agent1Key  = fs.readFileSync(${JSON.stringify(path.join(keysDir, "agent1-key.pem"))});
      const agent1Cert = fs.readFileSync(${JSON.stringify(path.join(keysDir, "agent1-cert.pem"))});

      const authorized = Promise.withResolvers();
      const server = tls.createServer({
        key: agent1Key,
        cert: agent1Cert,
        requestCert: true,
        rejectUnauthorized: false,
      });
      server.on("secureConnection", s => { authorized.resolve(s.authorized); s.end(); });
      server.on("tlsClientError", err => authorized.reject(err));
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const port = server.address().port;

      // Override installed AFTER the server's SSL_CTX was built.
      tls.setDefaultCACertificates([ca1]);

      const client = tls.connect({
        port,
        host: "127.0.0.1",
        key: agent1Key,
        cert: agent1Cert,
        rejectUnauthorized: false,
      });
      client.on("error", () => {});
      const result = await authorized.promise;
      client.destroy();
      server.close();

      assert.strictEqual(result, true,
        "server did not pick up setDefaultCACertificates() for client-cert verification");
      console.log("ok");
    `);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });
});
