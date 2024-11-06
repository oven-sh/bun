//#FILE: test-net-socket-write-error.js
//#SHA1: a69bb02fc98fc265ad23ff03e7ae16e9c984202d
//-----------------
"use strict";

const net = require("net");

describe("Net Socket Write Error", () => {
  let server;

  beforeAll(done => {
    server = net.createServer().listen(0, () => {
      done();
    });
  });

  afterAll(() => {
    server.close();
  });

  test("should throw TypeError when writing non-string/buffer", done => {
    const client = net.createConnection(server.address().port, () => {
      client.on("error", () => {
        done.fail("Client should not emit error");
      });

      expect(() => {
        client.write(1337);
      }).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
        }),
      );

      client.destroy();
      done();
    });

    client.on("close", () => {
      // This ensures the server closes after the client disconnects
      server.close();
    });
  });
});

//<#END_FILE: test-net-socket-write-error.js
