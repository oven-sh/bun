// A read or write on a subprocess stdio socket can fail with an errno other
// than EAGAIN/EINTR (ENOBUFS/ENOMEM under memory pressure, EIO, ECONNRESET).
// The error must reach the handle the caller holds exactly once, and the fd
// must be released the way EOF releases it, so a child that is still writing
// gets EPIPE instead of blocking forever. The same holds for the commands
// that read a child's output and wait for its exit: bun run --filter and
// --parallel, bun test --parallel, bun install and Bun.cron.
//
// An LD_PRELOAD shim fails the Nth recv()/send() on each AF_UNIX socket (the
// parent's end of a stdio socketpair) with EIO/ENOBUFS. The children write
// with write(2), so only bun's side of the pair is affected.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
// On Linux 5.9 and 5.10 bun reads a pipe with read(2), not preadv2(RWF_NOWAIT), and makes that syscall itself: the shim cannot fail it.
const canFailPipeRead = !/^5\.(9|10)\./.test(release());

// SPAWN_FAULT_RECV_AT=N  the Nth recv() on each AF_UNIX socket fails with EIO (1-based).
// SPAWN_FAULT_RECV_MARK=c  a recv() on an AF_UNIX socket that would return bytes that start with the character c fails with EIO.
// SPAWN_FAULT_PREADV2_AT=N  the Nth preadv2() on each AF_UNIX socket fails with EIO: the read of a reader that treats the socket as a pipe.
// SPAWN_FAULT_FIFO_READ_AT=N  the Nth preadv2() on each FIFO fails with EIO.
// SPAWN_FAULT_EPOLL_AT=N  the Nth epoll_ctl(ADD or MOD) on each AF_UNIX socket fails with ENOMEM.
// SPAWN_FAULT_SEND_AT=N  the Nth send() on each AF_UNIX socket fails with ENOBUFS.
// SPAWN_FAULT_REPORT=path  the failing recv() writes how many bytes that socket received before it to this file.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/epoll.h>
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
static int fail_preadv2_at = -1;
static int fail_fifo_read_at = -1;
static int fail_epoll_at = -1;
static int recv_mark = -1;
static unsigned int recv_count[MAX_FD];
static unsigned int send_count[MAX_FD];
static unsigned long recv_bytes[MAX_FD];
static unsigned int preadv2_count[MAX_FD];
static unsigned int epoll_count[MAX_FD];

