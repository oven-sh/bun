//#FILE: test-stream-writable-destroy.js
//#SHA1: 7cd4d2a2d9fafef7ec57eef846c45090ec17b26f
//-----------------
'use strict';

const { Writable, addAbortSignal } = require('stream');

describe('Writable Stream Destroy', () => {
  test('destroy without error', (done) => {
    const write = new Writable({
      write(chunk, enc, cb) { cb(); }
    });

    write.on('finish', () => {
      done.fail('should not emit finish');
    });
    write.on('close', done);

    write.destroy();
    expect(write.destroyed).toBe(true);
  });

  test('destroy in write', (done) => {
    const write = new Writable({
      write(chunk, enc, cb) {
        this.destroy(new Error('asd'));
        cb();
      }
    });

    write.on('error', (err) => {
      expect(err.message).toBe('asd');
      expect(write.destroyed).toBe(true);
      done();
    });
    write.on('finish', () => {
      done.fail('should not emit finish');
    });
    write.end('asd');
  });

  test('destroy with error', (done) => {
    const write = new Writable({
      write(chunk, enc, cb) { cb(); }
    });

    const expected = new Error('kaboom');

    write.on('finish', () => {
      done.fail('should not emit finish');
    });
    write.on('close', () => {
      done();
    });
    write.on('error', (err) => {
      expect(err).toBe(expected);
    });

    write.destroy(expected);
    expect(write.destroyed).toBe(true);
  });

  test('destroy with custom _destroy', (done) => {
    const write = new Writable({
      write(chunk, enc, cb) { cb(); }
    });

    const expected = new Error('kaboom');

    write._destroy = function(err, cb) {
      expect(err).toBe(expected);
      cb(err);
    };

    write.on('finish', () => {
      done.fail('should not emit finish');
    });
    write.on('close', () => {
      done();
    });
    write.on('error', (err) => {
      expect(err).toBe(expected);
    });

    write.destroy(expected);
    expect(write.destroyed).toBe(true);
  });

  // SKIP: asyncDispose is not available in this version of Node.js
  test.skip('destroy and asyncDispose', () => {
    // This test is skipped because Symbol.asyncDispose is not available
  });
});

//<#END_FILE: test-stream-writable-destroy.js
