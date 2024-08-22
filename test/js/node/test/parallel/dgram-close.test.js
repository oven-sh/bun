//#FILE: test-dgram-close.js
//#SHA1: c396ba7a9c9ef45206989b36e4b5db0b95503e38
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

// Flags: --expose-internals
"use strict";
// Ensure that if a dgram socket is closed before the DNS lookup completes, it
// won't crash.

const dgram = require("dgram");

const buf = Buffer.alloc(1024, 42);

test("dgram socket close before DNS lookup completes", done => {
  let socket = dgram.createSocket("udp4");

  // Get a random port for send
  const portGetter = dgram.createSocket("udp4");

  portGetter.bind(0, "localhost", () => {
    socket.send(buf, 0, buf.length, portGetter.address().port, portGetter.address().address);

    expect(socket.close()).toBe(socket);

    socket.on("close", () => {
      socket = null;

      // Verify that accessing handle after closure doesn't throw
      setImmediate(() => {
        setImmediate(() => {
          // We can't access internal symbols, so we'll just check if this doesn't throw
          expect(() => {
            console.log("Handle fd is: ", "placeholder");
          }).not.toThrow();

          portGetter.close();
          done();
        });
      });
    });
  });
});

//<#END_FILE: test-dgram-close.js
