//#FILE: test-stream2-unpipe-leak.js
//#SHA1: 7deb95c074fbcec9668a9c768c68057864ac085d
//-----------------
'use strict';

const stream = require('stream');

const chunk = Buffer.from('hallo');

class TestWriter extends stream.Writable {
  _write(buffer, encoding, callback) {
    callback(null);
  }
}

class TestReader extends stream.Readable {
  constructor() {
    super({
      highWaterMark: 0x10000
    });
  }

  _read(size) {
    this.push(chunk);
  }
}

let src;
let dest;

beforeEach(() => {
  src = new TestReader();
  dest = new TestWriter();
});

test('pipe and unpipe should not leak event listeners', () => {
  for (let i = 0; i < 10; i++) {
    src.pipe(dest);
    src.unpipe(dest);
  }

  expect(src.listeners('end').length).toBe(0);
  expect(src.listeners('readable').length).toBe(0);

  expect(dest.listeners('unpipe').length).toBe(0);
  expect(dest.listeners('drain').length).toBe(0);
  expect(dest.listeners('error').length).toBe(0);
  expect(dest.listeners('close').length).toBe(0);
  expect(dest.listeners('finish').length).toBe(0);
});

afterAll(() => {
  src.readableBuffer.length = 0;
  expect(src.readableLength).toBeGreaterThanOrEqual(src.readableHighWaterMark);
});

//<#END_FILE: test-stream2-unpipe-leak.js
