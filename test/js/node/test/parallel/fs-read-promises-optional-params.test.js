//#FILE: test-fs-read-promises-optional-params.js
//#SHA1: bc986664534329fd86b9aafd4c73a0159f71d388
//-----------------
'use strict';

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const read = promisify(fs.read);

const filepath = path.resolve(__dirname, 'x.txt');
let fd;

const expected = Buffer.from('xyz\n');
const defaultBufferAsync = Buffer.alloc(16384);
const bufferAsOption = Buffer.allocUnsafe(expected.byteLength);

beforeAll(() => {
  // Create the test file
  fs.writeFileSync(filepath, expected);
  fd = fs.openSync(filepath, 'r');
});

afterAll(() => {
  fs.closeSync(fd);
  fs.unlinkSync(filepath);
});

test('read with empty options object', async () => {
  const { bytesRead, buffer } = await read(fd, {});
  expect(bytesRead).toBe(expected.byteLength);
  expect(buffer.byteLength).toBe(defaultBufferAsync.byteLength);
});

test('read with buffer and position options', async () => {
  const { bytesRead, buffer } = await read(fd, bufferAsOption, { position: 0 });
  expect(bytesRead).toBe(expected.byteLength);
  expect(buffer.byteLength).toBe(bufferAsOption.byteLength);
});

//<#END_FILE: test-fs-read-promises-optional-params.js
