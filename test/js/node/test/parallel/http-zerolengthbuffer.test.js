//#FILE: test-http-zerolengthbuffer.js
//#SHA1: 28fff143238744f829f63936c8902047ad2c2fc5
//-----------------
"use strict";
// Serving up a zero-length buffer should work.

const http = require("http");

test("Serve zero-length buffer", done => {
  const server = http.createServer((req, res) => {
    const buffer = Buffer.alloc(0);
    res.writeHead(200, { "Content-Type": "text/html", "Content-Length": buffer.length });
    res.end(buffer);
  });

  server.listen(0, () => {
    http.get({ port: server.address().port }, res => {
      const dataHandler = jest.fn();
      res.on("data", dataHandler);

      res.on("end", () => {
        expect(dataHandler).not.toHaveBeenCalled();
        server.close();
        done();
      });
    });
  });
});

//<#END_FILE: test-http-zerolengthbuffer.js
