//#FILE: test-net-server-close.js
//#SHA1: 96e512298a1cede953eecb3a1d06b8dad1aeec81
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

test("server close behavior", async () => {
  const sockets = [];

  const serverClosePromise = new Promise(resolve => {
    const server = net.createServer(c => {
      const closeHandler = jest.fn();
      c.on("close", closeHandler);

      sockets.push(c);

      if (sockets.length === 2) {
        expect(server.close()).toBe(server);
        sockets.forEach(c => c.destroy());
      }

      c.on("close", () => {
        expect(closeHandler).toHaveBeenCalledTimes(1);
      });
    });

    server.on("close", resolve);

    expect(server).toBe(
      server.listen(0, () => {
        net.createConnection(server.address().port);
        net.createConnection(server.address().port);
      }),
    );
  });

  await serverClosePromise;
});

//<#END_FILE: test-net-server-close.js
