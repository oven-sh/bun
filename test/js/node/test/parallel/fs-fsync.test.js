//#FILE: test-fs-fsync.js
//#SHA1: 4225be75eaedfd17c32e0472e6739ba232b7f28e
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
const os = require('os');

const fileFixture = path.join(__dirname, '..', 'fixtures', 'a.js');
const tmpdir = path.join(os.tmpdir(), 'test-fs-fsync');
const fileTemp = path.join(tmpdir, 'a.js');

beforeAll(() => {
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpdir, { recursive: true });
  fs.copyFileSync(fileFixture, fileTemp);
});

afterAll(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test('fsync and fdatasync operations', (done) => {
  fs.open(fileTemp, 'a', 0o777, (err, fd) => {
    expect(err).toBeNull();

    fs.fdatasyncSync(fd);
    fs.fsyncSync(fd);

    fs.fdatasync(fd, (err) => {
      expect(err).toBeNull();
      fs.fsync(fd, (err) => {
        expect(err).toBeNull();
        fs.closeSync(fd);
        done();
      });
    });
  });
});

test('invalid inputs throw TypeError', () => {
  const invalidInputs = ['', false, null, undefined, {}, []];
  const errObj = {
    code: 'ERR_INVALID_ARG_TYPE',
    name: 'TypeError'
  };

  invalidInputs.forEach((input) => {
    expect(() => fs.fdatasync(input)).toThrow(expect.objectContaining(errObj));
    expect(() => fs.fdatasyncSync(input)).toThrow(expect.objectContaining(errObj));
    expect(() => fs.fsync(input)).toThrow(expect.objectContaining(errObj));
    expect(() => fs.fsyncSync(input)).toThrow(expect.objectContaining(errObj));
  });
});

//<#END_FILE: test-fs-fsync.js
