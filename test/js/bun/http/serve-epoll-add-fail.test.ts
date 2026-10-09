// An LD_PRELOAD shim makes epoll_ctl(EPOLL_CTL_ADD) fail with ENOSPC (what the
// kernel returns when fs.epoll.max_user_watches is exhausted) so Bun.serve /
// Bun.listen must throw and accepted connections must be closed, not parked.
// The shim also fails two calls that come before it in a listen: getaddrinfo()
// for two fixed names, and one setsockopt().
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import net from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { getSystemErrorName } from "node:util";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// FAIL_EPOLL_ADD=listener: listening TCP sockets (SO_ACCEPTCONN).
// FAIL_EPOLL_ADD=accepted: connected SOCK_STREAM. FAIL_EPOLL_ADD=udp: SOCK_DGRAM.
// FAIL_EPOLL_ADD=none: no socket. Non-socket fds (timerfd, eventfd) always pass through.
// FAIL_SETSOCKOPT=v6only or reuseport: that option fails with EPERM.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <netdb.h>
#include <netinet/in.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/socket.h>

static int (*real_epoll_ctl)(int, int, int, struct epoll_event *);
static int mode = -1; // 0 = listener, 1 = accepted, 2 = udp, 3 = none

int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event) {
    if (!real_epoll_ctl) {
        real_epoll_ctl = (int (*)(int, int, int, struct epoll_event *)) dlsym(RTLD_NEXT, "epoll_ctl");
        const char *m = getenv("FAIL_EPOLL_ADD");
        mode = (m && strcmp(m, "none") == 0) ? 3 : (m && strcmp(m, "udp") == 0) ? 2 : (m && strcmp(m, "accepted") == 0) ? 1 : 0;
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

int getaddrinfo(const char *node, const char *service, const struct addrinfo *hints, struct addrinfo **res) {
    static int (*real)(const char *, const char *, const struct addrinfo *, struct addrinfo **);
    if (!real) real = (int (*)(const char *, const char *, const struct addrinfo *, struct addrinfo **)) dlsym(RTLD_NEXT, "getaddrinfo");
    if (node && strcmp(node, "eai-noname.test") == 0) return EAI_NONAME;
    if (node && strcmp(node, "eai-again.test") == 0) return EAI_AGAIN;
    return real(node, service, hints, res);
}

int setsockopt(int fd, int level, int name, const void *value, socklen_t len) {
    static int (*real)(int, int, int, const void *, socklen_t);
    if (!real) real = (int (*)(int, int, int, const void *, socklen_t)) dlsym(RTLD_NEXT, "setsockopt");
    const char *fail = getenv("FAIL_SETSOCKOPT");
    if (fail && ((strcmp(fail, "v6only") == 0 && level == IPPROTO_IPV6 && name == IPV6_V6ONLY) ||
                 (strcmp(fail, "reuseport") == 0 && level == SOL_SOCKET && name == SO_REUSEPORT))) {
        errno = EPERM;
        return -1;
    }
    return real(fd, level, name, value, len);
}
`;

// Every way to listen on a TCP hostname, for the two names that the shim refuses.
const DNS_FIXTURE = /* js */ `
const shape = ({ code, syscall, hostname, message }) => ({ code, syscall, hostname, message });
const out = {};
for (const hostname of ["eai-noname.test", "eai-again.test"]) {
  try {
    Bun.serve({ hostname, port: 0, fetch: () => new Response() }).stop(true);
    out["Bun.serve " + hostname] = "listening";
  } catch (e) {
    out["Bun.serve " + hostname] = shape(e);
  }
  try {
    Bun.listen({ hostname, port: 0, socket: { data() {} } }).stop(true);
    out["Bun.listen " + hostname] = "listening";
  } catch (e) {
    out["Bun.listen " + hostname] = shape(e);
  }
  for (const name of ["http", "net"]) {
    out[name + " " + hostname] = await new Promise(resolve => {
      const server = require("node:" + name).createServer();
      server.on("error", e => resolve(shape(e)));
      server.listen(0, hostname, () => server.close(() => resolve("listening")));
    });
  }
}
console.log(JSON.stringify(out));
`;

const SETSOCKOPT_FIXTURE = /* js */ `
const address = JSON.parse(process.env.ADDRESS);
const out = {};
try {
  Bun.serve({ ...address, fetch: () => new Response() }).stop(true);
  out.serve = "listening";
} catch (e) {
  out.serve = { code: e.code, syscall: e.syscall, errno: e.errno };
}
try {
  Bun.listen({ ...address, socket: { data() {} } }).stop(true);
  out.listen = "listening";
} catch (e) {
  out.listen = { code: e.code, syscall: e.syscall, errno: e.errno };
}
console.log(JSON.stringify(out));
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
    "dns.js": DNS_FIXTURE,
    "setsockopt.js": SETSOCKOPT_FIXTURE,
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

type ShimMode = "listener" | "accepted" | "udp" | "none";

function shimEnv(mode: ShimMode) {
  const existing = bunEnv.LD_PRELOAD;
  return { ...bunEnv, LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath, FAIL_EPOLL_ADD: mode };
}

async function runWithShim(script: string, mode: ShimMode = "listener", env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), script],
    cwd: String(dir),
    env: { ...shimEnv(mode), ...env },
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
      errno: -28, // ENOSPC
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
    expect(result.code).toBe("ENOSPC");
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

test.concurrent.skipIf(!isLinux || !cc)(
  "a listen on a hostname that getaddrinfo() refuses throws the getaddrinfo error",
  async () => {
    const { stdout, stderr, exitCode } = await runWithShim("dns.js", "none");
    const notFound = {
      code: "ENOTFOUND",
      syscall: "getaddrinfo",
      hostname: "eai-noname.test",
      message: "getaddrinfo ENOTFOUND eai-noname.test",
    };
    const again = {
      code: "EAI_AGAIN",
      syscall: "getaddrinfo",
      hostname: "eai-again.test",
      message: "getaddrinfo EAI_AGAIN eai-again.test",
    };
    expect({ out: JSON.parse(stdout || "null"), stderr }).toEqual({
      out: {
        "Bun.serve eai-noname.test": notFound,
        "Bun.listen eai-noname.test": notFound,
        "http eai-noname.test": notFound,
        "net eai-noname.test": notFound,
        "Bun.serve eai-again.test": again,
        "Bun.listen eai-again.test": again,
        "http eai-again.test": again,
        "net eai-again.test": again,
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);

const hasIPv6 = Object.values(networkInterfaces())
  .flat()
  .some(network => network?.family === "IPv6");

test.concurrent.skipIf(!isLinux || !cc).each([
  ["IPV6_V6ONLY", "v6only", { hostname: "::1", port: 0 }, hasIPv6],
  ["SO_REUSEPORT", "reuseport", { hostname: "127.0.0.1", port: 0, reusePort: true }, true],
] as const)("a listen whose setsockopt(%s) fails throws that error", async (_, option, address, possible) => {
  // Without IPv6 the socket() call for ::1 fails first.
  if (!possible) return;
  const { stdout, stderr, exitCode } = await runWithShim("setsockopt.js", "none", {
    FAIL_SETSOCKOPT: option,
    ADDRESS: JSON.stringify(address),
  });
  const out = JSON.parse(stdout || "{}");
  for (const error of Object.values<any>(out)) {
    if (error.errno < 0) error.errno = getSystemErrorName(error.errno);
  }
  const refused = { code: "EPERM", syscall: "listen", errno: "EPERM" };
  expect({ out, stderr }).toEqual({ out: { serve: refused, listen: refused }, stderr: "" });
  expect(exitCode).toBe(0);
});
