// A read or write on a subprocess stdio socket can fail with an errno other
// than EAGAIN/EINTR (ENOBUFS/ENOMEM under memory pressure, EIO, ECONNRESET).
// The error must reach the handle the caller holds exactly once, and the fd
// must be released the way EOF releases it, so a child that is still writing
// gets EPIPE instead of blocking forever.
//
// An LD_PRELOAD shim fails the Nth recv()/send() on each AF_UNIX socket (the
// parent's end of a stdio socketpair) with EIO/ENOBUFS. The children write
// with write(2), so only bun's side of the pair is affected.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// SPAWN_FAULT_RECV_AT=N  the Nth recv() on each AF_UNIX socket fails with EIO (1-based).
// SPAWN_FAULT_SEND_AT=N  the Nth send() on each AF_UNIX socket fails with ENOBUFS.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

#define MAX_FD 65536

static ssize_t (*real_recv)(int, void *, size_t, int);
static ssize_t (*real_send)(int, const void *, size_t, int);
static int (*real_close)(int);
static long (*real_syscall)(long, long, long, long, long, long, long);
static int fail_recv_at = -1;
static int fail_send_at = -1;
static unsigned int recv_count[MAX_FD];
static unsigned int send_count[MAX_FD];

static void init_modes(void) {
  const char *s;
  if (fail_recv_at < 0) {
    s = getenv("SPAWN_FAULT_RECV_AT");
    fail_recv_at = s ? atoi(s) : 0;
  }
  if (fail_send_at < 0) {
    s = getenv("SPAWN_FAULT_SEND_AT");
    fail_send_at = s ? atoi(s) : 0;
  }
}

static int is_unix_sock(int fd) {
  struct stat st;
  if (fd < 0 || fd >= MAX_FD) return 0;
  if (fstat(fd, &st) != 0 || !S_ISSOCK(st.st_mode)) return 0;
  int domain = 0;
  socklen_t len = sizeof(domain);
  return getsockopt(fd, SOL_SOCKET, SO_DOMAIN, &domain, &len) == 0 && domain == AF_UNIX;
}

ssize_t recv(int fd, void *buf, size_t len, int flags) {
  if (!real_recv) {
    real_recv = (ssize_t (*)(int, void *, size_t, int))dlsym(RTLD_NEXT, "recv");
    init_modes();
  }
  if (fail_recv_at > 0 && is_unix_sock(fd) && ++recv_count[fd] == (unsigned)fail_recv_at) {
    errno = EIO;
    return -1;
  }
  return real_recv(fd, buf, len, flags);
}

ssize_t send(int fd, const void *buf, size_t len, int flags) {
  if (!real_send) {
    real_send = (ssize_t (*)(int, const void *, size_t, int))dlsym(RTLD_NEXT, "send");
    init_modes();
  }
  if (fail_send_at > 0 && is_unix_sock(fd) && ++send_count[fd] == (unsigned)fail_send_at) {
    errno = ENOBUFS;
    return -1;
  }
  return real_send(fd, buf, len, flags);
}

// Reset the per-fd counters on close so a recycled fd number starts fresh.
// Bun closes fds through syscall(SYS_close, fd), not the close() wrapper, so
// both entry points are interposed.
static void reset_fd(int fd) {
  if (fd >= 0 && fd < MAX_FD) {
    recv_count[fd] = 0;
    send_count[fd] = 0;
  }
}

int close(int fd) {
  if (!real_close) real_close = (int (*)(int))dlsym(RTLD_NEXT, "close");
  reset_fd(fd);
  return real_close(fd);
}

