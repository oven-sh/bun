'use strict';
const common = require('../common');
const assert = require('assert');
const dgram = require('dgram');
const dns = require('dns');

if (typeof Bun !== 'undefined') {
  if (process.platform === 'win32' && require('harness').isCI) {
    // TODO(@heimskr): This test mysteriously takes forever in Windows in CI
    // possibly due to UDP keeping the event loop alive longer than it should.
    process.exit(0);
  }
}

for (const ctor of [dns.Resolver, dns.promises.Resolver]) {
  for (const timeout of [null, true, false, '', '2']) {
    assert.throws(() => new ctor({ timeout }), {
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
      message: `The "options.timeout" property must be of type number.` + common.invalidArgTypeHelper(timeout),
    });
  }

  for (const timeout of [4.2]) {
    assert.throws(() => new ctor({ timeout }), {
      code: 'ERR_OUT_OF_RANGE',
      name: 'RangeError',
      message: `The value of "options.timeout" is out of range. It must be an integer. Received ${timeout}`,
    });
  }

  for (const timeout of [-2, 2 ** 31]) {
    assert.throws(() => new ctor({ timeout }), {
      code: 'ERR_OUT_OF_RANGE',
      name: 'RangeError',
      message: `The value of "options.timeout" is out of range. It must be >= -1 and <= 2147483647. Received ${timeout}`,
    });
  }

  for (const timeout of [-1, 0, 1]) new ctor({ timeout });  // OK
}

for (const timeout of [0, 1, 2]) {
  const server = dgram.createSocket('udp4');
  server.bind(0, '127.0.0.1', common.mustCall(() => {
    const resolver = new dns.Resolver({ timeout });
    resolver.setServers([`127.0.0.1:${server.address().port}`]);
    resolver.resolve4('nodejs.org', common.mustCall((err) => {
      assert.throws(() => { throw err; }, {
        code: 'ETIMEOUT',
        name: /^(DNSException|Error)$/,
      });
      server.close();
    }));
  }));
}

for (const timeout of [0, 1, 2]) {
  const server = dgram.createSocket('udp4');
  server.bind(0, '127.0.0.1', common.mustCall(() => {
    const resolver = new dns.promises.Resolver({ timeout });
    resolver.setServers([`127.0.0.1:${server.address().port}`]);
    resolver.resolve4('nodejs.org').catch(common.mustCall((err) => {
      assert.throws(() => { throw err; }, {
        code: 'ETIMEOUT',
        name: /^(DNSException|Error)$/,
      });
      server.close();
    }));
  }));
}
