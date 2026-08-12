// An LD_PRELOAD shim injects ENOMEM into a shell command's pipe setup (recv()
// on the eager read, or epoll_ctl() registering the pipe) so the reader error
// surfaces synchronously from inside the spawn call. The command must finish
// with the syscall errno as its exit code, not tear state down under the spawn.
//
// The last group does the same to the builtin `cat`'s own reader (a FIFO it
// opened itself): the re-registration after the first chunk fails, so the read
// error lands while that chunk is still queued on stdout.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { statSync } from "node:fs";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// Env-selected fault modes:
//   SHELL_FAIL_RECV=1        every recv() fails with ENOMEM.
//   SHELL_FAIL_EPOLL=1       every epoll_ctl ADD/MOD on a pipe-like fd fails
//                            with ENOMEM.
//   SHELL_FAIL_EPOLL_AFTER=1 the first epoll_ctl ADD on each AF_UNIX socket
//                            succeeds (so the PipeReader starts and the eager
//                            read runs); every later ADD/MOD on that fd fails
//                            with ENOMEM. This is the poll re-registration
//                            after an EAGAIN.
//   SHELL_RECV_ONE_CHUNK=1   the first recv() on each AF_UNIX socket returns
//                            a fixed chunk ("FAKE-CHUNK\\n"), every later one
//                            returns EAGAIN. Pins the "child wrote some bytes,
//                            then stalled" interleaving so it is deterministic.
//   SHELL_RECV_EAGAIN_FIRST=1 the first recv() on each AF_UNIX socket returns
//                            EAGAIN, every later recv() is real. Pushes the
//                            first successful read out of the eager spawn-time
//                            read_all() and into the epoll dispatch.
//   SHELL_FAIL_EPOLL_FROM=N  the Nth and every later epoll_ctl ADD/MOD on each
//                            AF_UNIX socket fails with ENOMEM (1-based).
//   SHELL_RECV_BULK=N        the first N recv()s on each AF_UNIX socket that
//                            reach the real syscall instead return the caller's
//                            whole buffer filled with 'A'. The PosixBufferedReader
//                            read loop's scratch buffer is 256 KB, so one bulk
//                            recv guarantees the streaming inner loop's mid-read
//                            flush (`head_start` past the half-buffer cutoff)
//                            fires in a single poll wake.
//   SHELL_FAIL_EPOLL_REARM_INO=N  the first epoll_ctl ADD/MOD on each fd open
//                            on the FIFO with inode N succeeds; every later one
//                            (the re-arm after a chunk was read) fails with
//                            ENOMEM. Keyed by inode so only the named FIFO the
//                            fixture hands to `cat` is affected, not the
//                            capture pipes (anonymous pipes are FIFOs too).
// FilePoll registers the socketpair through the raw syscall(SYS_epoll_ctl,
// ...) wrapper, not the libc epoll_ctl symbol, so the epoll modes interpose
// syscall(2).
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

#define MAX_FD 65536
#define CHUNK "FAKE-CHUNK\\n"
#define CHUNK_LEN (sizeof(CHUNK) - 1)

static ssize_t (*real_recv)(int, void *, size_t, int);
static long (*real_syscall)(long, long, long, long, long, long, long);
static int (*real_close)(int);
static int fail_recv = -1;
static int fail_epoll = -1;
static int fail_epoll_after = -1;
static int recv_one_chunk = -1;
static int recv_eagain_first = -1;
static int fail_epoll_from = -1; /* 0 = off, N >= 1 = 1-based index of the first failing call */
static int recv_bulk = -1;       /* 0 = off, N >= 1 = number of fabricated full-buffer recvs */
static unsigned long long rearm_ino; /* 0 = off, otherwise the inode of the FIFO whose re-arms fail */
static int rearm_init;
static unsigned char recv_count[MAX_FD];
static unsigned char epoll_count[MAX_FD];
static unsigned char bulk_count[MAX_FD];
static unsigned char rearm_count[MAX_FD];