static int knob(const char *name) {
  const char *s = getenv(name);
  return s ? atoi(s) : 0;
}

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
  if (fail_preadv2_at < 0) fail_preadv2_at = knob("SPAWN_FAULT_PREADV2_AT");
  if (fail_fifo_read_at < 0) fail_fifo_read_at = knob("SPAWN_FAULT_FIFO_READ_AT");
  if (fail_epoll_at < 0) fail_epoll_at = knob("SPAWN_FAULT_EPOLL_AT");
  if (recv_mark < 0) {
    s = getenv("SPAWN_FAULT_RECV_MARK");
    recv_mark = s ? s[0] : 0;
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

static int is_fifo(int fd) {
  struct stat st;
  return fd >= 0 && fd < MAX_FD && fstat(fd, &st) == 0 && S_ISFIFO(st.st_mode);
}

ssize_t recv(int fd, void *buf, size_t len, int flags) {
  if (!real_recv) {
    real_recv = (ssize_t (*)(int, void *, size_t, int))dlsym(RTLD_NEXT, "recv");
    init_modes();
  }
  if (fail_recv_at > 0 && is_unix_sock(fd)) {
    if (++recv_count[fd] == (unsigned)fail_recv_at) {
      const char *report = getenv("SPAWN_FAULT_REPORT");
      FILE *f = report ? fopen(report, "w") : NULL;
      if (f) {
        fprintf(f, "%lu", recv_bytes[fd]);
        fclose(f);
      }
      errno = EIO;
      return -1;
    }
    ssize_t n = real_recv(fd, buf, len, flags);
    if (n > 0) recv_bytes[fd] += (unsigned long)n;
    return n;
  }
  char first;
  if (recv_mark > 0 && is_unix_sock(fd) && real_recv(fd, &first, 1, MSG_PEEK | MSG_DONTWAIT) == 1 &&
      first == recv_mark) {
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
    recv_bytes[fd] = 0;
    preadv2_count[fd] = 0;
    epoll_count[fd] = 0;
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
    init_modes();
  }
  if (number == SYS_close) reset_fd((int)a);
  // Bun calls preadv2 and epoll_ctl through syscall(2) too, not through their libc wrappers.
  if (number == SYS_preadv2) {
    int fd = (int)a;
    int at = fail_preadv2_at > 0 && is_unix_sock(fd) ? fail_preadv2_at : fail_fifo_read_at > 0 && is_fifo(fd) ? fail_fifo_read_at : 0;
    if (at > 0 && ++preadv2_count[fd] == (unsigned)at) {
      errno = EIO;
      return -1;
    }
  }
  if (number == SYS_epoll_ctl && fail_epoll_at > 0 && ((int)b == EPOLL_CTL_ADD || (int)b == EPOLL_CTL_MOD) &&
      is_unix_sock((int)c) && ++epoll_count[(int)c] == (unsigned)fail_epoll_at) {
    errno = ENOMEM;
    return -1;
  }
  return real_syscall(number, a, b, c, d, e, f);
}
`;

// Writes 8 MB of lines to stdout, far more than a socket buffer holds, so it
// blocks until the parent reads or closes its end. Exit code 7 means a write
// failed: the parent released the pipe. Exit code 0 means the parent read it
// all. With the argument "sigpipe" it leaves SIGPIPE at its default and
// writes until the signal ends it.
const BIG_WRITER_C = /* c */ `
#include <signal.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  static char buf[64 * 1024];
  int until_sigpipe = argc > 1 && strcmp(argv[1], "sigpipe") == 0;
  if (!until_sigpipe) signal(SIGPIPE, SIG_IGN);
  memset(buf, 'x', sizeof(buf));
  for (size_t i = 127; i < sizeof(buf); i += 128) buf[i] = '\\n';
  for (long left = 8000000; left > 0 || until_sigpipe;) {
    ssize_t n = write(1, buf, sizeof(buf));
    if (n < 0 && !until_sigpipe) return 7;
    if (n > 0) left -= n;
  }
  return 0;
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

// Bun.spawn stdout piped into a native sink: Bun.write rejects with the read error.
const STDOUT_WRITE_FIXTURE = /* js */ `
const p = Bun.spawn(${JSON.stringify(WRITER_CMD)}, { stdout: "pipe", stderr: "inherit" });
let code = null;
try {
  await Bun.write("stdout-write.out", p.stdout);
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

// node:child_process: every byte the parent read before the error reaches 'data'.
const CHILD_PROCESS_BYTES_FIXTURE = /* js */ `
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
const events = [];
let got = 0;
const child = spawn(${JSON.stringify(WRITER_CMD[0])}, ${JSON.stringify(WRITER_CMD.slice(1))}, { stdio: ["ignore", "pipe", "ignore"] });
child.stdout.on("data", chunk => (got += chunk.length));
child.stdout.on("error", e => events.push("stdout.error:" + e.code));
child.stdout.on("close", () => events.push("stdout.close"));
child.on("close", () => {
  events.push("close");
  const received = Number(readFileSync(process.env.SPAWN_FAULT_REPORT, "utf8"));
  console.log(JSON.stringify({ receivedSome: received > 0, lost: received - got, events }));
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
  // The process ran, so the error says which one and how it exited. How it exited is not fixed: once the
  // parent's read fails the pipe is closed, and the writer dies of SIGPIPE or exits on EPIPE.
  out.bun = { threw: e.code, pid: typeof e.pid, exited: e.exitCode !== null || typeof e.signalCode === "string" };
}
{
  const r = spawnSync(${JSON.stringify(WRITER_CMD[0])}, ${JSON.stringify(WRITER_CMD.slice(1))}, { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 << 20 });
  out.spawnSync = { stdout: r.stdout, error: r.error?.code, pid: r.pid > 0, output: r.output, exited: r.status !== null || typeof r.signal === "string" };
}
try {
  const r = execFileSync(${JSON.stringify(WRITER_CMD[0])}, ${JSON.stringify(WRITER_CMD.slice(1))}, { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 << 20 });
  out.execFileSync = { returned: r?.constructor?.name };
} catch (e) {
  out.execFileSync = "threw:" + e.code;
}
console.log(JSON.stringify(out));
`;

// A node:child_process stdout stream whose read fails while it waits for data
// is destroyed from inside the error delivery. That cancel finds the reader
// closed already, so the error path has to drop the ref that roots the stream.
// The child writes its second chunk only after the parent asks for it, and the
// parent asks from setImmediate: by then the stream has pulled again and that
// read waits on the poll.
const STREAM_ROOTS_FIXTURE = /* js */ `
import { spawn } from "node:child_process";
import { heapStats } from "bun:jsc";

function once() {
  const { promise, resolve } = Promise.withResolvers();
  const child = spawn("sh", ["-c", "printf first; read go; printf FAULT; read done"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const events = [];
  child.stdout.on("data", chunk => {
    events.push("data:" + chunk);
    setImmediate(() => child.stdin.write("\\n"));
  });
  child.stdout.on("error", e => {
    events.push("error:" + e.code);
    child.stdin.end();
  });
  child.on("close", () => resolve(events.join(" ")));
  return promise;
}

const events = await once();
const rooted = heapStats().protectedObjectTypeCounts.FileInternalReadableStreamSource ?? 0;
console.log(JSON.stringify({ events, rooted }));
`;

// `crontab` on PATH is the big writer, so `crontab -l` prints 8 MB.
const CRON_FIXTURE = /* js */ `
const [action] = process.argv.slice(2);
try {
  if (action === "register") await Bun.cron(import.meta.dirname + "/job.ts", "* * * * *", "read-fault");
  else await Bun.cron.remove("read-fault");
  console.log("resolved");
} catch (e) {
  console.log("rejected: " + e.message);
}
`;

// The scanner's result is 400 KB of JSON, more than the pipe to bun holds.
const SCANNER_FIXTURE = /* js */ `
export const scanner = {
  version: "1",
  scan: async () => [
    {
      package: "dep",
      level: "fatal",
      url: "https://example.com/advisory",
      description: Buffer.alloc(400 * 1024, "d").toString(),
    },
  ],
};
`;

// `bun test --parallel=2` gives each worker one of these files. Only the
// stdout of the worker that runs the noisy file gets as far as the failing read.
const NOISY_TEST = /* js */ `
import { expect, test } from "bun:test";
test("writes 8 MB to stdout", () => {
  const line = Buffer.alloc(1023, "x").toString();
  for (let i = 0; i < 8000; i++) console.log(line);
  expect(1).toBe(1);
});
`;
const QUIET_TEST = /* js */ `
import { expect, test } from "bun:test";
test("writes nothing", () => {
  expect(1).toBe(1);
});
`;

let shimPath: string;
let toolsPath: string;
let dir: ReturnType<typeof tempDir> | undefined;
// A command that hangs outlives the test that timed out on it: the runner only kills what a serial test spawned.
const running = new Set<Bun.Subprocess>();

async function build(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`${cmd.join(" ")} failed: ${stderr || stdout}`);
}

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("spawn-stdio-syscall-error", {
    "shim.c": SHIM_C,
    "big-writer.c": BIG_WRITER_C,
    "stdin-stream.mjs": STDIN_STREAM_FIXTURE,
    "stdout-stream.mjs": STDOUT_STREAM_FIXTURE,
    "stdout-text.mjs": STDOUT_TEXT_FIXTURE,
    "stdout-write.mjs": STDOUT_WRITE_FIXTURE,
    "child-process.mjs": CHILD_PROCESS_FIXTURE,
    "child-process-bytes.mjs": CHILD_PROCESS_BYTES_FIXTURE,
    "spawn-sync.mjs": SPAWN_SYNC_FIXTURE,
    "stream-roots.mjs": STREAM_ROOTS_FIXTURE,
    "cron.mjs": CRON_FIXTURE,
    "job.ts": "export default { scheduled() {} };",
    "tests/noisy.test.ts": NOISY_TEST,
    "tests/quiet.test.ts": QUIET_TEST,
    "install-scanned/scanner.ts": SCANNER_FIXTURE,
    "install-scanned/bunfig.toml": `[install.security]\nscanner = "./scanner.ts"\n`,
  });
  const root = String(dir);
  shimPath = join(root, "shim.so");
  const writer = join(root, "big-writer");
  // bun finds `git` and `crontab` on PATH. Here both are the big writer.
  toolsPath = join(root, "tools");
  mkdirSync(toolsPath);
  for (const tool of ["git", "crontab"]) symlinkSync(writer, join(toolsPath, tool));

  const write = (path: string, content: object) => Bun.write(join(root, path), JSON.stringify(content));
  // A project that depends on a tarball whose package has this postinstall script.
  const installOf = async (project: string, postinstall?: string, kind = "dependencies") => {
    const tarball = join(root, `${project}.tgz`);
    const manifest = { name: "dep", version: "1.0.0", scripts: { postinstall } };
    await Bun.Archive.write(
      tarball,
      { "package/package.json": JSON.stringify(manifest), "package/index.js": "module.exports = 1;" },
      { compress: "gzip" },
    );
    await write(`${project}/package.json`, {
      name: "root",
      version: "1.0.0",
      [kind]: { dep: `file:${tarball}` },
      trustedDependencies: ["dep"],
    });
  };

  await Promise.all([
    build([cc!, "-shared", "-fPIC", "-o", shimPath, join(root, "shim.c"), "-ldl"], root),
    build([cc!, "-o", writer, join(root, "big-writer.c")], root),
    // `second` depends on `first`, so its script starts when the script of `first` has finished.
    write("ws/package.json", { name: "root", private: true, workspaces: ["first", "second"] }),
    write("ws/first/package.json", {
      name: "first",
      version: "1.0.0",
      scripts: {
        big: writer,
        sigpipe: `exec ${writer} sigpipe`,
      },
    }),
    write("ws/second/package.json", {
      name: "second",
      version: "1.0.0",
      dependencies: { first: "workspace:*" },
      scripts: { big: "echo from second" },
    }),
    installOf("install", writer),
    installOf("install-sigpipe", `exec ${writer} sigpipe`),
    installOf("install-optional", `exec ${writer} sigpipe`, "optionalDependencies"),
    installOf("install-scanned"),
    write("install-git/package.json", {
      name: "root",
      version: "1.0.0",
      dependencies: { dep: "git+https://example.invalid/owner/repo.git" },
    }),
  ]);
});

afterAll(() => {
  for (const proc of running) proc.kill("SIGKILL");
  dir?.[Symbol.dispose]();
});

function faultEnv(fault: Record<string, string>): Record<string, string | undefined> {
  return {
    ...bunEnv,
    LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shimPath}:${bunEnv.LD_PRELOAD}` : shimPath,
    SPAWN_FAULT_RECV_AT: undefined,
    SPAWN_FAULT_RECV_MARK: undefined,
    SPAWN_FAULT_PREADV2_AT: undefined,
    SPAWN_FAULT_FIFO_READ_AT: undefined,
    SPAWN_FAULT_EPOLL_AT: undefined,
    SPAWN_FAULT_SEND_AT: undefined,
    SPAWN_FAULT_REPORT: undefined,
    ...fault,
  };
}

// Runs a bun command in `cwd`, a directory of the fixture tree, and gives back its output as lines.
async function runCommandWithFault(args: string[], cwd: string, fault: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: join(String(dir), cwd),
    env: {
      ...faultEnv(fault),
      BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
      // On Linux a child whose output is not streamed writes to a memfd, not to a socket.
      BUN_FEATURE_FLAG_DISABLE_MEMFD: "1",
      BUN_TEST_PARALLEL_SCALE_MS: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  running.add(proc);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  running.delete(proc);
  // The payload lines are the part of the 8 MB that was read before the fault, and can end in a cut line.
  const lines = (text: string) =>
    Bun.stripANSI(text)
      .split("\n")
      .filter(line => line.length > 0 && !line.endsWith("x") && !line.startsWith("WARNING: ASAN interferes"));
  return { stdout: lines(stdout), stderr: lines(stderr), exitCode, signalCode: proc.signalCode };
}

// `git` and `crontab` on this PATH are the big writer.
const withTools = (fault: Record<string, string>) => ({ ...fault, PATH: `${toolsPath}:${bunEnv.PATH}` });

async function runWithFault(fixture: string, fault: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    cwd: String(dir),
    env: faultEnv(fault),
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

    test.concurrent("Bun.spawn: Bun.write(file, stdout) rejects and exited settles", async () => {
      expect(await runWithFault("stdout-write.mjs", { SPAWN_FAULT_RECV_AT: at })).toEqual({
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
          bun: { threw: "EIO", pid: "number", exited: true },
          // node's result for a process that ran: its pid and an output array, not the `pid: 0` and
          // `output: null` of one that could not be spawned.
          // It exited or was killed by a signal: `status` and `signal` are never both null.
          spawnSync: { stdout: null, error: "EIO", pid: true, output: [null, null, null], exited: true },
          execFileSync: "threw:EIO",
        },
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // child.stdout reads one chunk ahead of its 'data' listener, so once the stream flows a chunk is still buffered
  // when a later read fails. The stream is destroyed with the error, and that chunk has to reach 'data' first.
  test.concurrent("node:child_process: stdout delivers every byte read before the error", async () => {
    const report = join(String(dir), "recv-report.txt");
    expect(
      await runWithFault("child-process-bytes.mjs", { SPAWN_FAULT_RECV_AT: "6", SPAWN_FAULT_REPORT: report }),
    ).toEqual({
      parsed: { receivedSome: true, lost: 0, events: ["stdout.error:EIO", "stdout.close", "close"] },
      stderr: "",
      exitCode: 0,
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

describe.concurrent.skipIf(!isLinux || !cc)("commands that read a child's output", () => {
  // The worker that writes 8 MB is not left blocked on a pipe that nobody reads, so the run ends.
  describe("bun test --parallel", () => {
    const summary = (lines: string[]) =>
      lines.filter(line => /^\s*\d+ (pass|fail|errors?)$/.test(line)).map(line => line.trim());

    test.skipIf(!canFailPipeRead)("a read of a worker's output fails", async () => {
      const { stderr, exitCode, signalCode } = await runCommandWithFault(["test", "--parallel=2", "./tests"], ".", {
        SPAWN_FAULT_PREADV2_AT: "5",
      });
      expect({ summary: summary(stderr), exitCode, signalCode }).toEqual({
        summary: ["2 pass", "0 fail"],
        exitCode: 0,
        signalCode: null,
      });
    });

    test("the pipes of a worker fail to register", async () => {
      const { stderr, exitCode, signalCode } = await runCommandWithFault(["test", "--parallel=2", "./tests"], ".", {
        SPAWN_FAULT_EPOLL_AT: "1",
      });
      expect({ summary: summary(stderr), exitCode, signalCode }).toEqual({
        summary: ["2 pass", "0 fail"],
        exitCode: 0,
        signalCode: null,
      });
    });
  });

  describe("bun run", () => {
    describe.skipIf(!canFailPipeRead)("a read fails", () => {
      const fault = { SPAWN_FAULT_PREADV2_AT: "5" };

      test("--filter: the script gets EPIPE, and the next package runs", async () => {
        expect(await runCommandWithFault(["run", "--filter", "*", "big"], "ws", fault)).toEqual({
          stdout: ["first big: Exited with code 7", "second big: from second", "second big: Exited with code 0"],
          stderr: [],
          exitCode: 7,
          signalCode: null,
        });
      });

      test("--filter: a script that does not handle SIGPIPE is ended by it", async () => {
        expect(await runCommandWithFault(["run", "--filter", "first", "sigpipe"], "ws", fault)).toEqual({
          stdout: ["first sigpipe: Signaled with code SIGPIPE"],
          stderr: [],
          exitCode: 141,
          signalCode: null,
        });
      });

      test("--parallel: the script gets EPIPE", async () => {
        expect(await runCommandWithFault(["run", "--parallel", "big"], "ws/first", fault)).toEqual({
          stdout: [],
          stderr: ["big | Exited with code 7"],
          exitCode: 7,
          signalCode: null,
        });
      });
    });

    describe("the poll registration fails", () => {
      const fault = { SPAWN_FAULT_EPOLL_AT: "1" };

      test("--filter: the script gets EPIPE", async () => {
        expect(await runCommandWithFault(["run", "--filter", "first", "big"], "ws", fault)).toEqual({
          stdout: ["first big: Exited with code 7"],
          stderr: [],
          exitCode: 7,
          signalCode: null,
        });
      });

      test("--parallel: the script gets EPIPE", async () => {
        expect(await runCommandWithFault(["run", "--parallel", "big"], "ws/first", fault)).toEqual({
          stdout: [],
          stderr: ["big | Exited with code 7"],
          exitCode: 7,
          signalCode: null,
        });
      });
    });
  });

  test("node:child_process: a stdout stream that failed to read is not left rooted", async () => {
    expect(await runCommandWithFault(["stream-roots.mjs"], ".", { SPAWN_FAULT_RECV_MARK: "F" })).toEqual({
      stdout: [JSON.stringify({ events: "data:first error:EIO", rooted: 0 })],
      stderr: [],
      exitCode: 0,
      signalCode: null,
    });
  });

  describe("bun install and Bun.cron", () => {
    const fault = { SPAWN_FAULT_RECV_AT: "2" };
    const errors = (lines: string[]) => lines.filter(line => line.startsWith("error:"));

    test("a lifecycle script gets EPIPE and the install fails", async () => {
      const { stderr, exitCode, signalCode } = await runCommandWithFault(["install"], "install", fault);
      expect({ errors: errors(stderr), exitCode, signalCode }).toEqual({
        errors: [
          'error: Failed to read postinstall script output from "dep" due to error 5 EIO',
          'error: postinstall script from "dep" exited with 7',
        ],
        exitCode: 7,
        signalCode: null,
      });
    });

    // bun closed the pipe, so the signal is the failure of the script and not a signal for bun to die of.
    test("a lifecycle script that is ended by SIGPIPE fails the install", async () => {
      const { stderr, exitCode, signalCode } = await runCommandWithFault(["install"], "install-sigpipe", fault);
      expect({ errors: errors(stderr), exitCode, signalCode }).toEqual({
        errors: [
          'error: Failed to read postinstall script output from "dep" due to error 5 EIO',
          'error: postinstall script from "dep" terminated by SIGPIPE (Broken pipe)',
        ],
        exitCode: 1,
        signalCode: null,
      });
    });

    test("the failed script of an optional dependency does not fail the install", async () => {
      const { stderr, exitCode, signalCode } = await runCommandWithFault(["install"], "install-optional", fault);
      expect({
        errors: errors(stderr),
        installed: existsSync(join(String(dir), "install-optional", "node_modules", "dep")),
        exitCode,
        signalCode,
      }).toEqual({
        errors: ['error: Failed to read postinstall script output from "dep" due to error 5 EIO'],
        installed: false,
        exitCode: 0,
        signalCode: null,
      });
    });

    test("git gets EPIPE and the install fails", async () => {
      const { stderr, exitCode, signalCode } = await runCommandWithFault(["install"], "install-git", withTools(fault));
      expect({ errors: errors(stderr), exitCode, signalCode }).toEqual({
        errors: [
          "error: reading the output of git failed: EIO: Input/output error (recv())",
          'error: "git clone" for "dep" failed',
          "error: InstallFailed cloning repository for dep",
          "error: dep@git+https://example.invalid/owner/repo.git failed to resolve",
        ],
        exitCode: 1,
        signalCode: null,
      });
    });

    // The scanner's result does not fit the pipe, so the scanner is still writing when the read fails.
    test.skipIf(!canFailPipeRead).each([
      [
        "before any of its result was read",
        "1",
        "Security scanner exited with code 1 without sending data",
        "NoSecurityScanData",
      ],
      ["in the middle of its result", "2", "Security scanner sent invalid JSON: SyntaxError", "InvalidIPCMessage"],
    ])("the security scanner gets EPIPE and the install fails, read error %s", async (_label, at, cause, name) => {
      const { stderr, exitCode, signalCode } = await runCommandWithFault(["install"], "install-scanned", {
        SPAWN_FAULT_FIFO_READ_AT: at,
      });
      expect({ errors: errors(stderr), exitCode, signalCode }).toEqual({
        errors: [
          "error: Failed to read security scanner IPC: EIO: Input/output error (read())",
          `error: ${cause}`,
          `error: security scanner failed: ${name}`,
        ],
        exitCode: 1,
        signalCode: null,
      });
    });

    test.each(["register", "remove"])("Bun.cron %s: crontab gets EPIPE and the promise rejects", async action => {
      expect(await runCommandWithFault(["cron.mjs", action], ".", withTools(fault))).toEqual({
        stdout: ["rejected: Failed to read process output: EIO"],
        stderr: [],
        exitCode: 0,
        signalCode: null,
      });
    });
  });
});
