//#FILE: test-http-chunked-smuggling.js
//#SHA1: c146d9dc37a522ac07d943b4c40b3301923659fa
//-----------------
"use strict";

const http = require("http");
const net = require("net");

// Verify that invalid chunk extensions cannot be used to perform HTTP request
// smuggling attacks.

describe("HTTP Chunked Smuggling", () => {
  let server;
  let serverPort;

  beforeAll(done => {
    server = http.createServer((request, response) => {
      expect(request.url).not.toBe("/admin");
      response.end("hello world");
    });

    server.listen(0, () => {
      serverPort = server.address().port;
      done();
    });
  });

  afterAll(done => {
    server.close(done);
  });

  test("invalid chunk extensions", done => {
    const sock = net.connect(serverPort);

    sock.write(
      "" +
        "GET / HTTP/1.1\r\n" +
        "Host: localhost:8080\r\n" +
        "Transfer-Encoding: chunked\r\n" +
        "\r\n" +
        "2;\n" +
        "xx\r\n" +
        "4c\r\n" +
        "0\r\n" +
        "\r\n" +
        "GET /admin HTTP/1.1\r\n" +
        "Host: localhost:8080\r\n" +
        "Transfer-Encoding: chunked\r\n" +
        "\r\n" +
        "0\r\n" +
        "\r\n",
    );

    sock.resume();
    sock.on("end", () => {
      done();
    });
  });
});

//<#END_FILE: test-http-chunked-smuggling.js
