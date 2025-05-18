import { it, expect } from "bun:test";

it("handles trailing headers split across packets", async () => {
  const server = await Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      open(socket) {
        socket.write("HTTP/1.1 200 OK\r\n");
        socket.write("Content-Type: text/plain\r\n");
        socket.write("Transfer-Encoding: chunked\r\n");
        socket.write("\r\n");
        socket.write("5\r\nHello\r\n");
        socket.write("7\r\n, world\r\n");
        socket.write("0\r\n");
        socket.flush();
        setTimeout(() => {
          socket.write("X-Trail: ok\r\n\r\n");
          socket.end();
        }, 10).unref();
      },
      data() {},
      close() {},
    },
  });

  const res = await fetch(`http://${server.hostname}:${server.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello, world");
  server.stop(true);
});
