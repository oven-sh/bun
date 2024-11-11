//#FILE: test-stream-writable-end-cb-error.js
//#SHA1: 2e46c0660599d9acd4a889fbdc906a6ecbbc1acf
//-----------------
'use strict';

const stream = require('stream');

test('Invoke end callback on failure', (done) => {
  const writable = new stream.Writable();

  const _err = new Error('kaboom');
  writable._write = (chunk, encoding, cb) => {
    setImmediate(cb, _err);
  };

  writable.on('error', (err) => {
    expect(err).toBe(_err);
  });
  writable.write('asd');
  writable.end((err) => {
    expect(err).toBe(_err);
  });
  writable.end((err) => {
    expect(err).toBe(_err);
    done();
  });
});

test("Don't invoke end callback twice", (done) => {
  const writable = new stream.Writable();

  writable._write = (chunk, encoding, cb) => {
    setImmediate(cb);
  };

  let called = false;
  writable.end('asd', (err) => {
    called = true;
    expect(err).toBeNull();
  });

  writable.on('error', (err) => {
    expect(err.message).toBe('kaboom');
  });
  writable.on('finish', () => {
    expect(called).toBe(true);
    writable.emit('error', new Error('kaboom'));
    done();
  });
});

test('Handle ended state and errors', (done) => {
  const w = new stream.Writable({
    write(chunk, encoding, callback) {
      setImmediate(callback);
    },
    finish(callback) {
      setImmediate(callback);
    }
  });
  w.end('testing ended state', (err) => {
    expect(err.code).toBe('ERR_STREAM_WRITE_AFTER_END');
  });
  expect(w.destroyed).toBe(false);
  expect(w.writableEnded).toBe(true);
  w.end((err) => {
    expect(err.code).toBe('ERR_STREAM_WRITE_AFTER_END');
  });
  expect(w.destroyed).toBe(false);
  expect(w.writableEnded).toBe(true);
  w.end('end', (err) => {
    expect(err.code).toBe('ERR_STREAM_WRITE_AFTER_END');
  });
  expect(w.destroyed).toBe(true);
  w.on('error', (err) => {
    expect(err.code).toBe('ERR_STREAM_WRITE_AFTER_END');
    done();
  });
  w.on('finish', () => {
    done.fail('finish should not be called');
  });
});

//<#END_FILE: test-stream-writable-end-cb-error.js
