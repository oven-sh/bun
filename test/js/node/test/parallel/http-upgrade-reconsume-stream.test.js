//#FILE: test-http-upgrade-reconsume-stream.js
//#SHA1: 4117d0b2212d192173b5bd6bf2ef7fe82f627079
//-----------------
"use strict";

const tls = require("tls");
const http = require("http");

// Tests that, after the HTTP parser stopped owning a socket that emits an
// 'upgrade' event, another C++ stream can start owning it (e.g. a TLSSocket).

test("HTTP upgrade and TLSSocket creation", done => {
  const server = http.createServer(expect.any(Function));

  server.on("upgrade", (request, socket, head) => {
    // This should not crash.
    new tls.TLSSocket(socket);
    server.close();
    socket.destroy();
    done();
  });

  server.listen(0, () => {
    http
      .get({
        port: server.address().port,
        headers: {
          "Connection": "Upgrade",
          "Upgrade": "websocket",
        },
      })
      .on("error", () => {});
  });
});

//<#END_FILE: test-http-upgrade-reconsume-stream.js
