//#FILE: test-stream-await-drain-writers-in-synchronously-recursion-write.js
//#SHA1: 88d441126505584d1a93d1b0166441798c536e48
//-----------------
'use strict';
const { PassThrough } = require('stream');

test('Stream await drain writers in synchronously recursion write', (done) => {
  const encode = new PassThrough({
    highWaterMark: 1
  });

  const decode = new PassThrough({
    highWaterMark: 1
  });

  const send = jest.fn((buf) => {
    encode.write(buf);
  });

  let i = 0;
  const onData = jest.fn(() => {
    if (++i === 2) {
      send(Buffer.from([0x3]));
      send(Buffer.from([0x4]));
    }
  });

  encode.pipe(decode).on('data', onData);

  send(Buffer.from([0x1]));
  send(Buffer.from([0x2]));

  // We need to wait for the stream to process all data
  setTimeout(() => {
    expect(send).toHaveBeenCalledTimes(4);
    expect(onData).toHaveBeenCalledTimes(4);
    done();
  }, 100);
});

//<#END_FILE: test-stream-await-drain-writers-in-synchronously-recursion-write.js
