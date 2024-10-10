//#FILE: test-dgram-bind.js
//#SHA1: 748fcd0fcb3ed5103b9072bba3019e560fb2799b
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
const dgram = require("dgram");

test("dgram socket bind", async () => {
  const socket = dgram.createSocket("udp4");

  await new Promise(resolve => {
    socket.on("listening", () => {
      expect(() => {
        socket.bind();
      }).toThrow(
        expect.objectContaining({
          code: "ERR_SOCKET_ALREADY_BOUND",
          name: "Error",
          message: expect.stringMatching(/^Socket is already bound$/),
        }),
      );

      socket.close();
      resolve();
    });

    const result = socket.bind(); // Should not throw.

    expect(result).toBe(socket); // Should have returned itself.
  });
});

//<#END_FILE: test-dgram-bind.js
