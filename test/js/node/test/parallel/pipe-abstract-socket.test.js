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
    const expectedErrorMessage = "The argument 'options' can not set readableAll or writableAll to true when path is abstract unix socket. Received";

    test("throws when setting readableAll to true", () => {
      const options = {
        path,
        readableAll: true,
      };

      expect(() => {
        const server = net.createServer(jest.fn());
        server.listen(options);
      }).toThrow(
        expect.objectContaining({
          message: `${expectedErrorMessage} ${JSON.stringify(options)}`,
          code: "ERR_INVALID_ARG_VALUE",
        }),
      );
    });

    test("throws when setting writableAll to true", () => {
      const options = {
        path,
        writableAll: true,
      } ;

      expect(() => {
        const server = net.createServer(jest.fn());
        server.listen(options);
      }).toThrow(
        expect.objectContaining({
          message: `${expectedErrorMessage} ${JSON.stringify(options)}`,
          code: "ERR_INVALID_ARG_VALUE",
        }),
      );
    });

    test("throws when setting both readableAll and writableAll to true", () => {
      const options = {
        path,
        readableAll: true,
        writableAll: true,
      };

      expect(() => {
        const server = net.createServer(jest.fn());
        server.listen(options);
      }).toThrow(
        expect.objectContaining({
          message: `${expectedErrorMessage} ${JSON.stringify(options)}`,
          code: "ERR_INVALID_ARG_VALUE",
        }),
      );
    });
  });
}

//<#END_FILE: test-pipe-abstract-socket.js
