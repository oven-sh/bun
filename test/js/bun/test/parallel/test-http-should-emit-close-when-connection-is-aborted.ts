import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
const { expect } = createTest(import.meta.path);

await using server = http.createServer().listen(0);
await once(server, "listening");

// Use a raw net.Socket for the client rather than fetch() + AbortController.
// fetch() abort hops to the HTTP thread before the socket is closed, and on
// Windows that cross-thread close can race the server socket's AFD poll
// re-submission, so the disconnect is never observed and the test times out.
// A net.Socket lives on the same event loop as the server and refs it while
// connected, so destroy() is observed deterministically. The server-side
// behavior under test (IncomingMessage "close" + aborted=true on client
// disconnect) is independent of which client tore down the connection.
const socket = net.connect({ port: server.address().port, host: "127.0.0.1" });
await once(socket, "connect");
socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");

const [req, res] = await once(server, "request");
const closeEvent = Promise.withResolvers();
req.once("close", () => {
  closeEvent.resolve();
});
socket.destroy();
await closeEvent.promise;
expect(req.aborted).toBe(true);
