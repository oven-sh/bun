//#FILE: test-fs-promises-readfile-with-fd.js
//#SHA1: 041811f02dddcdb9eba7d97e3943e26ec6b881cd
//-----------------
'use strict';

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const os = require('os');

const tmpdir = path.join(os.tmpdir(), 'test-fs-promises-readfile-with-fd');
const fn = path.join(tmpdir, 'test.txt');

beforeAll(() => {
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpdir, { recursive: true });
  fs.writeFileSync(fn, 'Hello World');
});

afterAll(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test('readFile() reads from current position of the file', async () => {
  const handle = await fsPromises.open(fn, 'r');

  // Read only five bytes, so that the position moves to five.
  const buf = Buffer.alloc(5);
  const { bytesRead } = await handle.read(buf, 0, 5, null);
  expect(bytesRead).toBe(5);
  expect(buf.toString()).toBe('Hello');

  // readFile() should read from position five, instead of zero.
  expect((await handle.readFile()).toString()).toBe(' World');

  await handle.close();
});

//<#END_FILE: test-fs-promises-readfile-with-fd.js