static void init_modes(void) {
  if (fail_recv < 0) fail_recv = getenv("SHELL_FAIL_RECV") != NULL;
  if (fail_epoll < 0) fail_epoll = getenv("SHELL_FAIL_EPOLL") != NULL;
  if (fail_epoll_after < 0) fail_epoll_after = getenv("SHELL_FAIL_EPOLL_AFTER") != NULL;
  if (recv_one_chunk < 0) recv_one_chunk = getenv("SHELL_RECV_ONE_CHUNK") != NULL;
  if (recv_eagain_first < 0) recv_eagain_first = getenv("SHELL_RECV_EAGAIN_FIRST") != NULL;
  if (fail_epoll_from < 0) {
    const char *s = getenv("SHELL_FAIL_EPOLL_FROM");
    fail_epoll_from = s ? atoi(s) : 0;
  }
  if (recv_bulk < 0) {
    const char *s = getenv("SHELL_RECV_BULK");
    recv_bulk = s ? atoi(s) : 0;
  }
  if (!rearm_init) {
    const char *s = getenv("SHELL_FAIL_EPOLL_REARM_INO");
    rearm_ino = s ? strtoull(s, NULL, 10) : 0;
    rearm_init = 1;
  }
}

static int is_rearm_fifo(int fd) {
  struct stat st;
  return rearm_ino != 0 && fstat(fd, &st) == 0 && S_ISFIFO(st.st_mode) && st.st_ino == rearm_ino;
}

static int is_unix_sock(int fd) {
  struct stat st;
  if (fstat(fd, &st) != 0 || !S_ISSOCK(st.st_mode)) return 0;
  int domain = 0;
  socklen_t len = sizeof(domain);
  return getsockopt(fd, SOL_SOCKET, SO_DOMAIN, &domain, &len) == 0 && domain == AF_UNIX;
}

static int is_pipe_like(int fd) {
  struct stat st;
  if (fstat(fd, &st) != 0) return 0;
  if (S_ISFIFO(st.st_mode)) return 1;
  return is_unix_sock(fd);
}

ssize_t recv(int fd, void *buf, size_t len, int flags) {
  if (!real_recv) {
    real_recv = (ssize_t (*)(int, void *, size_t, int))dlsym(RTLD_NEXT, "recv");
    init_modes();
  }
  if (fail_recv) {
    errno = ENOMEM;
    return -1;
  }
  if (recv_one_chunk && fd >= 0 && fd < MAX_FD && is_unix_sock(fd)) {
    if (recv_count[fd]++ == 0) {
      size_t n = len < CHUNK_LEN ? len : CHUNK_LEN;
      memcpy(buf, CHUNK, n);
      return (ssize_t)n;
    }
    errno = EAGAIN;
    return -1;
  }
  if (recv_eagain_first && fd >= 0 && fd < MAX_FD && is_unix_sock(fd) && recv_count[fd]++ == 0) {
    errno = EAGAIN;
    return -1;
  }
  if (recv_bulk > 0 && fd >= 0 && fd < MAX_FD && is_unix_sock(fd) && bulk_count[fd] < recv_bulk && len > 0) {
    bulk_count[fd]++;
    memset(buf, 'A', len);
    return (ssize_t)len;
  }
  return real_recv(fd, buf, len, flags);
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
  if (number == SYS_epoll_ctl) {
    int op = (int)b;
    int target = (int)c;
    if (op == EPOLL_CTL_ADD || op == EPOLL_CTL_MOD) {
      if (fail_epoll && is_pipe_like(target)) {
        errno = ENOMEM;
        return -1;
      }
      if (fail_epoll_after && target >= 0 && target < MAX_FD && is_unix_sock(target)) {
        if (epoll_count[target]++ >= 1) {
          errno = ENOMEM;
          return -1;
        }
      }
      if (fail_epoll_from > 0 && target >= 0 && target < MAX_FD && is_unix_sock(target)) {
        if (++epoll_count[target] >= fail_epoll_from) {
          errno = ENOMEM;
          return -1;
        }
      }
      if (target >= 0 && target < MAX_FD && is_rearm_fifo(target)) {
        if (rearm_count[target]++ >= 1) {
          errno = ENOMEM;
          return -1;
        }
      }
    }
  }
  return real_syscall(number, a, b, c, d, e, f);
}

