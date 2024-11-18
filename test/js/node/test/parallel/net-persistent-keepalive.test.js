//#FILE: test-net-persistent-keepalive.js
//#SHA1: 1428cedddea85130590caec6c04b1939c1f614d4
//-----------------
"use strict";
const net = require("net");

let serverConnection;
let clientConnection;
let echoServer;
let serverPort;

beforeAll((done) => {
  echoServer = net.createServer((connection) => {
    serverConnection = connection;
    connection.setTimeout(0);
    expect(typeof connection.setKeepAlive).toBe("function");
    connection.on("end", () => {
      connection.end();
    });
  });

  echoServer.listen(0, () => {
    serverPort = echoServer.address().port;
    done();
  });
});

afterAll((done) => {
  if (echoServer) {
    echoServer.close(done);
  } else {
    done();
  }
});

test("persistent keepalive", (done) => {
  clientConnection = new net.Socket();
  // Send a keepalive packet after 400 ms and make sure it persists
  const s = clientConnection.setKeepAlive(true, 400);
  expect(s).toBeInstanceOf(net.Socket);

  clientConnection.connect(serverPort, "127.0.0.1");
  clientConnection.setTimeout(0);

  setTimeout(() => {
    // Make sure both connections are still open
    expect(serverConnection.readyState).toBe("open");
    expect(clientConnection.readyState).toBe("open");

    serverConnection.end();
    clientConnection.end();
    done();
  }, 600);
});

//<#END_FILE: test-net-persistent-keepalive.js
