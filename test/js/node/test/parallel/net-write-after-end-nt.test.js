//#FILE: test-net-write-after-end-nt.js
//#SHA1: 086a5699d5eff4953af4e9f19757b8489e915579
//-----------------
"use strict";
const net = require("net");

describe("net.Socket.write() after end", () => {
  let server;
  let port;

  beforeAll(done => {
    server = net
      .createServer(socket => {
        socket.end();
      })
      .listen(0, () => {
        port = server.address().port;
        done();
      });
  });

  afterAll(done => {
    server.close(done);
  });

  test("error is emitted in the next tick", done => {
    const client = net.connect(port, "127.0.0.1", () => {
      let hasError = false;

      client.on("error", err => {
        hasError = true;
        expect(err).toEqual(
          expect.objectContaining({
            code: "EPIPE",
            message: "This socket has been ended by the other party",
            name: "Error",
          }),
        );
        done();
      });

      client.on("end", () => {
        const ret = client.write("hello");
        expect(ret).toBe(false);
        expect(hasError).toBe(false);
        process.nextTick(() => {
          expect(hasError).toBe(true);
        });
      });

      client.end();
    });
  });
});

//<#END_FILE: test-net-write-after-end-nt.js
