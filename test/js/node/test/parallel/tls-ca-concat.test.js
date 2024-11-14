//#FILE: test-tls-ca-concat.js
//#SHA1: 23b19f45d7777ee95a3c8d8ba4a727b149ea7409
//-----------------
"use strict";

const fixtures = require("../common/fixtures");

// Check ca option can contain concatenated certs by prepending an unrelated
// non-CA cert and showing that agent6's CA root is still found.

const { connect, keys } = require(fixtures.path("tls-connect"));

test("ca option can contain concatenated certs", async () => {
  await new Promise((resolve, reject) => {
    connect(
      {
        client: {
          checkServerIdentity: (servername, cert) => {},
          ca: `${keys.agent1.cert}\n${keys.agent6.ca}`,
        },
        server: {
          cert: keys.agent6.cert,
          key: keys.agent6.key,
        },
      },
      (err, pair, cleanup) => {
        if (err) {
          cleanup();
          reject(err);
        } else {
          cleanup();
          resolve();
        }
      },
    );
  });
});

//<#END_FILE: test-tls-ca-concat.js
