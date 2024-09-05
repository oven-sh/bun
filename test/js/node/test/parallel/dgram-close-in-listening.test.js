//#FILE: test-dgram-close-in-listening.js
//#SHA1: b37e742b092d70824b67c4ad4d3e1bb17a8c5cd5
//-----------------
"use strict";

const dgram = require("dgram");

test("dgram socket closed before sendQueue is drained does not crash", done => {
  const buf = Buffer.alloc(1024, 42);

  const socket = dgram.createSocket("udp4");

  socket.on("listening", function () {
    socket.close();
  });

  // Get a random port for send
  const portGetter = dgram.createSocket("udp4").bind(0, "localhost", () => {
    // Adds a listener to 'listening' to send the data when
    // the socket is available
    socket.send(buf, 0, buf.length, portGetter.address().port, portGetter.address().address);

    portGetter.close();
    done(); // Signal test completion
  });
});

//<#END_FILE: test-dgram-close-in-listening.js
