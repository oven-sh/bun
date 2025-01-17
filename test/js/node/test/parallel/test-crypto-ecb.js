/*
Skipped test
https://github.com/electron/electron/blob/5680c628b6718385bbd975b51ec2640aa7df226b/script/node-disabled-tests.json#L17

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

'use strict';
const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

if (common.hasFipsCrypto)
  common.skip('BF-ECB is not FIPS 140-2 compatible');

if (common.hasOpenSSL3)
  common.skip('Blowfish is only available with the legacy provider in ' +
    'OpenSSl 3.x');

const assert = require('assert');
const crypto = require('crypto');

// Testing whether EVP_CipherInit_ex is functioning correctly.
// Reference: bug#1997

{
  const encrypt =
    crypto.createCipheriv('BF-ECB', 'SomeRandomBlahz0c5GZVnR', '');
  let hex = encrypt.update('Hello World!', 'ascii', 'hex');
  hex += encrypt.final('hex');
  assert.strictEqual(hex.toUpperCase(), '6D385F424AAB0CFBF0BB86E07FFB7D71');
}

{
  const decrypt =
    crypto.createDecipheriv('BF-ECB', 'SomeRandomBlahz0c5GZVnR', '');
  let msg = decrypt.update('6D385F424AAB0CFBF0BB86E07FFB7D71', 'hex', 'ascii');
  msg += decrypt.final('ascii');
  assert.strictEqual(msg, 'Hello World!');
}

*/