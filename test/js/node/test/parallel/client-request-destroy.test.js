//#FILE: test-client-request-destroy.js
//#SHA1: 343919bc022f2956e9aab5c9a215cbadca2364f1
//-----------------
"use strict";

// Test that http.ClientRequest.prototype.destroy() returns `this`.

const http = require("http");

test("http.ClientRequest.prototype.destroy() returns `this`", () => {
  const clientRequest = new http.ClientRequest({ createConnection: () => {} });

  expect(clientRequest.destroyed).toBe(false);
  expect(clientRequest.destroy()).toBe(clientRequest);
  expect(clientRequest.destroyed).toBe(true);
  expect(clientRequest.destroy()).toBe(clientRequest);
});

//<#END_FILE: test-client-request-destroy.js
