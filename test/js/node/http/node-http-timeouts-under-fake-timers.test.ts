import { expect, jest, test } from "bun:test";
import http from "node:http";
import net from "node:net";

// As in Node, fake timers don't stop the timers of builtin modules.
test("the timeout of a server fires in real time under fake timers", async () => {
  jest.useFakeTimers();
  try {
    const server = http.createServer(() => {});
    const fired = new Promise<string>(resolve =>
      server.setTimeout(100, socket => {
        socket.destroy();
        resolve("timeout");
      }),
    );
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    client.on("error", () => {});
    client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
    expect(await fired).toBe("timeout");
    client.destroy();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  } finally {
    jest.useRealTimers();
  }
}, 5000);
