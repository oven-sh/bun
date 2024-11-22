//#FILE: test-http2-request-response-proto.js
//#SHA1: ffffac0d4d11b6a77ddbfce366c206de8db99446
//-----------------
'use strict';

const hasCrypto = (() => {
  try {
    require('crypto');
    return true;
  } catch (err) {
    return false;
  }
})();

let http2;

if (!hasCrypto) {
  test.skip('missing crypto', () => {});
} else {
  http2 = require('http2');

  const {
    Http2ServerRequest,
    Http2ServerResponse,
  } = http2;

  describe('Http2ServerRequest and Http2ServerResponse prototypes', () => {
    test('protoRequest should be instance of Http2ServerRequest', () => {
      const protoRequest = { __proto__: Http2ServerRequest.prototype };
      expect(protoRequest instanceof Http2ServerRequest).toBe(true);
    });

    test('protoResponse should be instance of Http2ServerResponse', () => {
      const protoResponse = { __proto__: Http2ServerResponse.prototype };
      expect(protoResponse instanceof Http2ServerResponse).toBe(true);
    });
  });
}

//<#END_FILE: test-http2-request-response-proto.js
