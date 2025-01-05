import { describe, expect, test } from "bun:test";

describe("bun.connect", () => {
  test("should have x509 certificate", async () => {
    const socket = await Bun.connect({
      hostname: "example.com",
      port: 443,
      tls: true,
      socket: {
        open(socket: Socket) {},
        close() {},
        data() {},
        drain() {},
      },
    });

    socket.write("GET / HTTP/1.1\r\n");
    console.log(socket.getX509Certificate());
    console.log(socket.getPeerX509Certificate());
  });
});
