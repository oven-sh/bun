//#FILE: test-diagnostics-channel-udp.js
//#SHA1: 13d46f3f2404ee7cd53a551b90fc1ced191d4a81
//-----------------
"use strict";

const dgram = require("dgram");
const dc = require("diagnostics_channel");

const udpSocketChannel = dc.channel("udp.socket");

const isUDPSocket = socket => socket instanceof dgram.Socket;

test("udp.socket channel emits UDP socket", () => {
  const channelCallback = jest.fn(({ socket }) => {
    expect(isUDPSocket(socket)).toBe(true);
  });

  udpSocketChannel.subscribe(channelCallback);

  const socket = dgram.createSocket("udp4");
  socket.close();

  expect(channelCallback).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-diagnostics-channel-udp.js
