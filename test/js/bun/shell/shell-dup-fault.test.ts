// https://github.com/oven-sh/bun/issues/26660
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// setupIOBeforeRun()'s first syscall is a dup of stdout/stderr: on Linux,
// fcntl(fd, F_DUPFD_CLOEXEC, 0). Fail exactly that with EMFILE for fd 1/2
// while the SHELL_FAIL_DUP_ARM file exists, leaving Bun's own startup alone.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdlib.h>
#include <unistd.h>

static int (*real_fcntl)(int, int, ...);
static const char *arm_path;
static int init_done;

static int should_fail(int fd, int cmd) {
  if (!init_done) {
    real_fcntl = (int (*)(int, int, ...))dlsym(RTLD_NEXT, "fcntl");
    arm_path = getenv("SHELL_FAIL_DUP_ARM");
    init_done = 1;
  }
  if (!arm_path || (fd != 1 && fd != 2)) return 0;
  if (cmd != F_DUPFD && cmd != F_DUPFD_CLOEXEC) return 0;
  return access(arm_path, F_OK) == 0;
}

int fcntl(int fd, int cmd, ...) {
  if (should_fail(fd, cmd)) {
    errno = EMFILE;
    return -1;
  }
  // glibc's own fcntl reads its optional third argument as a void * for every
  // command (sysdeps/unix/sysv/linux/fcntl64.c); mirror that so commands this
  // shim does not recognize still forward their argument.
  va_list ap;
  va_start(ap, cmd);
  void *arg = va_arg(ap, void *);
  va_end(ap);
  return real_fcntl(fd, cmd, arg);
}
`;

// Every armed $ call takes the runFromJS error path, where only the GC
// finalizer may free the native Interpreter. Draining the ShellInterpreter
// count proves those finalizers ran, so under ASAN a reintroduced free aborts.
const FIXTURE = /* js */ `
import { heapStats } from "bun:jsc";
import { unlinkSync, writeFileSync } from "node:fs";

const arm = process.env.SHELL_FAIL_DUP_ARM;
const results = [];

async function run() {
  writeFileSync(arm, "1");
  try {
    for (let i = 0; i < 16; i++) {
      try {
        await Bun.$\`echo hi \${i}\`;
        results.push("resolved");
      } catch (e) {
        results.push(\`\${e?.code}:\${e?.syscall}\`);
      }
      Bun.gc(true);
    }
  } finally {
    unlinkSync(arm);
  }
}
await run();

// Conservative stack roots can pin a few wrappers indefinitely, so retry
// until (almost) every ShellInterpreter has been finalized (same pattern and
// tolerance as leak.test.ts).
let interpreters = -1;
for (let k = 0; k < 25; k++) {
  Bun.gc(true);
  interpreters = heapStats().objectTypeCounts.ShellInterpreter ?? 0;
  if (interpreters <= 3) break;
  await Bun.sleep(20);
}
console.log(JSON.stringify({ results, interpreters }));
`;

let shimPath: string;
let armPath: string;
let dir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("shell-dup-fault", {
    "shim.c": SHIM_C,
    "fixture.js": FIXTURE,
  });
  shimPath = join(String(dir), "shim.so");
  armPath = join(String(dir), "arm");
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

test.concurrent.skipIf(!isLinux || !cc)(
  "shell interpreter survives setupIOBeforeRun failure followed by GC",
  async () => {
    const existing = bunEnv.LD_PRELOAD;
    await using proc = Bun.spawn({
      // If the fixture does crash, skip the debug build's slow symbolized
      // backtrace so the failure surfaces as the panic message, not a test
      // timeout. The fixture ignores the extra argv entry.
      cmd: [bunExe(), "fixture.js", "--debug-crash-handler-use-trace-string"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
        SHELL_FAIL_DUP_ARM: armPath,
      },
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
    // One combined assertion so a crash surfaces stderr and the exit code in
    // the diff. Every $ call must have taken the setupIOBeforeRun error path
    // (EMFILE from the dup's fcntl).
    expect({ parsed, stderr, exitCode }).toEqual({
      parsed: { results: Array(16).fill("EMFILE:fcntl"), interpreters: expect.any(Number) },
      stderr: expect.any(String),
      exitCode: 0,
    });
    // Conservative stack roots may pin a few of the 16 wrappers; the rest
    // must have been finalized or this test never exercised the finalizer.
    expect((parsed as { interpreters: number }).interpreters).toBeLessThanOrEqual(3);
  },
);
