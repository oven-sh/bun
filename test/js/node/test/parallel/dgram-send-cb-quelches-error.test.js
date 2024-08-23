//#FILE: test-dgram-send-cb-quelches-error.js
//#SHA1: 7525b0a8af0df192c36a848b23332424245d2937
//-----------------
"use strict";

const assert = require("assert");
const dgram = require("dgram");
const dns = require("dns");

test("dgram send callback quelches error", () => {
  const socket = dgram.createSocket("udp4");
  const buffer = Buffer.from("gary busey");

  dns.setServers([]);

  const onEvent = jest.fn(() => {
    throw new Error("Error should not be emitted if there is callback");
  });

  socket.once("error", onEvent);

  // assert that:
  // * callbacks act as "error" listeners if given.
  // * error is never emitter for missing dns entries
  //   if a callback that handles error is present
  // * error is emitted if a callback with no argument is passed
  socket.send(buffer, 0, buffer.length, 100, "dne.example.com", callbackOnly);

  function callbackOnly(err) {
    expect(err).toBeTruthy();
    socket.removeListener("error", onEvent);
    socket.on("error", onError);
    socket.send(buffer, 0, buffer.length, 100, "dne.invalid");
  }

  function onError(err) {
    expect(err).toBeTruthy();
    socket.close();
  }

  expect(onEvent).not.toHaveBeenCalled();
});

//<#END_FILE: test-dgram-send-cb-quelches-error.js
