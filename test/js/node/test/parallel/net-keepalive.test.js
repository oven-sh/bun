//#FILE: test-net-keepalive.js
//#SHA1: 822f2eb57a17abc64e2664803a4ac69430e5b035
//-----------------
"use strict";

const net = require("net");

describe("net keepalive", () => {
  test("should maintain connection", async () => {
    let serverConnection;
    let clientConnection;

    const { promise, resolve, reject } = Promise.withResolvers();
    function done(err) {
      clientConnection.destroy();
      echoServer.close();
      if (err) reject(err);
      else resolve();
    }

    const echoServer = net.createServer(connection => {
      serverConnection = connection;
      connection.setTimeout(0);
      try {
        expect(connection.setKeepAlive).toBeDefined();
      } catch (err) {
        done(err);
        return;
      }
      connection.setKeepAlive(true, 50);
      connection.on("end", () => {
        connection.end();
      });
    });

    echoServer.listen(0, () => {
      clientConnection = net.createConnection(echoServer.address().port, "127.0.0.1");
      clientConnection.setTimeout(0);
      clientConnection.on("connect", () => {
        setTimeout(() => {
          try {
            expect(serverConnection.readyState).toBe("open");
            expect(clientConnection.readyState).toBe("open");
            done();
          } catch (err) {
            done(err);
          }
        }, 100);
      });
    });

    await promise;
  });
});

//<#END_FILE: test-net-keepalive.js
