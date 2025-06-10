'use strict';
const common = require('../common');
const assert = require('assert');
if (!common.hasCrypto) common.skip('missing crypto');
const fixtures = require('../common/fixtures');
const tls = require('tls');
const net = require('net');

// Sending tls data on a server TLSSocket with an active write led to a crash:
//
// node[1296]: ../src/crypto/crypto_tls.cc:963:virtual int node::crypto::TLSWrap::DoWrite(node::WriteWrap*,
//    uv_buf_t*, size_t, uv_stream_t*): Assertion `!current_write_' failed.
//  1: 0xb090e0 node::Abort() [node]
//  2: 0xb0915e  [node]
//  3: 0xca8413 node::crypto::TLSWrap::DoWrite(node::WriteWrap*, uv_buf_t*, unsigned long, uv_stream_s*) [node]
//  4: 0xcaa549 node::StreamBase::Write(uv_buf_t*, unsigned long, uv_stream_s*, v8::Local<v8::Object>) [node]
//  5: 0xca88d7 node::crypto::TLSWrap::EncOut() [node]
//  6: 0xca9ba8 node::crypto::TLSWrap::OnStreamRead(long, uv_buf_t const&) [node]
//  7: 0xca8eb0 node::crypto::TLSWrap::ClearOut() [node]
//  8: 0xca9ba0 node::crypto::TLSWrap::OnStreamRead(long, uv_buf_t const&) [node]
//  9: 0xbe50dd node::LibuvStreamWrap::OnUvRead(long, uv_buf_t const*) [node]
// 10: 0xbe54c4  [node]
// 11: 0x15583d7  [node]
// 12: 0x1558c00  [node]
// 13: 0x155ede4  [node]
// 14: 0x154d008 uv_run [node]

const serverReplaySize = 2 * 1024 * 1024;

(async function() {
  console.log('Starting test...');
  const tlsClientHello = await getClientHello();
  console.log('Got client hello, length:', tlsClientHello.length);

  const subserver = tls.createServer({
    key: fixtures.readKey('agent1-key.pem'),
    cert: fixtures.readKey('agent1-cert.pem'),
    ALPNCallback: common.mustCall(({ sn, protocols }) => {
      console.log('ALPN callback called with protocols:', protocols);
      // Once `subserver` receives `tlsClientHello` from the underlying net.Socket,
      // in this test, a TLSSocket actually, it should be able to proceed to the handshake
      // and emit this event
      assert.strictEqual(protocols[0], 'h2');
      return 'h2';
    }),
  });

  const server = tls.createServer({
    key: fixtures.readKey('agent1-key.pem'),
    cert: fixtures.readKey('agent1-cert.pem'),
  })
    .listen(startClient)
    .on('secureConnection', (serverTlsSock) => {
      console.log('Server received secure connection');
      // Craft writes that are large enough to stuck in sending
      // In reality this can be a 200 response to the incoming HTTP CONNECT
      const half = Buffer.alloc(serverReplaySize / 2, 0);
      console.log('Writing first half of data...');
      serverTlsSock.write(half, common.mustSucceed());
      console.log('Writing second half of data...');
      serverTlsSock.write(half, common.mustSucceed());

      console.log('Emitting connection to subserver...');
      subserver.emit('connection', serverTlsSock);
    });


  function startClient() {
    console.log('Starting client connection...');
    const clientTlsSock = tls.connect({
      host: '127.0.0.1',
      port: server.address().port,
      rejectUnauthorized: false,
    });

    const recv = [];
    let revcLen = 0;
    clientTlsSock.on('data', (chunk) => {
      console.log('Client received chunk of size:', chunk.length);
      revcLen += chunk.length;
      recv.push(chunk);
      if (revcLen > serverReplaySize) {
        console.log('Received enough data, checking server hello...');
        // Check the server's replay is followed by the subserver's TLS ServerHello
        const serverHelloFstByte = Buffer.concat(recv).subarray(serverReplaySize, serverReplaySize + 1);
        console.log('Server hello first byte:', serverHelloFstByte.toString('hex'));
        assert.strictEqual(serverHelloFstByte.toString('hex'), '16');
        process.exit(0);
      }
    });

    // In reality, one may want to send a HTTP CONNECT before starting this double TLS
    console.log('Writing client hello...');
    clientTlsSock.write(tlsClientHello);
  }
})().then(common.mustCall());

function getClientHello() {
  return new Promise((resolve) => {
    console.log('Creating temporary server to get client hello...');
    const server = net.createServer((sock) => {
      console.log('Temporary server received connection');
      sock.on('data', (chunk) => {
        console.log('Temporary server received client hello, length:', chunk.length);
        resolve(chunk);
      });
    })
    .listen(() => {
      console.log('Temporary server listening, connecting client...');
      tls.connect({
        port: server.address().port,
        host: '127.0.0.1',
        ALPNProtocols: ['h2'],
      }).on('error', () => {
        console.log('Client connection error (expected)');
      });
    });
  });
}
