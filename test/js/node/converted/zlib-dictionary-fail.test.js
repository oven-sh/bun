//#FILE: test-zlib-dictionary-fail.js
//#SHA1: e9c6d383f9b0a202067a125c016f1ef3cd5be558
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

'use strict';
const zlib = require('zlib');

// String "test" encoded with dictionary "dict".
const input = Buffer.from([0x78, 0xBB, 0x04, 0x09, 0x01, 0xA5]);

test('Inflate stream without dictionary', (done) => {
  const stream = zlib.createInflate();

  stream.on('error', (err) => {
    expect(err.message).toMatch(/Missing dictionary/);
    done();
  });

  stream.write(input);
});

test('Inflate stream with incorrect dictionary', (done) => {
  const stream = zlib.createInflate({ dictionary: Buffer.from('fail') });

  stream.on('error', (err) => {
    expect(err.message).toMatch(/Bad dictionary/);
    done();
  });

  stream.write(input);
});

test('InflateRaw stream with incorrect dictionary', (done) => {
  const stream = zlib.createInflateRaw({ dictionary: Buffer.from('fail') });

  stream.on('error', (err) => {
    // It's not possible to separate invalid dict and invalid data when using
    // the raw format
    expect(err.message).toMatch(/(invalid|Operation-Ending-Supplemental Code is 0x12)/);
    done();
  });

  stream.write(input);
});