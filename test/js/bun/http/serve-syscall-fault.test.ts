import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isFreeBSD, isLinux, isWindows } from "harness";
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

// The accept() tests count event loop iterations. iterationsPerTimer() is the
// number of iterations for each of 10 timers of 10 ms. An idle loop makes about
// one. A listener that is backed off adds about two for each retry. A loop
// that retries a failing accept() with no delay makes hundreds, also when the
// process gets a small share of a core (CPU time against wall time does not
// show the difference on a loaded machine).
const iterationsPerTimer = /* js */ `
  async function iterationsPerTimer() {
    const before = getEventLoopStats().iteration;
    for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 10));
    return (getEventLoopStats().iteration - before) / 10;
  }
  // Who holds the loop's sweep timer: one for each linked socket, and one for
  // the time that a listener is backed off.
  function sweepState() {
    const { acceptBackoffPending, sweepTimerCount } = getEventLoopStats();
    return { backedOff: acceptBackoffPending, sweepTimerCount };
  }
  // The state while a listener is backed off. A retry puts the listener back
  // into the poll set for one iteration, so wait for an iteration that is not
  // that one.
  async function backedOffState() {
    for (let i = 0; i < 1000 && !getEventLoopStats().acceptBackoffPending; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    return sweepState();
  }
`;
const backsOff = (idle: number, failing: number) => failing <= idle + 8;

// A Bun.serve child with a fault on accept() and a client on its own loop.
// ENOBUFS stands for an error that can repeat: on macOS the kernel drops the
// connection on EMFILE, so that one does not repeat there.
// `body` runs after the server listens and stops the server.
const injectedAcceptFixture = (body: string) => /* js */ `
  import { socketFaultInjection as fault, getEventLoopStats } from "bun:internal-for-testing";
  import net from "node:net";
  import os from "node:os";
  ${iterationsPerTimer}
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
  fault.set({ syscall: "accept", action: "errno", errno: os.constants.errno.ENOBUFS, repeat: -1 });
  const client = net.connect({ port: server.port, host: "127.0.0.1" });
  let text = "";
  client.on("data", chunk => (text += chunk));
  client.on("error", () => {});
  await new Promise(resolve => client.once("connect", resolve));
  // The request makes the listener readable also where accept() is deferred until data arrives.
  await new Promise((resolve, reject) =>
    client.write("GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n", err => (err ? reject(err) : resolve())),
  );
  // The status line, once the whole response arrived.
  const response = () =>
    new Promise((resolve, reject) => {
      const check = () => text.endsWith("ok") && resolve(text.slice(0, text.indexOf("\\r\\n")));
      client.on("data", check);
      client.on("close", () => reject(new Error("closed before a response: " + JSON.stringify(text))));
      check();
    });
  ${body}
`;

async function runInjectedAcceptFixture(body: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", injectedAcceptFixture(body)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let result: any = stdout.trim();
  try {
    result = JSON.parse(result);
  } catch {}
  return { result, signalCode: proc.signalCode, exitCode, stderrTail: exitCode === 0 ? "" : stderr.slice(-2000) };
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
  test.concurrent("accept → ENOBUFS: a listener that cannot be registered again is retried", async () => {
    const { result, ...exit } = await runInjectedAcceptFixture(`
      await iterationsPerTimer();
      // Only the backed-off listener registers a poll now, so its next retry
      // takes this failure. If the accepted socket took it, the client would
      // be reset and response() would reject.
      fault.set({ syscall: "poll_start", action: "errno", errno: os.constants.errno.ENOMEM, repeat: 1 });
      await iterationsPerTimer();
      fault.set({ syscall: "accept", action: "none" });
      console.log(JSON.stringify({ status: await response() }));
      client.destroy();
      server.stop(true);
    `);
    expect({ result, ...exit }).toEqual({
      result: { status: "HTTP/1.1 200 OK" },
      signalCode: null,
      exitCode: 0,
      stderrTail: "",
    });
  });

  test.concurrent(
    "accept → ENOBUFS: stop() of a backed-off server returns the sweep timer and lets the process exit",
    async () => {
      const { result, ...exit } = await runInjectedAcceptFixture(`
      await iterationsPerTimer();
      const during = await backedOffState();
      client.destroy();
      server.stop(true);
      // The close of the listener asks for the pass that ends the episode.
      let after = sweepState();
      for (let i = 0; i < 1000 && (after.backedOff || after.sweepTimerCount > 0); i++) {
        await new Promise(resolve => setImmediate(resolve));
        after = sweepState();
      }
      console.log(JSON.stringify({ during, after }));
    `);
      expect({ result, ...exit }).toEqual({
        // The client's socket and the episode hold the sweep timer.
        result: { during: { backedOff: true, sweepTimerCount: 2 }, after: { backedOff: false, sweepTimerCount: 0 } },
        signalCode: null,
        exitCode: 0,
        stderrTail: "",
      });
    },
  );
});

