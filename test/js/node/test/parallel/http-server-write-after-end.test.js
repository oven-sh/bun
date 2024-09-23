//#FILE: test-http-server-write-after-end.js
//#SHA1: cacf983393f707ddefc829a25ce16a5bf6f41c19
//-----------------
"use strict";

const http = require("http");

// Fix for https://github.com/nodejs/node/issues/14368

test("HTTP server write after end", done => {
  const server = http.createServer(handle);

  function handle(req, res) {
    res.on("error", jest.fn());

    res.write("hello");
    res.end();

    setImmediate(() => {
      res.write("world", err => {
        expect(err).toEqual(
          expect.objectContaining({
            code: "ERR_STREAM_WRITE_AFTER_END",
            name: "Error",
            message: expect.any(String),
          }),
        );
        server.close();
        done();
      });
    });
  }

  server.listen(0, () => {
    http.get(`http://localhost:${server.address().port}`);
  });
});

//<#END_FILE: test-http-server-write-after-end.js
