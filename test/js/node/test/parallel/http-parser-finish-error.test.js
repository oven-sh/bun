//#FILE: test-http-parser-finish-error.js
//#SHA1: 343dfc59000ecf108bf7c3250ccc6681f6f0c2a8
//-----------------
"use strict";

const net = require("net");
const http = require("http");

const str = "GET / HTTP/1.1\r\n" + "Content-Length:";

test("HTTP parser finish error", done => {
  const server = http.createServer(jest.fn());

  server.on("clientError", (err, socket) => {
    expect(err.message).toMatch(/^Parse Error/);
    expect(err.code).toBe("HPE_INVALID_EOF_STATE");
    socket.destroy();
  });

  server.listen(0, () => {
    const client = net.connect({ port: server.address().port }, () => {
      client.on("data", jest.fn());
      client.on("end", () => {
        server.close();
        done();
      });
      client.write(str);
      client.end();
    });
  });

  expect.assertions(2);
});

//<#END_FILE: test-http-parser-finish-error.js
