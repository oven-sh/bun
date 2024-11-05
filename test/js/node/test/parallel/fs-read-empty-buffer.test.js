//#FILE: test-fs-read-empty-buffer.js
//#SHA1: a2dc2c25e5a712b62c41298f885df24dd6106646
//-----------------
'use strict';
const fs = require('fs');
const path = require('path');

const filepath = path.resolve(__dirname, 'x.txt');
let fd;

beforeAll(() => {
  // Create a test file
  fs.writeFileSync(filepath, 'test content');
  fd = fs.openSync(filepath, 'r');
});

afterAll(() => {
  fs.closeSync(fd);
  fs.unlinkSync(filepath);
});

const buffer = new Uint8Array();

test('fs.readSync throws ERR_INVALID_ARG_VALUE for empty buffer', () => {
  expect(() => fs.readSync(fd, buffer, 0, 10, 0)).toThrow(expect.objectContaining({
    code: 'ERR_INVALID_ARG_VALUE',
    message: expect.stringContaining('The argument \'buffer\' is empty and cannot be written')
  }));
});

test('fs.read throws ERR_INVALID_ARG_VALUE for empty buffer', () => {
  expect(() => fs.read(fd, buffer, 0, 1, 0, () => {})).toThrow(expect.objectContaining({
    code: 'ERR_INVALID_ARG_VALUE',
    message: expect.stringContaining('The argument \'buffer\' is empty and cannot be written')
  }));
});

test('fsPromises.filehandle.read rejects with ERR_INVALID_ARG_VALUE for empty buffer', async () => {
  const filehandle = await fs.promises.open(filepath, 'r');
  await expect(filehandle.read(buffer, 0, 1, 0)).rejects.toThrow(expect.objectContaining({
    code: 'ERR_INVALID_ARG_VALUE',
    message: expect.stringContaining('The argument \'buffer\' is empty and cannot be written')
  }));
  await filehandle.close();
});

//<#END_FILE: test-fs-read-empty-buffer.js
