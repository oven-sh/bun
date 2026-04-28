// Triggers the checkServerIdentity()==false path in HTTPContext.onHandshake:
// the CA chain verifies, but the server cert's identity doesn't match the
// request hostname, so the native fast path calls closeAndFail() and returns
// false. Before the fix, the caller then wrote to client.flags on an
// HTTPClient that closeAndFail → fail → result callback had already freed,
// tripping ASAN use-after-poison on the HTTP thread.
//
// Several requests are issued so the process outlives the first failure and
// ASAN has time to abort before the main thread exits.

import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const keysDir = path.join(import.meta.dir, "..", "test", "fixtures", "keys");
// agent1-cert is CN=agent1 (signed by ca1), so connecting as "localhost" with
// ca1 trusted passes chain verification but fails hostname matching.
const serverKey = fs.readFileSync(path.join(keysDir, "agent1-key.pem"));
const serverCert = fs.readFileSync(path.join(keysDir, "agent1-cert.pem"));
const ca = fs.readFileSync(path.join(keysDir, "ca1-cert.pem"));

const N = 8;
let remaining = N;
let failed = false;

const server = https
  .createServer({ key: serverKey, cert: serverCert }, (req, res) => {
    // Should never be reached: the client rejects during handshake.
    failed = true;
    res.writeHead(200);
    res.end();
  })
  .listen(0, () => {
    const port = (server.address() as import("node:net").AddressInfo).port;
    for (let i = 0; i < N; i++) {
      const req = https.request(
        { host: "localhost", port, rejectUnauthorized: true, ca, agent: false },
        () => {
          console.error("unexpected response");
          failed = true;
          done();
        },
      );
      req.on("error", err => {
        if ((err as NodeJS.ErrnoException).code !== "ERR_TLS_CERT_ALTNAME_INVALID") {
          console.error("unexpected error", err);
          failed = true;
        }
        done();
      });
      req.end();
    }
  });

function done() {
  if (--remaining === 0) {
    server.close();
    // Give the HTTP thread a tick to finish any in-flight handshake callback
    // before the main thread races to exit.
    setImmediate(() => {
      if (failed) process.exit(1);
      console.log("ok");
    });
  }
}
