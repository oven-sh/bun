//#FILE: test-http-server-reject-chunked-with-content-length.js
//#SHA1: e94d6c381c99ba72c2cc2bcbc4c6474a7c63819a
//-----------------
"use strict";

const http = require("http");
const net = require("net");

const reqstr = "POST / HTTP/1.1\r\n" + "Content-Length: 1\r\n" + "Transfer-Encoding: chunked\r\n\r\n";

test("HTTP server rejects chunked with content length", done => {
  const server = http.createServer(expect.any(Function));

  server.on("clientError", err => {
    expect(err.message).toMatch(/^Parse Error/);
    expect(err.code).toBe("HPE_INVALID_TRANSFER_ENCODING");
    server.close();
  });

  server.listen(0, () => {
    const client = net.connect({ port: server.address().port }, () => {
      client.write(reqstr);
      client.end();
    });

    client.on("data", () => {
      // Should not get to this point because the server should simply
      // close the connection without returning any data.
      throw new Error("no data should be returned by the server");
    });

    client.on("end", () => {
      done();
    });
  });
});

//<#END_FILE: test-http-server-reject-chunked-with-content-length.js
