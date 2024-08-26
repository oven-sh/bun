//#FILE: test-tls-add-context.js
//#SHA1: 61f134fe8c8fb63a00278b2d70dfecf11efb5df9
//-----------------
"use strict";

const crypto = require("crypto");
const fixtures = require("../common/fixtures");
const tls = require("tls");

// Skip test if crypto is not available
if (!crypto) {
  test.skip("missing crypto", () => {});
} else {
  function loadPEM(n) {
    return fixtures.readKey(`${n}.pem`);
  }

  const serverOptions = {
    key: loadPEM("agent2-key"),
    cert: loadPEM("agent2-cert"),
    ca: [loadPEM("ca2-cert")],
    requestCert: true,
    rejectUnauthorized: false,
  };

  let connections = 0;

  test("TLS add context", done => {
    const server = tls.createServer(serverOptions, c => {
      if (++connections === 3) {
        server.close();
      }
      if (c.servername === "unknowncontext") {
        expect(c.authorized).toBe(false);
        return;
      }
      expect(c.authorized).toBe(true);
    });

    const secureContext = {
      key: loadPEM("agent1-key"),
      cert: loadPEM("agent1-cert"),
      ca: [loadPEM("ca1-cert")],
    };
    server.addContext("context1", secureContext);
    server.addContext("context2", tls.createSecureContext(secureContext));

    const clientOptionsBase = {
      key: loadPEM("agent1-key"),
      cert: loadPEM("agent1-cert"),
      ca: [loadPEM("ca1-cert")],
      rejectUnauthorized: false,
    };

    server.listen(0, () => {
      const client1 = tls.connect(
        {
          ...clientOptionsBase,
          port: server.address().port,
          servername: "context1",
        },
        () => {
          client1.end();
        },
      );

      const client2 = tls.connect(
        {
          ...clientOptionsBase,
          port: server.address().port,
          servername: "context2",
        },
        () => {
          client2.end();
        },
      );

      const client3 = tls.connect(
        {
          ...clientOptionsBase,
          port: server.address().port,
          servername: "unknowncontext",
        },
        () => {
          client3.end();
          done();
        },
      );
    });
  });
}

//<#END_FILE: test-tls-add-context.js
