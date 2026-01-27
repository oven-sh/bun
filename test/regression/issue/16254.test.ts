// https://github.com/oven-sh/bun/issues/16254
// req.socket.authorized should be a boolean indicating client certificate verification status

import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import * as https from "https";
import type { AddressInfo } from "net";
import { join } from "path";

const fixturesDir = join(import.meta.dir, "../../js/node/tls/fixtures");

// ca1 is a self-signed CA certificate
const ca1Cert = readFileSync(join(fixturesDir, "ca1-cert.pem"));
// agent1 is signed by ca1
const agent1Key = readFileSync(join(fixturesDir, "agent1-key.pem"));
const agent1Cert = readFileSync(join(fixturesDir, "agent1-cert.pem"));

test("req.socket.authorized should be true when client certificate is valid (mTLS)", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<{ authorized: boolean | undefined; response: string }>();

  const server = https.createServer(
    {
      key: agent1Key,
      cert: agent1Cert,
      ca: ca1Cert,
      requestCert: true,
      rejectUnauthorized: true,
    },
    (req, res) => {
      const authorized = req.socket.authorized;
      res.writeHead(200);
      res.end(authorized ? "Authorized" : "Not authorized");
      resolve({ authorized, response: authorized ? "Authorized" : "Not authorized" });
    },
  );

  server.on("error", reject);

  await new Promise<void>(res => server.listen(0, res));

  try {
    const port = (server.address() as AddressInfo).port;

    const req = https.request(
      {
        hostname: "localhost",
        port,
        method: "GET",
        path: "/",
        key: agent1Key,
        cert: agent1Cert,
        ca: ca1Cert,
        rejectUnauthorized: false, // Don't reject self-signed server cert
      },
      res => {
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
          // Response handled via promise above
        });
      },
    );

    req.on("error", reject);
    req.end();

    const result = await promise;

    // The main assertion: authorized should be a boolean true, not undefined
    expect(typeof result.authorized).toBe("boolean");
    expect(result.authorized).toBe(true);
    expect(result.response).toBe("Authorized");
  } finally {
    server.close();
  }
});

test("req.socket.authorized should be defined even when requestCert is false", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<boolean | undefined>();

  const server = https.createServer(
    {
      key: agent1Key,
      cert: agent1Cert,
      requestCert: false,
      rejectUnauthorized: false,
    },
    (req, res) => {
      resolve(req.socket.authorized);
      res.writeHead(200);
      res.end("OK");
    },
  );

  server.on("error", reject);

  await new Promise<void>(res => server.listen(0, res));

  try {
    const port = (server.address() as AddressInfo).port;

    const req = https.request(
      {
        hostname: "localhost",
        port,
        method: "GET",
        path: "/",
        rejectUnauthorized: false,
      },
      () => {},
    );

    req.on("error", reject);
    req.end();

    const authorized = await promise;

    // authorized should be a boolean (false when no client cert requested)
    expect(typeof authorized).toBe("boolean");
    expect(authorized).toBe(false);
  } finally {
    server.close();
  }
});
