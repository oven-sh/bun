//#FILE: test-http2-connect-tls-with-delay.js
//#SHA1: 8c5489e025ec14c2cc53788b27fde11a11990e42
//-----------------
"use strict";

const http2 = require("http2");
const tls = require("tls");
const fs = require("fs");
const path = require("path");

const serverOptions = {
  key: fs.readFileSync(path.join(__dirname, "..", "fixtures", "keys", "agent1-key.pem")),
  cert: fs.readFileSync(path.join(__dirname, "..", "fixtures", "keys", "agent1-cert.pem")),
};

let server;

beforeAll(done => {
  server = http2.createSecureServer(serverOptions, (req, res) => {
    res.end();
  });

  server.listen(0, "127.0.0.1", done);
});

afterAll(() => {
  server.close();
});

test("HTTP/2 connect with TLS and delay", done => {
  const options = {
    ALPNProtocols: ["h2"],
    host: "127.0.0.1",
    servername: "localhost",
    port: server.address().port,
    rejectUnauthorized: false,
  };

  const socket = tls.connect(options, async () => {
    socket.once("readable", () => {
      const client = http2.connect("https://localhost:" + server.address().port, {
        ...options,
        createConnection: () => socket,
      });

      client.once("remoteSettings", () => {
        const req = client.request({
          ":path": "/",
        });
        req.on("data", () => req.resume());
        req.on("end", () => {
          client.close();
          req.close();
          done();
        });
        req.end();
      });
    });
  });
});

//<#END_FILE: test-http2-connect-tls-with-delay.js
