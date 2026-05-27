// Regression test for https://github.com/oven-sh/bun/issues/31471
//
// `https.request` / `http.request` threw `Error: pfx is not supported`
// whenever the request options contained a truthy `pfx` value — including an
// empty array `pfx: []`. An empty array carries no certificate data and is a
// no-op in Node, so it must not throw.
//
// Playwright's `APIRequestContext` (request.newContext({ clientCertificates }))
// unconditionally adds `pfx: []` to the request options whenever client
// certificates are configured, even when the user only supplies `cert`/`key`.
// Bun's truthy guard then rejected the request with `pfx is not supported`,
// breaking mutual-TLS requests through Playwright.
//
// PKCS#12 is not yet supported by Bun's TLS pipeline, so a `pfx` that actually
// carries data should still be rejected — only the empty case must pass.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const keys = join(import.meta.dir, "..", "test", "fixtures", "keys");
const agent1 = {
  key: readFileSync(join(keys, "agent1-key.pem"), "utf8"),
  cert: readFileSync(join(keys, "agent1-cert.pem"), "utf8"),
  ca: readFileSync(join(keys, "ca1-cert.pem"), "utf8"),
};

describe.concurrent("https.request pfx option", () => {
  // Mirrors what Playwright sends: an empty `pfx: []` alongside `cert`/`key`.
  // Before the fix the empty array tripped the `pfx is not supported` guard and
  // the request never started; after, the request proceeds to completion.
  test("empty pfx array does not throw and completes the request", async () => {
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
          }, (req, res) => {
            res.writeHead(200);
            res.end("hello");
          });
          server.listen(0, () => {
            const req = https.request({
              port: server.address().port,
              host: "localhost",
              method: "GET",
              rejectUnauthorized: false,
              servername: "agent1",
              ca: ${JSON.stringify(agent1.ca)},
              // What Playwright always sets when clientCertificates are present:
              pfx: [],
              key: ${JSON.stringify(agent1.key)},
              cert: ${JSON.stringify(agent1.cert)},
            }, res => {
              let body = "";
              res.setEncoding("utf8");
              res.on("data", d => (body += d));
              res.on("end", () => {
                console.log("STATUS=" + res.statusCode);
                console.log("BODY=" + body);
                server.close();
              });
            });
            req.on("error", err => {
              console.log("ERROR=" + err.message);
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
    expect(stdout).toContain("STATUS=200");
    expect(stdout).toContain("BODY=hello");
    expect(exitCode).toBe(0);
  });

  // A `pfx` that actually carries data is still unsupported — it must throw
  // rather than silently dropping the credentials.
  test("non-empty pfx still throws pfx is not supported", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const https = require("https");
          try {
            https.request({ host: "localhost", port: 443, pfx: Buffer.from("x") });
            console.log("NO_THROW");
          } catch (err) {
            console.log("THREW=" + err.message);
          }
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("THREW=pfx is not supported");
    expect(exitCode).toBe(0);
  });
});
