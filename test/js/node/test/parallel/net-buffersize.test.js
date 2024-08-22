//#FILE: test-net-buffersize.js
//#SHA1: b6b1298dc9f836252e5fcdcee680116d50da7651
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
const net = require("net");

const iter = 10;

test("net buffer size", async () => {
  const server = net.createServer(socket => {
    socket.on("readable", () => {
      socket.read();
    });

    socket.on("end", () => {
      server.close();
    });
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      const client = net.connect(server.address().port);

      client.on("finish", () => {
        expect(client.bufferSize).toBe(0);
        resolve();
      });

      for (let i = 1; i < iter; i++) {
        client.write("a");
        expect(client.bufferSize).toBe(i);
      }

      client.end();
    });
  });
});

//<#END_FILE: test-net-buffersize.js
