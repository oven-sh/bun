//#FILE: test-tls-startcom-wosign-whitelist.js
//#SHA1: 6742ecdeeaa94ca1efad850b021d5308b3077358
//-----------------
"use strict";

const tls = require("tls");
const fixtures = require("../common/fixtures");

function loadPEM(n) {
  return fixtures.readKey(`${n}.pem`);
}

const testCases = [
  {
    // agent8 is signed by fake-startcom-root with notBefore of
    // Oct 20 23:59:59 2016 GMT. It passes StartCom/WoSign check.
    serverOpts: {
      key: loadPEM("agent8-key"),
      cert: loadPEM("agent8-cert"),
    },
    clientOpts: {
      ca: loadPEM("fake-startcom-root-cert"),
      port: undefined,
      rejectUnauthorized: true,
    },
    errorCode: "CERT_REVOKED",
  },
  {
    // agent9 is signed by fake-startcom-root with notBefore of
    // Oct 21 00:00:01 2016 GMT. It fails StartCom/WoSign check.
    serverOpts: {
      key: loadPEM("agent9-key"),
      cert: loadPEM("agent9-cert"),
    },
    clientOpts: {
      ca: loadPEM("fake-startcom-root-cert"),
      port: undefined,
      rejectUnauthorized: true,
    },
    errorCode: "CERT_REVOKED",
  },
];

describe("TLS StartCom/WoSign Whitelist", () => {
  let finishedTests = 0;

  afterAll(() => {
    expect(finishedTests).toBe(testCases.length);
  });

  testCases.forEach((tcase, index) => {
    it(`should handle case ${index + 1} correctly`, async () => {
      const server = tls.createServer(tcase.serverOpts, s => {
        s.resume();
      });

      await new Promise(resolve => {
        server.listen(0, () => {
          tcase.clientOpts.port = server.address().port;
          const client = tls.connect(tcase.clientOpts);

          client.on("error", e => {
            expect(e.code).toBe(tcase.errorCode);
            server.close(resolve);
          });

          client.on("secureConnect", () => {
            // agent8 can pass StartCom/WoSign check so that the secureConnect
            // is established.
            expect(tcase.errorCode).toBe("CERT_REVOKED");
            client.end();
            server.close(resolve);
          });
        });
      });

      finishedTests++;
    });
  });
});

//<#END_FILE: test-tls-startcom-wosign-whitelist.js
