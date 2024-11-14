//#FILE: test-http-many-ended-pipelines.js
//#SHA1: 930bb6dc614c68f965c7b31e9a1223386234e389
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
const net = require("net");

const numRequests = 20;
let first = false;

test("HTTP server handles many ended pipelines", async () => {
  const server = http.createServer((req, res) => {
    if (!first) {
      first = true;
      req.socket.on("close", () => {
        server.close();
      });
    }

    res.end("ok");
    // Oh no!  The connection died!
    req.socket.destroy();
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      const client = net.connect({
        port: server.address().port,
        allowHalfOpen: true,
      });

      client.on("error", err => {
        // The socket might be destroyed by the other peer while data is still
        // being written. The `'EPIPE'` and `'ECONNABORTED'` codes might also be
        // valid but they have not been seen yet.
        expect(err.code).toBe("ECONNRESET");
      });

      for (let i = 0; i < numRequests; i++) {
        client.write("GET / HTTP/1.1\r\n" + "Host: some.host.name\r\n" + "\r\n\r\n");
      }
      client.end();
      client.pipe(process.stdout);

      resolve();
    });
  });
});

const mockWarning = jest.spyOn(process, "emit");
mockWarning.mockImplementation((event, ...args) => {
  if (event === "warning") return;
  return process.emit.apply(process, [event, ...args]);
});

afterAll(() => {
  expect(mockWarning).not.toHaveBeenCalledWith("warning", expect.anything());
  mockWarning.mockRestore();
});

//<#END_FILE: test-http-many-ended-pipelines.js
