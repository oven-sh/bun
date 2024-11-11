//#FILE: test-stream-readable-reading-readingMore.js
//#SHA1: 6238e66578495f08d54243a81308f8be9d647261
//-----------------
'use strict';
const { Readable } = require('stream');

describe('Readable Stream reading and readingMore states', () => {
  test('with readable listener', (done) => {
    const readable = new Readable({
      read(size) {}
    });

    const state = readable._readableState;

    expect(state.reading).toBe(false);
    expect(state.readingMore).toBe(false);

    let dataCallCount = 0;
    readable.on('data', (data) => {
      if (readable.readableFlowing)
        expect(state.readingMore).toBe(true);

      expect(state.reading).toBe(!state.ended);
      dataCallCount++;
    });

    function onStreamEnd() {
      expect(state.readingMore).toBe(false);
      expect(state.reading).toBe(false);
    }

    const expectedReadingMore = [true, true, false];
    let readableCallCount = 0;
    readable.on('readable', () => {
      expect(state.readingMore).toBe(expectedReadingMore.shift());
      expect(state.ended).toBe(!state.reading);

      while (readable.read() !== null);

      if (expectedReadingMore.length === 0)
        process.nextTick(onStreamEnd);
      
      readableCallCount++;
      if (readableCallCount === 3) done();
    });

    readable.on('end', onStreamEnd);
    readable.push('pushed');

    readable.read(6);

    expect(state.reading).toBe(true);
    expect(state.readingMore).toBe(true);

    readable.unshift('unshifted');
    readable.push(null);
  });

  test('without readable listener', (done) => {
    const readable = new Readable({
      read(size) {}
    });

    const state = readable._readableState;

    expect(state.reading).toBe(false);
    expect(state.readingMore).toBe(false);

    let dataCallCount = 0;
    readable.on('data', (data) => {
      if (readable.readableFlowing)
        expect(state.readingMore).toBe(true);

      expect(state.reading).toBe(!state.ended);
      dataCallCount++;
      if (dataCallCount === 2) done();
    });

    function onStreamEnd() {
      expect(state.readingMore).toBe(false);
      expect(state.reading).toBe(false);
    }

    readable.on('end', onStreamEnd);
    readable.push('pushed');

    expect(state.flowing).toBe(true);
    readable.pause();

    expect(state.reading).toBe(false);
    expect(state.flowing).toBe(false);

    readable.resume();
    expect(state.reading).toBe(false);
    expect(state.flowing).toBe(true);

    readable.unshift('unshifted');
    readable.push(null);
  });

  test('with removed readable listener', (done) => {
    const readable = new Readable({
      read(size) {}
    });

    const state = readable._readableState;

    expect(state.reading).toBe(false);
    expect(state.readingMore).toBe(false);

    const onReadable = jest.fn();
    readable.on('readable', onReadable);

    let dataCallCount = 0;
    readable.on('data', (data) => {
      expect(state.reading).toBe(!state.ended);
      dataCallCount++;
      if (dataCallCount === 2) done();
    });

    readable.removeListener('readable', onReadable);

    function onStreamEnd() {
      expect(state.readingMore).toBe(false);
      expect(state.reading).toBe(false);
    }

    readable.on('end', onStreamEnd);
    readable.push('pushed');

    expect(state.flowing).toBe(false);

    jest.useRealTimers();
    process.nextTick(() => {
      readable.resume();

      expect(state.flowing).toBe(true);
      readable.pause();

      expect(state.flowing).toBe(false);

      readable.resume();
      expect(state.flowing).toBe(true);

      readable.unshift('unshifted');
      readable.push(null);
    });
  });
});

//<#END_FILE: test-stream-readable-reading-readingMore.js
