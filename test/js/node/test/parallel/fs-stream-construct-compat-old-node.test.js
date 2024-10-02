//#FILE: test-fs-stream-construct-compat-old-node.js
//#SHA1: b26c68c20ca3cb4018d7da49ce9f6936deafb9f4
//-----------------
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const fixturesPath = path.join(__dirname, '..', 'fixtures');
const tmpdir = path.join(os.tmpdir(), 'jest-fs-stream-construct-compat-old-node');

beforeAll(() => {
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpdir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test('ReadStream compatibility with old node', (done) => {
  function ReadStream(...args) {
    fs.ReadStream.call(this, ...args);
  }
  Object.setPrototypeOf(ReadStream.prototype, fs.ReadStream.prototype);
  Object.setPrototypeOf(ReadStream, fs.ReadStream);

  const openMock = jest.fn(function() {
    fs.open(this.path, this.flags, this.mode, (er, fd) => {
      if (er) {
        if (this.autoClose) {
          this.destroy();
        }
        this.emit('error', er);
        return;
      }

      this.fd = fd;
      this.emit('open', fd);
      this.emit('ready');
    });
  });

  ReadStream.prototype.open = openMock;

  let readyCalled = false;
  let openCalled = false;
  const r = new ReadStream(path.join(fixturesPath, 'x.txt'))
    .on('ready', () => {
      readyCalled = true;
      expect(openCalled).toBe(true);
      if (openCalled && readyCalled) {
        r.destroy();
        done();
      }
    })
    .on('error', (err) => {
      done(err);
    })
    .on('open', (fd) => {
      openCalled = true;
      expect(readyCalled).toBe(false);
      expect(fd).toBe(r.fd);
      if (openCalled && readyCalled) {
        r.destroy();
        done();
      }
    });
}, 10000);

test('WriteStream compatibility with old node', (done) => {
  function WriteStream(...args) {
    fs.WriteStream.call(this, ...args);
  }
  Object.setPrototypeOf(WriteStream.prototype, fs.WriteStream.prototype);
  Object.setPrototypeOf(WriteStream, fs.WriteStream);

  const openMock = jest.fn(function() {
    fs.open(this.path, this.flags, this.mode, (er, fd) => {
      if (er) {
        if (this.autoClose) {
          this.destroy();
        }
        this.emit('error', er);
        return;
      }

      this.fd = fd;
      this.emit('open', fd);
      this.emit('ready');
    });
  });

  WriteStream.prototype.open = openMock;

  let readyCalled = false;
  let openCalled = false;
  const w = new WriteStream(path.join(tmpdir, 'dummy'))
    .on('ready', () => {
      readyCalled = true;
      expect(openCalled).toBe(true);
      if (openCalled && readyCalled) {
        w.destroy();
        done();
      }
    })
    .on('error', (err) => {
      done(err);
    })
    .on('open', (fd) => {
      openCalled = true;
      expect(readyCalled).toBe(false);
      expect(fd).toBe(w.fd);
      if (openCalled && readyCalled) {
        w.destroy();
        done();
      }
    });
}, 10000);

//<#END_FILE: test-fs-stream-construct-compat-old-node.js
