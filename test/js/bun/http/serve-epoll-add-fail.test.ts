// epoll_ctl(EPOLL_CTL_ADD) for a listen socket can fail with ENOSPC when
// fs.epoll.max_user_watches is exhausted. uSockets used to discard the
// epoll_ctl return code, so Bun.serve() returned a healthy-looking server
// whose listener was never registered with the event loop: the kernel kept
// completing TCP handshakes into the backlog while no request was ever
// answered. This test injects that ENOSPC via an LD_PRELOAD shim and asserts
// Bun.serve / Bun.listen now throw instead of silently going deaf.
import { beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import net from "node:net";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// The shim makes epoll_ctl(ADD) fail with ENOSPC for either listening sockets
// (SO_ACCEPTCONN == 1) or connected TCP sockets (SO_TYPE == SOCK_STREAM &&
// SO_ACCEPTCONN == 0), selected by the FAIL_EPOLL_ADD env var. Non-socket fds
// (timerfd, eventfd) always pass through so the event loop can start.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/socket.h>

static int (*real_epoll_ctl)(int, int, int, struct epoll_event *);
static int mode = -1; // 0 = listener, 1 = accepted

int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event) {
    if (!real_epoll_ctl) {
        real_epoll_ctl = (int (*)(int, int, int, struct epoll_event *)) dlsym(RTLD_NEXT, "epoll_ctl");
        const char *m = getenv("FAIL_EPOLL_ADD");
        mode = (m && strcmp(m, "accepted") == 0) ? 1 : 0;
    }
    if (op == EPOLL_CTL_ADD) {
        int acceptconn = 0, type = 0;
        socklen_t len = sizeof(int);
        if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &len) == 0) {
            len = sizeof(int);
            getsockopt(fd, SOL_SOCKET, SO_ACCEPTCONN, &acceptconn, &len);
            int is_stream = (type == SOCK_STREAM);
            if ((mode == 0 && is_stream && acceptconn) ||
                (mode == 1 && is_stream && !acceptconn)) {
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

// For the accepted-socket case: the listener registers fine, but every
// accepted connection's EPOLL_CTL_ADD fails. The server prints its port,
// then "OPEN" for each socket that reaches the open() handler. With the fix
// the fd is closed before open() is dispatched, so the client sees the
// connection close and the server never prints "OPEN".
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

let shimPath: string;
let dir: ReturnType<typeof tempDir>;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("epoll-add-fail", {
    "shim.c": SHIM_C,
    "serve.js": SERVE_FIXTURE,
    "listen.js": LISTEN_FIXTURE,
    "accept.js": ACCEPT_FIXTURE,
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

async function runWithShim(script: string, mode: "listener" | "accepted" = "listener") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), script],
    cwd: String(dir),
    env: { ...bunEnv, LD_PRELOAD: shimPath, FAIL_EPOLL_ADD: mode },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.skipIf(!isLinux || !cc)("Bun.serve throws when epoll_ctl(EPOLL_CTL_ADD) for the listen socket fails", async () => {
  const { stdout, stderr, exitCode } = await runWithShim("serve.js");
  const line = stdout.trim().split("\n").pop() ?? "";
  expect(line).not.toBe("");
  const result = JSON.parse(line);
  // Before the fix: { ok: true, port: <n> } and the server is a zombie.
  expect({ stderr, result }).toEqual({
    stderr: "",
    result: {
      ok: false,
      code: "ENOSPC",
      syscall: "listen",
      message: expect.stringContaining("ENOSPC"),
    },
  });
  expect(exitCode).toBe(0);
});

test.skipIf(!isLinux || !cc)(
  "Bun.listen throws when epoll_ctl(EPOLL_CTL_ADD) for the listen socket fails",
  async () => {
    const { stdout, stderr, exitCode } = await runWithShim("listen.js");
    const line = stdout.trim().split("\n").pop() ?? "";
    expect(line).not.toBe("");
    const result = JSON.parse(line);
    expect({ stderr, ok: result.ok }).toEqual({ stderr: "", ok: false });
    expect(result.errno).toBe(28); // ENOSPC
    expect(result.code).toBe("ENOSPC");
    expect(result.syscall).toBe("listen");
    expect(exitCode).toBe(0);
  },
);

test.skipIf(!isLinux || !cc)("accepted connection is closed when epoll_ctl(EPOLL_CTL_ADD) fails for it", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "accept.js"],
    cwd: String(dir),
    env: { ...bunEnv, LD_PRELOAD: shimPath, FAIL_EPOLL_ADD: "accepted" },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });

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
      if (done) return buffered.length ? buffered : null;
      buffered += decoder.decode(value, { stream: true });
    }
  }

  const portLine = await readLine();
  expect(portLine).toMatch(/^PORT \d+$/);
  const port = Number(portLine!.slice("PORT ".length));

  // Connect from the test process (no shim here). With the fix the server
  // closes the accepted fd immediately because epoll_ctl failed, so the
  // client observes close/end. Without the fix the server dispatches
  // open() and leaves the socket parked forever; this await never resolves
  // and the test fails on Bun's default per-test timeout.
  const closed = await new Promise<string>(resolve => {
    const sock = net.connect({ host: "127.0.0.1", port }, () => {
      sock.write("ping");
    });
    sock.on("error", err => resolve("error:" + (err as NodeJS.ErrnoException).code));
    sock.on("close", () => resolve("close"));
  });
  expect(["close", "error:ECONNRESET"]).toContain(closed);

  // The server must not have reached open() for the dead connection.
  proc.stdin.write("done\n");
  proc.stdin.end();
  const stderr = await proc.stderr.text();
  let rest = "";
  for (let line; (line = await readLine()) !== null; ) rest += line + "\n";
  expect({ stderr, rest }).toEqual({ stderr: "", rest: "" });
  expect(await proc.exited).toBe(0);
});
