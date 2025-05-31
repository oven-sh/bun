'use strict';
const common = require('../common');
const assert = require('assert');
const net = require('net');
const msg = 'test';
let stopped = true;
let server1Sock;

const server1ConnHandler = (socket) => {
  socket.on('data', function(data) {
    if (stopped) {
      assert.fail('data event should not have happened yet');
    }
    assert.strictEqual(data.toString(), msg);
    socket.end();
    server1.close();
  });

  server1Sock = socket;
};

const server1 = net.createServer({ pauseOnConnect: true }, server1ConnHandler);

const server2ConnHandler = (socket) => {
  socket.on('data', function(data) {
    assert.strictEqual(data.toString(), msg);
    socket.end();
    server2.close();

    assert.strictEqual(server1Sock.bytesRead, 0);
    server1Sock.resume();
    stopped = false;
  });
};

const server2 = net.createServer({ pauseOnConnect: false }, server2ConnHandler);

server1.listen(0, function() {
  const clientHandler = common.mustCall(function() {
    server2.listen(0, function() {
      net.createConnection({ port: this.address().port }).write(msg);
    });
  });
  net.createConnection({ port: this.address().port }).write(msg, clientHandler);
});

process.on('exit', function() {
  assert.strictEqual(stopped, false);
});
