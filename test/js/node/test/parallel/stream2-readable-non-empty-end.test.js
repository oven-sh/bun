//#FILE: test-stream2-readable-non-empty-end.js
//#SHA1: b060c5935067a4cf544b92d549e78e1fc7b043f1
//-----------------
'use strict';
const { Readable } = require('stream');

test('Readable stream with non-empty end', (done) => {
  let len = 0;
  const chunks = new Array(10);
  for (let i = 1; i <= 10; i++) {
    chunks[i - 1] = Buffer.allocUnsafe(i);
    len += i;
  }

  const test = new Readable();
  let n = 0;
  test._read = function(size) {
    const chunk = chunks[n++];
    setTimeout(function() {
      test.push(chunk === undefined ? null : chunk);
    }, 1);
  };

  test.on('end', thrower);
  function thrower() {
    throw new Error('this should not happen!');
  }

  let bytesread = 0;
  test.on('readable', function() {
    const b = len - bytesread - 1;
    const res = test.read(b);
    if (res) {
      bytesread += res.length;
      console.error(`br=${bytesread} len=${len}`);
      setTimeout(next, 1);
    }
    test.read(0);
  });
  test.read(0);

  function next() {
    // Now let's make 'end' happen
    test.removeListener('end', thrower);
    test.on('end', () => {
      expect(true).toBe(true); // This replaces common.mustCall()
    });

    // One to get the last byte
    let r = test.read();
    expect(r).toBeTruthy();
    expect(r.length).toBe(1);
    r = test.read();
    expect(r).toBeNull();
    done();
  }
});

//<#END_FILE: test-stream2-readable-non-empty-end.js
