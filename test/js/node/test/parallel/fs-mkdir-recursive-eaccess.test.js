//#FILE: test-fs-mkdir-recursive-eaccess.js
//#SHA1: 1e0e4f480b7573549c130b4177759bd60adc1890
//-----------------
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const isWindows = process.platform === 'win32';
const isIBMi = process.platform === 'os400';

if (isIBMi) {
  console.log('Skipped: IBMi has a different access permission mechanism');
  process.exit(0);
}

const tmpdir = path.join(os.tmpdir(), 'test-fs-mkdir-recursive-eaccess');

let n = 0;

function makeDirectoryReadOnly(dir) {
  let accessErrorCode = 'EACCES';
  if (isWindows) {
    accessErrorCode = 'EPERM';
    execSync(`icacls ${dir} /deny "everyone:(OI)(CI)(DE,DC,AD,WD)"`);
  } else {
    fs.chmodSync(dir, '444');
  }
  return accessErrorCode;
}

function makeDirectoryWritable(dir) {
  if (isWindows) {
    execSync(`icacls ${dir} /remove:d "everyone"`);
  }
}

beforeAll(() => {
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpdir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test('Synchronous API should return an EACCES/EPERM error with path populated', () => {
  const dir = path.join(tmpdir, `mkdirp_${n++}`);
  fs.mkdirSync(dir);
  const codeExpected = makeDirectoryReadOnly(dir);
  
  expect(() => {
    fs.mkdirSync(path.join(dir, '/foo'), { recursive: true });
  }).toThrow(expect.objectContaining({
    code: codeExpected,
    path: expect.any(String)
  }));

  makeDirectoryWritable(dir);
});

test('Asynchronous API should return an EACCES/EPERM error with path populated', (done) => {
  const dir = path.join(tmpdir, `mkdirp_${n++}`);
  fs.mkdirSync(dir);
  const codeExpected = makeDirectoryReadOnly(dir);
  
  fs.mkdir(path.join(dir, '/bar'), { recursive: true }, (err) => {
    makeDirectoryWritable(dir);
    expect(err).toEqual(expect.objectContaining({
      code: codeExpected,
      path: expect.any(String)
    }));
    done();
  });
});

//<#END_FILE: test-fs-mkdir-recursive-eaccess.js
