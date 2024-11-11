//#FILE: test-stream2-base64-single-char-read-end.js
//#SHA1: 7d3b8e9ad3f47e915bc265658c0b5639fa4a68cd
//-----------------
'use strict';
const { Readable: R, Writable: W } = require('stream');

test('Stream2 base64 single char read end', (done) => {
  const src = new R({ encoding: 'base64' });
  const dst = new W();
  let hasRead = false;
  const accum = [];

  src._read = function(n) {
    if (!hasRead) {
      hasRead = true;
      process.nextTick(function() {
        src.push(Buffer.from('1'));
        src.push(null);
      });
    }
  };

  dst._write = function(chunk, enc, cb) {
    accum.push(chunk);
    cb();
  };

  src.on('end', function() {
    expect(String(Buffer.concat(accum))).toBe('MQ==');
    done();
  });

  src.pipe(dst);
}, 1000); // 1 second timeout

//<#END_FILE: test-stream2-base64-single-char-read-end.js
