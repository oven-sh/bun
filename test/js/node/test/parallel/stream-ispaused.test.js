//#FILE: test-stream-ispaused.js
//#SHA1: af3a0e2cf2d770bbd09100f422f42667a9d39285
//-----------------
'use strict';

const stream = require('stream');

describe('Stream isPaused', () => {
  let readable;

  beforeEach(() => {
    readable = new stream.Readable();
    // _read is a noop, here.
    readable._read = jest.fn();
  });

  test('Default state of a stream is not "paused"', () => {
    expect(readable.isPaused()).toBe(false);
  });

  test('Stream is not paused after attaching "data" event listener', () => {
    // Make the stream start flowing...
    readable.on('data', jest.fn());
    expect(readable.isPaused()).toBe(false);
  });

  test('Stream is paused after calling pause()', () => {
    readable.pause();
    expect(readable.isPaused()).toBe(true);
  });

  test('Stream is not paused after calling resume()', () => {
    readable.pause();
    readable.resume();
    expect(readable.isPaused()).toBe(false);
  });
});

//<#END_FILE: test-stream-ispaused.js
