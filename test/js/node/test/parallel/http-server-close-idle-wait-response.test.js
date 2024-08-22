//#FILE: test-http-server-close-idle-wait-response.js
//#SHA1: 04c4c10103faabfd084635c9280824668eb0ba18
//-----------------
"use strict";

const { createServer, get } = require("http");

test("HTTP server close idle connections after response", async () => {
  const server = createServer(
    jest.fn((req, res) => {
      req.resume();

      setTimeout(() => {
        res.writeHead(204, { Connection: "keep-alive", "Keep-Alive": "timeout=1" });
        res.end();
      }, 1000);
    }),
  );

  await new Promise(resolve => {
    server.listen(0, () => {
      const port = server.address().port;

      get(`http://localhost:${port}`, res => {
        server.close();
      }).on("finish", () => {
        setTimeout(() => {
          server.closeIdleConnections();
          resolve();
        }, 500);
      });
    });
  });

  expect(server.listeners("request")[0]).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-http-server-close-idle-wait-response.js
