//#FILE: test-net-connect-after-destroy.js
//#SHA1: 9341bea710601b5a3a8e823f4847396b210a855c
//-----------------
'use strict';

const net = require('net');

test('net.createConnection after destroy', () => {
  // Connect to something that we need to DNS resolve
  const c = net.createConnection(80, 'google.com');
  
  // The test passes if this doesn't throw an error
  expect(() => {
    c.destroy();
  }).not.toThrow();
});

//<#END_FILE: test-net-connect-after-destroy.js
