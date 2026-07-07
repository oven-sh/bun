'use strict';

const common = require('../common');
// Bun: answer the queries from a local stub DNS server (same pattern as
// test-dns-resolveany.js). Upstream resolves 'localhost' against the real
// nameserver, which can take ~20s of c-ares retries in CI containers.
const dnstools = require('../common/dns');

const assert = require('assert');
const dns = require('dns');
const dgram = require('dgram');

const localhost = [ '127.0.0.1' ];

const server = dgram.createSocket('udp4');
server.on('message', (msg, { address, port }) => {
  const parsed = dnstools.parseDNSPacket(msg);
  const domain = parsed.questions[0].domain;
  server.send(dnstools.writeDNSPacket({
    id: parsed.id,
    questions: parsed.questions,
    answers: [{ type: 'A', address: '127.0.0.1', ttl: 60, domain }],
  }), port, address);
});

let pending = 2;
function onResolved() {
  if (--pending === 0) server.close();
}

server.bind(0, common.mustCall(() => {
  const stubServers = [ `127.0.0.1:${server.address().port}` ];

  // Fix https://github.com/nodejs/node/issues/14734

  {
    const resolver = new dns.Resolver();
    resolver.setServers(stubServers);
    resolver.resolve('localhost', common.mustCall(onResolved));

    assert.throws(resolver.setServers.bind(resolver, localhost), {
      code: 'ERR_DNS_SET_SERVERS_FAILED',
      message: /[Tt]here are pending queries/
    });
  }

  {
    dns.setServers(stubServers);
    dns.resolve('localhost', common.mustCall(onResolved));

    // should not throw
    dns.setServers(localhost);
  }
}));
