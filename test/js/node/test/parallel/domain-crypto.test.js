//#FILE: test-domain-crypto.js
//#SHA1: d7d6352f0f2684220baef0cfa1029278c3f05f8f
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

const crypto = require("crypto");

// Pollution of global is intentional as part of test.
// See https://github.com/nodejs/node/commit/d1eff9ab
global.domain = require("domain");

describe("domain-crypto", () => {
  beforeAll(() => {
    if (!crypto) {
      test.skip("node compiled without OpenSSL.");
    }
  });

  test("crypto.randomBytes should not throw", () => {
    expect(() => crypto.randomBytes(8)).not.toThrow();
  });

  test("crypto.randomBytes with callback should succeed", () => {
    return new Promise(resolve => {
      crypto.randomBytes(8, (err, buffer) => {
        expect(err).toBeNull();
        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBe(8);
        resolve();
      });
    });
  });

  test("crypto.randomFillSync should not throw", () => {
    const buf = Buffer.alloc(8);
    expect(() => crypto.randomFillSync(buf)).not.toThrow();
  });

  test("crypto.pseudoRandomBytes should not throw", () => {
    expect(() => crypto.pseudoRandomBytes(8)).not.toThrow();
  });

  test("crypto.pseudoRandomBytes with callback should succeed", () => {
    return new Promise(resolve => {
      crypto.pseudoRandomBytes(8, (err, buffer) => {
        expect(err).toBeNull();
        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBe(8);
        resolve();
      });
    });
  });

  test("crypto.pbkdf2 should succeed", () => {
    return new Promise(resolve => {
      crypto.pbkdf2("password", "salt", 8, 8, "sha1", (err, derivedKey) => {
        expect(err).toBeNull();
        expect(derivedKey).toBeInstanceOf(Buffer);
        expect(derivedKey.length).toBe(8);
        resolve();
      });
    });
  });
});

//<#END_FILE: test-domain-crypto.js
