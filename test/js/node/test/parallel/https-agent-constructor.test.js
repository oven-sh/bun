//#FILE: test-https-agent-constructor.js
//#SHA1: 6b63dcb4d1a1a60f19fbb26cb555013821af5791
//-----------------
"use strict";

if (!process.versions.openssl) {
  test.skip("missing crypto");
}

const https = require("https");

test("https.Agent constructor", () => {
  expect(new https.Agent()).toBeInstanceOf(https.Agent);
  expect(https.Agent()).toBeInstanceOf(https.Agent);
});

//<#END_FILE: test-https-agent-constructor.js
