//#FILE: test-fs-readfile-empty.js
//#SHA1: a78ffc8186bc3e0a7d8d8dcf0f292ef4220817a5
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

const fs = require('fs');
const path = require('path');

const fixturesPath = path.join(__dirname, '..', 'fixtures');
const fn = path.join(fixturesPath, 'empty.txt');

test('fs.readFile on an empty file', (done) => {
  fs.readFile(fn, (err, data) => {
    expect(err).toBeNull();
    expect(data).toBeTruthy();
    done();
  });
});

test('fs.readFile on an empty file with utf8 encoding', (done) => {
  fs.readFile(fn, 'utf8', (err, data) => {
    expect(err).toBeNull();
    expect(data).toBe('');
    done();
  });
});

test('fs.readFile on an empty file with encoding option', (done) => {
  fs.readFile(fn, { encoding: 'utf8' }, (err, data) => {
    expect(err).toBeNull();
    expect(data).toBe('');
    done();
  });
});

test('fs.readFileSync on an empty file', () => {
  const data = fs.readFileSync(fn);
  expect(data).toBeTruthy();
});

test('fs.readFileSync on an empty file with utf8 encoding', () => {
  const data = fs.readFileSync(fn, 'utf8');
  expect(data).toBe('');
});

//<#END_FILE: test-fs-readfile-empty.js
