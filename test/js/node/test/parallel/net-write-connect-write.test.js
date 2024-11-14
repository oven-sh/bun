//#FILE: test-net-write-connect-write.js
//#SHA1: 8d6e9a30cc58bee105db15dc48c8a13c451629be
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

test("net write connect write", async () => {
  const server = net.createServer(socket => {
    socket.pipe(socket);
  });

  await new Promise(resolve => {
    server.listen(0, resolve);
  });

  const conn = net.connect(server.address().port);
  let received = "";

  conn.setEncoding("utf8");
  conn.write("before");

  await new Promise(resolve => {
    conn.on("connect", () => {
      conn.write(" after");
      resolve();
    });
  });

  await new Promise(resolve => {
    conn.on("data", buf => {
      received += buf;
      conn.end();
    });

    conn.on("end", () => {
      server.close();
      expect(received).toBe("before after");
      resolve();
    });
  });
});

//<#END_FILE: test-net-write-connect-write.js