long syscall(long number, ...) {
  va_list ap;
  long a, b, c, d, e, f;
  va_start(ap, number);
  a = va_arg(ap, long);
  b = va_arg(ap, long);
  c = va_arg(ap, long);
  d = va_arg(ap, long);
  e = va_arg(ap, long);
  f = va_arg(ap, long);
  va_end(ap);
  if (!real_syscall) {
    real_syscall = (long (*)(long, long, long, long, long, long, long))dlsym(RTLD_NEXT, "syscall");
  }
  if (number == SYS_close) reset_fd((int)a);
  return real_syscall(number, a, b, c, d, e, f);
}
`;

// The child writes 8 MB, far more than the socket buffer holds, so it blocks
// on write until the parent reads or closes its end. stderr is not a pipe, so
// the stdout socket is the only AF_UNIX socket the shim sees.
const WRITER_CMD = ["sh", "-c", "head -c 8000000 /dev/zero"];

// Bun.spawn({stdin: ReadableStream}): the write error is the stream's cancel reason.
const STDIN_STREAM_FIXTURE = /* js */ `
const total = 8 << 20;
let pulled = 0;
let cancelReason = "not-called";
const rs = new ReadableStream(
  {
    pull(c) {
      if (pulled >= total) return c.close();
      c.enqueue(new Uint8Array(65536));
      pulled += 65536;
    },
    cancel(reason) {
      cancelReason = reason instanceof Error ? reason.code : String(reason);
    },
  },
  { highWaterMark: 0 },
);
const p = Bun.spawn(["sh", "-c", "exec wc -c"], { stdin: rs, stdout: "pipe", stderr: "inherit" });
const childGot = Number((await p.stdout.text()).trim());
await p.exited;
console.log(JSON.stringify({ cancelReason, childTruncated: childGot < total, exitCode: p.exitCode }));
`;

// Bun.spawn stdout: the read rejects with the error and the child's write end
// sees the close, so exited settles.
const STDOUT_STREAM_FIXTURE = /* js */ `
const p = Bun.spawn(${JSON.stringify(WRITER_CMD)}, { stdout: "pipe", stderr: "inherit" });
let got = 0;
let code = null;
try {
  for await (const chunk of p.stdout) got += chunk.length;
} catch (e) {
  code = e.code;
}
const exitCode = await p.exited;
console.log(JSON.stringify({ code, truncated: got < 8000000, exited: typeof exitCode === "number" }));
`;

// Bun.spawn stdout consumed as a whole: text() rejects instead of hanging.
const STDOUT_TEXT_FIXTURE = /* js */ `
const p = Bun.spawn(${JSON.stringify(WRITER_CMD)}, { stdout: "pipe", stderr: "inherit" });
let code = null;
try {
  await p.stdout.text();
} catch (e) {
  code = e.code;
}
const exitCode = await p.exited;
console.log(JSON.stringify({ code, exited: typeof exitCode === "number" }));
`;

// node:child_process: stdout emits 'error' then 'close', and the ChildProcess
// still emits 'close'.
const CHILD_PROCESS_FIXTURE = /* js */ `
import { spawn } from "node:child_process";
const events = [];
const child = spawn(${JSON.stringify(WRITER_CMD[0])}, ${JSON.stringify(WRITER_CMD.slice(1))}, { stdio: ["ignore", "pipe", "ignore"] });
child.stdout.on("data", () => {});
child.stdout.on("error", e => events.push("stdout.error:" + e.code));
child.stdout.on("end", () => events.push("stdout.end"));
child.stdout.on("close", () => events.push("stdout.close"));
child.on("close", () => {
  events.push("close");
  console.log(JSON.stringify({ events }));
});
`;

// Bun.spawnSync / child_process.spawnSync / execFileSync: the lost output is an error, not a success.
const SPAWN_SYNC_FIXTURE = /* js */ `
import { spawnSync, execFileSync } from "node:child_process";
const out = {};
try {
  const r = Bun.spawnSync(${JSON.stringify(WRITER_CMD)}, { stderr: "inherit" });
  out.bun = { stdout: r.stdout?.constructor?.name, success: r.success };
} catch (e) {
  out.bun = "threw:" + e.code;
}
{
  const r = spawnSync(${JSON.stringify(WRITER_CMD[0])}, ${JSON.stringify(WRITER_CMD.slice(1))}, { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 << 20 });
  out.spawnSync = { stdout: r.stdout, error: r.error?.code };
}
try {
  const r = execFileSync(${JSON.stringify(WRITER_CMD[0])}, ${JSON.stringify(WRITER_CMD.slice(1))}, { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 << 20 });
  out.execFileSync = { returned: r?.constructor?.name };
} catch (e) {
  out.execFileSync = "threw:" + e.code;
}
console.log(JSON.stringify(out));
`;

let shimPath: string;
let dir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("spawn-stdio-syscall-error", {
    "shim.c": SHIM_C,
    "stdin-stream.mjs": STDIN_STREAM_FIXTURE,
    "stdout-stream.mjs": STDOUT_STREAM_FIXTURE,
    "stdout-text.mjs": STDOUT_TEXT_FIXTURE,
    "child-process.mjs": CHILD_PROCESS_FIXTURE,
    "spawn-sync.mjs": SPAWN_SYNC_FIXTURE,
  });
  shimPath = join(String(dir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
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
  dir?.[Symbol.dispose]();
});

async function runWithFault(fixture: string, fault: Record<string, string>) {
  const env: Record<string, string | undefined> = {
    ...bunEnv,
    LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shimPath}:${bunEnv.LD_PRELOAD}` : shimPath,
    SPAWN_FAULT_RECV_AT: undefined,
    SPAWN_FAULT_SEND_AT: undefined,
    ...fault,
  };
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const line = stdout.trim().split("\n").pop() ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    parsed = line;
  }
  // The child's own "head: error writing" line is the expected EPIPE/ECONNRESET.
  const unexpectedStderr = stderr
    .split("\n")
    .filter(l => l.length > 0 && !l.startsWith("head:") && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  return { parsed, stderr: unexpectedStderr, exitCode };
}

