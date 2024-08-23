//#FILE: test-http2-request-response-proto.js
//#SHA1: ffffac0d4d11b6a77ddbfce366c206de8db99446
//-----------------
"use strict";

const http2 = require("http2");

const { Http2ServerRequest, Http2ServerResponse } = http2;

test("Http2ServerRequest and Http2ServerResponse prototypes", () => {
  const protoRequest = { __proto__: Http2ServerRequest.prototype };
  const protoResponse = { __proto__: Http2ServerResponse.prototype };

  expect(protoRequest).toBeInstanceOf(Http2ServerRequest);
  expect(protoResponse).toBeInstanceOf(Http2ServerResponse);
});

//<#END_FILE: test-http2-request-response-proto.js
