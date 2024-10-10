//#FILE: test-fs-non-number-arguments-throw.js
//#SHA1: 65db5c653216831bc16d38c5d659fbffa296d3d8
//-----------------
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpdir = path.join(os.tmpdir(), 'test-fs-non-number-arguments-throw');
const tempFile = path.join(tmpdir, 'fs-non-number-arguments-throw');

beforeAll(() => {
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpdir, { recursive: true });
  fs.writeFileSync(tempFile, 'abc\ndef');
});

afterAll(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test('createReadStream with valid number arguments', (done) => {
  const sanity = 'def';
  const saneEmitter = fs.createReadStream(tempFile, { start: 4, end: 6 });

  saneEmitter.on('data', (data) => {
    expect(data.toString('utf8')).toBe(sanity);
    done();
  });
});

test('createReadStream throws with string start argument', () => {
  expect(() => {
    fs.createReadStream(tempFile, { start: '4', end: 6 });
  }).toThrow(expect.objectContaining({
    code: 'ERR_INVALID_ARG_TYPE',
    name: 'TypeError',
    message: expect.any(String)
  }));
});

test('createReadStream throws with string end argument', () => {
  expect(() => {
    fs.createReadStream(tempFile, { start: 4, end: '6' });
  }).toThrow(expect.objectContaining({
    code: 'ERR_INVALID_ARG_TYPE',
    name: 'TypeError',
    message: expect.any(String)
  }));
});

test('createWriteStream throws with string start argument', () => {
  expect(() => {
    fs.createWriteStream(tempFile, { start: '4' });
  }).toThrow(expect.objectContaining({
    code: 'ERR_INVALID_ARG_TYPE',
    name: 'TypeError',
    message: expect.any(String)
  }));
});

//<#END_FILE: test-fs-non-number-arguments-throw.js