// The same without the injector, so it runs on every Linux build: the process
// is at its descriptor limit when a client connects, and accept() fails with
// EMFILE. The client is this process, so no socket is linked on the server's
// loop and the back-off holds the only reference to the sweep timer. Not for
// macOS: there the kernel drops the connection when accept() cannot get a
// descriptor, so "served once a descriptor is free" does not hold.
test.concurrent.skipIf(!isLinux && !isFreeBSD)(
  "Bun.serve at the descriptor limit backs off instead of retrying accept() with no delay, then serves the queued client",
  async () => {
    const child = /* js */ `
      import { getEventLoopStats } from "bun:internal-for-testing";
      import { closeSync, openSync } from "node:fs";
      ${iterationsPerTimer}
      const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
      const lines = console[Symbol.asyncIterator]();
      const idle = await iterationsPerTimer();
      const before = sweepState();
      const held = [];
      for (;;) {
        try {
          held.push(openSync("/dev/null", "r"));
        } catch (e) {
          if (e.code !== "EMFILE") throw e;
          break;
        }
      }
      console.log(JSON.stringify({ port: server.port }));
      // The parent connected and wrote its request: the connection waits in the backlog.
      await lines.next();
      const failing = await iterationsPerTimer();
      const during = await backedOffState();
      for (const fd of held) closeSync(fd);
      // The parent got its response and keeps the connection open.
      await lines.next();
      console.log(JSON.stringify({ idle, failing, before, during, after: sweepState() }));
      await lines.next();
      server.stop(true);
    `;
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `ulimit -n 256 && exec "$1" --no-install -e "$2"`, "sh", bunExe(), child],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = proc.stderr.text();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    async function nextLine() {
      for (;;) {
        const newline = buffered.indexOf("\n");
        if (newline >= 0) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          return JSON.parse(line);
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("server exited early: " + (await stderr).slice(-2000));
        buffered += decoder.decode(value);
      }
    }
    async function tellChild(line: string) {
      proc.stdin.write(line + "\n");
      await proc.stdin.flush();
    }

    const { port } = await nextLine();
    const client = net.connect({ port, host: "127.0.0.1" });
    let text = "";
    const response = new Promise<string>((resolve, reject) => {
      client.on("data", chunk => {
        text += chunk;
        if (text.endsWith("ok")) resolve(text.slice(0, text.indexOf("\r\n")));
      });
      client.on("error", reject);
      client.on("close", () => reject(new Error("closed before a response: " + JSON.stringify(text))));
    });
    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => resolve());
      client.once("error", reject);
    });
    // The request makes the listener readable also where accept() is deferred until data arrives.
    await new Promise<void>((resolve, reject) =>
      client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n", err => (err ? reject(err) : resolve())),
    );
    await tellChild("queued");
    const status = await response;
    await tellChild("served");
    const { idle, failing, ...sweep } = await nextLine();
    client.destroy();
    await tellChild("closed");
    proc.stdin.end();
    const exitCode = await proc.exited;
    expect({
      rates: { idle, failing },
      backsOff: backsOff(idle, failing),
      status,
      ...sweep,
      signalCode: proc.signalCode,
      exitCode,
    }).toEqual({
      rates: expect.anything(),
      backsOff: true,
      status: "HTTP/1.1 200 OK",
      before: { backedOff: false, sweepTimerCount: 0 },
      during: { backedOff: true, sweepTimerCount: 1 },
      // The accepted connection is the one holder that is left.
      after: { backedOff: false, sweepTimerCount: 1 },
      signalCode: null,
      exitCode: 0,
    });
  },
);
