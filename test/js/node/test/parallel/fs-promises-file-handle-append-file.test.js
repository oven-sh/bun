//#FILE: test-fs-promises-file-handle-append-file.js
//#SHA1: 2a1932450418ea18ef00a890342f29ab307006e7
//-----------------
'use strict';

const fs = require('fs');
const { open } = fs.promises;
const path = require('path');
const os = require('os');

const tmpDir = path.join(os.tmpdir(), 'test-fs-promises-file-handle-append-file');

beforeAll(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('FileHandle.appendFile with buffer', async () => {
  const filePath = path.resolve(tmpDir, 'tmp-append-file-buffer.txt');
  const fileHandle = await open(filePath, 'a');
  const buffer = Buffer.from('a&Dp'.repeat(100), 'utf8');

  await fileHandle.appendFile(buffer);
  const appendedFileData = fs.readFileSync(filePath);
  expect(appendedFileData).toEqual(buffer);

  await fileHandle.close();
});

test('FileHandle.appendFile with string', async () => {
  const filePath = path.resolve(tmpDir, 'tmp-append-file-string.txt');
  const fileHandle = await open(filePath, 'a');
  const string = 'x~yz'.repeat(100);

  await fileHandle.appendFile(string);
  const stringAsBuffer = Buffer.from(string, 'utf8');
  const appendedFileData = fs.readFileSync(filePath);
  expect(appendedFileData).toEqual(stringAsBuffer);

  await fileHandle.close();
});

//<#END_FILE: test-fs-promises-file-handle-append-file.js
