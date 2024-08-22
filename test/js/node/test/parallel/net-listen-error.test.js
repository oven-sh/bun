//#FILE: test-net-listen-error.js
//#SHA1: e137f95ad19c9814ab76d44f0020b7b1c9969b07
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

test("net.createServer listen error", done => {
  const server = net.createServer(function (socket) {});

  const mockListenCallback = jest.fn();
  server.listen(1, "1.1.1.1", mockListenCallback); // EACCES or EADDRNOTAVAIL

  server.on("error", error => {
    expect(error).toEqual(
      expect.objectContaining({
        message: expect.any(String),
        code: expect.stringMatching(/^(EACCES|EADDRNOTAVAIL)$/),
      }),
    );
    expect(mockListenCallback).not.toHaveBeenCalled();
    done();
  });
});

//<#END_FILE: test-net-listen-error.js
