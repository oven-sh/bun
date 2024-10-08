//#FILE: test-fs-empty-readStream.js
//#SHA1: 979f558eb3c86e2d897cb766be1f300bbb0cbf8c
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

const emptyFile = path.join(__dirname, '..', 'fixtures', 'empty.txt');

test('read stream on empty file should not emit data event', (done) => {
  fs.open(emptyFile, 'r', (err, fd) => {
    expect(err).toBeNull();
    const read = fs.createReadStream(emptyFile, { fd });

    const dataHandler = jest.fn();
    read.once('data', dataHandler);

    read.once('end', () => {
      expect(dataHandler).not.toHaveBeenCalled();
      done();
    });
  });
});

test('paused read stream on empty file should not emit data or end events', (done) => {
  fs.open(emptyFile, 'r', (err, fd) => {
    expect(err).toBeNull();
    const read = fs.createReadStream(emptyFile, { fd });

    read.pause();

    const dataHandler = jest.fn();
    read.once('data', dataHandler);

    const endHandler = jest.fn();
    read.once('end', endHandler);

    setTimeout(() => {
      expect(read.isPaused()).toBe(true);
      expect(dataHandler).not.toHaveBeenCalled();
      expect(endHandler).not.toHaveBeenCalled();
      done();
    }, 50);
  });
});

//<#END_FILE: test-fs-empty-readStream.js
