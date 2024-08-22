//#FILE: test-pipe-abstract-socket-http.js
//#SHA1: 9d09cc143dc3d494d277d55e823f0577e002248a
//-----------------
"use strict";

const http = require("http");

if (process.platform !== "linux") {
  test.skip("This test is Linux-only", () => {});
} else {
  test("HTTP server with abstract socket", done => {
    const server = http.createServer((req, res) => {
      res.end("ok");
    });

    server.listen("\0abstract", () => {
      http.get(
        {
          socketPath: server.address(),
        },
        res => {
          expect(res.statusCode).toBe(200);
          server.close();
          done();
        },
      );
    });

    // Ensure the server callback is called
    expect(server.listeners("request")[0]).toHaveBeenCalledTimes(1);

    // Ensure the server.listen callback is called
    expect(server.listeners("listening")[0]).toHaveBeenCalledTimes(1);
  });
}

//<#END_FILE: test-pipe-abstract-socket-http.js
