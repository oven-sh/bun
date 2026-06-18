// Flags: --expose-internals
'use strict';

const common = require('../common');

if (process.features.inspector) {
  common.skip('V8 inspector is enabled');
}

// Bun: `internal/util/inspector` is not exposed, so assert the public surface
// instead. Unlike a Node build without the V8 inspector, inspector.open()
// works in Bun (it serves the DevTools protocol); only feature detection still
// reports no inspector.
const assert = require('assert');
const inspector = require('inspector');

assert.strictEqual(process.features.inspector, false);
assert.strictEqual(inspector.url(), undefined);

inspector.open(0);
assert.ok(inspector.url().startsWith('ws://'));
inspector.close();
assert.strictEqual(inspector.url(), undefined);
