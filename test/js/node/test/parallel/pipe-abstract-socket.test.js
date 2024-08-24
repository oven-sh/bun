//#FILE: test-pipe-abstract-socket.js
//#SHA1: 085e51018c26c846b8ea9a2b23da4f45f37fe82f
//-----------------
"use strict";

const net = require("net");

const isLinux = process.platform === "linux";

if (!isLinux) {
  it.skip("Skipping test on non-Linux platforms", () => {});
} else {
  describe("Abstract Unix socket tests", () => {
    const path = "\0abstract";
    const expectedErrorMessage = "can not set readableAll or writableAllt to true when path is abstract unix socket";

    test("throws when setting readableAll to true", () => {
      expect(() => {
        const server = net.createServer(jest.fn());
        server.listen({
          path,
          readableAll: true,
        });
      }).toThrow(
        expect.objectContaining({
          message: expect.any(String),
        }),
      );
    });

    test("throws when setting writableAll to true", () => {
      expect(() => {
        const server = net.createServer(jest.fn());
        server.listen({
          path,
          writableAll: true,
        });
      }).toThrow(
        expect.objectContaining({
          message: expect.any(String),
        }),
      );
    });

    test("throws when setting both readableAll and writableAll to true", () => {
      expect(() => {
        const server = net.createServer(jest.fn());
        server.listen({
          path,
          readableAll: true,
          writableAll: true,
        });
      }).toThrow(
        expect.objectContaining({
          message: expect.any(String),
        }),
      );
    });
  });
}

//<#END_FILE: test-pipe-abstract-socket.js
