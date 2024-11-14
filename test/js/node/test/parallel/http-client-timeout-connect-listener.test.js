//#FILE: test-http-client-timeout-connect-listener.js
//#SHA1: 4311732db4ce9958ec0ed01be68786e522ed6ca8
//-----------------
"use strict";

// This test ensures that `ClientRequest.prototype.setTimeout()` does
// not add a listener for the `'connect'` event to the socket if the
// socket is already connected.

const http = require("http");

// Maximum allowed value for timeouts.
const timeout = 2 ** 31 - 1;

let server;
let agent;

beforeAll(() => {
  return new Promise(resolve => {
    server = http.createServer((req, res) => {
      res.end();
    });

    server.listen(0, () => {
      agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
      resolve();
    });
  });
});

afterAll(() => {
  return new Promise(resolve => {
    agent.destroy();
    server.close(resolve);
  });
});

function doRequest(options) {
  return new Promise(resolve => {
    const req = http.get(options, res => {
      res.on("end", resolve);
      res.resume();
    });

    req.setTimeout(timeout);
    return req;
  });
}

test("ClientRequest.prototype.setTimeout() does not add connect listener to connected socket", async () => {
  const options = { port: server.address().port, agent: agent };

  await doRequest(options);

  const req = http.get(options);
  req.setTimeout(timeout);

  await new Promise(resolve => {
    req.on("socket", socket => {
      expect(socket.listenerCount("connect")).toBe(0);
      resolve();
    });
  });

  await new Promise(resolve => {
    req.on("response", res => {
      res.on("end", resolve);
      res.resume();
    });
  });
});

//<#END_FILE: test-http-client-timeout-connect-listener.js
