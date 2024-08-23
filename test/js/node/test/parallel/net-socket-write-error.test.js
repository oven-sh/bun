//#FILE: test-net-socket-write-error.js
//#SHA1: a69bb02fc98fc265ad23ff03e7ae16e9c984202d
//-----------------
"use strict";

const net = require("net");

test("net socket write error", done => {
  const server = net.createServer().listen(0, connectToServer);

  function connectToServer() {
    const client = net
      .createConnection(this.address().port, () => {
        client.on("error", () => {
          throw new Error("Error event should not be emitted");
        });

        expect(() => {
          client.write(1337);
        }).toThrow(
          expect.objectContaining({
            code: "ERR_INVALID_ARG_TYPE",
            name: "TypeError",
            message: expect.any(String),
          }),
        );

        client.destroy();
      })
      .on("close", () => {
        server.close();
        done();
      });
  }
});

//<#END_FILE: test-net-socket-write-error.js
