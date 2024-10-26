//#FILE: test-stream-writable-finished.js
//#SHA1: 20d27885cc10a6787d3e6c6fb877c0aba2310f93
//-----------------
'use strict';

const { Writable } = require('stream');

// basic
test('Writable.prototype has writableFinished', () => {
  expect(Object.hasOwn(Writable.prototype, 'writableFinished')).toBe(true);
});

// event
test('writableFinished state changes correctly', (done) => {
  const writable = new Writable();

  writable._write = (chunk, encoding, cb) => {
    // The state finished should start in false.
    expect(writable.writableFinished).toBe(false);
    cb();
  };

  writable.on('finish', () => {
    expect(writable.writableFinished).toBe(true);
    done();
  });

  writable.end('testing finished state', () => {
    expect(writable.writableFinished).toBe(true);
  });
});

test('Emit finish asynchronously', (done) => {
  const w = new Writable({
    write(chunk, encoding, cb) {
      cb();
    }
  });

  w.end();
  w.on('finish', done);
});

test('Emit prefinish synchronously', (done) => {
  const w = new Writable({
    write(chunk, encoding, cb) {
      cb();
    }
  });

  let sync = true;
  w.on('prefinish', () => {
    expect(sync).toBe(true);
    done();
  });
  w.end();
  sync = false;
});

test('Emit prefinish synchronously w/ final', (done) => {
  const w = new Writable({
    write(chunk, encoding, cb) {
      cb();
    },
    final(cb) {
      cb();
    }
  });

  let sync = true;
  w.on('prefinish', () => {
    expect(sync).toBe(true);
    done();
  });
  w.end();
  sync = false;
});

test('Call _final synchronously', (done) => {
  let sync = true;
  const w = new Writable({
    write(chunk, encoding, cb) {
      cb();
    },
    final: (cb) => {
      expect(sync).toBe(true);
      cb();
      done();
    }
  });

  w.end();
  sync = false;
});

//<#END_FILE: test-stream-writable-finished.js
