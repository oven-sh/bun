//#FILE: test-stream2-readable-wrap-empty.js
//#SHA1: aaac82ec7df0743321f2aaacd9512ecf1b932ad6
//-----------------
'use strict';

const { Readable } = require('stream');
const EE = require('events').EventEmitter;

test('Readable.wrap with empty stream', (done) => {
  const oldStream = new EE();
  oldStream.pause = jest.fn();
  oldStream.resume = jest.fn();

  const newStream = new Readable().wrap(oldStream);

  const onEnd = jest.fn(() => {
    expect(onEnd).toHaveBeenCalled();
    done();
  });

  newStream
    .on('readable', () => {})
    .on('end', onEnd);

  oldStream.emit('end');
});

//<#END_FILE: test-stream2-readable-wrap-empty.js
