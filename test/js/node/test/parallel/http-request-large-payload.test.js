//#FILE: test-http-request-large-payload.js
//#SHA1: 236870617a867c47c0767e351433c5deb7c87120
//-----------------
"use strict";

// This test ensures Node.js doesn't throw an error when making requests with
// the payload 16kb or more in size.
// https://github.com/nodejs/node/issues/2821

const http = require("http");

test("HTTP request with large payload", done => {
  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end();

    server.close();
    done();
  });

  server.listen(0, function () {
    const req = http.request({
      method: "POST",
      port: this.address().port,
    });

    const payload = Buffer.alloc(16390, "Й");
    req.write(payload);
    req.end();
  });
});

//<#END_FILE: test-http-request-large-payload.js
