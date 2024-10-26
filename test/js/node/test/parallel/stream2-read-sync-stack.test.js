//#FILE: test-stream2-read-sync-stack.js
//#SHA1: 6c88d0cc474e5f00822b3be4e2c54bdd933e54d6
//-----------------
'use strict';

const { Readable } = require('stream');

test('Synchronous read callbacks handle heavy nesting without error', (done) => {
  const r = new Readable();
  const N = 256 * 1024;

  let reads = 0;
  r._read = function(n) {
    const chunk = reads++ === N ? null : Buffer.allocUnsafe(1);
    r.push(chunk);
  };

  const onReadableMock = jest.fn(() => {
    if (!(r.readableLength % 256))
      console.log('readable', r.readableLength);
    r.read(N * 2);
  });

  r.on('readable', onReadableMock);

  const onEndMock = jest.fn(() => {
    expect(onReadableMock).toHaveBeenCalled();
    expect(onEndMock).toHaveBeenCalledTimes(1);
    done();
  });

  r.on('end', onEndMock);

  r.read(0);
});

//<#END_FILE: test-stream2-read-sync-stack.js
