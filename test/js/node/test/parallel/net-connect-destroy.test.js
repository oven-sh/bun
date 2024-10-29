//#FILE: test-net-connect-destroy.js
//#SHA1: a185f5169d7b2988a09b74d9524743beda08dcff
//-----------------
'use strict';
const net = require('net');

test('Socket is destroyed and emits close event', (done) => {
  const socket = new net.Socket();
  
  socket.on('close', () => {
    // The close event was emitted
    expect(true).toBe(true);
    done();
  });

  socket.destroy();
});

//<#END_FILE: test-net-connect-destroy.js
