//#FILE: test-net-connect-paused-connection.js
//#SHA1: ab2fae629f3abb5fc4d5e59dd7d1dd2e09b9eb48
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

test("net connect with paused connection", done => {
  const server = net.createServer(conn => {
    conn.unref();
  });

  server.listen(0, () => {
    const connection = net.connect(server.address().port, "localhost");
    connection.pause();

    const timeoutId = setTimeout(() => {
      done.fail("Should not have called timeout");
    }, 1000);

    // Unref the timeout to allow the process to exit
    timeoutId.unref();

    // Allow some time for the test to potentially fail
    setTimeout(() => {
      server.close();
      done();
    }, 500);
  });

  server.unref();
});

//<#END_FILE: test-net-connect-paused-connection.js
