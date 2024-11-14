//#FILE: test-tls-wrap-econnreset.js
//#SHA1: 22f57b68ee3c5d271a9235972865773da523a34e
//-----------------
"use strict";

const net = require("net");
const tls = require("tls");

// Skip the test if crypto is not available
if (!("crypto" in process.versions)) {
  test.skip("missing crypto", () => {});
} else {
  test("TLS connection reset", async () => {
    const server = net.createServer(c => {
      c.end();
    });

    await new Promise(resolve => {
      server.listen(0, resolve);
    });

    const port = server.address().port;

    let errored = false;
    const tlsConnection = tls.connect(port, "127.0.0.1");

    await expect(
      new Promise((_, reject) => {
        tlsConnection.once("error", reject);
      }),
    ).rejects.toMatchObject({
      code: "ECONNRESET",
      path: undefined,
      host: "127.0.0.1",
      port: port,
      localAddress: undefined,
      message: expect.any(String),
    });

    errored = true;
    server.close();

    await new Promise(resolve => {
      tlsConnection.on("close", resolve);
    });

    expect(errored).toBe(true);
  });
}

//<#END_FILE: test-tls-wrap-econnreset.js
