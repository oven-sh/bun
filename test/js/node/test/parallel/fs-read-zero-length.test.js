//#FILE: test-fs-read-zero-length.js
//#SHA1: bda4b0f0c821a8479ffbf0a9099444eed6ee5c4e
//-----------------
'use strict';
const fs = require('fs');
const path = require('path');

const fixturesPath = path.join(__dirname, '..', 'fixtures');
const filepath = path.join(fixturesPath, 'x.txt');

let fd;

beforeAll(() => {
  fd = fs.openSync(filepath, 'r');
});

afterAll(() => {
  fs.closeSync(fd);
});

test('fs.read with zero length buffer (async)', (done) => {
  const bufferAsync = Buffer.alloc(0);

  fs.read(fd, bufferAsync, 0, 0, 0, (err, bytesRead) => {
    expect(err).toBeNull();
    expect(bytesRead).toBe(0);
    expect(bufferAsync).toEqual(Buffer.alloc(0));
    done();
  });
});

test('fs.readSync with zero length buffer', () => {
  const bufferSync = Buffer.alloc(0);

  const bytesRead = fs.readSync(fd, bufferSync, 0, 0, 0);
  
  expect(bufferSync).toEqual(Buffer.alloc(0));
  expect(bytesRead).toBe(0);
});

//<#END_FILE: test-fs-read-zero-length.js
