//#FILE: test-http-agent-uninitialized.js
//#SHA1: 00034f4963a5620af8a58e68c262c92ea9ec982b
//-----------------
"use strict";

const http = require("http");
const net = require("net");

test("http agent handles uninitialized socket", done => {
  const agent = new http.Agent({
    keepAlive: true,
  });
  const socket = new net.Socket();

  const server = http
    .createServer((req, res) => {
      res.end();
    })
    .listen(0, () => {
      const req = new http.ClientRequest(`http://localhost:${server.address().port}/`);

      // Manually add the socket without a _handle.
      agent.freeSockets[agent.getName(req)] = [socket];
      // Now force the agent to use the socket and check that _handle exists before
      // calling asyncReset().
      agent.addRequest(req, {});
      req.on("response", () => {
        server.close();
        done();
      });
      req.end();
    });

  expect(server).toBeDefined();
});

//<#END_FILE: test-http-agent-uninitialized.js
