/* eslint-disable node-core/crypto-check */

'use strict';
const common = require('../common');
const assert = require('assert');
const fixtures = require('../common/fixtures');
const tls = require('tls');

// This module is for BoringSSL-specific branches in tests whose original
// OpenSSL coverage cannot run unchanged. Each helper should assert the
// observable BoringSSL behavior that explains why the OpenSSL-specific
// assertions are bypassed.

/**
 * BoringSSL exposes many removed or disabled TLS cipher suites as "no match"
 * at secure-context creation time. This is used for suites such as
 * finite-field DHE and anonymous ECDH that OpenSSL builds may still negotiate
 * in tests.
 * @param {Function} fn
 */
function assertNoCipherMatch(fn) {
  // Only the code is asserted: the OpenSSL-style decomposition (library/
  // function/reason casing) differs between the native handshake path and the
  // JS cipher validation path that produces this error.
  assert.throws(fn, {
    code: 'ERR_SSL_NO_CIPHER_MATCH',
  });
}

/**
 * BoringSSL does not parse OpenSSL cipher-string commands such as `@SECLEVEL`.
 * Those are OpenSSL policy directives, not cipher names.
 * @param {Function} fn
 */
function assertInvalidCommand(fn) {
  assert.throws(fn, {
    code: 'ERR_SSL_INVALID_COMMAND',
    library: 'SSL routines',
    function: 'OPENSSL_internal',
    reason: 'INVALID_COMMAND',
  });
}

/**
 * Node's DHE tests exercise OpenSSL's finite-field DHE cipher support and DH
 * parameter-size policy. BoringSSL does not offer these DHE cipher suites on
 * this surface, so creating a server context with a DHE-only cipher list fails
 * before a handshake can test DH parameter behavior.
 */
function assertFiniteFieldDheUnsupported() {
  assertNoCipherMatch(() => {
    tls.createServer({
      key: fixtures.readKey('agent2-key.pem'),
      cert: fixtures.readKey('agent2-cert.pem'),
      ciphers: 'DHE-RSA-AES128-GCM-SHA256',
    });
  });
}

/**
 * OpenSSL security levels reject small keys by policy and can be adjusted with
 * `@SECLEVEL` in the cipher string. BoringSSL does not implement those security
 * levels: the small-key server context is accepted, while the OpenSSL-specific
 * `@SECLEVEL` command is rejected as invalid cipher-string syntax.
 */
function assertOpenSSLSecurityLevelsUnsupported() {
  const options = {
    key: fixtures.readKey('agent11-key.pem'),
    cert: fixtures.readKey('agent11-cert.pem'),
    ciphers: 'DEFAULT',
  };

  tls.createServer(options).close();

  options.ciphers = 'DEFAULT:@SECLEVEL=0';
  assertInvalidCommand(() => tls.createServer(options));
}

/**
 * BoringSSL does not support caller-initiated renegotiation. Even on a TLS 1.2
 * connection, TLSSocket#renegotiate() returns false and the callback receives
 * Node's BoringSSL-specific unsupported-renegotiation error instead of
 * entering the native binding or exercising Node's renegotiation-limit logic.
 */
function testRenegotiationUnsupported() {
  const server = tls.createServer({
    key: fixtures.readKey('rsa_private.pem'),
    cert: fixtures.readKey('rsa_cert.crt'),
    maxVersion: 'TLSv1.2',
  }, (socket) => socket.resume());

  server.listen(0, common.mustCall(() => {
    const client = tls.connect({
      port: server.address().port,
      rejectUnauthorized: false,
      maxVersion: 'TLSv1.2',
    }, common.mustCall(() => {
      const ok = client.renegotiate({}, common.mustCall((err) => {
        assert.throws(() => { throw err; }, {
          code: 'ERR_TLS_RENEGOTIATION_UNSUPPORTED',
          message: 'TLS session renegotiation is unsupported by this TLS ' +
                   'implementation',
        });
        client.destroy();
        server.close();
      }));
      assert.strictEqual(ok, false);
    }));
    client.on('error', common.mustNotCall());
  }));
}

/**
 * BoringSSL has no DHE cipher suites and no X448, so of the original test only
 * an ECDHE case can run.
 */
function testEphemeralKeyInfoEcdheOnly() {
  const server = tls.createServer({
    key: fixtures.readKey('agent2-key.pem'),
    cert: fixtures.readKey('agent2-cert.pem'),
    ciphers: 'ECDHE-RSA-AES256-GCM-SHA384',
    ecdhCurve: 'prime256v1',
    maxVersion: 'TLSv1.2',
  }, common.mustCall((socket) => {
    assert.strictEqual(socket.getEphemeralKeyInfo(), null);
    socket.end();
  }));

  server.listen(0, common.mustCall(() => {
    const client = tls.connect({
      port: server.address().port,
      rejectUnauthorized: false,
      maxVersion: 'TLSv1.2',
    }, common.mustCall(() => {
      assert.deepStrictEqual(client.getEphemeralKeyInfo(), {
        type: 'ECDH',
        name: 'prime256v1',
        size: 256,
      });
      server.close();
    }));
  }));
}

