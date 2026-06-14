// Flags: --expose-gc
'use strict';
const common = require('../common');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { AsyncLocalStorage } = require('node:async_hooks');

// This test verifies that referencing an AsyncLocalStorage store from
// a weak AsyncWrap does not prevent the store from being garbage collected.
// We use zlib streams as examples of weak AsyncWraps here, but the
// issue is not specific to zlib.

class Store {}

let zlibDone = false;
// Bun: node uses v8.queryObjects(Store) to count live instances, which is not
// implemented in Bun. A FinalizationRegistry observing the single Store
// instance verifies the same thing: the store must be collectable once the
// zlib stream is done.
let storeCollected = false;
const registry = new FinalizationRegistry(() => {
  storeCollected = true;
});

// Use immediates to ensure no accidental async context propagation occurs
setImmediate(common.mustCall(() => {
  const asyncLocalStorage = new AsyncLocalStorage();
  const store = new Store();
  registry.register(store);
  asyncLocalStorage.run(store, common.mustCall(() => {
    (async () => {
      const zlibStream = zlib.createGzip();
      // (Make sure this test does not break if _handle is renamed
      // to something else)
      assert.strictEqual(typeof zlibStream._handle, 'object');
      // Create backreference from AsyncWrap to store
      store.zlibStream = zlibStream._handle;
      // Let the zlib stream finish (not strictly necessary)
      zlibStream.end('hello world');
      await zlibStream.toArray();
      zlibDone = true;
    })().then(common.mustCall());
  }));
}));

const finish = common.mustCall(async () => {
  // Make sure the ALS store has been garbage-collected
  await common.gcUntil('store collected', () => storeCollected);
});

const interval = setInterval(() => {
  if (zlibDone) {
    clearInterval(interval);
    finish();
  }
}, 5);
