//#FILE: test-net-dns-lookup-skip.js
//#SHA1: 023bfbaa998480ab732d83d4bf8efb68ad4fe5db
//-----------------
'use strict';
const net = require('net');

async function checkDnsLookupSkip(addressType) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((client) => {
      client.end();
      server.close();
    });

    const address = addressType === 4 ? '127.0.0.1' : '::1';
    const lookupSpy = jest.fn();

    server.listen(0, address, () => {
      net.connect(server.address().port, address)
        .on('lookup', lookupSpy)
        .on('connect', () => {
          expect(lookupSpy).not.toHaveBeenCalled();
          resolve();
        })
        .on('error', reject);
    });
  });
}

test('DNS lookup should be skipped for IPv4', async () => {
  await checkDnsLookupSkip(4);
});

// Check if the environment supports IPv6
const hasIPv6 = (() => {
  try {
    net.createServer().listen(0, '::1').close();
    return true;
  } catch {
    return false;
  }
})();

(hasIPv6 ? test : test.skip)('DNS lookup should be skipped for IPv6', async () => {
  await checkDnsLookupSkip(6);
});

//<#END_FILE: test-net-dns-lookup-skip.js
