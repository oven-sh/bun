//#FILE: test-http-keep-alive-timeout-custom.js
//#SHA1: 4f7c5a20da7b46bea9198b3854aed7c2042a8691
//-----------------
"use strict";

const http = require("http");

test("HTTP Keep-Alive timeout custom", async () => {
  const server = http.createServer((req, res) => {
    const body = "hello world\n";

    res.writeHead(200, {
      "Content-Length": body.length,
      "Keep-Alive": "timeout=50",
    });
    res.write(body);
    res.end();
  });
  server.keepAliveTimeout = 12010;

  const agent = new http.Agent({ maxSockets: 1, keepAlive: true });

  await new Promise(resolve => {
    server.listen(0, () => {
      http.get(
        {
          path: "/",
          port: server.address().port,
          agent: agent,
        },
        response => {
          response.resume();
          expect(response.headers["keep-alive"]).toBe("timeout=50");
          server.close();
          agent.destroy();
          resolve();
        },
      );
    });
  });
});

//<#END_FILE: test-http-keep-alive-timeout-custom.js
