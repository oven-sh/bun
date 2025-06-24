'use strict';

require('../common');
const assert = require('assert');

// Nul bytes should throw, not abort.
/* eslint-disable no-control-regex */
assert.throws(() => require('\u0000ab'), /'\u0000ab'/);
assert.throws(() => require('a\u0000b'), /'a\u0000b'/);
assert.throws(() => require('ab\u0000'), /'ab\u0000'/);
/* eslint-enable no-control-regex */
