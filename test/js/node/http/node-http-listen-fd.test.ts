import { expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

// Socket activation: a supervisor (systemd LISTEN_FDS, inetd, a
// privilege-dropping parent) binds and listens, then hands the descriptor to
// the process that serves it. The donor server below stands in for the
// supervisor; the child inherits its own copy of the fd as fd 3.
async function serveOnInheritedFd(fixture: string) {
  const donor = net.createServer(() => {});
  await new Promise<void>(resolve => donor.listen(0, "127.0.0.1", () => resolve()));
  const fd = (donor as any)._handle.fd;
  const port = (donor.address() as net.AddressInfo).port;

  using dir = tempDir("listen-fd", { "fixture.js": fixture });

  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(String(dir), "fixture.js")],
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe", fd],
  });

  try {
    // Await the child's own "listening" callback rather than a fixed delay.
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let banner = "";
    while (!banner.includes("\n")) {
      const { done, value } = await reader.read();
      if (done) break;
      banner += decoder.decode(value, { stream: true });
    }

    const res = await fetch(`http://127.0.0.1:${port}/`);
    return { banner: banner.trim(), body: await res.text() };
  } finally {
    proc.kill();
    donor.close();
  }
}

test.skipIf(!isPosix)("http.Server.listen({ fd }) serves on an inherited listening socket", async () => {
  const { banner, body } = await serveOnInheritedFd(`
    const http = require("http");
    const server = http.createServer((req, res) => res.end("served-on-inherited-fd"));
    server.on("error", e => { console.log("ERROR " + e.code); process.exit(1); });
    server.listen({ fd: 3 }, () => console.log("LISTENING " + server.address().address));
  `);

  expect(banner).toBe("LISTENING 127.0.0.1");
  expect(body).toBe("served-on-inherited-fd");
});

test.skipIf(!isPosix)("net.Server.listen({ fd }) serves on an inherited listening socket", async () => {
  const { banner, body } = await serveOnInheritedFd(`
    const net = require("net");
    const server = net.createServer(sock => {
      sock.end("HTTP/1.1 200 OK\\r\\ncontent-length: 3\\r\\nconnection: close\\r\\n\\r\\nnet");
    });
    server.on("error", e => { console.log("ERROR " + e.code); process.exit(1); });
    server.listen({ fd: 3 }, () => console.log("LISTENING " + server.address().address));
  `);

  expect(banner).toBe("LISTENING 127.0.0.1");
  expect(body).toBe("net");
});

// The adopted fd must actually be a listening socket. Polling a regular file
// or a connected socket would never become acceptable, so the caller would
// hang instead of being told the descriptor is unusable.
test.skipIf(!isPosix)("listen({ fd }) rejects a descriptor that is not a listening socket", async () => {
  using dir = tempDir("listen-fd-bad", { "not-a-socket.txt": "hello" });
  const fd = fs.openSync(path.join(String(dir), "not-a-socket.txt"), "r");

  try {
    const server = net.createServer(() => {});
    const result = await new Promise<any>(resolve => {
      server.once("error", (e: any) => resolve({ event: "error", code: e.code }));
      server.once("listening", () => resolve({ event: "listening", address: server.address() }));
      server.listen({ fd });
    });
    server.close();

    expect(result).toEqual({ event: "error", code: "ENOTSOCK" });
  } finally {
    fs.closeSync(fd);
  }
});
