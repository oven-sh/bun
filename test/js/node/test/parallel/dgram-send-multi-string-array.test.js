//#FILE: test-dgram-send-multi-string-array.js
//#SHA1: 8ea2007ac52bfde3742aabe352aab19bf91a4ac2
//-----------------
"use strict";

const dgram = require("dgram");

test("dgram send multiple strings as array", done => {
  const socket = dgram.createSocket("udp4");
  const data = ["foo", "bar", "baz"];

  socket.on("message", (msg, rinfo) => {
    socket.close();
    expect(msg.toString()).toBe(data.join(""));
    done();
  });

  socket.bind(() => {
    socket.send(data, socket.address().port, "localhost");
  });
});

//<#END_FILE: test-dgram-send-multi-string-array.js
