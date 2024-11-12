//#FILE: test-net-socket-end-before-connect.js
//#SHA1: e09a7492b07dfa5467171563408395f653e9b032
//-----------------
'use strict';

const net = require('net');

test('Socket ends before connect', (done) => {
  const server = net.createServer();

  server.listen(() => {
    const socket = net.createConnection(server.address().port, "127.0.0.1");
    
    const closeHandler = function() {
      server.close();
      done();
    }
    socket.on('close', closeHandler);
    socket.end();
  });
});

//<#END_FILE: test-net-socket-end-before-connect.js
