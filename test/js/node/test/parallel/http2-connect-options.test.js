//#FILE: test-http2-connect-options.js
//#SHA1: 9bc8ddb455cb830743645455e314294e56047a1b
//-----------------
"use strict";

const http2 = require("http2");

if (!process.versions.openssl) {
  test.skip("missing crypto", () => {});
} else if (!["linux", "android"].includes(process.platform)) {
  test.skip("platform-specific test.", () => {});
} else {
  test("HTTP2 connect options", async () => {
    const server = http2.createServer((req, res) => {
      console.log(`Connect from: ${req.connection.remoteAddress}`);
      expect(req.connection.remoteAddress).toBe("127.0.0.2");

      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(`You are from: ${req.connection.remoteAddress}`);
      });
      req.resume();
    });

    await new Promise(resolve => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const options = { localAddress: "127.0.0.2", family: 4 };

    const client = http2.connect("http://localhost:" + server.address().port, options);

    const req = client.request({
      ":path": "/",
    });

    req.on("data", () => req.resume());

    await new Promise(resolve => {
      req.on("end", () => {
        client.close();
        req.close();
        server.close();
        resolve();
      });
      req.end();
    });
  });
}

//<#END_FILE: test-http2-connect-options.js
