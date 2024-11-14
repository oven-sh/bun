//#FILE: test-dgram-oob-buffer.js
//#SHA1: a851da9a2178e92ce8315294d7cebf6eb78eb4bd
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
// Some operating systems report errors when an UDP message is sent to an
// unreachable host. This error can be reported by sendto() and even by
// recvfrom(). Node should not propagate this error to the user.

const dgram = require("dgram");

test("UDP message sent to unreachable host should not propagate error", async () => {
  const socket = dgram.createSocket("udp4");
  const buf = Buffer.from([1, 2, 3, 4]);

  const portGetter = dgram.createSocket("udp4");

  await new Promise(resolve => {
    portGetter.bind(0, "localhost", () => {
      const { address, port } = portGetter.address();

      portGetter.close(() => {
        const sendCallback = jest.fn();

        socket.send(buf, 0, 0, port, address, sendCallback);
        socket.send(buf, 0, 4, port, address, sendCallback);
        socket.send(buf, 1, 3, port, address, sendCallback);
        socket.send(buf, 3, 1, port, address, sendCallback);
        // Since length of zero means nothing, don't error despite OOB.
        socket.send(buf, 4, 0, port, address, sendCallback);

        socket.close();

        // We expect the sendCallback to not be called
        expect(sendCallback).not.toHaveBeenCalled();

        resolve();
      });
    });
  });
});

//<#END_FILE: test-dgram-oob-buffer.js
