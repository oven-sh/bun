//#FILE: test-dgram-udp4.js
//#SHA1: 588735591046212fc512f69d9001ccb820c57a71
//-----------------
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

"use strict";
const dgram = require("dgram");

const message_to_send = "A message to send";
const localhostIPv4 = "127.0.0.1";

test("UDP4 server and client communication", async () => {
  const server = dgram.createSocket("udp4");

  const serverMessagePromise = new Promise(resolve => {
    server.on("message", (msg, rinfo) => {
      expect(rinfo.address).toBe(localhostIPv4);
      expect(msg.toString()).toBe(message_to_send);
      server.send(msg, 0, msg.length, rinfo.port, rinfo.address);
      resolve();
    });
  });

  const listeningPromise = new Promise(resolve => {
    server.on("listening", resolve);
  });

  server.bind(0);

  await listeningPromise;

  const client = dgram.createSocket("udp4");
  const port = server.address().port;

  const clientMessagePromise = new Promise(resolve => {
    client.on("message", (msg, rinfo) => {
      expect(rinfo.address).toBe(localhostIPv4);
      expect(rinfo.port).toBe(port);
      expect(msg.toString()).toBe(message_to_send);
      resolve();
    });
  });

  client.send(message_to_send, 0, message_to_send.length, port, "localhost");

  await Promise.all([serverMessagePromise, clientMessagePromise]);

  const clientClosePromise = new Promise(resolve => {
    client.on("close", resolve);
  });

  const serverClosePromise = new Promise(resolve => {
    server.on("close", resolve);
  });

  client.close();
  server.close();

  await Promise.all([clientClosePromise, serverClosePromise]);
});

//<#END_FILE: test-dgram-udp4.js
