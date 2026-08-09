// When registering the child's pidfd with epoll fails (ENOMEM under memory
// pressure, ENOSPC when /proc/sys/fs/epoll/max_user_watches is exhausted),
// the process must fall back to the waiter thread instead of fabricating an
// exit: previously `subprocess.kill()` became a silent no-op (no signal sent,
// `killed` stayed false) and `.exited` never settled, leaking the child.
//
// The failure is injected with an LD_PRELOAD shim that makes epoll_ctl
// ADD/MOD fail with ENOMEM whenever the target fd is a pidfd. Bun issues
// epoll_ctl both through the libc symbol and through the generic syscall()
// entry point, so the shim interposes both.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, tempDir } from "harness";
import { join } from "path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// LD_PRELOAD requires the dynamically linked glibc build; the musl build is
// static.
const enabled = isLinux && !isMusl && !!cc;

const SHIM_SOURCE = `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/syscall.h>
#include <unistd.h>

static int is_pidfd(int fd) {
  char path[64], buf[64];
  snprintf(path, sizeof(path), "/proc/self/fd/%d", fd);
  ssize_t n = readlink(path, buf, sizeof(buf) - 1);
  if (n <= 0) return 0;
  buf[n] = 0;
  return strstr(buf, "[pidfd]") != NULL;
}

static int should_fail(int op, int fd) {
  return (op == EPOLL_CTL_ADD || op == EPOLL_CTL_MOD) && is_pidfd(fd);
}

int epoll_ctl(int epfd, int op, int fd, struct epoll_event *ev) {
  static int (*real)(int, int, int, struct epoll_event *);
  if (!real) real = dlsym(RTLD_NEXT, "epoll_ctl");
  if (should_fail(op, fd)) {
    errno = ENOMEM;
    return -1;
  }
  return real(epfd, op, fd, ev);
}

long syscall(long number, ...) {
  static long (*real)(long, long, long, long, long, long, long);
  va_list ap;
  long a[6];
  va_start(ap, number);
  for (int i = 0; i < 6; i++) a[i] = va_arg(ap, long);
  va_end(ap);
  if (!real) real = dlsym(RTLD_NEXT, "syscall");
  if (number == SYS_epoll_ctl && should_fail((int)a[1], (int)a[2])) {
    errno = ENOMEM;
    return -1;
  }
  return real(number, a[0], a[1], a[2], a[3], a[4], a[5]);
}
`;

// Spawns a child, SIGKILLs it, and reports what the Subprocess API observed.
// The Bun.sleep() race is a deadline, not a wait: on a broken build `.exited`
// never settles, and the deadline turns that hang into a clean JSON mismatch.
const FIXTURE = `
const p = Bun.spawn(["sleep", "100"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
p.kill("SIGKILL");
let timer;
const deadline = new Promise(resolve => { timer = setTimeout(() => resolve("never settled"), 3000); });
const exited = await Promise.race([p.exited, deadline]);
clearTimeout(timer);
let alive;
try { process.kill(p.pid, 0); alive = true; } catch { alive = false; }
if (alive) try { process.kill(p.pid, 9); } catch {}
console.log(JSON.stringify({ exited, signalCode: p.signalCode, killed: p.killed, alive }));
`;

async function compileShim(dir: string): Promise<string> {
  const source = join(dir, "epoll_fail.c");
  const shim = join(dir, "epoll_fail.so");
  await Bun.write(source, SHIM_SOURCE);
  await using proc = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-O2", "-o", shim, source, "-ldl"],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`cc failed: ${stderr}`);
  return shim;
}

async function runFixture(extraEnv: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", FIXTURE],
    env: { ...bunEnv, ...extraEnv },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim());
}

test.skipIf(!enabled)("kill() and exited work when pidfd epoll registration fails", async () => {
  using dir = tempDir("epoll-fail", {});
  const shim = await compileShim(String(dir));

  // Control: the fixture passes without fault injection.
  expect(await runFixture({})).toEqual({
    exited: 137,
    signalCode: "SIGKILL",
    killed: true,
    alive: false,
  });

  // With every pidfd epoll_ctl ADD/MOD failing, the signal must still be
  // delivered and the exit must still be observed.
  expect(await runFixture({ LD_PRELOAD: shim })).toEqual({
    exited: 137,
    signalCode: "SIGKILL",
    killed: true,
    alive: false,
  });
}, 15_000);

test.skipIf(!enabled)("exit is observed without kill when pidfd epoll registration fails", async () => {
  using dir = tempDir("epoll-fail-exit", {});
  const shim = await compileShim(String(dir));

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const p = Bun.spawn(["sleep", "0.05"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
       let timer;
       const deadline = new Promise(resolve => { timer = setTimeout(() => resolve("never settled"), 3000); });
       const exited = await Promise.race([p.exited, deadline]);
       clearTimeout(timer);
       console.log(JSON.stringify({ exited, exitCode: p.exitCode }));`,
    ],
    env: { ...bunEnv, LD_PRELOAD: shim },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(JSON.stringify({ exited: 0, exitCode: 0 }));
  expect(exitCode).toBe(0);
}, 15_000);
