// Flags: --expose-internals
'use strict';

const common = require('../common');

// Bun: `internal/util/inspector` is not exposed, so assert the public surface
// instead. process.features.inspector is true and inspector.open() serves the
// DevTools protocol.
const assert = require('assert');
const inspector = require('inspector');

assert.strictEqual(process.features.inspector, true);
assert.strictEqual(inspector.url(), undefined);

inspector.open(0);
assert.ok(inspector.url().startsWith('ws://'));
inspector.close();
assert.strictEqual(inspector.url(), undefined);
