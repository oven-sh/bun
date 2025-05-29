'use strict';
require('../common');
const assert = require('assert');
const net = require('net');

const N = 50;
let client_recv_count = 0;
let client_end_count = 0;
let disconnect_count = 0;

const server = net.createServer(function(socket) {
  socket.resume();

  socket.write('hello\r\n');

  socket.on('end', () => {
    socket.end();
  });

  socket.on('close', (had_error) => {
    assert.strictEqual(had_error, false);
  });
});

server.listen(0, function() {
  const client = net.createConnection(this.address().port);

  client.setEncoding('UTF8');

  client.on('data', function(chunk) {
    client_recv_count += 1;
    assert.strictEqual(chunk, 'hello\r\n');
    client.end();
  });

  client.on('end', () => {
    client_end_count++;
  });

  client.on('close', (had_error) => {
    assert.strictEqual(had_error, false);
    if (disconnect_count++ < N)
      client.connect(server.address().port); // reconnect
    else
      server.close();
  });
});

process.on('exit', () => {
  assert.strictEqual(disconnect_count, N + 1);
  assert.strictEqual(client_recv_count, N + 1);
  assert.strictEqual(client_end_count, N + 1);
});
