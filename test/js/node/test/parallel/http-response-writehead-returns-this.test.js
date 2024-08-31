//#FILE: test-http-response-writehead-returns-this.js
//#SHA1: 8a079a3635356290e98a1e7c4eb89b97680b3889
//-----------------
"use strict";

const http = require("http");

test("http.ServerResponse.writeHead() returns this", done => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "a-header": "a-header-value" }).end("abc");
  });

  server.listen(0, () => {
    http.get({ port: server.address().port }, res => {
      expect(res.headers["a-header"]).toBe("a-header-value");

      const chunks = [];

      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        expect(Buffer.concat(chunks).toString()).toBe("abc");
        server.close();
        done();
      });
    });
  });
});

//<#END_FILE: test-http-response-writehead-returns-this.js
