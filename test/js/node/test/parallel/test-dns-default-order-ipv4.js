// Flags: --dns-result-order=ipv4first
'use strict';
const common = require('../common');
const assert = require('assert');
const { promisify } = require('util');

// Test that --dns-result-order=ipv4first works as expected.

if (!process.execArgv.includes("--dns-result-order=ipv4first")) {
  process.exit(0);
}

const originalLookup = Bun.dns.lookup;
const calls = [];
Bun.dns.lookup = common.mustCallAtLeast((...args) => {
  calls.push(args);
  return originalLookup(...args);
}, 1);

const dns = require('dns');
const dnsPromises = dns.promises;

// We want to test the parameter of ipv4first only so that we
// ignore possible errors here.
function allowFailed(fn) {
  return fn.catch((_err) => {
    //
  });
}

(async () => {
  let callsLength = 0;
  const checkParameter = (expected) => {
    assert.strictEqual(calls.length, callsLength + 1);
    const { order } = calls[callsLength][1];
    assert.strictEqual(order, expected);
    callsLength += 1;
  };

  await allowFailed(promisify(dns.lookup)('example.org'));
  checkParameter('ipv4first');

  await allowFailed(dnsPromises.lookup('example.org'));
  checkParameter('ipv4first');

  await allowFailed(promisify(dns.lookup)('example.org', {}));
  checkParameter('ipv4first');

  await allowFailed(dnsPromises.lookup('example.org', {}));
  checkParameter('ipv4first');
})().then(common.mustCall());
