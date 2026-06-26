// An LD_PRELOAD shim makes recv() on the shell's stdout/stderr socketpair fail
// with ENOMEM so the eager pipe read inside ShellSubprocess::spawn_async errors
// synchronously. The resulting Cmd::buffered_output_close used to hand back a
// runnable Yield that drove the trampoline into Cmd::deinit, freeing the
// ShellSubprocess out from under the still-running spawn call:
//
//   AddressSanitizer: heap-use-after-free (READ)
//     Readable::start_pipe_reader            shell/subproc.rs:1247
//     ShellSubprocess::spawn_maybe_sync_impl shell/subproc.rs:888
//   freed by: Cmd::deinit <- Interpreter::deinit_node
//             <- PipeReader::run_yield_with <- PipeReader::on_reader_error
//
// The command must instead finish cleanly with the syscall errno as its exit
// code (ENOMEM = 12 on Linux).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// Interposes recv(2). When SHELL_FAIL_RECV=1, every recv fails with ENOMEM.
// The only recv calls a `bun -e` shell script makes are the eager reads on the
// subprocess's stdout/stderr socketpairs, so no counting is needed.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/types.h>

static ssize_t (*real_recv)(int, void *, size_t, int);
static int fail = -1;

ssize_t recv(int fd, void *buf, size_t len, int flags) {
    if (!real_recv) {
        real_recv = (ssize_t (*)(int, void *, size_t, int)) dlsym(RTLD_NEXT, "recv");
        fail = getenv("SHELL_FAIL_RECV") != NULL;
    }
    if (fail) {
        errno = ENOMEM;
        return -1;
    }
    return real_recv(fd, buf, len, flags);
}
`;

// stderr is redirected away from the capture pipe, so the faulted stdout read
// is the last open stream: closing it finishes the Cmd from inside the spawn.
const STDOUT_ONLY_FIXTURE = /* js */ `
import { $ } from "bun";
const r = await $\`head -c 64 /dev/zero 2> /dev/null\`.nothrow();
console.log(JSON.stringify({ exitCode: r.exitCode }));
`;

// Both stdout and stderr are capture pipes; the stderr read (faulted from
// inside spawn_async's own stack frame) is the one that finishes the Cmd.
const BOTH_PIPES_FIXTURE = /* js */ `
import { $ } from "bun";
const r = await $\`head -c 64 /dev/zero\`.nothrow();
console.log(JSON.stringify({ exitCode: r.exitCode }));
`;

let shimPath: string;
let dir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("shell-pipe-read-fault", {
    "shim.c": SHIM_C,
    "stdout-only.js": STDOUT_ONLY_FIXTURE,
    "both-pipes.js": BOTH_PIPES_FIXTURE,
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

async function runWithShim(script: string) {
  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd: [bunExe(), script],
    cwd: String(dir),
    env: {
      ...bunEnv,
      LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
      SHELL_FAIL_RECV: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.skipIf(!isLinux || !cc)("shell survives a synchronous stdout pipe read error during spawn", async () => {
  const { stdout, stderr, exitCode } = await runWithShim("stdout-only.js");
  const line = stdout.trim().split("\n").pop() ?? "";
  expect({ stderr, line }).toEqual({ stderr: expect.any(String), line: expect.stringContaining("{") });
  expect(JSON.parse(line)).toEqual({ exitCode: 12 }); // ENOMEM
  expect(exitCode).toBe(0);
});

test.skipIf(!isLinux || !cc)("shell survives synchronous stdout and stderr pipe read errors during spawn", async () => {
  const { stdout, stderr, exitCode } = await runWithShim("both-pipes.js");
  const line = stdout.trim().split("\n").pop() ?? "";
  expect({ stderr, line }).toEqual({ stderr: expect.any(String), line: expect.stringContaining("{") });
  expect(JSON.parse(line)).toEqual({ exitCode: 12 }); // ENOMEM
  expect(exitCode).toBe(0);
});
