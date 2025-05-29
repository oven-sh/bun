'use strict';
const common = require('../common');
const net = require('net');
const assert = require('assert');

const c = net.createConnection(common.PORT);
c.on('connect', common.mustNotCall());
c.on('error', common.mustCall((e) => {
  assert.strictEqual(c.connecting, false);
  assert.strictEqual(e.code, 'ECONNREFUSED');
}));
