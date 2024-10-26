//#FILE: test-stream2-readable-empty-buffer-no-eof.js
//#SHA1: 70ef48637116477747867b03a60462fb64331087
//-----------------
'use strict';

const { Readable } = require('stream');

describe('Readable Stream Empty Buffer No EOF', () => {
  test('should not end on empty buffer', (done) => {
    const r = new Readable();
    const buf = Buffer.alloc(5, 'x');
    let reads = 5;
    r._read = function(n) {
      switch (reads--) {
        case 5:
          return setImmediate(() => {
            return r.push(buf);
          });
        case 4:
          setImmediate(() => {
            return r.push(Buffer.alloc(0));
          });
          return setImmediate(r.read.bind(r, 0));
        case 3:
          setImmediate(r.read.bind(r, 0));
          return process.nextTick(() => {
            return r.push(Buffer.alloc(0));
          });
        case 2:
          setImmediate(r.read.bind(r, 0));
          return r.push(Buffer.alloc(0)); // Not-EOF!
        case 1:
          return r.push(buf);
        case 0:
          return r.push(null); // EOF
        default:
          throw new Error('unreachable');
      }
    };

    const results = [];
    function flow() {
      let chunk;
      while (null !== (chunk = r.read()))
        results.push(String(chunk));
    }
    r.on('readable', flow);
    r.on('end', () => {
      results.push('EOF');
      expect(results).toEqual(['xxxxx', 'xxxxx', 'EOF']);
      done();
    });
    flow();
  });

  test('should handle base64 encoding correctly', (done) => {
    const r = new Readable({ encoding: 'base64' });
    let reads = 5;
    r._read = function(n) {
      if (!reads--)
        return r.push(null); // EOF
      return r.push(Buffer.from('x'));
    };

    const results = [];
    function flow() {
      let chunk;
      while (null !== (chunk = r.read()))
        results.push(String(chunk));
    }
    r.on('readable', flow);
    r.on('end', () => {
      results.push('EOF');
      expect(results).toEqual(['eHh4', 'eHg=', 'EOF']);
      done();
    });
    flow();
  });
});

//<#END_FILE: test-stream2-readable-empty-buffer-no-eof.js
