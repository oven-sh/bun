'use strict';
const net = require('net');

const options = { port: 0, reusePort: true };

function checkSupportReusePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer().listen(options);
    server.on('listening', () => {
      server.close(resolve);
    });
    server.on('error', (err) => {
      console.log('The `reusePort` option is not supported:', err.message);
      server.close();
      reject(err);
    });
  });
}

function hasMultiLocalhost() {
  // Bun has no process.binding('tcp_wrap'); without a synchronous bind probe, report false so
  // multi-localhost tests skip (node skips them on most platforms too).
  try {
    const { TCP, constants: TCPConstants } = process.binding('tcp_wrap');
    const t = new TCP(TCPConstants.SOCKET);
    const ret = t.bind('127.0.0.2', 0);
    t.close();
    return ret === 0;
  } catch {
    return false;
  }
}

module.exports = {
  checkSupportReusePort,
  hasMultiLocalhost,
  options,
};
