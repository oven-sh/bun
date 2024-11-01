//#FILE: test-fs-readfile-fd.js
//#SHA1: ec2bc78cb0bab7b8e9b23c1c44a77b227294d8b4
//-----------------
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpdir = path.join(os.tmpdir(), 'test-fs-readfile-fd');
const emptyFilePath = path.join(tmpdir, 'empty.txt');

beforeAll(() => {
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpdir, { recursive: true });
  fs.writeFileSync(emptyFilePath, '');
});

afterAll(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

function tempFd(callback) {
  fs.open(emptyFilePath, 'r', (err, fd) => {
    expect(err).toBeFalsy();
    callback(fd, () => {
      fs.close(fd, (err) => {
        expect(err).toBeFalsy();
      });
    });
  });
}

function tempFdSync(callback) {
  const fd = fs.openSync(emptyFilePath, 'r');
  callback(fd);
  fs.closeSync(fd);
}

test('fs.readFile with file descriptor', (done) => {
  tempFd((fd, close) => {
    fs.readFile(fd, (err, data) => {
      expect(data).toBeTruthy();
      close();
      done();
    });
  });
});

test('fs.readFile with file descriptor and utf8 encoding', (done) => {
  tempFd((fd, close) => {
    fs.readFile(fd, 'utf8', (err, data) => {
      expect(data).toBe('');
      close();
      done();
    });
  });
});

test('fs.readFileSync with file descriptor', () => {
  tempFdSync((fd) => {
    expect(fs.readFileSync(fd)).toBeTruthy();
  });
});

test('fs.readFileSync with file descriptor and utf8 encoding', () => {
  tempFdSync((fd) => {
    expect(fs.readFileSync(fd, 'utf8')).toBe('');
  });
});

test('readFile() reads from current position of file descriptor', (done) => {
  const filename = path.join(tmpdir, 'test.txt');
  fs.writeFileSync(filename, 'Hello World');

  fs.open(filename, 'r', (err, fd) => {
    expect(err).toBeFalsy();
    const buf = Buffer.alloc(5);

    fs.read(fd, buf, 0, 5, null, (err, bytes) => {
      expect(err).toBeFalsy();
      expect(bytes).toBe(5);
      expect(buf.toString()).toBe('Hello');

      fs.readFile(fd, (err, data) => {
        expect(err).toBeFalsy();
        expect(data.toString()).toBe(' World');
        fs.closeSync(fd);
        done();
      });
    });
  });
});

test('readFileSync() reads from current position of file descriptor', () => {
  const filename = path.join(tmpdir, 'test.txt');
  fs.writeFileSync(filename, 'Hello World');

  const fd = fs.openSync(filename, 'r');

  const buf = Buffer.alloc(5);
  expect(fs.readSync(fd, buf, 0, 5)).toBe(5);
  expect(buf.toString()).toBe('Hello');

  expect(fs.readFileSync(fd).toString()).toBe(' World');

  fs.closeSync(fd);
});

//<#END_FILE: test-fs-readfile-fd.js
