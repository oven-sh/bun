//#FILE: test-net-during-close.js
//#SHA1: c5fc5c85760b2c68679f7041ebf737e8204ca8c5
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

test("accessing client properties during server close", done => {
  const server = net.createServer(socket => {
    socket.end();
  });

  server.listen(0, () => {
    const client = net.createConnection(server.address().port);
    server.close();

    // Server connection event has not yet fired client is still attempting to
    // connect. Accessing properties should not throw in this case.
    expect(() => {
      /* eslint-disable no-unused-expressions */
      client.remoteAddress;
      client.remoteFamily;
      client.remotePort;
      /* eslint-enable no-unused-expressions */
    }).not.toThrow();

    // Exit now, do not wait for the client error event.
    done();
  });
});

//<#END_FILE: test-net-during-close.js
