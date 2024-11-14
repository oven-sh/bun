//#FILE: test-tls-env-extra-ca-no-crypto.js
//#SHA1: da8421700b140b9bef4723eee10dbae7786423b6
//-----------------
"use strict";

const { fork } = require("child_process");
const path = require("path");

// This test ensures that trying to load extra certs won't throw even when
// there is no crypto support, i.e., built with "./configure --without-ssl".
if (process.argv[2] === "child") {
  // exit
} else {
  const NODE_EXTRA_CA_CERTS = path.join(__dirname, "..", "fixtures", "keys", "ca1-cert.pem");

  test("Loading extra certs without crypto support", () => {
    return new Promise(resolve => {
      fork(__filename, ["child"], { env: { ...process.env, NODE_EXTRA_CA_CERTS } }).on("exit", status => {
        // Client did not succeed in connecting
        expect(status).toBe(0);
        resolve();
      });
    });
  });
}

//<#END_FILE: test-tls-env-extra-ca-no-crypto.js
