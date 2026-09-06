// https.request() checks the peer certificate against the hostname the way
// tls.checkServerIdentity() does in Node. agent1's certificate is CN=agent1
// with no subjectAltName, signed by ca1. Every request below trusts ca1, so
// the identity check alone decides whether the request succeeds.
//
// The mismatch case runs in a child process on purpose. The child makes one
// rejected request, closes the server as soon as the request emits "error",
// and exits. The test requires an empty stderr and exit code 0. On the ASAN
// lane the child also runs with leak detection. A crash or a leak on the
// reject path fails this one test instead of the test runner. This child is
// how the close_notify leak fixed in #30368 was found, and that fix has no
// other test. The other cases only check behavior and run in this process.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import https, { type RequestOptions, type Server, type ServerOptions } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

const keys = join(import.meta.dir, "..", "test", "fixtures", "keys");
const agent1 = {
  key: readFileSync(join(keys, "agent1-key.pem"), "utf8"), // CN=agent1, no SAN, signed by ca1
  cert: readFileSync(join(keys, "agent1-cert.pem"), "utf8"),
  ca: readFileSync(join(keys, "ca1-cert.pem"), "utf8"),
};

async function listen(options: ServerOptions): Promise<Server> {
  const server = https.createServer(options, (_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });
  await once(server.listen(0), "listening");
  return server;
}

async function request(options: RequestOptions): Promise<{ statusCode: number | undefined; body: string }> {
  const req = https.request(options);
  req.end();
  const [res] = await once(req, "response");
  res.setEncoding("utf8");
  let body = "";
  res.on("data", (chunk: string) => (body += chunk));
  await once(res, "end");
  return { statusCode: res.statusCode, body };
}

describe.concurrent("https.request checkServerIdentity", () => {
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
            }, res => {
              console.log(JSON.stringify({ unexpectedResponse: res.statusCode }));
              res.resume();
              server.close();
            });
            req.on("error", err => {
              console.log(JSON.stringify({
                code: err.code,
                reason: err.reason,
                host: err.host,
                certCN: err.cert?.subject?.CN,
                message: err.message,
              }));
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
    expect(JSON.parse(stdout)).toEqual({
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
      reason: "Host: not-agent1. is not cert's CN: agent1",
      host: "not-agent1",
      certCN: "agent1",
      message: "Hostname/IP does not match certificate's altnames: Host: not-agent1. is not cert's CN: agent1",
    });
    expect(exitCode).toBe(0);
  });

  test("falls back to Subject CN when no SAN is present", async () => {
    await using server = await listen({ key: agent1.key, cert: agent1.cert });
    const { port } = server.address() as AddressInfo;
    expect(await request({ port, rejectUnauthorized: true, ca: agent1.ca, servername: "agent1" })).toEqual({
      statusCode: 200,
      body: "ok",
    });
  });

  // https.request() defaults the host to "localhost", which does not match
  // CN=agent1, so only the custom callback can let this request through.
  test("custom checkServerIdentity overrides the native check", async () => {
    await using server = await listen({ key: agent1.key, cert: agent1.cert });
    const { port } = server.address() as AddressInfo;
    const calls: { hostname: string; subjectCN: string; issuerCN: string }[] = [];
    const response = await request({
      port,
      rejectUnauthorized: true,
      ca: agent1.ca,
      checkServerIdentity(hostname, cert) {
        calls.push({ hostname, subjectCN: cert.subject.CN, issuerCN: cert.issuer.CN });
        return undefined;
      },
    });
    expect(response).toEqual({ statusCode: 200, body: "ok" });
    expect(calls).toEqual([{ hostname: "localhost", subjectCN: "agent1", issuerCN: "ca1" }]);
  });

  // Node only asks the client for a certificate when requestCert is set.
  // A server `ca` on its own must not reject a client without one.
  test("https.Server with ca but no requestCert accepts clients without a cert", async () => {
    await using server = await listen({ key: agent1.key, cert: agent1.cert, ca: agent1.ca });
    const { port } = server.address() as AddressInfo;
    expect(await request({ port, rejectUnauthorized: true, ca: agent1.ca, servername: "agent1" })).toEqual({
      statusCode: 200,
      body: "ok",
    });
  });
});
