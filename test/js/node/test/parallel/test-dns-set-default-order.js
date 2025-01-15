'use strict';
const common = require('../common');
const assert = require('assert');
const { promisify } = require('util');

// Test that `dns.setDefaultResultOrder()` and
// `dns.promises.setDefaultResultOrder()` work as expected.

const originalLookup = Bun.dns.lookup;
const calls = [];
Bun.dns.lookup = common.mustCallAtLeast((...args) => {
  calls.push(args);
  return originalLookup(...args);
}, 1);

const dns = require('dns');
const dnsPromises = dns.promises;

// We want to test the parameter of order only so that we
// ignore possible errors here.
function allowFailed(fn) {
  return fn.catch((_err) => {
    //
  });
}

assert.throws(() => dns.setDefaultResultOrder('my_order'), {
  code: 'ERR_INVALID_ARG_VALUE',
});
assert.throws(() => dns.promises.setDefaultResultOrder('my_order'), {
  code: 'ERR_INVALID_ARG_VALUE',
});
assert.throws(() => dns.setDefaultResultOrder(4), {
  code: 'ERR_INVALID_ARG_VALUE',
});
assert.throws(() => dns.promises.setDefaultResultOrder(4), {
  code: 'ERR_INVALID_ARG_VALUE',
});

(async () => {
  let callsLength = 0;
  const checkParameter = (expected) => {
    assert.strictEqual(calls.length, callsLength + 1);
    const { order } = calls[callsLength][1];
    assert.strictEqual(order, expected);
    callsLength += 1;
  };

  dns.setDefaultResultOrder('verbatim');
  await allowFailed(promisify(dns.lookup)('example.org'));
  checkParameter('verbatim');
  await allowFailed(dnsPromises.lookup('example.org'));
  checkParameter('verbatim');
  await allowFailed(promisify(dns.lookup)('example.org', {}));
  checkParameter('verbatim');
  await allowFailed(dnsPromises.lookup('example.org', {}));
  checkParameter('verbatim');

  dns.setDefaultResultOrder('ipv4first');
  await allowFailed(promisify(dns.lookup)('example.org'));
  checkParameter('ipv4first');
  await allowFailed(dnsPromises.lookup('example.org'));
  checkParameter('ipv4first');
  await allowFailed(promisify(dns.lookup)('example.org', {}));
  checkParameter('ipv4first');
  await allowFailed(dnsPromises.lookup('example.org', {}));
  checkParameter('ipv4first');

  dns.setDefaultResultOrder('ipv6first');
  await allowFailed(promisify(dns.lookup)('example.org'));
  checkParameter('ipv6first');
  await allowFailed(dnsPromises.lookup('example.org'));
  checkParameter('ipv6first');
  await allowFailed(promisify(dns.lookup)('example.org', {}));
  checkParameter('ipv6first');
  await allowFailed(dnsPromises.lookup('example.org', {}));
  checkParameter('ipv6first');

  dns.promises.setDefaultResultOrder('verbatim');
  await allowFailed(promisify(dns.lookup)('example.org'));
  checkParameter('verbatim');
  await allowFailed(dnsPromises.lookup('example.org'));
  checkParameter('verbatim');
  await allowFailed(promisify(dns.lookup)('example.org', {}));
  checkParameter('verbatim');
  await allowFailed(dnsPromises.lookup('example.org', {}));
  checkParameter('verbatim');

  dns.promises.setDefaultResultOrder('ipv4first');
  await allowFailed(promisify(dns.lookup)('example.org'));
  checkParameter('ipv4first');
  await allowFailed(dnsPromises.lookup('example.org'));
  checkParameter('ipv4first');
  await allowFailed(promisify(dns.lookup)('example.org', {}));
  checkParameter('ipv4first');
  await allowFailed(dnsPromises.lookup('example.org', {}));
  checkParameter('ipv4first');

  dns.promises.setDefaultResultOrder('ipv6first');
  await allowFailed(promisify(dns.lookup)('example.org'));
  checkParameter('ipv6first');
  await allowFailed(dnsPromises.lookup('example.org'));
  checkParameter('ipv6first');
  await allowFailed(promisify(dns.lookup)('example.org', {}));
  checkParameter('ipv6first');
  await allowFailed(dnsPromises.lookup('example.org', {}));
  checkParameter('ipv6first');
})().then(common.mustCall());
