//#FILE: test-net-persistent-nodelay.js
//#SHA1: 48ab228711df09f547aa2ef4abaac2735ef4625b
//-----------------
"use strict";

const net = require("net");

describe("TCP setNoDelay persistence", () => {
  let echoServer;
  let originalSetNoDelay;
  let callCount;

  beforeAll(() => {
    echoServer = net.createServer(connection => {
      connection.end();
    });
  });

  afterAll(() => {
    echoServer.close();
  });

  beforeEach(() => {
    callCount = 0;
    originalSetNoDelay = net.Socket.prototype.setNoDelay;
    net.Socket.prototype.setNoDelay = function (enable) {
      const result = originalSetNoDelay.call(this, enable);
      callCount++;
      return result;
    };
  });

  afterEach(() => {
    net.Socket.prototype.setNoDelay = originalSetNoDelay;
  });

  test("setNoDelay is called once when connecting", done => {
    echoServer.listen(0, () => {
      const sock1 = new net.Socket();

      // setNoDelay before the handle is created
      const s = sock1.setNoDelay();
      expect(s).toBeInstanceOf(net.Socket);

      sock1.connect(echoServer.address().port);
      sock1.on("end", () => {
        expect(callCount).toBe(1);
        done();
      });
    });
  });
});

//<#END_FILE: test-net-persistent-nodelay.js
