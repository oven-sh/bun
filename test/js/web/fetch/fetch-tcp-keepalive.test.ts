// Verifies that fetch() enables TCP keepalive (SO_KEEPALIVE + TCP_KEEPIDLE)
// on its client sockets, matching Node/undici behavior, and that
// `keepalive: false` (the existing RequestInit option that also disables
// HTTP connection pooling) skips it. node:http forwards `agent.keepAlive`
// to fetch's `keepalive`, so the same gate covers Node compat.
//
// The option lives on the fd, so it must be set once per connection: the
// second half of the file counts the setsockopt(SO_KEEPALIVE) calls with an
// LD_PRELOAD shim and checks that a request served by a pooled connection
// does not set it again, and that a unix socket never sets it.
//
// Linux-only: reads /proc/<pid>/net/tcp for the kernel's view of the
// socket's keepalive timer, and uses LD_PRELOAD. Other platforms skip.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import http from "node:http";
import { join } from "node:path";

// OHOS sandbox denies reading /proc/self/net/tcp (EACCES), so the probe
// cannot run there even though the platform reports "linux".
const linuxOnly = test.skipIf(!isLinux || Bun.env.BUN_OHOS === "1");

// Spin up a server that holds the response open, run the request via
// `startRequest`, and return the kernel timer field for the client
// socket. The server is fresh per call so the connection pool can't
// reuse a socket from a previous test (different port → different key).
async function probeClientSocket(startRequest: (url: string) => Promise<{ drain: () => Promise<void> }>) {
  // Server that holds the connection open so the client socket stays
  // ESTABLISHED long enough to inspect.
  await using server = Bun.serve({
    port: 0,
    async fetch(req, server) {
      // The client's ephemeral port identifies the TCP connection that
      // carried the request: a reused keep-alive socket keeps its port.
      const headers = { "x-client-port": String(server.requestIP(req)?.port) };
      if (new URL(req.url).pathname === "/warmup") {
        return new Response("ok", { headers });
      }
      // Keep the response streaming so the client socket stays open
      // while we inspect /proc/net/tcp from the client side.
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("hold"));
            await Bun.sleep(500);
            controller.close();
          },
        }),
        { headers },
      );
    },
  });

  const port = server.port;
  const { drain } = await startRequest(`http://127.0.0.1:${port}/`);

  // Parse /proc/self/net/tcp: find ESTABLISHED (state 01) socket with
  // remote port = server.port. Column 5 is the timer field
  // "<timer_active>:<jiffies_until_expiry>". Per net/ipv4/tcp_ipv4.c
  // get_tcp4_sock(): 0=no timer, 1=retransmit, 4=zero-window probe,
  // 2=sk_timer armed — which is the keepalive timer on an idle
  // established socket. Empirically: without SO_KEEPALIVE this field is
  // "00:00000000"; with it, "02:<jiffies>".
  const tcp = await Bun.file("/proc/self/net/tcp").text();
  const portHex = port.toString(16).toUpperCase().padStart(4, "0");
  let found = false;
  let timerActive = "";
  for (const line of tcp.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 6) continue;
    const [, remote, state, , timer] = cols.slice(1, 6);
    // remote = server port. state 01 = ESTABLISHED. The client socket's
    // remote_address is the server; the server's listening socket has
    // state 0A and the server's accepted socket has the client port in
    // remote — so this matches only the client side.
    if (state === "01" && remote.endsWith(":" + portHex)) {
      found = true;
      timerActive = timer.split(":")[0];
    }
  }

  await drain();
  expect(found).toBe(true);
  return timerActive;
}

// Await headers + first chunk so the socket is ESTABLISHED and the
// client's outbound GET has been ACKed (piggybacked on the response)
// before we read /proc — otherwise a retransmit timer (01) could mask
// the keepalive timer (02) in the kernel's timer field.
async function fetchAndHold(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  const reader = resp.body!.getReader();
  await reader.read();
  return { drain: () => reader.cancel() };
}

linuxOnly("fetch sockets have TCP keepalive enabled", async () => {
  const timerActive = await probeClientSocket(url => fetchAndHold(url));
  // Without SO_KEEPALIVE: "00". With it: "02" (sk_timer / keepalive armed).
  expect(timerActive).toBe("02");
});

linuxOnly("fetch keepalive: false skips SO_KEEPALIVE (matches undici options.keepAlive)", async () => {
  const timerActive = await probeClientSocket(url => fetchAndHold(url, { keepalive: false }));
  expect(timerActive).toBe("00");
});

linuxOnly("a connection reused from the keep-alive pool still has TCP keepalive enabled", async () => {
  const timerActive = await probeClientSocket(async url => {
    // The first request opens the connection and, once its body is
    // consumed, returns the socket to the pool.
    const warmup = await fetch(new URL("/warmup", url));
    await warmup.text();
    // The second request must be served by that same connection, on which
    // SO_KEEPALIVE was set only when it was opened.
    const resp = await fetch(url);
    expect(resp.headers.get("x-client-port")).toBe(warmup.headers.get("x-client-port"));
    const reader = resp.body!.getReader();
    await reader.read();
    return { drain: () => reader.cancel() };
  });
  expect(timerActive).toBe("02");
});

