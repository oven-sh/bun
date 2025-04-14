// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';
const common = require('../common');
const assert = require('assert');
const fork = require('child_process').fork;
const net = require('net');
const debug = require('util').debuglog('test');

const Countdown = require('../common/countdown');

if (process.argv[2] === 'child') {
  console.log('[child] Starting child process');
  let serverScope;

  // TODO(@jasnell): The message event is not called consistently
  // across platforms. Need to investigate if it can be made
  // more consistent.
  const onServer = (msg, server) => {
    console.log('[child] Received message:', msg);
    if (msg.what !== 'server') return;
    process.removeListener('message', onServer);
    console.log('[child] Received server from parent');

    serverScope = server;

    // TODO(@jasnell): This is apparently not called consistently
    // across platforms. Need to investigate if it can be made
    // more consistent.
    server.on('connection', (socket) => {
      console.log('[child] Got connection');
      debug('CHILD: got connection');
      process.send({ what: 'connection' });
      socket.destroy();
    });

    // Start making connection from parent.
    console.log('[child] Server listening');
    debug('CHILD: server listening');
    process.send({ what: 'listening' });
  };

  process.on('message', onServer);

  // TODO(@jasnell): The close event is not called consistently
  // across platforms. Need to investigate if it can be made
  // more consistent.
  const onClose = (msg) => {
    if (msg.what !== 'close') return;
    console.log('[child] Received close message:', msg);
    process.removeListener('message', onClose);
    console.log('[child] Closing server');

    serverScope.on('close', common.mustCall(() => {
      console.log('[child] Server closed');
      process.send({ what: 'close' });
    }));
    serverScope.close();
  };

  process.on('message', onClose);

  console.log('[child] Sending ready message');
  process.send({ what: 'ready' });
} else {
  console.log('[parent] Starting parent process');

  const child = fork(process.argv[1], ['child']);
  console.log('[parent] Child process forked');

  child.on('exit', common.mustCall((code, signal) => {
    console.log(`[parent] Child process exited with code ${code}, signal ${signal}`);
    const message = `CHILD: died with ${code}, ${signal}`;
    assert.strictEqual(code, 0, message);
  }));

  // Send net.Server to child and test by connecting.
  function testServer(callback) {
    console.log('[parent] Testing server');

    // Destroy server execute callback when done.
    const countdown = new Countdown(2, () => {
      console.log('[parent] Countdown completed, closing server');
      server.on('close', common.mustCall(() => {
        console.log('[parent] Server closed');
        debug('PARENT: server closed');
        child.send({ what: 'close' });
      }));
      server.close();
    });

    // We expect 4 connections and close events.
    const connections = new Countdown(4, () => {
      console.log('[parent] All connections received');
      countdown.dec();
    });
    const closed = new Countdown(4, () => {
      console.log('[parent] All connections closed');
      countdown.dec();
    });

    // Create server and send it to child.
    const server = net.createServer();
    console.log('[parent] Server created');

    // TODO(@jasnell): The specific number of times the connection
    // event is emitted appears to be variable across platforms.
    // Need to investigate why and whether it can be made
    // more consistent.
    server.on('connection', (socket) => {
      console.log('[parent] Got connection');
      debug('PARENT: got connection');
      socket.destroy();
      connections.dec();
    });

    server.on('listening', common.mustCall(() => {
      console.log('[parent] Server listening on port', server.address().port);
      debug('PARENT: server listening');
      child.send({ what: 'server' }, server);
    }));
    server.listen(0);

    // Handle client messages.
    // TODO(@jasnell): The specific number of times the message
    // event is emitted appears to be variable across platforms.
    // Need to investigate why and whether it can be made
    // more consistent.
    const messageHandlers = (msg) => {
      console.log('[parent] Received message from child:', msg);
      if (msg.what === 'listening') {
        console.log('[parent] Child server is listening, making connections');
        // Make connections.
        let socket;
        for (let i = 0; i < 4; i++) {
          console.log('[parent] Creating connection', i + 1);
          socket = net.connect(server.address().port, common.mustCall(() => {
            console.log('[parent] Client connected', i + 1);
            debug('CLIENT: connected');
          }));
          socket.on('close', common.mustCall(() => {
            console.log('[parent] Client connection closed');
            closed.dec();
            debug('CLIENT: closed');
          }));
        }

      } else if (msg.what === 'connection') {
        console.log('[parent] Child received connection');
        // Child got connection
        connections.dec();
      } else if (msg.what === 'close') {
        console.log('[parent] Child server closed');
        child.removeListener('message', messageHandlers);
        callback();
      }
    };

    child.on('message', messageHandlers);
  }

  const onReady = common.mustCall((msg) => {
    console.log('[parent] Received message from child:', msg);
    if (msg.what !== 'ready') return;
    console.log('[parent] Child is ready');
    child.removeListener('message', onReady);
    testServer(common.mustCall(() => {
      console.log('[parent] Test server completed');
    }));
  });

  // Create server and send it to child.
  child.on('message', onReady);
}