// Reset the per-fd counters on close so a recycled fd number starts fresh.
int close(int fd) {
  if (!real_close) real_close = (int (*)(int))dlsym(RTLD_NEXT, "close");
  if (fd >= 0 && fd < MAX_FD) {
    recv_count[fd] = 0;
    epoll_count[fd] = 0;
    bulk_count[fd] = 0;
    rearm_count[fd] = 0;
  }
  return real_close(fd);
}
`;

// stderr is redirected away from the capture pipe, so the faulted stdout
// stream is the last open one: closing it finishes the Cmd from inside spawn.
const STDOUT_ONLY_FIXTURE = /* js */ `
import { $ } from "bun";
const r = await $\`head -c 64 /dev/zero 2> /dev/null\`.nothrow();
console.log(JSON.stringify({ exitCode: r.exitCode }));
`;

// Both stdout and stderr are capture pipes; the stderr fault (raised from
// inside spawn_async's own stack frame) is the one that finishes the Cmd.
const BOTH_PIPES_FIXTURE = /* js */ `
import { $ } from "bun";
const r = await $\`head -c 64 /dev/zero\`.nothrow();
console.log(JSON.stringify({ exitCode: r.exitCode }));
`;

// For SHELL_RECV_ONE_CHUNK + SHELL_FAIL_EPOLL_AFTER: the eager read gets one
// chunk, then an EAGAIN whose poll re-registration fails. That error closes the
// stream (PipeReader::detach sets process = None), and the reader then still
// delivers the drained chunk and retries the poll, signalling the already
// detached Cmd a second time. The child just has to stay alive long enough for
// the (faked) EAGAIN to be plausible; the shell kills it once the Cmd finishes.
//
// .quiet() keeps the CapturedWriter dead so the second signal comes straight
// from the retried register_poll's on_reader_error.
const QUIET_CHUNK_FIXTURE = /* js */ `
import { $ } from "bun";
const r = await $\`sleep 5\`.quiet().nothrow();
console.log(JSON.stringify({ exitCode: r.exitCode }));
`;

// For SHELL_RECV_EAGAIN_FIRST + SHELL_FAIL_EPOLL_FROM=3: the eager spawn-time
// read gets EAGAIN and re-registers the poll (epoll_ctl #2, succeeds), so the
// spawn returns and drops its keepalive. The child's bytes then wake the poll;
// that read drains the chunk, hits a real EAGAIN, and its re-registration
// (epoll_ctl #3) fails, tearing the stream down from under the in-flight read
// while it still has the drained chunk to deliver. `exec sleep` keeps stdout
// open so the poll-driven read sees data-then-EAGAIN instead of EOF, and
// `2> /dev/null` makes stdout the only captured stream so the Cmd finishes
// as soon as it errors instead of waiting out the child.
const POLL_CHUNK_FIXTURE = /* js */ `
import { $ } from "bun";
const r = await $\`sh -c 'printf AAAA; exec sleep 5' 2> /dev/null\`.quiet().nothrow();
console.log(JSON.stringify({ exitCode: r.exitCode }));
`;

// For SHELL_FAIL_EPOLL_REARM_INO: the builtin cat reads CAT_FIFO, either as a
// file argument or through a stdin redirect (the two states of its state
// machine). The fixture keeps its own read/write descriptor on the FIFO so the
// reader never sees EOF: cat's first poll wake reads the payload and queues it
// on stdout (the capture pipe, so the write waits for the event loop), and the
// re-arm that follows is the call the shim fails. cat has to write the payload
// out anyway and then finish with the errno. It used to cancel the queued
// chunk and suspend forever instead.
const CAT_FIFO_FIXTURE = /* js */ `
import { $ } from "bun";
import { constants, openSync, writeSync } from "node:fs";
const fifo = process.env.CAT_FIFO;
const keepWriterOpen = openSync(fifo, constants.O_RDWR);
writeSync(keepWriterOpen, "queued before the fault\\n");
const r = process.env.CAT_FIFO_VIA === "redirect" ? await $\`cat < \${fifo}\`.nothrow() : await $\`cat \${fifo}\`.nothrow();
console.log(JSON.stringify({ exitCode: r.exitCode, stdout: r.stdout.toString() }));
`;

