//#FILE: test-http-request-arguments.js
//#SHA1: c02b492e2dbf5fa6ffcda8a80c3e4ad41bb0c9e5
//-----------------
"use strict";

const http = require("http");

// Test providing both a url and options, with the options partially
// replacing address and port portions of the URL provided.
test("http.get with url and options", done => {
  const server = http.createServer((req, res) => {
    expect(req.url).toBe("/testpath");
    res.end();
    server.close();
  });

  server.listen(0, () => {
    const port = server.address().port;
    http.get("http://example.com/testpath", { hostname: "localhost", port }, res => {
      res.resume();
      done();
    });
  });
});

//<#END_FILE: test-http-request-arguments.js
