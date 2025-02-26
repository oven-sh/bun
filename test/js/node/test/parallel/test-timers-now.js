'use strict';
// Flags: --expose-internals

const common = require('../common');
common.skip("skipped because it tests node internals irrelevant to bun");
const assert = require('assert');
const { internalBinding } = require('internal/test/binding');
const binding = internalBinding('timers');

// Return value of getLibuvNow() should easily fit in a SMI after start-up.
// We need to use the binding as the receiver for fast API calls.
assert(binding.getLibuvNow() < 0x3ffffff);
