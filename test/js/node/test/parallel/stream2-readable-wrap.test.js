//#FILE: test-stream2-readable-wrap.js
//#SHA1: 05d7538e1f9caaf625905dee517533ff1235776d
//-----------------
'use strict';

const { Readable, Writable } = require('stream');
const EventEmitter = require('events');

let chunks;
let objectChunks;

beforeEach(() => {
  chunks = 10;
  objectChunks = [5, 'a', false, 0, '', 'xyz', { x: 4 }, 7, [], 555];
});

function runTest(highWaterMark, objectMode, produce) {
  return new Promise((resolve) => {
    const old = new EventEmitter();
    const r = new Readable({ highWaterMark, objectMode });
    expect(r).toBe(r.wrap(old));

    const endListener = jest.fn();
    r.on('end', endListener);

    old.pause = function() {
      old.emit('pause');
      flowing = false;
    };

    old.resume = function() {
      old.emit('resume');
      flow();
    };

    let pausing = false;
    r.on('pause', () => {
      expect(pausing).toBe(false);
      pausing = true;
      process.nextTick(() => {
        pausing = false;
      });
    });

    let flowing;
    let oldEnded = false;
    const expected = [];
    function flow() {
      flowing = true;
      while (flowing && chunks-- > 0) {
        const item = produce();
        expected.push(item);
        old.emit('data', item);
      }
      if (chunks <= 0) {
        oldEnded = true;
        old.emit('end');
      }
    }

    const w = new Writable({ highWaterMark: highWaterMark * 2, objectMode });
    const written = [];
    w._write = function(chunk, encoding, cb) {
      written.push(chunk);
      setTimeout(cb, 1);
    };

    const finishListener = jest.fn(() => {
      performAsserts();
    });
    w.on('finish', finishListener);

    r.pipe(w);

    flow();

    function performAsserts() {
      expect(oldEnded).toBe(true);
      expect(written).toEqual(expected);
      expect(endListener).toHaveBeenCalled();
      expect(finishListener).toHaveBeenCalled();
      resolve();
    }
  });
}

describe('Readable.wrap', () => {
  test.each([
    [100, false, () => Buffer.alloc(100)],
    [10, false, () => Buffer.from('xxxxxxxxxx')],
    [1, true, () => ({ foo: 'bar' })],
    [1, true, () => objectChunks.shift()],
  ])('runTest with highWaterMark=%i, objectMode=%s', async (highWaterMark, objectMode, produce) => {
    await runTest(highWaterMark, objectMode, produce);
  });
});

//<#END_FILE: test-stream2-readable-wrap.js
