// An LD_PRELOAD shim makes epoll_ctl(EPOLL_CTL_ADD) fail with ENOSPC (what the
// kernel returns when fs.epoll.max_user_watches is exhausted) so Bun.serve /
// Bun.listen must throw and accepted connections must be closed, not parked.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import net from "node:net";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// FAIL_EPOLL_ADD=listener: listening TCP sockets (SO_ACCEPTCONN).
// FAIL_EPOLL_ADD=accepted: connected SOCK_STREAM. FAIL_EPOLL_ADD=udp: SOCK_DGRAM.
// Non-socket fds (timerfd, eventfd) always pass through.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/socket.h>

static int (*real_epoll_ctl)(int, int, int, struct epoll_event *);
static int mode = -1; // 0 = listener, 1 = accepted, 2 = udp

int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event) {
    if (!real_epoll_ctl) {
        real_epoll_ctl = (int (*)(int, int, int, struct epoll_event *)) dlsym(RTLD_NEXT, "epoll_ctl");
        const char *m = getenv("FAIL_EPOLL_ADD");
        mode = (m && strcmp(m, "udp") == 0) ? 2 : (m && strcmp(m, "accepted") == 0) ? 1 : 0;
    }
    if (op == EPOLL_CTL_ADD) {
        int acceptconn = 0, type = 0;
        socklen_t len = sizeof(int);
        if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &len) == 0) {
            len = sizeof(int);
            getsockopt(fd, SOL_SOCKET, SO_ACCEPTCONN, &acceptconn, &len);
            int is_stream = (type == SOCK_STREAM);
            if ((mode == 0 && is_stream && acceptconn) ||
                (mode == 1 && is_stream && !acceptconn) ||
                (mode == 2 && type == SOCK_DGRAM)) {
                errno = ENOSPC;
                return -1;
            }
        }
    }
    return real_epoll_ctl(epfd, op, fd, event);
}
`;

const SERVE_FIXTURE = /* js */ `
try {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
  console.log(JSON.stringify({ ok: true, port: server.port }));
  server.stop(true);
} catch (e) {
  console.log(JSON.stringify({ ok: false, code: e?.code, syscall: e?.syscall, message: String(e?.message ?? e) }));
}
`;

const LISTEN_FIXTURE = /* js */ `
try {
  const server = Bun.listen({
    port: 0,
    hostname: "127.0.0.1",
    socket: { data() {}, open() {}, close() {}, error() {} },
  });
  console.log(JSON.stringify({ ok: true, port: server.port }));
  server.stop(true);
} catch (e) {
  console.log(JSON.stringify({ ok: false, code: e?.code, errno: e?.errno, syscall: e?.syscall, message: String(e?.message ?? e) }));
}
`;

// Listener registers fine; every accepted connection's EPOLL_CTL_ADD fails.
// open() must never fire and the client must observe the connection close.
const ACCEPT_FIXTURE = /* js */ `
const server = Bun.listen({
  port: 0,
  hostname: "127.0.0.1",
  socket: {
    open() { console.log("OPEN"); },
    data() {},
    close() {},
    error() {},
  },
});
console.log("PORT " + server.port);
process.stdin.once("data", () => { server.stop(true); process.exit(0); });
`;

// Listener passes; the outbound fetch() connect socket's ADD fails and the
// promise must reject instead of pending forever.
const FETCH_FIXTURE = /* js */ `
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
try {
  const res = await fetch(\`http://127.0.0.1:\${server.port}/\`);
  console.log(JSON.stringify({ settled: "resolved", status: res.status }));
} catch (e) {
  console.log(JSON.stringify({ settled: "rejected", code: e?.code, name: e?.name, message: String(e?.message ?? e) }));
} finally {
  server.stop(true);
}
`;

// Same for Bun.connect: the outbound socket's ADD fails and the promise must
// reject instead of pending forever.
const CONNECT_FIXTURE = /* js */ `
const server = Bun.listen({
  port: 0, hostname: "127.0.0.1",
  socket: { open(s) { s.end(); }, data() {}, close() {}, error() {} },
});
try {
  const sock = await Bun.connect({
    port: server.port, hostname: "127.0.0.1",
    socket: { open() {}, data() {}, close() {}, error() {} },
  });
  console.log(JSON.stringify({ settled: "resolved" }));
  sock.end();
} catch (e) {
  console.log(JSON.stringify({ settled: "rejected", code: e?.code, errno: e?.errno, syscall: e?.syscall, message: String(e?.message ?? e) }));
} finally {
  server.stop(true);
}
`;

const UDP_FIXTURE = /* js */ `
try {
  const sock = await Bun.udpSocket({ port: 0, hostname: "127.0.0.1", socket: { data() {} } });
  console.log(JSON.stringify({ ok: true, port: sock.port }));
  sock.close();
} catch (e) {
  console.log(JSON.stringify({ ok: false, code: e?.code, errno: e?.errno, message: String(e?.message ?? e) }));
}
`;

let shimPath: string;
let dir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("epoll-add-fail", {
    "shim.c": SHIM_C,
    "serve.js": SERVE_FIXTURE,
    "listen.js": LISTEN_FIXTURE,
    "accept.js": ACCEPT_FIXTURE,
    "fetch.js": FETCH_FIXTURE,
    "connect.js": CONNECT_FIXTURE,
    "udp.js": UDP_FIXTURE,
  });
  shimPath = join(String(dir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) {
    throw new Error(`shim compile failed: ${ccErr || ccOut}`);
  }
});

afterAll(() => {
  dir?.[Symbol.dispose]();
});

function shimEnv(mode: "listener" | "accepted" | "udp") {
  const existing = bunEnv.LD_PRELOAD;
  return { ...bunEnv, LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath, FAIL_EPOLL_ADD: mode };
}

async function runWithShim(script: string, mode: "listener" | "accepted" | "udp" = "listener") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), script],
    cwd: String(dir),
    env: shimEnv(mode),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent.skipIf(!isLinux || !cc)(
  "Bun.serve throws when epoll_ctl(EPOLL_CTL_ADD) for the listen socket fails",
  async () => {
    const { stdout, stderr, exitCode } = await runWithShim("serve.js");
    const line = stdout.trim().split("\n").pop() ?? "";
    expect({ stderr, line }).toEqual({ stderr: expect.any(String), line: expect.stringContaining("{") });
    const result = JSON.parse(line);
    expect(result).toEqual({
      ok: false,
      code: "ENOSPC",
      syscall: "listen",
      message: expect.stringContaining("ENOSPC"),
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isLinux || !cc)(
  "Bun.listen throws when epoll_ctl(EPOLL_CTL_ADD) for the listen socket fails",
  async () => {
    const { stdout, stderr, exitCode } = await runWithShim("listen.js");
    const line = stdout.trim().split("\n").pop() ?? "";
    expect({ stderr, line }).toEqual({ stderr: expect.any(String), line: expect.stringContaining("{") });
    const result = JSON.parse(line);
    expect(result).toEqual({
      ok: false,
      errno: 28, // ENOSPC
      code: "ENOSPC",
      syscall: "listen",
      message: expect.any(String),
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isLinux || !cc)(
  "accepted connection is closed when epoll_ctl(EPOLL_CTL_ADD) fails for it",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "accept.js"],
      cwd: String(dir),
      env: shimEnv("accepted"),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
    });

    const stderrPromise = proc.stderr.text();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    async function readLine(): Promise<string | null> {
      for (;;) {
        const i = buffered.indexOf("\n");
        if (i >= 0) {
          const line = buffered.slice(0, i);
          buffered = buffered.slice(i + 1);
          return line;
        }
        const { value, done } = await reader.read();
        if (done) {
          const tail = buffered;
          buffered = "";
          return tail.length ? tail : null;
        }
        buffered += decoder.decode(value, { stream: true });
      }
    }

    const portLine = await readLine();
    expect(portLine).toMatch(/^PORT \d+$/);
    const port = Number(portLine!.slice("PORT ".length));

    // The shim is only in the child; this client must see the server close
    // the accepted fd (epoll_ctl failed) instead of leaving it parked.
    const closed = await new Promise<string>(resolve => {
      const sock = net.connect({ host: "127.0.0.1", port }, () => {
        sock.write("ping");
      });
      sock.on("error", err => resolve("error:" + (err as NodeJS.ErrnoException).code));
      sock.on("close", () => resolve("close"));
    });
    expect(["close", "error:ECONNRESET"]).toContain(closed);

    proc.stdin.write("done\n");
    proc.stdin.end();
    const [stderr, rest, exitCode] = await Promise.all([
      stderrPromise,
      (async () => {
        let out = "";
        for (let line; (line = await readLine()) !== null; ) out += line + "\n";
        return out;
      })(),
      proc.exited,
    ]);
    // open() must not have fired (no "OPEN" line after PORT).
    expect({ stderr, rest }).toEqual({ stderr: expect.any(String), rest: "" });
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isLinux || !cc)(
  "fetch() rejects when epoll_ctl(EPOLL_CTL_ADD) for the connect socket fails",
  async () => {
    const { stdout, stderr, exitCode } = await runWithShim("fetch.js", "accepted");
    const line = stdout.trim().split("\n").pop() ?? "";
    expect({ stderr, line }).toEqual({ stderr: expect.any(String), line: expect.stringContaining("{") });
    const result = JSON.parse(line);
    expect(result.settled).toBe("rejected");
    expect(result.code).toBe("FailedToOpenSocket");
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isLinux || !cc)(
  "Bun.connect rejects when epoll_ctl(EPOLL_CTL_ADD) for the connect socket fails",
  async () => {
    const { stdout, stderr, exitCode } = await runWithShim("connect.js", "accepted");
    const line = stdout.trim().split("\n").pop() ?? "";
    expect({ stderr, line }).toEqual({ stderr: expect.any(String), line: expect.stringContaining("{") });
    const result = JSON.parse(line);
    // Synchronous NULL from us_socket_group_connect → do_connect() Err →
    // handle_connect_error remaps the errno and rejects with syscall "connect".
    expect(result).toEqual({
      settled: "rejected",
      code: "ECONNREFUSED",
      errno: -111,
      syscall: "connect",
      message: expect.any(String),
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isLinux || !cc)(
  "Bun.udpSocket throws when epoll_ctl(EPOLL_CTL_ADD) for the UDP socket fails",
  async () => {
    const { stdout, stderr, exitCode } = await runWithShim("udp.js", "udp");
    const line = stdout.trim().split("\n").pop() ?? "";
    expect({ stderr, line }).toEqual({ stderr: expect.any(String), line: expect.stringContaining("{") });
    const result = JSON.parse(line);
    expect(result).toEqual({
      ok: false,
      code: "ENOSPC",
      errno: 28,
      message: expect.stringContaining("ENOSPC"),
    });
    expect(exitCode).toBe(0);
  },
);
