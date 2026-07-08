import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

test("http.Server: server.timeout defaults to 0 and reflects setTimeout()", () => {
  const srv = http.createServer(() => {});
  try {
    expect(srv.timeout).toBe(0);

    const returned = srv.setTimeout(1234);
    expect(returned).toBe(srv);
    expect(srv.timeout).toBe(1234);

    srv.timeout = 4321;
    expect(srv.timeout).toBe(4321);

    srv.setTimeout(0);
    expect(srv.timeout).toBe(0);
  } finally {
    srv.close();
  }
});

// Node.js treats `server.timeout = N` and `server.setTimeout(N)` as the same
// knob; assigning the property must apply the idle timeout to subsequent
// sockets so a stalled connection is eventually closed.
test("http.Server: assigning server.timeout closes a stalled connection", async () => {
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end("ok"));
  });
  try {
    srv.listen(0, "127.0.0.1");
    await once(srv, "listening");

    srv.timeout = 500;
    expect(srv.timeout).toBe(500);

    const addr = srv.address() as net.AddressInfo;
    const client = net.connect(addr.port, "127.0.0.1");
    client.setNoDelay(true);
    client.on("error", () => {});
    client.resume();
    await once(client, "connect");
    // Complete request head, then stall the body.
    client.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 900\r\n\r\nab");

    const [timedOutSocket] = (await once(srv, "timeout")) as [net.Socket];
    timedOutSocket.destroy();
    await once(client, "close");

    client.destroy();
  } finally {
    srv.closeAllConnections?.();
    srv.close();
  }
}, 20_000);
