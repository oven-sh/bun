'use strict';

// Refs: https://github.com/nodejs/node/issues/33940

const common = require('../common');
const tmpdir = require('../common/tmpdir');
const fs = require('fs');
const assert = require('assert');

tmpdir.refresh();

const file = tmpdir.resolve('read_stream_pos_test.txt');

fs.writeFileSync(file, '');

let counter = 0;

const appendLine = () => {
  counter = counter + 1;
  fs.writeFileSync(file, `hello at ${counter}\n`, { flag: 'a' });
};

// Seed a line so the first stream is guaranteed at least one 'data' event and a
// short (< hwm) tail chunk even before the 1ms writer has had a chance to fire.
appendLine();

const writeInterval = setInterval(appendLine, 1);

const hwm = 10;
let bufs = [];
let isLow = false;
let cur = 0;
let stream;
let streamStart = 0;

const readInterval = setInterval(common.mustCallAtLeast(() => {
  if (stream) return;

  streamStart = cur;
  stream = fs.createReadStream(file, {
    highWaterMark: hwm,
    start: cur
  });
  stream.on('data', common.mustCallAtLeast((chunk) => {
    cur += chunk.length;
    bufs.push(chunk);
    if (isLow) {
      const read = Buffer.concat(bufs);
      const onDisk = fs.readFileSync(file);
      assert.strictEqual(read.length, cur - streamStart);
      assert.ok(cur <= onDisk.length, `cur ${cur} exceeds file size ${onDisk.length}`);
      // nodejs/node#33940: after a short read the next pread was issued at the
      // wrong position, so the bytes delivered here overlapped or skipped what
      // earlier chunks had already returned. The concatenated chunks must be
      // exactly the file's bytes at [streamStart, cur).
      assert.deepStrictEqual(read, onDisk.subarray(streamStart, cur));
      const brokenLines = read.toString()
        .split('\n')
        .filter((line) => {
          const s = 'hello at'.slice(0, line.length);
          if (line && !line.startsWith(s)) {
            return true;
          }
          return false;
        });
      assert.strictEqual(brokenLines.length, 0);
      exitTest();
      return;
    }
    if (chunk.length !== hwm) {
      isLow = true;
      // Upstream relies on the 1ms writer landing between this short read and
      // the stream's next pread, and carries a 90s safety timer for when that
      // race never hits (reached routinely on Windows, where the test then
      // exits without asserting anything). Appending here, before the next
      // _read is scheduled, makes the follow-up chunk deterministic without
      // changing the code path under test.
      appendLine();
    }
  }));
  stream.on('end', () => {
    stream = null;
    isLow = false;
    bufs = [];
  });
}), 10);

const exitTest = () => {
  clearInterval(readInterval);
  clearInterval(writeInterval);
  if (stream && !stream.destroyed) {
    stream.on('close', () => {
      process.exit();
    });
    stream.destroy();
  } else {
    process.exit();
  }
};
