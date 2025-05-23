'use strict';
// Flags: --expose-gc
// just like test-gc-http-client-timeout.js,
// but using a net server/client instead

require('../common');
if (require("../../../../harness").isASAN) return; // TODO: BUN
const { onGC } = require('../common/gc');
const assert = require('assert');
const net = require('net');
const os = require('os');

setTimeout(() => process.exit(1), 5000).unref();

function serverHandler(sock) {
  sock.setTimeout(120000);
  sock.resume();
  sock.on('close', function() {
    clearTimeout(timer);
  });
  sock.on('end', function() {
    clearTimeout(timer);
  });
  sock.on('error', function(err) {
    assert.strictEqual(err.code, 'ECONNRESET');
  });
  const timer = setTimeout(function() {
    sock.end('hello\n');
  }, 500);
}

const cpus = os.availableParallelism();
console.log(`cpus: ${cpus}`);
let createClients = true;
let done = 0;
let count = 0;
let countGC = 0;

const server = net.createServer(serverHandler);
server.listen(0, getAll);

function getAll() {
  if (!createClients)
    return;

  const req = net.connect(server.address().port);
  req.resume();
  req.setTimeout(250, function() {
    req.destroy();
    done++;
  });

  count++;
  onGC(req, { ongc });

  setImmediate(getAll);
}

for (let i = 0; i < cpus; i++)
  getAll();

function ongc() {
  countGC++;
}

setImmediate(status);

function status() {
  if (done > 0) {
    createClients = false;
    global.gc();
    console.log(`done/collected/total: ${done}/${countGC}/${count}/${require("bun:jsc").heapStats().objectTypeCounts.TCPSocket-1}`);
    if (countGC === count) {
      server.close();
      return;
    }
  }

  setTimeout(status,100);
}
