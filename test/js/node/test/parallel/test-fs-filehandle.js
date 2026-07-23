// Flags: --expose-gc --no-warnings --expose-internals
'use strict';

const common = require('../common');
const assert = require('assert');
const path = require('path');
const { open } = require('fs/promises');

// Bun does not expose internalBinding('fs').openFileHandle, which node uses
// here only to create a FileHandle that is immediately unreachable. The public
// fs.promises.open() produces the same state -- a FileHandle that is garbage
// collected without having been closed -- so the behaviour under test is
// reached that way instead.
// const { internalBinding } = require('internal/test/binding');
// const fs = internalBinding('fs');
// const { stringToFlags } = require('internal/fs/utils');

const filepath = path.toNamespacedPath(__filename);

// Verifies that the FileHandle object is garbage collected and that an
// error is thrown if it is not closed.
let raised = false;
process.on('uncaughtException', common.mustCall((err) => {
  raised = true;
  assert.strictEqual(err.code, 'ERR_INVALID_STATE');
  assert.match(err.message, /^A FileHandle object was closed during/);
  assert.match(err.message, new RegExp(RegExp.escape(filepath)));
}));

async function openAndAbandon() {
  const fh = await open(filepath, 'r');
  assert.strictEqual(typeof fh.fd, 'number');
  // fh intentionally goes out of scope without being closed.
}

// Node reaches the collection through a native handle with no JS references at
// all; here the handle is only unreachable once the async frame above is gone,
// so collection is retried instead of assumed to happen on the first sweep.
openAndAbandon().then(common.mustCall(async () => {
  for (let i = 0; i < 20 && !raised; i++) {
    globalThis.gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}));
