'use strict';
const common = require('../common');
const assert = require('assert');

const net = require('net');
const http = require('http');

const server = http.createServer(function(request, response) {
  response.removeHeader('connection');

  if (request.httpVersion === '1.0') {
    const socket = request.socket;
    response.on('finish', common.mustCall(function() {
      assert.ok(socket.writableEnded);
    }));
  }

  response.end('beep boop\n');
});

const agent = new http.Agent({ keepAlive: true });

function makeHttp11Request(cb) {
  http.get({
    port: server.address().port,
    agent
  }, function(res) {
    const socket = res.socket;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers.connection, undefined);

    res.setEncoding('ascii');
    let response = '';
    res.on('data', function(chunk) {
      response += chunk;
    });
    res.on('end', function() {
      assert.strictEqual(response, 'beep boop\n');

      process.nextTick(function() {
        cb(socket);
      });
    });
  });
}

function makeHttp10Request(cb) {
  const socket = net.connect({ port: server.address().port }, function() {
    socket.write('GET / HTTP/1.0\r\n' +
               'Host: localhost:' + server.address().port + '\r\n' +
                '\r\n');
    socket.resume();

    socket.on('close', cb);
  });
}

server.listen(0, function() {
  makeHttp11Request(function(firstSocket) {
    makeHttp11Request(function(secondSocket) {
      assert.strictEqual(firstSocket, secondSocket);

      makeHttp10Request(function() {
        server.close();
      });
    });
  });
});