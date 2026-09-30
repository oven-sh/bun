'use strict';

const common = require('../common');
const assert = require('assert');
const { Readable } = require('stream');

const buf = Buffer.alloc(8192);

const readable = new Readable({
  highWaterMark: 16 * 1024,
  read: common.mustCall(function() {
    this.push(buf);
  }, 12)
});

let i = 0;

readable.on('readable', common.mustCall(function() {
  if (i++ === 10) {
    // We will just terminate now.
    readable.removeAllListeners('readable');
    return;
  }

  const data = readable.read();
  // read() with no size returns a single buffered chunk at a time.
  assert.strictEqual(data.length, 8192);
}, 11));
