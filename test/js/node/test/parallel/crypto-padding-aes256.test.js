//#FILE: test-crypto-padding-aes256.js
//#SHA1: 96fb5beb94bedbc768788ba2726dcd0e61733c5a
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

const iv = Buffer.from("00000000000000000000000000000000", "hex");
const key = Buffer.from("0123456789abcdef0123456789abcdef" + "0123456789abcdef0123456789abcdef", "hex");

function encrypt(val, pad) {
  const c = crypto.createCipheriv("aes256", key, iv);
  c.setAutoPadding(pad);
  return c.update(val, "utf8", "latin1") + c.final("latin1");
}

function decrypt(val, pad) {
  const c = crypto.createDecipheriv("aes256", key, iv);
  c.setAutoPadding(pad);
  return c.update(val, "latin1", "utf8") + c.final("utf8");
}

test("AES256 encryption and decryption with no padding (multiple of block size)", () => {
  // echo 0123456789abcdef0123456789abcdef \
  // | openssl enc -e -aes256 -nopad -K <key> -iv <iv> \
  // | openssl enc -d -aes256 -nopad -K <key> -iv <iv>
  const plaintext = "0123456789abcdef0123456789abcdef"; // Multiple of block size
  const encrypted = encrypt(plaintext, false);
  const decrypted = decrypt(encrypted, false);
  expect(decrypted).toBe(plaintext);
});

test("AES256 encryption and decryption with padding (not a multiple of block size)", () => {
  // echo 0123456789abcdef0123456789abcde \
  // | openssl enc -e -aes256 -K <key> -iv <iv> \
  // | openssl enc -d -aes256 -K <key> -iv <iv>
  const plaintext = "0123456789abcdef0123456789abcde"; // not a multiple
  const encrypted = encrypt(plaintext, true);
  const decrypted = decrypt(encrypted, true);
  expect(decrypted).toBe(plaintext);
});

//<#END_FILE: test-crypto-padding-aes256.js
