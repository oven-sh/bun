//#FILE: test-http2-socket-close.js
//#SHA1: 21273f490d8c69e059cce07cae5dd7d37707ae60
//-----------------
"use strict";

const net = require("net");
const h2 = require("http2");
const fs = require("fs");
const path = require("path");

const tlsOptions = {
  key: fs.readFileSync(path.join(__dirname, "..", "fixtures", "keys", "agent1-key.pem")),
  cert: fs.readFileSync(path.join(__dirname, "..", "fixtures", "keys", "agent1-cert.pem")),
  ALPNProtocols: ["h2"],
};

let netServer;
let serverRawSocket;
let serverH2Session;
let h2Server;

beforeAll(done => {
  netServer = net.createServer(socket => {
    serverRawSocket = socket;
    h2Server.emit("connection", socket);
  });

  h2Server = h2.createSecureServer(tlsOptions, (req, res) => {
    res.writeHead(200);
    res.end();
  });

  h2Server.on("session", session => {
    serverH2Session = session;
  });

  netServer.listen(0, () => {
    done();
  });
});

afterAll(done => {
  netServer.close(() => {
    done();
  });
});

describe("HTTP/2 socket close", () => {
  test("should handle socket close without segfault", done => {
    const proxyClient = h2.connect(`https://localhost:${netServer.address().port}`, {
      rejectUnauthorized: false,
    });

    proxyClient.on("error", () => {});
    proxyClient.on("close", () => {
      done();
    });

    const req = proxyClient.request({
      ":method": "GET",
      ":path": "/",
    });

    req.on("error", () => {});
    req.on("response", response => {
      expect(response[":status"]).toBe(200);

      // Asynchronously shut down the server's connections after the response,
      // but not in the order it typically expects:
      setTimeout(() => {
        serverRawSocket.destroy();

        setTimeout(() => {
          serverH2Session.close();
        }, 10);
      }, 10);
    });
  });
});

//<#END_FILE: test-http2-socket-close.js
