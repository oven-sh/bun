//#FILE: test-http-agent-uninitialized-with-handle.js
//#SHA1: 828942acbc68f8fd92425ecdf0e754ab13b4baff
//-----------------
"use strict";

const http = require("http");
const net = require("net");

test("http agent with uninitialized socket handle", done => {
  const agent = new http.Agent({
    keepAlive: true,
  });
  const socket = new net.Socket();
  // If _handle exists then internals assume a couple methods exist.
  socket._handle = {
    ref() {},
    readStart() {},
  };

  const server = http.createServer((req, res) => {
    res.end();
  });

  server.listen(0, () => {
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

  expect(server).toHaveProperty("listen");
  expect(server).toHaveProperty("close");
});

//<#END_FILE: test-http-agent-uninitialized-with-handle.js
