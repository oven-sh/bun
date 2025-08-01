'use strict';
const common = require('../common');
const assert = require('assert');
const dnsPromises = require('dns').promises;

Bun.dns.resolve = (hostname, rrtype) => Promise.reject({code: 'EPERM', syscall: 'query' + rrtype[0].toUpperCase() + rrtype.substr(1), hostname});

assert.rejects(
  dnsPromises.resolve('example.org'),
  {
    code: 'EPERM',
    syscall: 'queryA',
    hostname: 'example.org'
  }
).then(common.mustCall());
