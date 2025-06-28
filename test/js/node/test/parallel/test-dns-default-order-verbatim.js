// Flags: --dns-result-order=verbatim
'use strict';
const common = require('../common');
const assert = require('assert');
const { promisify } = require('util');

const originalLookup = Bun.dns.lookup;
const calls = [];
Bun.dns.lookup = common.mustCallAtLeast((...args) => {
  calls.push(args);
  return originalLookup(...args);
}, 1);

const dns = require('dns');
const dnsPromises = dns.promises;

// We want to test the parameter of verbatim only so that we
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
  checkParameter("verbatim");

  await allowFailed(dnsPromises.lookup('example.org'));
  checkParameter("verbatim");

  await allowFailed(promisify(dns.lookup)('example.org', {}));
  checkParameter("verbatim");

  await allowFailed(dnsPromises.lookup('example.org', {}));
  checkParameter("verbatim");

  await allowFailed(
    promisify(dns.lookup)('example.org', { order: 'ipv4first' })
  );
  checkParameter("ipv4first");

  await allowFailed(
    promisify(dns.lookup)('example.org', { order: 'ipv6first' })
  );
  checkParameter("ipv6first");
})().then(common.mustCall());
