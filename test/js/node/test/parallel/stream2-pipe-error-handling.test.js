//#FILE: test-stream2-pipe-error-handling.js
//#SHA1: c5e7ad139c64f22b16e8fff8a62f6f91067087c8
//-----------------
'use strict';

const stream = require('stream');

describe('Stream2 Pipe Error Handling', () => {
  test('Error handling with default Writable', () => {
    let count = 1000;

    const source = new stream.Readable();
    source._read = function(n) {
      n = Math.min(count, n);
      count -= n;
      source.push(Buffer.allocUnsafe(n));
    };

    let unpipedDest;
    source.unpipe = function(dest) {
      unpipedDest = dest;
      stream.Readable.prototype.unpipe.call(this, dest);
    };

    const dest = new stream.Writable();
    dest._write = function(chunk, encoding, cb) {
      cb();
    };

    source.pipe(dest);

    let gotErr = null;
    dest.on('error', function(err) {
      gotErr = err;
    });

    let unpipedSource;
    dest.on('unpipe', function(src) {
      unpipedSource = src;
    });

    const err = new Error('This stream turned into bacon.');
    dest.emit('error', err);
    expect(gotErr).toBe(err);
    expect(unpipedSource).toBe(source);
    expect(unpipedDest).toBe(dest);
  });

  test('Error handling with Writable autoDestroy: false', () => {
    let count = 1000;

    const source = new stream.Readable();
    source._read = function(n) {
      n = Math.min(count, n);
      count -= n;
      source.push(Buffer.allocUnsafe(n));
    };

    let unpipedDest;
    source.unpipe = function(dest) {
      unpipedDest = dest;
      stream.Readable.prototype.unpipe.call(this, dest);
    };

    const dest = new stream.Writable({ autoDestroy: false });
    dest._write = function(chunk, encoding, cb) {
      cb();
    };

    source.pipe(dest);

    let unpipedSource;
    dest.on('unpipe', function(src) {
      unpipedSource = src;
    });

    const err = new Error('This stream turned into bacon.');

    let gotErr = null;
    dest.on('error', function(e) {
      gotErr = e;
    });

    dest.emit('error', err);
    
    expect(gotErr).toBe(err);
    expect(unpipedSource).toBe(source);
    expect(unpipedDest).toBe(dest);
  });
});

//<#END_FILE: test-stream2-pipe-error-handling.js
