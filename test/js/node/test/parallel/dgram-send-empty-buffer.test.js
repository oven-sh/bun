//#FILE: test-dgram-send-empty-buffer.js
//#SHA1: ac60fc545252e681b648a7038d1bebe46ffbbac0
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

test("dgram send empty buffer", done => {
  const client = dgram.createSocket("udp4");

  client.bind(0, () => {
    const port = client.address().port;

    client.on("message", buffer => {
      expect(buffer.length).toBe(0);
      clearInterval(interval);
      client.close();
      done();
    });

    const buf = Buffer.alloc(0);
    const interval = setInterval(() => {
      client.send(buf, 0, 0, port, "127.0.0.1", () => {
        // This callback is expected to be called
      });
    }, 10);
  });
});

//<#END_FILE: test-dgram-send-empty-buffer.js
