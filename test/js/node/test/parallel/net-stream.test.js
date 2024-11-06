//#FILE: test-net-stream.js
//#SHA1: 3682dee1fcd1fea4f59bbad200ab1476e0f49bda
//-----------------
"use strict";

const net = require("net");

const SIZE = 2e6;
const N = 10;
const buf = Buffer.alloc(SIZE, "a");

let server;

beforeAll(done => {
  server = net
    .createServer(socket => {
      socket.setNoDelay();

      const onError = jest.fn(() => socket.destroy());
      const onClose = jest.fn(() => server.close());

      socket.on("error", onError).on("close", onClose);

      for (let i = 0; i < N; ++i) {
        socket.write(buf, () => {});
      }
      socket.end();

      socket.on("close", () => {
        expect(onError).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
        done();
      });
    })
    .listen(0, () => {
      done();
    });
});

afterAll(() => {
  server.close();
});

test("net stream behavior", done => {
  const conn = net.connect(server.address().port, "127.0.0.1");

  conn.on("data", buf => {
    expect(conn.pause()).toBe(conn);
    setTimeout(() => {
      conn.destroy();
      done();
    }, 20);
  });
});

//<#END_FILE: test-net-stream.js
