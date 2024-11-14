//#FILE: test-http-pause-no-dump.js
//#SHA1: 30c3bd27f5edd0ba060a0d6833061d1ce6379cd5
//-----------------
"use strict";

const http = require("http");

test("HTTP pause should not dump", done => {
  const server = http.createServer((req, res) => {
    req.once("data", () => {
      req.pause();
      res.writeHead(200);
      res.end();
      res.on("finish", () => {
        expect(req._dumped).toBeFalsy();
      });
    });
  });

  server.listen(0, () => {
    const req = http.request(
      {
        port: server.address().port,
        method: "POST",
        path: "/",
      },
      res => {
        expect(res.statusCode).toBe(200);
        res.resume();
        res.on("end", () => {
          server.close();
          done();
        });
      },
    );

    req.end(Buffer.allocUnsafe(1024));
  });
});

//<#END_FILE: test-http-pause-no-dump.js
