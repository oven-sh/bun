//#FILE: test-http2-multistream-destroy-on-read-tls.js
//#SHA1: bf3869a9f8884210710d41c0fb1f54d2112e9af5
//-----------------
"use strict";
const http2 = require("http2");

describe("HTTP2 multistream destroy on read", () => {
  let server;
  const filenames = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

  beforeAll(done => {
    server = http2.createServer();

    server.on("stream", stream => {
      function write() {
        stream.write("a".repeat(10240));
        stream.once("drain", write);
      }
      write();
    });

    server.listen(0, done);
  });

  afterAll(() => {
    if (server) {
      server.close();
    } else {
      done();
    }
  });

  test("should handle multiple stream destructions", done => {
    const client = http2.connect(`http://localhost:${server.address().port}`);

    let destroyed = 0;
    for (const entry of filenames) {
      const stream = client.request({
        ":path": `/${entry}`,
      });
      stream.once("data", () => {
        stream.destroy();

        if (++destroyed === filenames.length) {
          client.close();
          done();
        }
      });
    }
  });
});

//<#END_FILE: test-http2-multistream-destroy-on-read-tls.js
