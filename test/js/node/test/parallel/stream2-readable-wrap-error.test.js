//#FILE: test-stream2-readable-wrap-error.js
//#SHA1: fee6479f564570c7f3a01c9bee6b859ce84c2df2
//-----------------
'use strict';

const { Readable } = require('stream');
const EE = require('events').EventEmitter;

class LegacyStream extends EE {
  pause() {}
  resume() {}
}

test('Readable wrap with autoDestroy: true', (done) => {
  const err = new Error();
  const oldStream = new LegacyStream();
  const errorHandler = jest.fn(() => {
    expect(r._readableState.errorEmitted).toBe(true);
    expect(r._readableState.errored).toBe(err);
    expect(r.destroyed).toBe(true);
    expect(errorHandler).toHaveBeenCalledTimes(1);
    done();
  });

  const r = new Readable({ autoDestroy: true })
    .wrap(oldStream)
    .on('error', errorHandler);

  oldStream.emit('error', err);
});

test('Readable wrap with autoDestroy: false', (done) => {
  const err = new Error();
  const oldStream = new LegacyStream();
  const errorHandler = jest.fn(() => {
    expect(r._readableState.errorEmitted).toBe(true);
    expect(r._readableState.errored).toBe(err);
    expect(r.destroyed).toBe(false);
    expect(errorHandler).toHaveBeenCalledTimes(1);
    done();
  });

  const r = new Readable({ autoDestroy: false })
    .wrap(oldStream)
    .on('error', errorHandler);

  oldStream.emit('error', err);
});

//<#END_FILE: test-stream2-readable-wrap-error.js
