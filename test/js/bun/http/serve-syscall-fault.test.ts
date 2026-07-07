import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isWindows } from "harness";

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

// Each test spawns its own isolated server subprocess on port:0 with no shared state, so run concurrently.
describe.concurrent.skipIf(skip)("Bun.serve under injected syscall faults", () => {
  test("send → short writes (1 byte) deliver complete fixed-length body", async () => {
    const { proc, port } = await spawnServer(/* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1",
        fetch: () => new Response(Buffer.alloc(16384, 0x61)) });
      fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
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

  test("client abort under server-side 1-byte sends: every response reaches a terminal state", async () => {
    const { proc, port } = await spawnServer(/* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1",
        fetch: () => new Response(new ReadableStream({
          start(c) { c.enqueue(Buffer.alloc(32768, 0x42)); c.close(); }
        })) });
      fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
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