// The first recv() is the eager read during spawn (the bytes are buffered
// before JS touches .stdout). A later one is a read the JS consumer drives.
const RECV_FAULTS = [
  ["the eager read during spawn", "1"],
  ["a read after the consumer attached", "3"],
] as const;

describe.skipIf(!isLinux || !cc)("subprocess stdio syscall errors", () => {
  describe.each(RECV_FAULTS)("stdout read error on %s", (_label, at) => {
    test.concurrent("Bun.spawn: the stream read rejects and exited settles", async () => {
      expect(await runWithFault("stdout-stream.mjs", { SPAWN_FAULT_RECV_AT: at })).toEqual({
        parsed: { code: "EIO", truncated: true, exited: true },
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent("Bun.spawn: stdout.text() rejects and exited settles", async () => {
      expect(await runWithFault("stdout-text.mjs", { SPAWN_FAULT_RECV_AT: at })).toEqual({
        parsed: { code: "EIO", exited: true },
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent("node:child_process: stdout emits 'error' before 'close'", async () => {
      expect(await runWithFault("child-process.mjs", { SPAWN_FAULT_RECV_AT: at })).toEqual({
        parsed: { events: ["stdout.error:EIO", "stdout.close", "close"] },
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent("spawnSync: the lost output is reported as an error", async () => {
      expect(await runWithFault("spawn-sync.mjs", { SPAWN_FAULT_RECV_AT: at })).toEqual({
        parsed: {
          bun: "threw:EIO",
          spawnSync: { stdout: null, error: "EIO" },
          execFileSync: "threw:EIO",
        },
        stderr: "",
        exitCode: 0,
      });
    });
  });

  describe.each([
    ["the first write", "1"],
    ["a later write", "3"],
  ])("stdin ReadableStream write error on %s", (_label, at) => {
    test.concurrent("Bun.spawn: the stream is cancelled with the error as the reason", async () => {
      expect(await runWithFault("stdin-stream.mjs", { SPAWN_FAULT_SEND_AT: at })).toEqual({
        parsed: { cancelReason: "ENOBUFS", childTruncated: true, exitCode: 0 },
        stderr: "",
        exitCode: 0,
      });
    });
  });
});
