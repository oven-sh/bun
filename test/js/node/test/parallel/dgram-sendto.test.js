//#FILE: test-dgram-sendto.js
//#SHA1: 8047210c86bed6536f5ff3132e228a2ee9d0bb11
//-----------------
"use strict";

const dgram = require("dgram");

describe("dgram.sendto", () => {
  let socket;

  beforeEach(() => {
    socket = dgram.createSocket("udp4");
  });

  afterEach(() => {
    socket.close();
  });

  test("throws when called with no arguments", () => {
    expect(() => socket.sendto()).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });

  test('throws when "length" argument is invalid', () => {
    expect(() => socket.sendto("buffer", 1, "offset", "port", "address", "cb")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });

  test('throws when "offset" argument is invalid', () => {
    expect(() => socket.sendto("buffer", "offset", 1, "port", "address", "cb")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });

  test('throws when "address" argument is invalid', () => {
    expect(() => socket.sendto("buffer", 1, 1, 10, false, "cb")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });

  test('throws when "port" argument is invalid', () => {
    expect(() => socket.sendto("buffer", 1, 1, false, "address", "cb")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-dgram-sendto.js
