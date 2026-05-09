// Regression tests for node-compat group u9sf0l.
//
// The core bug was an ASAN use-after-poison in
// src/http/HTTPContext.zig onHandshake: when the native
// checkServerIdentity() rejected the peer certificate, it called
// closeAndFail() → fail() → result callback, which destroyed the
// AsyncHTTP (and its embedded HTTPClient). onHandshake then wrote to
// client.flags.did_have_handshaking_error on freed memory.
//
// Triggering the bug requires `rejectUnauthorized: true`, a trusted
// CA, and a hostname that does NOT match the certificate's identity.
// Previously any CN-only cert (no SAN) would hit this, because the
// native checkX509ServerIdentity never fell back to the Subject CN.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const keys = join(import.meta.dir, "..", "test", "fixtures", "keys");
const agent1 = {
  key: readFileSync(join(keys, "agent1-key.pem"), "utf8"), // CN=agent1, no SAN, signed by ca1
  cert: readFileSync(join(keys, "agent1-cert.pem"), "utf8"),
  ca: readFileSync(join(keys, "ca1-cert.pem"), "utf8"),
};

describe("https.request checkServerIdentity", () => {
  // Direct repro of the ASAN crash: trusted CA + servername that does not
  // match the cert. Before the fix this hit use-after-poison in
  // HTTPContext.onHandshake on ASAN builds instead of emitting 'error'.
  test("hostname mismatch emits error without crashing", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const https = require("https");
          const server = https.createServer({
            key: ${JSON.stringify(agent1.key)},
            cert: ${JSON.stringify(agent1.cert)},
          }, (req, res) => { res.writeHead(200); res.end("ok"); });
          server.listen(0, () => {
            const req = https.request({
              port: server.address().port,
              rejectUnauthorized: true,
              ca: ${JSON.stringify(agent1.ca)},
              servername: "not-agent1",
            }, () => {
              console.log("UNEXPECTED_RESPONSE");
              server.close();
            });
            req.on("error", err => {
              console.log("ERROR_CODE=" + err.code);
              server.close();
            });
            req.end();
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ERROR_CODE=ERR_TLS_CERT_ALTNAME_INVALID");
    expect(exitCode).toBe(0);
  });

  // Node's tls.checkServerIdentity falls back to the Subject CN when the
  // certificate carries no DNS/IP/URI SANs. agent1's cert is CN=agent1 with
  // no SAN. With `servername: "agent1"` the request must succeed.
  test("falls back to Subject CN when no SAN is present", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const https = require("https");
          const server = https.createServer({
            key: ${JSON.stringify(agent1.key)},
            cert: ${JSON.stringify(agent1.cert)},
          }, (req, res) => { res.writeHead(200); res.end("ok"); });
          server.listen(0, () => {
            const req = https.request({
              port: server.address().port,
              rejectUnauthorized: true,
              ca: ${JSON.stringify(agent1.ca)},
              servername: "agent1",
            }, res => {
              let body = "";
              res.on("data", d => body += d);
              res.on("end", () => {
                console.log("BODY=" + body);
                server.close();
              });
            });
            req.on("error", err => {
              console.log("UNEXPECTED_ERROR=" + (err.code || err.message));
              server.close();
            });
            req.end();
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("BODY=ok");
    expect(exitCode).toBe(0);
  });

  // A user-supplied `checkServerIdentity` must override the native check.
  // agent1's CN is "agent1" so the native check for hostname "localhost"
  // would fail; the custom callback makes the request succeed and must
  // actually be invoked.
  test("custom checkServerIdentity overrides the native check", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const https = require("https");
          const server = https.createServer({
            key: ${JSON.stringify(agent1.key)},
            cert: ${JSON.stringify(agent1.cert)},
          }, (req, res) => { res.writeHead(200); res.end("ok"); });
          server.listen(0, () => {
            let called = false;
            const req = https.request({
              port: server.address().port,
              rejectUnauthorized: true,
              ca: ${JSON.stringify(agent1.ca)},
              checkServerIdentity: (host, cert) => {
                called = true;
                return undefined;
              },
            }, res => {
              let body = "";
              res.on("data", d => body += d);
              res.on("end", () => {
                console.log("CALLED=" + called + " BODY=" + body);
                server.close();
              });
            });
            req.on("error", err => {
              console.log("UNEXPECTED_ERROR=" + (err.code || err.message));
              server.close();
            });
            req.end();
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("CALLED=true BODY=ok");
    expect(exitCode).toBe(0);
  });

  // Node.js only requests a client certificate when `requestCert: true`.
  // Passing `ca` alone must not make the server reject clients that don't
  // present one.
  test("https.Server with ca but no requestCert accepts clients without a cert", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const https = require("https");
          const server = https.createServer({
            key: ${JSON.stringify(agent1.key)},
            cert: ${JSON.stringify(agent1.cert)},
            ca: ${JSON.stringify(agent1.ca)},
          }, (req, res) => { res.writeHead(200); res.end("ok"); });
          server.listen(0, () => {
            const req = https.request({
              port: server.address().port,
              rejectUnauthorized: true,
              ca: ${JSON.stringify(agent1.ca)},
              servername: "agent1",
            }, res => {
              let body = "";
              res.on("data", d => body += d);
              res.on("end", () => {
                console.log("BODY=" + body);
                server.close();
              });
            });
            req.on("error", err => {
              console.log("UNEXPECTED_ERROR=" + (err.code || err.message));
              server.close();
            });
            req.end();
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("BODY=ok");
    expect(exitCode).toBe(0);
  });
});
