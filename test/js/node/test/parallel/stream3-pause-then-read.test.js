//#FILE: test-stream3-pause-then-read.js
//#SHA1: bd44dc04c63140e4b65c0755eec67a55eaf48158
//-----------------
'use strict';

const stream = require('stream');
const Readable = stream.Readable;
const Writable = stream.Writable;

let consoleLogSpy;
let consoleErrorSpy;

beforeEach(() => {
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

test('Stream3 pause then read', (done) => {
  const totalChunks = 100;
  const chunkSize = 99;
  const expectTotalData = totalChunks * chunkSize;
  let expectEndingData = expectTotalData;

  const r = new Readable({ highWaterMark: 1000 });
  let chunks = totalChunks;
  r._read = function(n) {
    consoleLogSpy('_read called', chunks);
    if (!(chunks % 2))
      setImmediate(push);
    else if (!(chunks % 3))
      process.nextTick(push);
    else
      push();
  };

  let totalPushed = 0;
  function push() {
    const chunk = chunks-- > 0 ? Buffer.alloc(chunkSize, 'x') : null;
    if (chunk) {
      totalPushed += chunk.length;
    }
    consoleLogSpy('chunks', chunks);
    r.push(chunk);
  }

  function read100() {
    readn(100, onData);
  }

  function readn(n, then) {
    consoleErrorSpy(`read ${n}`);
    expectEndingData -= n;
    (function read() {
      const c = r.read(n);
      consoleErrorSpy('c', c);
      if (!c)
        r.once('readable', read);
      else {
        expect(c.length).toBe(n);
        expect(r.readableFlowing).toBeFalsy();
        then();
      }
    })();
  }

  function onData() {
    expectEndingData -= 100;
    consoleErrorSpy('onData');
    let seen = 0;
    r.on('data', function od(c) {
      seen += c.length;
      if (seen >= 100) {
        r.removeListener('data', od);
        r.pause();
        if (seen > 100) {
          const diff = seen - 100;
          r.unshift(c.slice(c.length - diff));
          consoleErrorSpy('seen too much', seen, diff);
        }
        setImmediate(pipeLittle);
      }
    });
  }

  function pipeLittle() {
    expectEndingData -= 200;
    consoleErrorSpy('pipe a little');
    const w = new Writable();
    let written = 0;
    w.on('finish', () => {
      expect(written).toBe(200);
      setImmediate(read1234);
    });
    w._write = function(chunk, encoding, cb) {
      written += chunk.length;
      if (written >= 200) {
        r.unpipe(w);
        w.end();
        cb();
        if (written > 200) {
          const diff = written - 200;
          written -= diff;
          r.unshift(chunk.slice(chunk.length - diff));
        }
      } else {
        setImmediate(cb);
      }
    };
    r.pipe(w);
  }

  function read1234() {
    readn(1234, resumePause);
  }

  function resumePause() {
    consoleErrorSpy('resumePause');
    r.resume();
    r.pause();
    r.resume();
    r.pause();
    r.resume();
    r.pause();
    r.resume();
    r.pause();
    r.resume();
    r.pause();
    setImmediate(pipe);
  }

  function pipe() {
    consoleErrorSpy('pipe the rest');
    const w = new Writable();
    let written = 0;
    w._write = function(chunk, encoding, cb) {
      written += chunk.length;
      cb();
    };
    w.on('finish', () => {
      consoleErrorSpy('written', written, totalPushed);
      expect(written).toBe(expectEndingData);
      expect(totalPushed).toBe(expectTotalData);
      consoleLogSpy('ok');
      done();
    });
    r.pipe(w);
  }

  read100();
});

//<#END_FILE: test-stream3-pause-then-read.js
