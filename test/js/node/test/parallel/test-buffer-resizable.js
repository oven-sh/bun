// Flags: --no-warnings
'use strict';

require('../common');
const { Buffer } = require('node:buffer');
const { strictEqual } = require('node:assert');

{
  {
    const ab = new ArrayBuffer(10, { maxByteLength: 20 });
    const buffer = Buffer.from(ab, 1);
    strictEqual(ab.byteLength, 10);
    strictEqual(buffer.buffer.byteLength, 10);
    strictEqual(buffer.byteLength, 9);
    ab.resize(15);
    strictEqual(ab.byteLength, 15);
    strictEqual(buffer.buffer.byteLength, 15);
    strictEqual(buffer.byteLength, 14);
    ab.resize(5);
    strictEqual(ab.byteLength, 5);
    strictEqual(buffer.buffer.byteLength, 5);
    strictEqual(buffer.byteLength, 4);
  }
}

{
  {
    const ab = new ArrayBuffer(10, { maxByteLength: 20 });
    const buffer = new Buffer(ab, 1);
    strictEqual(ab.byteLength, 10);
    strictEqual(buffer.buffer.byteLength, 10);
    strictEqual(buffer.byteLength, 9);
    ab.resize(15);
    strictEqual(ab.byteLength, 15);
    strictEqual(buffer.buffer.byteLength, 15);
    strictEqual(buffer.byteLength, 14);
    ab.resize(5);
    strictEqual(ab.byteLength, 5);
    strictEqual(buffer.buffer.byteLength, 5);
    strictEqual(buffer.byteLength, 4);
  }
}
