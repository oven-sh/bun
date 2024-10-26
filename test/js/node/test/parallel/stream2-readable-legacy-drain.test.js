//#FILE: test-stream2-readable-legacy-drain.js
//#SHA1: 8182fd1e12ce8538106404d39102ea69eee2e467
//-----------------
'use strict';

const Stream = require('stream');
const Readable = Stream.Readable;

test('Readable stream with legacy drain', (done) => {
  const r = new Readable();
  const N = 256;
  let reads = 0;
  r._read = function(n) {
    return r.push(++reads === N ? null : Buffer.allocUnsafe(1));
  };

  const endHandler = jest.fn();
  r.on('end', endHandler);

  const w = new Stream();
  w.writable = true;
  let buffered = 0;
  w.write = function(c) {
    buffered += c.length;
    process.nextTick(drain);
    return false;
  };

  function drain() {
    expect(buffered).toBeLessThanOrEqual(3);
    buffered = 0;
    w.emit('drain');
  }

  w.end = jest.fn();

  r.pipe(w);

  // We need to wait for the 'end' event to be emitted
  setTimeout(() => {
    expect(endHandler).toHaveBeenCalled();
    expect(w.end).toHaveBeenCalled();
    done();
  }, 1000); // Adjust timeout as needed
});

//<#END_FILE: test-stream2-readable-legacy-drain.js
