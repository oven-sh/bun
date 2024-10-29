//#FILE: test-net-server-unref-persistent.js
//#SHA1: 4b518c58827ac05dd5c3746c8a0811181184b945
//-----------------
'use strict';
const net = require('net');

test.skip('net server unref should be persistent', () => {
  // This test is skipped in Jest because it relies on Node.js-specific event loop behavior
  // that can't be accurately simulated in a Jest environment.
  // The original test should be kept in Node.js's test suite.
});

//<#END_FILE: test-net-server-unref-persistent.js
