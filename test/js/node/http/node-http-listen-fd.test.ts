import { expect, test } from "bun:test";
import { isPosix } from "harness";
import http from "node:http";
import net from "node:net";

// Bun.serve cannot adopt an inherited listening descriptor, so http.Server
// must report an error for listen({ fd }) instead of silently binding a fresh
// random port (which left the service unreachable on the intended socket).
test.skipIf(!isPosix)(
  "http.Server.listen({ fd }) reports EINVAL instead of silently binding a random port",
  async () => {
    const donor = net.createServer(() => {});
    try {
      await new Promise<void>(resolve => donor.listen(0, "127.0.0.1", () => resolve()));
      const fd = (donor as any)._handle.fd;
      expect(typeof fd).toBe("number");
      expect(fd).toBeGreaterThanOrEqual(0);

      const server = http.createServer((req, res) => res.end("ok"));
      const result = await new Promise<any>(resolve => {
        server.once("error", (e: any) => resolve({ event: "error", code: e.code, errno: e.errno, syscall: e.syscall }));
        server.once("listening", () => resolve({ event: "listening", address: server.address() }));
        server.listen({ fd });
      });
      server.close();

      // POSIX-only test, so the libuv errno is -22 (Windows reports -4071).
      expect(result).toEqual({ event: "error", code: "EINVAL", errno: -22, syscall: "listen" });
    } finally {
      donor.close();
    }
  },
);
