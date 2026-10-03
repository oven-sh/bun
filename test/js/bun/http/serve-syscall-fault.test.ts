import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isLinux, isWindows } from "harness";

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

// A Bun.serve child for the accept() tests. `body` runs after the server
// listens. The child exits by itself: a listener that is backed off must not
// keep the event loop alive.
//
// iterationsPerTimer() is the number of event loop iterations for each of 20
// timers of 10 ms. An idle loop makes about one. A listener that is backed off
// adds about two for each retry, which is four per timer. A loop that retries
// a failing accept() with no delay makes hundreds, and still many when the
// process gets a small share of a core (CPU time against wall time does not
// show the difference on a loaded machine).
const acceptFixture = (body: string) => /* js */ `
  import { socketFaultInjection as fault, getEventLoopStats } from "bun:internal-for-testing";
  import { closeSync, openSync } from "node:fs";
  import net from "node:net";
  import os from "node:os";

  async function iterationsPerTimer() {
    const before = getEventLoopStats().iteration;
    for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 10));
    return (getEventLoopStats().iteration - before) / 20;
  }

  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });

  function connectClient() {
    const client = net.connect({ port: server.port, host: "127.0.0.1" });
    let text = "";
    client.on("data", chunk => (text += chunk));
    client.on("error", () => {});
    return {
      client,
      connected: new Promise(resolve => client.once("connect", resolve)),
      // The request makes the listener readable also where accept() is deferred until data arrives.
      sendRequest: () =>
        new Promise((resolve, reject) =>
          client.write("GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n", err => (err ? reject(err) : resolve())),
        ),
      // The status line, once the whole response arrived.
      response: () =>
        new Promise((resolve, reject) => {
          const check = () => text.endsWith("ok") && resolve(text.slice(0, text.indexOf("\\r\\n")));
          client.on("data", check);
          client.on("close", () => reject(new Error("closed before a response: " + JSON.stringify(text))));
          check();
        }),
    };
  }

  ${body}
  server.stop(true);
`;

async function runAcceptFixture(body: string, ulimit?: number) {
  const script = acceptFixture(body);
  await using proc = Bun.spawn({
    cmd: ulimit
      ? ["/bin/sh", "-c", `ulimit -n ${ulimit} && exec "$1" --no-install -e "$2"`, "sh", bunExe(), script]
      : [bunExe(), "-e", script],
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

// `failing` is the loop's iteration rate while accept() fails, `idle` the same
// loop before.
const backsOff = (idle: number, failing: number) => failing <= idle + 8;

// Each accept() test runs a Bun child that takes a few seconds on a debug+ASAN
// build, more than the 5000ms default of a bare `bun bd test <file>`.
const ACCEPT_TIMEOUT_MS = 30_000;

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

  test.concurrent(
    "accept → EMFILE, ENFILE, ENOBUFS or ENOMEM until disarmed: the listener backs off, the queued client is then served",
    async () => {
      const errnos = ["EMFILE", "ENFILE", "ENOBUFS", "ENOMEM"] as const;
      const { result, ...exit } = await runAcceptFixture(`
        const result = { idle: await iterationsPerTimer() };
        for (const errno of ${JSON.stringify(errnos)}) {
          fault.set({ syscall: "accept", action: "errno", errno: os.constants.errno[errno], repeat: -1 });
          const { client, connected, sendRequest, response } = connectClient();
          await connected;
          await sendRequest();
          const failing = await iterationsPerTimer();
          fault.clear();
          result[errno] = { failing, status: await response() };
          client.destroy();
        }
        console.log(JSON.stringify(result));
      `);
      const served = (errno: (typeof errnos)[number]) => ({
        status: result?.[errno]?.status,
        backsOff: backsOff(result?.idle, result?.[errno]?.failing),
      });
      expect({ rates: result, ...Object.fromEntries(errnos.map(errno => [errno, served(errno)])), ...exit }).toEqual({
        rates: expect.anything(),
        EMFILE: { status: "HTTP/1.1 200 OK", backsOff: true },
        ENFILE: { status: "HTTP/1.1 200 OK", backsOff: true },
        ENOBUFS: { status: "HTTP/1.1 200 OK", backsOff: true },
        ENOMEM: { status: "HTTP/1.1 200 OK", backsOff: true },
        signalCode: null,
        exitCode: 0,
        stderrTail: "",
      });
    },
    ACCEPT_TIMEOUT_MS,
  );

  test.concurrent(
    "accept → EMFILE: a listener that cannot be registered again is retried",
    async () => {
      const { result, ...exit } = await runAcceptFixture(`
        fault.set({ syscall: "accept", action: "errno", errno: os.constants.errno.EMFILE, repeat: -1 });
        const { client, connected, sendRequest, response } = connectClient();
        await connected;
        await sendRequest();
        await iterationsPerTimer();
        // Only the backed-off listener registers a poll now, so its next retry
        // takes this failure. If the accepted socket took it, the client would
        // be reset and response() would reject.
        fault.set({ syscall: "poll_start", action: "errno", errno: os.constants.errno.ENOMEM, repeat: 1 });
        await iterationsPerTimer();
        fault.set({ syscall: "accept", action: "none" });
        console.log(JSON.stringify({ status: await response() }));
        client.destroy();
      `);
      expect({ result, ...exit }).toEqual({
        result: { status: "HTTP/1.1 200 OK" },
        signalCode: null,
        exitCode: 0,
        stderrTail: "",
      });
    },
    ACCEPT_TIMEOUT_MS,
  );

  test.concurrent(
    "accept → EMFILE: stop() of a backed-off server lets the process exit",
    async () => {
      const { result, ...exit } = await runAcceptFixture(`
        fault.set({ syscall: "accept", action: "errno", errno: os.constants.errno.EMFILE, repeat: -1 });
        const { client, connected, sendRequest } = connectClient();
        await connected;
        await sendRequest();
        await iterationsPerTimer();
        client.destroy();
        console.log(JSON.stringify({ stopping: true }));
      `);
      expect({ result, ...exit }).toEqual({
        result: { stopping: true },
        signalCode: null,
        exitCode: 0,
        stderrTail: "",
      });
    },
    ACCEPT_TIMEOUT_MS,
  );
});

// The same without the injector, so it runs on every Linux build: the process
// is at its descriptor limit when the client connects, and accept() fails with
// EMFILE. The connection waits in the backlog and is served once a descriptor
// is free.
test.concurrent.skipIf(!isLinux)(
  "Bun.serve at the descriptor limit backs off instead of retrying accept() with no delay",
  async () => {
    const { result, ...exit } = await runAcceptFixture(
      `
        const idle = await iterationsPerTimer();
        const forTheClient = openSync("/dev/null", "r");
        const held = [];
        for (;;) {
          try {
            held.push(openSync("/dev/null", "r"));
          } catch (e) {
            if (e.code !== "EMFILE") throw e;
            break;
          }
        }
        // The client's socket takes the one descriptor that is free.
        closeSync(forTheClient);
        const { client, connected, sendRequest, response } = connectClient();
        await connected;
        await sendRequest();
        const failing = await iterationsPerTimer();
        for (const fd of held) closeSync(fd);
        console.log(JSON.stringify({ idle, failing, status: await response() }));
        client.destroy();
      `,
      512,
    );
    expect({ result, backsOff: backsOff(result?.idle, result?.failing), ...exit }).toEqual({
      result: { idle: expect.any(Number), failing: expect.any(Number), status: "HTTP/1.1 200 OK" },
      backsOff: true,
      signalCode: null,
      exitCode: 0,
      stderrTail: "",
    });
  },
  ACCEPT_TIMEOUT_MS,
);
