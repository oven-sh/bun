'use strict';

const common = require('../common');
const http = require('http');
const net = require('net');
const assert = require('assert');
const stream = require('stream');
function request(socket, count) {
  const request = `GET / HTTP/1.1\r\nConnection: keep-alive\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n`;
  socket.write(request.repeat(count));
}

const server = http.createServer(common.mustCall((req, res) => {
  res.end('ok');
}));

server.on('dropRequest', common.mustCall((request, socket) => {
  assert.strictEqual(request instanceof http.IncomingMessage, true);
  // FIXME: fix this today is not a net.Socket but a Duplex
  // assert.strictEqual(socket instanceof net.Socket, true);
  assert.strictEqual(socket instanceof stream.Duplex, true);
  server.close();
}));

server.listen(0, "127.0.0.1", common.mustCall(() => {
  const socket = net.connect(server.address().port);
  socket.on('connect', common.mustCall(() => {
   request(socket, server.maxRequestsPerSocket + 1);
 }));
  socket.on('data', common.mustCallAtLeast());
  socket.on('close', common.mustCall());
}));

server.maxRequestsPerSocket = 1;
