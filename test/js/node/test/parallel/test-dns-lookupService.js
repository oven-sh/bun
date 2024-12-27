'use strict';
const common = require('../common');
const assert = require('assert');

// Stub `getnameinfo` to *always* error.
Bun.dns.lookupService = (addr, port) => {
  throw Object.assign(new Error(`getnameinfo ENOENT ${addr}`), {code: 'ENOENT', syscall: 'getnameinfo'});
};

const dns = require('dns');

assert.throws(
  () => dns.lookupService('127.0.0.1', 80, common.mustNotCall()),
  {
    code: 'ENOENT',
    message: 'getnameinfo ENOENT 127.0.0.1',
    syscall: 'getnameinfo'
  }
);

assert.rejects(
  dns.promises.lookupService('127.0.0.1', 80),
  {
    code: 'ENOENT',
    message: 'getnameinfo ENOENT 127.0.0.1',
    syscall: 'getnameinfo'
  }
).then(common.mustCall());
