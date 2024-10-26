//#FILE: test-stream-writable-writable.js
//#SHA1: 9ba050952c8c8fb466d30733582c8b1bc607493f
//-----------------
'use strict';

const { Writable } = require('stream');

test('Writable stream is writable until destroyed', () => {
  const w = new Writable({
    write() {}
  });
  expect(w.writable).toBe(true);
  w.destroy();
  expect(w.writable).toBe(false);
});

test('Writable stream is not writable after error', (done) => {
  const w = new Writable({
    write(chunk, encoding, callback) {
      callback(new Error());
    }
  });
  expect(w.writable).toBe(true);
  w.write('asd');
  w.on('error', () => {
    expect(w.writable).toBe(false);
    done();
  });
});

test('Writable stream is not writable after async error', (done) => {
  const w = new Writable({
    write(chunk, encoding, callback) {
      process.nextTick(() => {
        callback(new Error());
      });
    }
  });
  w.write('asd');
  w.on('error', () => {
    expect(w.writable).toBe(false);
    done();
  });
});

test('Writable stream is not writable after end', () => {
  const w = new Writable({
    write() {}
  });
  expect(w.writable).toBe(true);
  w.end();
  expect(w.writable).toBe(false);
});

//<#END_FILE: test-stream-writable-writable.js
