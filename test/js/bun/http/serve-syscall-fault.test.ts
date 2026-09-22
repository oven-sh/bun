import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isLinux, isWindows, tempDir } from "harness";
import { join } from "node:path";

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

// us_socket_resume() fails a socket whose poll the kernel refuses to take back
// (the dispatcher parks a paused socket whose peer hung up, so the resume is a
// fresh EPOLL_CTL_ADD and can fail the way a first registration can). The
// runtime resumes from inside its own work: the request-body hooks and the
// response-end path. A close dispatched there destructs the uWS response and
// frees the RequestContext that work still uses.
//
// epoll only: kqueue and libuv never park the fd, so their resume is a plain
// filter/poll change with nothing for the hook to fail. Each case runs in a
// subprocess so a use-after-free surfaces as a non-zero exit.
describe.skipIf(skip || !isLinux)("Bun.serve: a request-socket resume that fails the socket", () => {
  // The unix socket lives in a directory of the test, so a fixture that
  // crashes, which is the failure these cases catch, leaves nothing behind.
  async function spawnFixture(args: (socket: string) => string[]) {
    using dir = tempDir("serve-resume-fault", {});
    const socket = join(String(dir), "s.sock");
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args(socket)],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1", SERVE_RESUME_FAULT_SOCKET: socket },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  async function run(mode: string, expected: string[]) {
    const { stdout, stderr, exitCode, signalCode } = await spawnFixture(socket => [
      join(import.meta.dir, "serve-resume-fault-fixture.ts"),
      mode,
      socket,
    ]);
    expect({
      stdout: stdout.trim().split("\n"),
      signalCode,
      exitCode,
      // Only populated when the assertion is about to fail, so the diff shows why.
      stderrTail: exitCode === 0 ? "" : stderr.slice(-3000),
    }).toEqual({ stdout: expected, signalCode: null, exitCode: 0, stderrTail: "" });
  }

  // Each ping is a connection of its own. The one after the handler fails if
  // the resume did not consume the injected failure.
  const ping = "HTTP/1.1 200 OK, pong";
  // The body the handler waits for can no longer arrive, so the read rejects
  // like any other connection that dies mid-body.
  const bodyFails = [`before: ${ping}`, "abort", "body: rejected AbortError", `after: ${ping}`, "done"];

  // Not concurrent: each case starts a debug + ASAN binary, and four at once push each other past the default timeout.
  test("req.arrayBuffer() rejects and the server stays up", () => run("body-buffered", bodyFails));

  test("req.text() on a materialized body rejects and the server stays up", () => run("body-stream", bodyFails));

  // The handler answered, so the request is complete: ending it must not
  // deliver an abort, and the connection closes with the response.
  test("a response that ends while the body is paused completes", () =>
    run("response-ends", [`before: ${ping}`, `after: ${ping}`, "done"]));

  // The fixture is a test file of its own: expect().rejects is what waits on
  // the loop from inside a dispatch. The close has to come from that inner
  // tick, so a fixture that never finishes is the failure here.
  test("a dispatch that waits on the loop for the failed socket gets its close", async () => {
    const { stderr, exitCode, signalCode } = await spawnFixture(() => [
      "test",
      join(import.meta.dir, "serve-resume-fault-nested-fixture.ts"),
    ]);
    expect({
      passed: stderr.includes(" 1 pass") && stderr.includes(" 0 fail"),
      signalCode,
      exitCode,
      stderrTail: exitCode === 0 ? "" : stderr.slice(-3000),
    }).toEqual({ passed: true, signalCode: null, exitCode: 0, stderrTail: "" });
  });
});
