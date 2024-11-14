//#FILE: test-dgram-connect-send-multi-string-array.js
//#SHA1: 611c15bc8089ffcae85adaa91bff5031c776a8ab
//-----------------
"use strict";

const dgram = require("dgram");

test("dgram.createSocket can send multi-string array", done => {
  const socket = dgram.createSocket("udp4");
  const data = ["foo", "bar", "baz"];

  socket.on("message", (msg, rinfo) => {
    socket.close();
    expect(msg.toString()).toBe(data.join(""));
    done();
  });

  socket.bind(0, () => {
    socket.connect(socket.address().port, () => {
      socket.send(data);
    });
  });
});

//<#END_FILE: test-dgram-connect-send-multi-string-array.js
