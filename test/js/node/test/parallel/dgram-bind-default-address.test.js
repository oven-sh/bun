//#FILE: test-dgram-bind-default-address.js
//#SHA1: f29269b15b1205e37cc43e02b76cc5d8eb3b70be
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

// Skip test in FreeBSD jails since 0.0.0.0 will resolve to default interface
const inFreeBSDJail = process.platform === "freebsd" && process.env.CI === "true";
if (inFreeBSDJail) {
  test.skip("In a FreeBSD jail");
}

test("UDP4 socket bind to default address", async () => {
  const socket = dgram.createSocket("udp4");

  await new Promise(resolve => {
    socket.bind(0, () => {
      const address = socket.address();
      expect(typeof address.port).toBe("number");
      expect(isFinite(address.port)).toBe(true);
      expect(address.port).toBeGreaterThan(0);
      expect(address.address).toBe("0.0.0.0");
      socket.close();
      resolve();
    });
  });
});

const hasIPv6 = (() => {
  try {
    const socket = dgram.createSocket("udp6");
    socket.close();
    return true;
  } catch {
    return false;
  }
})();

if (!hasIPv6) {
  test.skip("udp6 part of test, because no IPv6 support");
} else {
  test("UDP6 socket bind to default address", async () => {
    const socket = dgram.createSocket("udp6");

    await new Promise(resolve => {
      socket.bind(0, () => {
        const address = socket.address();
        expect(typeof address.port).toBe("number");
        expect(isFinite(address.port)).toBe(true);
        expect(address.port).toBeGreaterThan(0);
        let addressValue = address.address;
        if (addressValue === "::ffff:0.0.0.0") addressValue = "::";
        expect(addressValue).toBe("::");
        socket.close();
        resolve();
      });
    });
  });
}

//<#END_FILE: test-dgram-bind-default-address.js
