// https://github.com/oven-sh/bun/issues/18982
// dockerode's container.attach() hangs because http.ClientRequest never emits 'upgrade'.
import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net, { type AddressInfo } from "node:net";

test("http.request emits 'upgrade' on 101 Switching Protocols (dockerode attach)", async () => {
  const server = net.createServer(conn => {
    conn.once("data", () => {
      conn.write(
        "HTTP/1.1 101 UPGRADED\r\n" +
          "Content-Type: application/vnd.docker.raw-stream\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: tcp\r\n" +
          "\r\n",
      );
      conn.on("data", chunk => conn.write(chunk));
    });
  });

  const { promise, resolve, reject } = Promise.withResolvers<AddressInfo>();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolve(server.address() as AddressInfo));
  const addr = await promise;

  try {
    const req = http.request({
      host: "127.0.0.1",
      port: addr.port,
      method: "POST",
      path: "/containers/test/attach?stream=1&stdin=1&stdout=1",
      headers: { Connection: "Upgrade", Upgrade: "tcp" },
    });
    req.end();

    const [res, socket] = await once(req, "upgrade");
    expect(res.statusCode).toBe(101);
    expect(res.headers.upgrade).toBe("tcp");

    const echoed = once(socket, "data");
    socket.write('echo "Hello, World!"\n');
    const [chunk] = await echoed;
    expect(chunk.toString()).toBe('echo "Hello, World!"\n');

    socket.end();
  } finally {
    server.close();
  }
});