linuxOnly("node:http with non-keepalive Agent skips SO_KEEPALIVE", async () => {
  // `agent: false` constructs a fresh `new Agent()` whose `keepAlive`
  // defaults to false; _http_client.ts forwards that as fetch
  // `keepalive: false`.
  const timerActive = await probeClientSocket(async url => {
    const { promise, resolve, reject } = Promise.withResolvers<http.IncomingMessage>();
    const req = http.get(url, { agent: false }, resolve);
    req.on("error", reject);
    const res = await promise;
    await new Promise<void>(r => res.once("data", () => r()));
    return {
      drain: async () => {
        res.destroy();
        req.destroy();
      },
    };
  });
  expect(timerActive).toBe("00");
});

linuxOnly("node:http globalAgent (keepAlive: true) enables SO_KEEPALIVE", async () => {
  const timerActive = await probeClientSocket(async url => {
    const { promise, resolve, reject } = Promise.withResolvers<http.IncomingMessage>();
    const req = http.get(url, resolve);
    req.on("error", reject);
    const res = await promise;
    await new Promise<void>(r => res.once("data", () => r()));
    return {
      drain: async () => {
        res.destroy();
        req.destroy();
      },
    };
  });
  expect(timerActive).toBe("02");
});

// ---------------------------------------------------------------------------
// setsockopt(SO_KEEPALIVE) call counting.
//
// The kernel exposes whether keepalive is on, not how many times it was set,
// so the client runs in a child process with an LD_PRELOAD shim that logs one
// "SO_KEEPALIVE fd=N" line to stderr per setsockopt(SOL_SOCKET, SO_KEEPALIVE)
// call. The server runs in this process, so the child's only sockets are the
// fetch client sockets.

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const shimTests = test.skipIf(!isLinux || !cc);

const SHIM_C = String.raw`
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <sys/socket.h>
#include <unistd.h>

static int (*real_setsockopt)(int, int, int, const void *, socklen_t);

int setsockopt(int fd, int level, int optname, const void *optval, socklen_t optlen) {
    if (!real_setsockopt) {
        real_setsockopt = (int (*)(int, int, int, const void *, socklen_t)) dlsym(RTLD_NEXT, "setsockopt");
    }
    if (level == SOL_SOCKET && optname == SO_KEEPALIVE) {
        char line[64];
        int n = snprintf(line, sizeof line, "SO_KEEPALIVE fd=%d\n", fd);
        if (n > 0) {
            ssize_t unused = write(2, line, (size_t) n);
            (void) unused;
        }
    }
    return real_setsockopt(fd, level, optname, optval, optlen);
}
`;

// Sequential requests to one origin. Each response body is the client port
// the server saw, so the output proves how many connections were used.
const POOLED_FIXTURE = /* js */ `
const ports = [];
for (let i = 0; i < Number(process.env.REQUEST_COUNT); i++) {
  const res = await fetch(process.env.SERVER_URL);
  ports.push(await res.text());
}
console.log(JSON.stringify(ports));
`;

const UNIX_FIXTURE = /* js */ `
const bodies = [];
for (let i = 0; i < Number(process.env.REQUEST_COUNT); i++) {
  const res = await fetch("http://localhost/", { unix: process.env.UNIX_PATH });
  bodies.push(await res.text());
}
console.log(JSON.stringify(bodies));
`;

let shimDir: ReturnType<typeof tempDir> | undefined;
let shimPath: string;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  shimDir = tempDir("fetch-so-keepalive-count", {
    "shim.c": SHIM_C,
    "pooled.js": POOLED_FIXTURE,
    "unix.js": UNIX_FIXTURE,
  });
  shimPath = join(String(shimDir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-o", shimPath, join(String(shimDir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) {
    throw new Error(`shim compile failed: ${ccErr || ccOut}`);
  }
});

afterAll(() => {
  shimDir?.[Symbol.dispose]();
});

async function runWithShim(fixture: string, env: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    cwd: String(shimDir),
    env: {
      ...bunEnv,
      ...env,
      LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shimPath}:${bunEnv.LD_PRELOAD}` : shimPath,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const keepaliveCalls = stderr.match(/SO_KEEPALIVE fd=\d+/g) ?? [];
  return { stdout, stderr, exitCode, keepaliveCalls };
}

shimTests("SO_KEEPALIVE is set once per connection, not once per request on a pooled connection", async () => {
  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, server) => new Response(String(server.requestIP(req)?.port)),
  });

  const { stdout, stderr, exitCode, keepaliveCalls } = await runWithShim("pooled.js", {
    SERVER_URL: server.url.href,
    REQUEST_COUNT: "5",
  });

  const ports: string[] = JSON.parse(stdout.trim());
  // All five requests went over one connection...
  expect(ports).toHaveLength(5);
  expect(new Set(ports).size).toBe(1);
  // ...so keepalive was set up exactly once.
  expect(keepaliveCalls, stderr).toHaveLength(1);
  expect(exitCode).toBe(0);
});

shimTests("fetch over a unix socket does not set SO_KEEPALIVE", async () => {
  const unix = join(String(shimDir), "server.sock");
  await using server = Bun.serve({
    unix,
    fetch: () => new Response("ok"),
  });

  const { stdout, stderr, exitCode, keepaliveCalls } = await runWithShim("unix.js", {
    UNIX_PATH: unix,
    REQUEST_COUNT: "2",
  });

  expect(JSON.parse(stdout.trim())).toEqual(["ok", "ok"]);
  expect(keepaliveCalls, stderr).toHaveLength(0);
  expect(exitCode).toBe(0);
});
