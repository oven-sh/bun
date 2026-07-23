// Fixture for the out-of-memory path of the per-loop TLS plaintext buffer.
//
// us_internal_init_loop_ssl_data() allocates one 512 KiB buffer per event loop,
// lazily, on the loop's first TLS socket. A NULL return used to go unnoticed:
// every later SSL_read handed BoringSSL `NULL + LIBUS_RECV_BUFFER_PADDING` as
// its plaintext destination and memcpy faulted on the first record of
// application data. malloc() of 512 KiB effectively never returns NULL on an
// overcommitting kernel, so the fault injector is the only way here from a
// test; on Windows it is a routine failure.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { tls as certs } from "harness";
import tls from "node:tls";
import type { AddressInfo } from "node:net";

if (!fault.available()) throw new Error("socket fault injection is not available in this build");

// Nothing in this process has attached a TLS socket yet, so the next attach is
// the one that allocates the loop's buffer.
fault.set({ syscall: "ssl_loop_buffer", action: "errno", errno: "ENOMEM" });
console.log("ARMED");

const server = tls.createServer({ key: certs.key, cert: certs.cert }, socket => {
  socket.on("error", () => {});
  // Comfortably more than 256 bytes: memcpy only reaches the
  // destination-alignment path that the crash reports point at for copies
  // larger than 8 vector registers' worth.
  socket.write(Buffer.alloc(4096, 0x61));
});
server.on("error", () => {});

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address() as AddressInfo;
  const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
  client.on("error", () => {
    console.log("CLIENT ERROR");
    process.exit(0);
  });
  // Either of these means the allocation failure went unreported: the process
  // was supposed to abort before a TLS socket could reach its read loop.
  client.on("data", () => {
    console.log("READ DATA");
    process.exit(0);
  });
  client.on("close", () => {
    console.log("CLOSED");
    process.exit(0);
  });
});