let shimPath: string;
let dir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("shell-pipe-read-fault", {
    "shim.c": SHIM_C,
    "stdout-only.js": STDOUT_ONLY_FIXTURE,
    "both-pipes.js": BOTH_PIPES_FIXTURE,
    "quiet-chunk.js": QUIET_CHUNK_FIXTURE,
    "poll-chunk.js": POLL_CHUNK_FIXTURE,
    "cat-fifo.js": CAT_FIFO_FIXTURE,
  });
  shimPath = join(String(dir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
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

// The shell surfaces the failed syscall's errno as the command's exit code.
const ENOMEM = 12;

const MODES = [
  "SHELL_FAIL_RECV",
  "SHELL_FAIL_EPOLL",
  "SHELL_FAIL_EPOLL_AFTER",
  "SHELL_RECV_ONE_CHUNK",
  "SHELL_RECV_EAGAIN_FIRST",
] as const;
// Integer-valued fault knobs; cleared alongside MODES and set through `extraEnv`.
const VALUE_MODES = ["SHELL_FAIL_EPOLL_FROM", "SHELL_RECV_BULK", "SHELL_FAIL_EPOLL_REARM_INO"] as const;

async function expectShellFault(
  script: string,
  modes: (typeof MODES)[number][],
  extraEnv: Record<string, string> = {},
  expected: Record<string, unknown> = { exitCode: ENOMEM },
) {
  const existing = bunEnv.LD_PRELOAD;
  const env: Record<string, string | undefined> = {
    ...bunEnv,
    LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
    // ASAN symbolizes the whole debug binary before exiting on an error, which
    // alone blows the per-test budget. No assertion reads the symbolized frames.
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0"].filter(Boolean).join(":"),
  };
  for (const m of [...MODES, ...VALUE_MODES]) env[m] = undefined;
  for (const m of modes) env[m] = "1";
  Object.assign(env, extraEnv);
  await using proc = Bun.spawn({
    // If the fixture does crash, skip the debug build's slow symbolized
    // backtrace so the failure surfaces as the panic message, not a test
    // timeout. The fixture ignores the extra argv entry.
    cmd: [bunExe(), script, "--debug-crash-handler-use-trace-string"],
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
  // One combined assertion so a crash surfaces stderr and the exit code in the diff.
  expect({ parsed, stderr, exitCode }).toEqual({
    parsed: expected,
    stderr: expect.any(String),
    exitCode: 0,
  });
}

test.concurrent.skipIf(!isLinux || !cc)(
  "shell survives a synchronous stdout pipe read error during spawn",
  async () => {
    await expectShellFault("stdout-only.js", ["SHELL_FAIL_RECV"]);
  },
);

test.concurrent.skipIf(!isLinux || !cc)(
  "shell survives synchronous stdout and stderr pipe read errors during spawn",
  async () => {
    await expectShellFault("both-pipes.js", ["SHELL_FAIL_RECV"]);
  },
);

test.concurrent.skipIf(!isLinux || !cc)(
  "shell survives a synchronous epoll_ctl failure registering the stdout pipe",
  async () => {
    await expectShellFault("stdout-only.js", ["SHELL_FAIL_EPOLL"]);
  },
);

test.concurrent.skipIf(!isLinux || !cc)(
  "shell survives synchronous epoll_ctl failures registering both pipes",
  async () => {
    await expectShellFault("both-pipes.js", ["SHELL_FAIL_EPOLL"]);
  },
);

// Regression: the re-registration failing AFTER the eager read made progress
// closes the stream and detaches the PipeReader (process = None), and the
// reader then still delivers the drained chunk and retries the poll, so the
// already detached reader reaches try_signal_done_to_cmd a second time.
// Panicked with "assertion failed: process.is_some()".
test.concurrent.skipIf(!isLinux || !cc)(
  "shell survives a poll re-registration failure after the eager read drained a chunk",
  async () => {
    await expectShellFault("quiet-chunk.js", ["SHELL_FAIL_EPOLL_AFTER", "SHELL_RECV_ONE_CHUNK"]);
  },
);

// Same re-registration failure, but raised from the poll-driven read instead
// of the eager spawn-time one. `Readable::start_pipe_reader` holds an Arc
// across the eager read, but the epoll dispatch holds nothing, so when the
// failed register_poll's on_reader_error dropped the last reference to the
// PipeReader, read_with_fn's EAGAIN arm delivered the drained chunk to the
// freed reader. ASAN: heap-use-after-free in PipeReader::on_read_chunk.
test.concurrent.skipIf(!isLinux || !cc || !isASAN)(
  "shell survives a poll re-registration failure during a poll-driven read",
  async () => {
    await expectShellFault("poll-chunk.js", ["SHELL_RECV_EAGAIN_FIRST"], { SHELL_FAIL_EPOLL_FROM: "3" });
  },
);

// Same failing epoll_ctl (#3: ADD at start, MOD after the eager read's forced
// EAGAIN, then the first poll-driven MOD), but SHELL_RECV_BULK=1 makes the
// poll-driven recv return the read loop's whole 256 KB scratch buffer at once.
// That pushes `head_start` past read_with_fn's half-buffer cutoff, so the
// shell `PipeReader::on_read_chunk` mid-loop flush fires while the inner loop
// still has iterations left. on_read_chunk then called
// `self.reader.register_poll()` itself; its failure dispatched
// `on_reader_error`, which dropped the last `Arc<PipeReader>`, and the still
// looping read_with_fn kept reading through the freed `PosixBufferedReader`.
// ASAN: heap-use-after-free in PosixBufferedReader::read_with_fn.
//
// With the re-arm removed from on_read_chunk, epoll_ctl #3 is instead the read
// loop's own EAGAIN re-registration, whose failure path already returns
// without touching the (freed) reader, so the command just reports ENOMEM.
test.concurrent.skipIf(!isLinux || !cc || !isASAN)(
  "shell survives a poll re-registration failure raised from on_read_chunk's mid-read flush",
  async () => {
    await expectShellFault("poll-chunk.js", ["SHELL_RECV_EAGAIN_FIRST"], {
      SHELL_FAIL_EPOLL_FROM: "3",
      SHELL_RECV_BULK: "1",
    });
  },
);

// Builtin cat (`Cat::on_io_reader_done`), both of its states. The read error
// arrives with the chunk it just read still queued on stdout; cat must let
// that chunk drain and then exit with the errno. On POSIX the builtin is only
// used with BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS set.
async function expectCatReadFaultAfterChunk(via: "arg" | "redirect") {
  const fifo = join(String(dir), `cat-${via}.fifo`);
  mkfifo(fifo);
  await expectShellFault(
    "cat-fifo.js",
    [],
    {
      BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1",
      SHELL_FAIL_EPOLL_REARM_INO: statSync(fifo, { bigint: true }).ino.toString(),
      CAT_FIFO: fifo,
      CAT_FIFO_VIA: via,
    },
    { exitCode: ENOMEM, stdout: "queued before the fault\n" },
  );
}

test.concurrent.skipIf(!isLinux || !cc)(
  "builtin cat finishes when a file argument fails to read after a chunk was queued",
  async () => {
    await expectCatReadFaultAfterChunk("arg");
  },
);

test.concurrent.skipIf(!isLinux || !cc)(
  "builtin cat finishes when redirected stdin fails to read after a chunk was queued",
  async () => {
    await expectCatReadFaultAfterChunk("redirect");
  },
);
