import { once } from "node:events";
import http from "node:http";
import net from "node:net";

const release = Promise.withResolvers<void>();
const inflight = Promise.withResolvers<void>();
let server: http.Server | null = http.createServer((req, res) => {
  inflight.resolve();
  release.promise.then(() => res.end("ok"));
});
try {
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  await once(client, "connect");
  let received = "";
  client.setEncoding("latin1").on("data", d => (received += d));
  client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  await inflight.promise;
  // Busy during close(), so the connection survives it and is keep-alive again
  // once the response is out.
  server.close();
  server = null;
  release.resolve();
  while (!received.endsWith("ok")) await once(client, "data");
  // The client end no longer holds the loop; the process exits now iff the
  // closed server doesn't either.
  client.unref();
  process.on("exit", () => {
    console.log(
      JSON.stringify({ status: received.split("\r\n")[0], connectionOpenAtExit: client.readyState === "open" }),
    );
  });
} finally {
  if (server?.listening) server.close();
}
