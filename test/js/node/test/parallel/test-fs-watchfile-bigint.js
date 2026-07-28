'use strict';

// Flags: --expose-internals

const common = require('../common');

const assert = require('assert');
const fs = require('fs');

const tmpdir = require('../common/tmpdir');

const enoentFile = tmpdir.resolve('non-existent-file');

// Bun does not expose node's internal/fs/utils module, so the all-zero
// BigIntStats instance this test compares against cannot be constructed
// directly. The observable contract is the same: every numeric field is the
// BigInt 0n and every date field is the UNIX epoch.
// const { BigIntStats } = require('internal/fs/utils');
const zeroBigIntFields = [
  'dev', 'mode', 'nlink', 'uid', 'gid', 'rdev', 'blksize', 'ino', 'size',
  'blocks', 'atimeMs', 'mtimeMs', 'ctimeMs', 'birthtimeMs',
  'atimeNs', 'mtimeNs', 'ctimeNs', 'birthtimeNs',
];

function assertZeroStatObject(stats) {
  // deepStrictEqual against a real BigIntStats would also pin the class and the
  // exact own-property set, so check those explicitly.
  assert.strictEqual(stats.constructor.name, 'BigIntStats');
  assert.strictEqual(typeof stats.isFile, 'function');
  assert.strictEqual(stats.isFile(), false);
  assert.strictEqual(stats.isDirectory(), false);
  for (const field of zeroBigIntFields) {
    assert.strictEqual(stats[field], 0n, `expected ${field} to be 0n`);
  }
  for (const field of ['atime', 'mtime', 'ctime', 'birthtime']) {
    assert.strictEqual(stats[field].getTime(), 0, `expected ${field} to be the epoch`);
  }
}

tmpdir.refresh();

// If the file initially didn't exist, and gets created at a later point of
// time, the callback should be invoked again with proper values in stat object
let fileExists = false;
const options = { interval: 0, bigint: true };

const watcher =
  fs.watchFile(enoentFile, options, common.mustCall((curr, prev) => {
    if (!fileExists) {
      // If the file does not exist, all the fields should be zero and the date
      // fields should be UNIX EPOCH time
      assertZeroStatObject(curr);
      assertZeroStatObject(prev);
      // Create the file now, so that the callback will be called back once the
      // event loop notices it.
      fs.closeSync(fs.openSync(enoentFile, 'w'));
      fileExists = true;
    } else {
      // If the ino (inode) value is greater than zero, it means that the file
      // is present in the filesystem and it has a valid inode number.
      assert(curr.ino > 0n);
      // As the file just got created, previous ino value should be lesser than
      // or equal to zero (non-existent file).
      assert(prev.ino <= 0n);
      // Stop watching the file
      fs.unwatchFile(enoentFile);
      watcher.stop();  // Stopping a stopped watcher should be a noop
    }
  }, 2));

// 'stop' should only be emitted once - stopping a stopped watcher should
// not trigger a 'stop' event.
watcher.on('stop', common.mustCall());
