'use strict';

require('../common');
const assert = require('assert');
const net = require('net');

// Tests that net.connect() called without arguments throws ERR_MISSING_ARGS.
const message = 'The "options", "port", or "path" argument must be specified';
assert.throws(() => {
  net.connect();
}, {
  code: 'ERR_MISSING_ARGS',
  message,
});

assert.throws(() => {
  new net.Socket().connect();
}, {
  code: 'ERR_MISSING_ARGS',
  message,
});

assert.throws(() => {
  net.connect({});
}, {
  code: 'ERR_MISSING_ARGS',
  message,
});

assert.throws(() => {
  new net.Socket().connect({});
}, {
  code: 'ERR_MISSING_ARGS',
  message,
});
