// Flags: --expose-internals
'use strict';

const common = require('../common');

if (process.features.inspector) {
  common.skip('V8 inspector is enabled');
}

// Bun: `internal/util/inspector` is not exposed, so assert the public
// no-inspector surface instead: feature detection reports no inspector and
// inspector.open() is unavailable.
const assert = require('assert');
const inspector = require('inspector');

assert.strictEqual(process.features.inspector, false);
assert.strictEqual(inspector.url(), undefined);
assert.throws(() => inspector.open(), { code: 'ERR_NOT_IMPLEMENTED' });
