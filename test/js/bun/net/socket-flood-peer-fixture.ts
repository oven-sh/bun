// A peer that sends without pause: it keeps the receive queue of whatever
// connects to it full. Prints its port. Exits when the connection closes.
//
//   bun socket-flood-peer-fixture.ts <tcp|tls>
import { join } from "node:path";

const chunk = Buffer.alloc(1 << 20, "x");
const fill = (socket: Bun.Socket) => {
  while (socket.write(chunk) === chunk.length);
};
const tls = process.argv[2] === "tls";

const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  tls: tls
    ? {
        cert: Bun.file(join(import.meta.dir, "../http/fixtures/cert.pem")),
        key: Bun.file(join(import.meta.dir, "../http/fixtures/cert.key")),
      }
    : undefined,
  socket: {
    open(socket) {
      if (!tls) fill(socket);
    },
    handshake: fill,
    drain: fill,
    data() {},
    error() {},
    close() {
      process.exit(0);
    },
  },
});
console.log(listener.port);
