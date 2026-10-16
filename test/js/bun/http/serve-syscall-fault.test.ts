import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isWindows } from "harness";
import net from "node:net";

const skip = !fault.available() || isWindows;

// Bun.serve is the server; faults are armed inside the server subprocess so
// only the server's bsd_* calls are affected.

async function spawnServer(body: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", body],
    env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1", ...env },
    stderr: "pipe",
    stdout: "pipe",
  });
  const reader = proc.stdout.getReader();
  let line = "";
  while (!line.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("server exited before ready: " + (await proc.stderr.text()));
    line += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  return { proc, port: Number(line.trim()) };
}

describe.skipIf(skip)("Bun.serve under injected syscall faults", () => {
  test("send → short writes (1 byte) deliver complete fixed-length body", async () => {
    const { proc, port } = await spawnServer(/* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1",
        fetch: () => new Response(Buffer.alloc(16384, 0x61)) });
      fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
      fault.set({ syscall: "writev", action: "short", bytes: 1, repeat: -1 });
      console.log(s.port);
      process.on("SIGTERM", () => { fault.clear(); s.stop(true); process.exit(0); });
    `);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      const buf = await res.arrayBuffer();
      expect({ status: res.status, length: buf.byteLength }).toEqual({ status: 200, length: 16384 });
    } finally {
      proc.kill("SIGTERM");
      await proc.exited;
    }
    expect(proc.signalCode).toBeNull();
    expect(proc.exitCode).toBe(0);
  });

  test("send → short writes deliver complete streaming ReadableStream body", async () => {
    const { proc, port } = await spawnServer(/* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1",
        fetch: () => new Response(new ReadableStream({
          start(c) { for (let i = 0; i < 8; i++) c.enqueue(Buffer.alloc(1024, i)); c.close(); }
        })) });
      fault.set({ syscall: "send", action: "short", bytes: 7, repeat: -1 });
      fault.set({ syscall: "writev", action: "short", bytes: 7, repeat: -1 });
      console.log(s.port);
      process.on("SIGTERM", () => { fault.clear(); s.stop(true); process.exit(0); });
    `);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      const buf = new Uint8Array(await res.arrayBuffer());
      expect(buf.length).toBe(8 * 1024);
      for (let i = 0; i < 8; i++) expect(buf[i * 1024]).toBe(i);
    } finally {
      proc.kill("SIGTERM");
      await proc.exited;
    }
    expect(proc.signalCode).toBeNull();
    expect(proc.exitCode).toBe(0);
  });

  test("recv → short reads (1 byte) deliver complete request body to handler", async () => {
    const { proc, port } = await spawnServer(/* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1",
        fetch: async (req) => new Response(String((await req.arrayBuffer()).byteLength)) });
      fault.set({ syscall: "recv", action: "short", bytes: 1, repeat: -1 });
      console.log(s.port);
      process.on("SIGTERM", () => { fault.clear(); s.stop(true); process.exit(0); });
    `);
    try {
      const body = Buffer.alloc(4096, "P");
      const res = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body });
      expect(await res.text()).toBe(String(body.length));
    } finally {
      proc.kill("SIGTERM");
      await proc.exited;
    }
    expect(proc.signalCode).toBeNull();
    expect(proc.exitCode).toBe(0);
  });

  test("https: send → short writes deliver complete body over TLS", async () => {
    const { proc, port } = await spawnServer(
      /* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1",
        tls: { key: process.env.KEY, cert: process.env.CERT },
        fetch: () => new Response(Buffer.alloc(8192, 0x54)) });
      fault.set({ syscall: "send", action: "short", bytes: 3, repeat: -1 });
      fault.set({ syscall: "writev", action: "short", bytes: 3, repeat: -1 });
      console.log(s.port);
      process.on("SIGTERM", () => { fault.clear(); s.stop(true); process.exit(0); });
    `,
      { KEY: certs.key, CERT: certs.cert },
    );
    try {
      const res = await fetch(`https://127.0.0.1:${port}/`, { tls: { ca: certs.cert } });
      const buf = await res.arrayBuffer();
      expect({ status: res.status, length: buf.byteLength }).toEqual({ status: 200, length: 8192 });
    } finally {
      proc.kill("SIGTERM");
      await proc.exited;
    }
    expect(proc.signalCode).toBeNull();
    expect(proc.exitCode).toBe(0);
  });

  test("server.timeout(req, N) holds when the socket takes none of a response that ended in the cork buffer", async () => {
    const { proc, port } = await spawnServer(/* js */ `
      const { socketFaultInjection: fault, runSocketTimeoutSweepSoon } = require("bun:internal-for-testing");
      // A socket of this process that sends nothing. Its 1 s timeout fires in the next sweep of the loop.
      const listener = Bun.listen({ port: 0, hostname: "127.0.0.1", socket: { data() {} } });
      let afterSweep = () => {};
      Bun.connect({ port: listener.port, hostname: "127.0.0.1",
        socket: { data() {}, timeout() { afterSweep(); } } }).then(witness => {
        const s = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 1,
          fetch(req, server) {
            server.timeout(req, 60);
            // The response ends with all of its bytes in the cork buffer, and no send moves one.
            fault.set({ syscall: "send", action: "zero", repeat: -1 });
            fault.set({ syscall: "writev", action: "zero", repeat: -1 });
            // One sweep runs over both connections. The sends work again when it has run.
            afterSweep = () => fault.clear();
            witness.timeout(1);
            runSocketTimeoutSweepSoon();
            return new Response("tail");
          } });
        console.log(s.port);
        process.on("SIGTERM", () => { fault.clear(); s.stop(true); process.exit(0); });
      });
    `);
    try {
      // The wire up to the end of the response, or up to the close if the server cut it.
      const wire = Promise.withResolvers<string>();
      const socket = net.connect(port, "127.0.0.1");
      let received = "";
      socket.on("error", () => {});
      socket.on("data", chunk => {
        received += chunk;
        if (received.endsWith("\r\n\r\ntail")) wire.resolve(received);
      });
      socket.on("close", () => wire.resolve(received));
      socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      try {
        expect(await wire.promise).toEndWith("\r\n\r\ntail");
      } finally {
        socket.destroy();
      }
    } finally {
      proc.kill("SIGTERM");
      await proc.exited;
    }
    expect(proc.signalCode).toBeNull();
    expect(proc.exitCode).toBe(0);
  });

  test("server.timeout(req, N) before server.upgrade(req) leaves the 101 and the first frame in one send", async () => {
    const { proc, port } = await spawnServer(/* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1",
        websocket: {
          open(ws) { ws.send("first-frame"); },
          // The client sends a frame when it has the 101. A first frame that is not out by then never leaves.
          message(ws) { ws.terminate(); },
        },
        fetch(req, server) {
          server.timeout(req, 60);
          // Only the first send from here on moves bytes: a first frame that is not in it never leaves.
          fault.set({ syscall: "send", action: "zero", after: 1, repeat: -1 });
          if (server.upgrade(req)) return;
          return new Response("no upgrade", { status: 400 });
        } });
      console.log(s.port);
      process.on("SIGTERM", () => { fault.clear(); s.stop(true); process.exit(0); });
    `);
    try {
      // An unmasked text frame of 11 bytes.
      const frame = "\x81\x0bfirst-frame";
      // The wire up to the frame, or up to the close if the frame did not come.
      const wire = Promise.withResolvers<string>();
      const socket = net.connect(port, "127.0.0.1");
      let received = "";
      let asked = false;
      socket.on("error", () => {});
      socket.on("data", chunk => {
        received += chunk.toString("latin1");
        if (received.endsWith(frame)) return wire.resolve(received);
        if (!asked && received.includes("\r\n\r\n")) {
          asked = true;
          // A masked text frame "done" with a zero mask: the server ends the connection.
          socket.write(Buffer.from([0x81, 0x84, 0, 0, 0, 0, 0x64, 0x6f, 0x6e, 0x65]));
        }
      });
      socket.on("close", () => wire.resolve(received));
      socket.write(
        "GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
          "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      );
      try {
        const got = await wire.promise;
        expect({ switched: got.startsWith("HTTP/1.1 101 "), firstFrame: got.endsWith(frame) }).toEqual({
          switched: true,
          firstFrame: true,
        });
      } finally {
        socket.destroy();
      }
    } finally {
      proc.kill("SIGTERM");
      await proc.exited;
    }
    expect(proc.signalCode).toBeNull();
    expect(proc.exitCode).toBe(0);
  });

  test("client abort under server-side 1-byte sends: every response reaches a terminal state", async () => {
    const { proc, port } = await spawnServer(/* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1",
        fetch: () => new Response(new ReadableStream({
          start(c) { c.enqueue(Buffer.alloc(32768, 0x42)); c.close(); }
        })) });
      fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
      fault.set({ syscall: "writev", action: "short", bytes: 1, repeat: -1 });
      console.log(s.port);
      // Graceful stop() resolves only once every in-flight response has
      // reached a terminal state, so a leaked/hung response = test timeout.
      process.on("SIGTERM", () => { fault.clear(); s.stop().then(() => process.exit(0)); });
    `);
    try {
      const N = 6;
      await Promise.all(
        Array.from({ length: N }, async () => {
          const c = new AbortController();
          const res = await fetch(`http://127.0.0.1:${port}/`, { signal: c.signal });
          const reader = res.body!.getReader();
          await reader.read();
          c.abort();
        }),
      );
    } finally {
      proc.kill("SIGTERM");
      await proc.exited;
    }
    expect(proc.signalCode).toBeNull();
    expect(proc.exitCode).toBe(0);
  });
});
