//#FILE: test-http-head-response-has-no-body-end-implicit-headers.js
//#SHA1: e2f884b0a99ba30e0e8065596d00af1ed99b4791
//-----------------
"use strict";
const http = require("http");

// This test is to make sure that when the HTTP server
// responds to a HEAD request with data to res.end,
// it does not send any body but the response is sent
// anyway.

test("HTTP HEAD response has no body, end implicit headers", done => {
  const server = http.createServer((req, res) => {
    res.end("FAIL"); // broken: sends FAIL from hot path.
  });

  server.listen(0, () => {
    const req = http.request(
      {
        port: server.address().port,
        method: "HEAD",
        path: "/",
      },
      res => {
        res.on("end", () => {
          server.close();
          done();
        });
        res.resume();
      },
    );
    req.end();
  });
});

//<#END_FILE: test-http-head-response-has-no-body-end-implicit-headers.js
