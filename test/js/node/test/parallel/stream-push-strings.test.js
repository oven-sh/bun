//#FILE: test-stream-push-strings.js
//#SHA1: d2da34fc74795ea8cc46460ce443d0b30b0e98d8
//-----------------
'use strict';

const { Readable } = require('stream');

class MyStream extends Readable {
  constructor(options) {
    super(options);
    this._chunks = 3;
  }

  _read(n) {
    switch (this._chunks--) {
      case 0:
        return this.push(null);
      case 1:
        return setTimeout(() => {
          this.push('last chunk');
        }, 100);
      case 2:
        return this.push('second to last chunk');
      case 3:
        return process.nextTick(() => {
          this.push('first chunk');
        });
      default:
        throw new Error('?');
    }
  }
}

test('MyStream pushes strings correctly', (done) => {
  const ms = new MyStream();
  const results = [];
  const expectedResults = ['first chunksecond to last chunk', 'last chunk'];

  ms.on('readable', function() {
    let chunk;
    while (null !== (chunk = ms.read()))
      results.push(String(chunk));
  });

  ms.on('end', () => {
    expect(ms._chunks).toBe(-1);
    expect(results).toEqual(expectedResults);
    done();
  });

  // Consume the stream to trigger 'end' event
  ms.resume();
}, 10000); // Increase timeout to 10 seconds

//<#END_FILE: test-stream-push-strings.js
