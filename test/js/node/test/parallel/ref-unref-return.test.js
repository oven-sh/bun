//#FILE: test-ref-unref-return.js
//#SHA1: c7275fa0ca17f1cee96244c48f1044ce4d2e67c1
//-----------------
"use strict";

const net = require("net");
const dgram = require("dgram");

test("ref and unref methods return the same instance", () => {
  expect(new net.Server().ref()).toBeInstanceOf(net.Server);
  expect(new net.Server().unref()).toBeInstanceOf(net.Server);
  expect(new net.Socket().ref()).toBeInstanceOf(net.Socket);
  expect(new net.Socket().unref()).toBeInstanceOf(net.Socket);
  expect(new dgram.Socket("udp4").ref()).toBeInstanceOf(dgram.Socket);
  expect(new dgram.Socket("udp6").unref()).toBeInstanceOf(dgram.Socket);
});

//<#END_FILE: test-ref-unref-return.js
