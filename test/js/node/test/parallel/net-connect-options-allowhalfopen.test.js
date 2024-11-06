//#FILE: test-net-connect-options-allowhalfopen.js
//#SHA1: 9ba18563d747b3ebfa63f8f54468b62526224ec6
//-----------------
"use strict";
const net = require("net");

describe("Net connect options allowHalfOpen", () => {
  let server;
  let clientReceivedFIN = 0;
  let serverConnections = 0;
  let clientSentFIN = 0;
  let serverReceivedFIN = 0;
  const host = "127.0.0.1";
  const CLIENT_VARIANTS = 6;

  function serverOnConnection(socket) {
    console.log(`'connection' ${++serverConnections} emitted on server`);
    const srvConn = serverConnections;
    socket.resume();
    socket.on("data", data => {
      socket.clientId = data.toString();
      console.log(`server connection ${srvConn} is started by client ${socket.clientId}`);
    });

    socket.on("end", () => {
      console.log(`Server received FIN sent by client ${socket.clientId}`);
      if (++serverReceivedFIN < CLIENT_VARIANTS) return;
      setTimeout(() => {
        server.close();
        console.log(
          `connection ${socket.clientId} is closing the server:
          FIN ${serverReceivedFIN} received by server,
          FIN ${clientReceivedFIN} received by client
          FIN ${clientSentFIN} sent by client,
          FIN ${serverConnections} sent by server`.replace(/ {3,}/g, ""),
        );
      }, 50);
    });
    socket.end();
    console.log(`Server has sent ${serverConnections} FIN`);
  }

  function serverOnClose() {
    console.log(
      `Server has been closed:
      FIN ${serverReceivedFIN} received by server
      FIN ${clientReceivedFIN} received by client
      FIN ${clientSentFIN} sent by client
      FIN ${serverConnections} sent by server`.replace(/ {3,}/g, ""),
    );
  }

  beforeAll(done => {
    server = net
      .createServer({ allowHalfOpen: true })
      .on("connection", serverOnConnection)
      .on("close", serverOnClose)
      .listen(0, host, () => {
        console.log(`Server started listening at ${host}:${server.address().port}`);
        done();
      });
  });

  afterAll(() => {
    if (server) {
      server.close();
    } else {
      done();
    }
  });

  test("should handle allowHalfOpen connections correctly", done => {
    function clientOnConnect(index) {
      return function clientOnConnectInner() {
        const client = this;
        console.log(`'connect' emitted on Client ${index}`);
        client.resume();
        client.on("end", () => {
          setTimeout(() => {
            console.log(`client ${index} received FIN`);
            expect(client.readable).toBe(false);
            expect(client.writable).toBe(true);
            expect(client.write(String(index))).toBeTruthy();
            client.end();
            clientSentFIN++;
            console.log(`client ${index} sent FIN, ${clientSentFIN} have been sent`);
          }, 50);
        });
        client.on("close", () => {
          clientReceivedFIN++;
          console.log(
            `connection ${index} has been closed by both sides,` + ` ${clientReceivedFIN} clients have closed`,
          );
          if (clientReceivedFIN === CLIENT_VARIANTS) {
            done();
          }
        });
      };
    }

    const port = server.address().port;
    const opts = { allowHalfOpen: true, host, port };
    net.connect(opts, clientOnConnect(1));
    net.connect(opts).on("connect", clientOnConnect(2));
    net.createConnection(opts, clientOnConnect(3));
    net.createConnection(opts).on("connect", clientOnConnect(4));
    new net.Socket(opts).connect(opts, clientOnConnect(5));
    new net.Socket(opts).connect(opts).on("connect", clientOnConnect(6));
  });
});

//<#END_FILE: test-net-connect-options-allowhalfopen.js
