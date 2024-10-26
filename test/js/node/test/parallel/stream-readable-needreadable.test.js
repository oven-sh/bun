//#FILE: test-stream-readable-needReadable.js
//#SHA1: 301ca49c86e59196821c0fcd419c71f5ffd4a94d
//-----------------
'use strict';
const { Readable } = require('stream');

describe('Readable Stream needReadable', () => {
  test('needReadable behavior for simple readable stream', (done) => {
    const readable = new Readable({
      read: () => {}
    });

    // Initialized to false.
    expect(readable._readableState.needReadable).toBe(false);

    readable.on('readable', () => {
      // When the readable event fires, needReadable is reset.
      expect(readable._readableState.needReadable).toBe(false);
      readable.read();
    });

    // If a readable listener is attached, then a readable event is needed.
    expect(readable._readableState.needReadable).toBe(true);

    readable.push('foo');
    readable.push(null);

    readable.on('end', () => {
      // No need to emit readable anymore when the stream ends.
      expect(readable._readableState.needReadable).toBe(false);
      done();
    });
  });

  test('needReadable behavior for async readable stream', (done) => {
    const asyncReadable = new Readable({
      read: () => {}
    });

    let readableCallCount = 0;
    asyncReadable.on('readable', () => {
      readableCallCount++;
      if (asyncReadable.read() !== null) {
        // After each read(), the buffer is empty.
        // If the stream doesn't end now,
        // then we need to notify the reader on future changes.
        expect(asyncReadable._readableState.needReadable).toBe(true);
      }
      if (readableCallCount === 2) {
        expect(asyncReadable._readableState.needReadable).toBe(false);
        done();
      }
    });

    process.nextTick(() => {
      asyncReadable.push('foooo');
    });
    process.nextTick(() => {
      asyncReadable.push('bar');
    });
    setImmediate(() => {
      asyncReadable.push(null);
    });
  });

  test('needReadable behavior for flowing stream', (done) => {
    const flowing = new Readable({
      read: () => {}
    });

    // Notice this must be above the on('data') call.
    flowing.push('foooo');
    flowing.push('bar');
    flowing.push('quo');
    process.nextTick(() => {
      flowing.push(null);
    });

    let dataCallCount = 0;
    // When the buffer already has enough data, and the stream is
    // in flowing mode, there is no need for the readable event.
    flowing.on('data', (data) => {
      expect(flowing._readableState.needReadable).toBe(false);
      dataCallCount++;
      if (dataCallCount === 3) {
        done();
      }
    });
  });

  test('needReadable behavior for slow producer', (done) => {
    const slowProducer = new Readable({
      read: () => {}
    });

    let readableCallCount = 0;
    slowProducer.on('readable', () => {
      const chunk = slowProducer.read(8);
      const state = slowProducer._readableState;
      if (chunk === null) {
        // The buffer doesn't have enough data, and the stream is not end,
        // we need to notify the reader when data arrives.
        expect(state.needReadable).toBe(true);
      } else {
        expect(state.needReadable).toBe(false);
      }
      readableCallCount++;
      if (readableCallCount === 4) {
        done();
      }
    });

    process.nextTick(() => {
      slowProducer.push('foo');
      process.nextTick(() => {
        slowProducer.push('foo');
        process.nextTick(() => {
          slowProducer.push('foo');
          process.nextTick(() => {
            slowProducer.push(null);
          });
        });
      });
    });
  });
});

//<#END_FILE: test-stream-readable-needReadable.js
