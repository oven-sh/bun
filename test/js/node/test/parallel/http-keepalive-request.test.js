//#FILE: test-http-keepalive-request.js
//#SHA1: 31cc9b875e1ead9a0b98fb07b672b536f6d06fba
//-----------------
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";

const http = require("http");

let serverSocket = null;
let clientSocket = null;
const expectRequests = 10;
let actualRequests = 0;

const server = http.createServer((req, res) => {
  // They should all come in on the same server socket.
  if (serverSocket) {
    expect(req.socket).toBe(serverSocket);
  } else {
    serverSocket = req.socket;
  }

  res.end(req.url);
});

const agent = new http.Agent({ keepAlive: true });

function makeRequest(n) {
  return new Promise(resolve => {
    if (n === 0) {
      server.close();
      agent.destroy();
      resolve();
      return;
    }

    const req = http.request({
      port: server.address().port,
      path: `/${n}`,
      agent: agent,
    });

    req.end();

    // TODO: client side socket compatibility
    // req.on("socket", sock => {
    //   if (clientSocket) {
    //     expect(sock).toBe(clientSocket);
    //   } else {
    //     clientSocket = sock;
    //   }
    // });

    req.on("response", res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", c => {
        data += c;
      });
      res.on("end", () => {
        expect(data).toBe(`/${n}`);
        setTimeout(() => {
          actualRequests++;
          resolve(makeRequest(n - 1));
        }, 1);
      });
    });
  });
}

test("HTTP keep-alive requests", async () => {
  await new Promise(resolve => {
    server.listen(0, () => {
      resolve(makeRequest(expectRequests));
    });
  });

  expect(actualRequests).toBe(expectRequests);
});

//<#END_FILE: test-http-keepalive-request.js
