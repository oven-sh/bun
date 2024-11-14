//#FILE: test-double-tls-client.js
//#SHA1: f0d01e282b2d7efc1e1770700f742345216a8bb3
//-----------------
"use strict";

const assert = require("assert");
const fixtures = require("../common/fixtures");
const tls = require("tls");

// In reality, this can be a HTTP CONNECT message, signaling the incoming
// data is TLS encrypted
const HEAD = "XXXX";

let subserver;
let server;

beforeAll(() => {
  subserver = tls.createServer({
    key: fixtures.readKey("agent1-key.pem"),
    cert: fixtures.readKey("agent1-cert.pem"),
  });

  subserver.on("secureConnection", () => {
    process.exit(0);
  });

  server = tls.createServer({
    key: fixtures.readKey("agent1-key.pem"),
    cert: fixtures.readKey("agent1-cert.pem"),
  });

  server.on("secureConnection", serverTlsSock => {
    serverTlsSock.on("data", chunk => {
      expect(chunk.toString()).toBe(HEAD);
      subserver.emit("connection", serverTlsSock);
    });
  });
});

afterAll(() => {
  server.close();
  subserver.close();
});

test("double TLS client", done => {
  const onSecureConnect = jest.fn();

  server.listen(() => {
    const down = tls.connect({
      host: "127.0.0.1",
      port: server.address().port,
      rejectUnauthorized: false,
    });

    down.on("secureConnect", () => {
      onSecureConnect();
      down.write(HEAD, err => {
        expect(err).toBeFalsy();

        // Sending tls data on a client TLSSocket with an active write led to a crash:
        //
        //  node[16862]: ../src/crypto/crypto_tls.cc:963:virtual int node::crypto::TLSWrap::DoWrite(node::WriteWrap*,
        //    uv_buf_t*, size_t, uv_stream_t*): Assertion `!current_write_' failed.
        //  1: 0xb090e0 node::Abort() [node]
        //  2: 0xb0915e  [node]
        //  3: 0xca8413 node::crypto::TLSWrap::DoWrite(node::WriteWrap*, uv_buf_t*, unsigned long, uv_stream_s*) [node]
        //  4: 0xcaa549 node::StreamBase::Write(uv_buf_t*, unsigned long, uv_stream_s*, v8::Local<v8::Object>) [node]
        //  5: 0xca88d7 node::crypto::TLSWrap::EncOut() [node]
        //  6: 0xd3df3e  [node]
        //  7: 0xd3f35f v8::internal::Builtin_HandleApiCall(int, unsigned long*, v8::internal::Isolate*) [node]
        //  8: 0x15d9ef9  [node]
        // Aborted
        tls.connect({
          socket: down,
          rejectUnauthorized: false,
        });

        expect(onSecureConnect).toHaveBeenCalledTimes(1);
        done();
      });
    });
  });
});

//<#END_FILE: test-double-tls-client.js
