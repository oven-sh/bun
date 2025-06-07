'use strict';
const common = require('../common');

if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const { X509Certificate } = require('crypto');
const tls = require('tls');
const fixtures = require('../common/fixtures');

const altKeyCert = {
  key: fixtures.readKey('agent2-key.pem'),
  cert: fixtures.readKey('agent2-cert.pem'),
  minVersion: 'TLSv1.2',
};

console.log('altKeyCert:', altKeyCert);

const altKeyCertVals = [
  altKeyCert,
  tls.createSecureContext(altKeyCert),
];

console.log('altKeyCertVals length:', altKeyCertVals.length);

(function next() {
  if (!altKeyCertVals.length) {
    console.log('No more altKeyCertVals to process');
    return;
  }
  const altKeyCertVal = altKeyCertVals.shift();
  console.log('Processing altKeyCertVal:', altKeyCertVal);
  
  const options = {
    key: fixtures.readKey('agent1-key.pem'),
    cert: fixtures.readKey('agent1-cert.pem'),
    minVersion: 'TLSv1.3',
    ALPNCallback: common.mustCall(function({ servername, protocols }) {
      console.log('ALPNCallback called with:', { servername, protocols });
      this.setKeyCert(altKeyCertVal);
      assert.deepStrictEqual(protocols, ['acme-tls/1']);
      return protocols[0];
    }),
  };

  console.log('Creating server with options:', options);

  tls.createServer(options, (s) => s.end()).listen(0, function() {
    console.log('Server listening on port:', this.address().port);
    
    this.on('connection', common.mustCall((socket) => {
      console.log('Connection received');
      this.close();
    }));

    tls.connect({
      port: this.address().port,
      rejectUnauthorized: false,
      ALPNProtocols: ['acme-tls/1'],
    }, common.mustCall(function() {
      console.log('Client connected');
      assert.strictEqual(this.getProtocol(), 'TLSv1.3');
      const altCert = new X509Certificate(altKeyCert.cert);
      console.log('Comparing certificates:\n', this.getPeerX509Certificate().raw, '\n', altCert.raw);
      assert.strictEqual(
        this.getPeerX509Certificate().raw.equals(altCert.raw),
        true
      );
      this.end();
      next();
    }));
  });
})();