/**
 * The protocol matrix tests cover OpenSSL behavior for legacy TLS protocols.
 * For BoringSSL we only need to exhibit that a TLSv1-only client cannot connect
 * to a server whose minimum protocol is TLS 1.2; the client receives the
 * protocol-version alert instead of the OpenSSL version-specific matrix.
 */
function testLegacyProtocolUnsupported() {
  const server = tls.createServer({
    key: fixtures.readKey('agent2-key.pem'),
    cert: fixtures.readKey('agent2-cert.pem'),
    minVersion: 'TLSv1.2',
  }, common.mustNotCall());

  server.on('tlsClientError', common.mustCall());
  server.listen(0, common.mustCall(() => {
    const client = tls.connect({
      port: server.address().port,
      rejectUnauthorized: false,
      secureProtocol: 'TLSv1_method',
    }, common.mustNotCall());
    client.on('error', common.mustCall((err) => {
      assert.strictEqual(err.code, 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION');
      server.close();
    }));
  }));
}

/**
 * PSK works for TLS 1.2 in BoringSSL, but Node's PSK tests also cover the
 * default TLS 1.3 path. In that path BoringSSL does not complete a certificate-
 * less PSK-only handshake through Node's current server setup: the server
 * reports NO_CERTIFICATE_SET and the client receives an internal-error alert.
 */
function testPskTls13Unsupported() {
  const key = Buffer.from('d731ef57be09e5204f0b205b60627028', 'hex');
  let gotClientError = false;
  let gotServerError = false;
  function maybeClose(server) {
    if (gotClientError && gotServerError)
      server.close();
  }

  const server = tls.createServer({
    ciphers: 'PSK+HIGH',
    pskCallback() { return key; },
  }, common.mustNotCall());

  server.once('tlsClientError', common.mustCall((err) => {
    assert.strictEqual(err.code, 'ERR_SSL_NO_CERTIFICATE_SET');
    gotServerError = true;
    maybeClose(server);
  }));

  server.listen(0, common.mustCall(() => {
    const client = tls.connect({
      port: server.address().port,
      ciphers: 'PSK+HIGH',
      checkServerIdentity() {},
      pskCallback() {
        return { psk: key, identity: 'TestUser' };
      },
    }, common.mustNotCall());
    client.on('error', common.mustCall((err) => {
      assert.strictEqual(err.code, 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR');
      gotClientError = true;
      maybeClose(server);
    }));
  }));
}

/**
 * The OpenSSL ticket tests assume that once a TLS 1.3 session is reused, the
 * client will not necessarily receive a replacement session event before close.
 * BoringSSL emits new session tickets on both the initial and resumed TLS 1.3
 * connections, so the resumed connection still emits at least one 'session'
 * event while isSessionReused() is true.
 */
function testTls13SessionTicketSemanticsDiffer() {
  const server = tls.createServer({
    key: fixtures.readKey('agent1-key.pem'),
    cert: fixtures.readKey('agent1-cert.pem'),
  }, (socket) => socket.end());

  let session;
  let secondSessionEvents = 0;

  server.listen(0, common.mustCall(() => {
    const first = tls.connect({
      port: server.address().port,
      rejectUnauthorized: false,
    }, common.mustCall(() => {
      assert.strictEqual(first.isSessionReused(), false);
    }));
    first.on('session', common.mustCallAtLeast((sess) => {
      session = sess;
    }, 1));
    first.on('close', common.mustCall(() => {
      assert(Buffer.isBuffer(session));

      const second = tls.connect({
        port: server.address().port,
        rejectUnauthorized: false,
        session,
      }, common.mustCall(() => {
        assert.strictEqual(second.isSessionReused(), true);
      }));
      second.on('session', common.mustCallAtLeast(() => {
        secondSessionEvents++;
      }, 1));
      second.on('close', common.mustCall(() => {
        assert(secondSessionEvents > 0);
        server.close();
      }));
      second.resume();
    }));
    first.resume();
  }));
}

module.exports = {
  assertFiniteFieldDheUnsupported,
  assertNoCipherMatch,
  assertOpenSSLSecurityLevelsUnsupported,
  testEphemeralKeyInfoEcdheOnly,
  testLegacyProtocolUnsupported,
  testPskTls13Unsupported,
  testRenegotiationUnsupported,
  testTls13SessionTicketSemanticsDiffer,
};
