//#FILE: test-stream-readableListening-state.js
//#SHA1: f67eea4ad477e9c0e52215f4afbd8fc8df55b891
//-----------------
'use strict';

const stream = require('stream');

describe('Readable Stream readableListening state', () => {
  test('readableListening state with "readable" event', (done) => {
    const r = new stream.Readable({
      read: () => {}
    });

    // readableListening state should start in `false`.
    expect(r._readableState.readableListening).toBe(false);

    const readableListener = jest.fn(() => {
      // Inside the readable event this state should be true.
      expect(r._readableState.readableListening).toBe(true);
      done();
    });

    r.on('readable', readableListener);

    r.push(Buffer.from('Testing readableListening state'));

    // Ensure the readable event was called
    setImmediate(() => {
      expect(readableListener).toHaveBeenCalled();
    });
  });

  test('readableListening state with "data" event', (done) => {
    const r2 = new stream.Readable({
      read: () => {}
    });

    // readableListening state should start in `false`.
    expect(r2._readableState.readableListening).toBe(false);

    const dataListener = jest.fn((chunk) => {
      // readableListening should be false because we don't have
      // a `readable` listener
      expect(r2._readableState.readableListening).toBe(false);
      done();
    });

    r2.on('data', dataListener);

    r2.push(Buffer.from('Testing readableListening state'));

    // Ensure the data event was called
    setImmediate(() => {
      expect(dataListener).toHaveBeenCalled();
    });
  });
});

//<#END_FILE: test-stream-readableListening-state.js
