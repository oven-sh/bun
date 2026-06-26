// The shell reads a spawned command's stdout/stderr capture socketpairs
// eagerly inside ShellSubprocess::spawn_async, while Cmd::transition_to_exec
// still holds raw pointers into the ShellSubprocess and re-borrows the Cmd
// node after the call. A recv() that fails there reaches
// Cmd::buffered_output_close synchronously; it must defer the command's
// completion until the spawn returns instead of driving the trampoline, which
// would deinit the Cmd and free the ShellSubprocess under the live spawn
// frames (heap-use-after-free / "expected Node::Cmd at Node#N, got Free").
//
// The LD_PRELOAD shim fails every recv(MSG_DONTWAIT) with ENOMEM. The shell's
// PipeReader is the only caller of recv in these fixtures, so the first read
// of each capture socketpair (the one inside the spawn) errors
// deterministically.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
// musl builds of Bun are statically linked, so LD_PRELOAD can't interpose.
const enabled = isLinux && !isMusl && !!cc;

const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <sys/socket.h>
#include <sys/types.h>

static ssize_t (*real_recv)(int, void *, size_t, int);

ssize_t recv(int fd, void *buf, size_t len, int flags) {
    if (!real_recv) {
        real_recv = (ssize_t (*)(int, void *, size_t, int)) dlsym(RTLD_NEXT, "recv");
    }
    if (flags & MSG_DONTWAIT) {
        errno = ENOMEM;
        return -1;
    }
    return real_recv(fd, buf, len, flags);
}
`;

// Both stdout and stderr are captured: the second failed read (stderr's)
// finishes the command while spawn_maybe_sync_impl is still on the stack.
const BOTH_PIPES_FIXTURE = /* js */ `
import { $ } from "bun";
const r = await $\`/bin/echo hi\`.quiet().nothrow();
console.log("exit=" + r.exitCode);
`;

// stderr goes to a file, so the very first failed read (stdout's) finishes
// the command; the spawn then touches subproc.stderr of the freed subprocess.
const STDOUT_ONLY_FIXTURE = /* js */ `
import { $ } from "bun";
const r = await $\`/bin/echo hi 2> /dev/null\`.quiet().nothrow();
console.log("exit=" + r.exitCode);
`;

let dir: ReturnType<typeof tempDir> | undefined;
let shimPath: string;

beforeAll(async () => {
  if (!enabled) return;
  dir = tempDir("shell-spawn-read-fail", {
    "shim.c": SHIM_C,
    "both-pipes.ts": BOTH_PIPES_FIXTURE,
    "stdout-only.ts": STDOUT_ONLY_FIXTURE,
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

async function runFixture(script: string) {
  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd: [bunExe(), script],
    cwd: String(dir),
    env: { ...bunEnv, LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.skipIf(!enabled)("shell survives capture pipe reads failing during the spawn (stdout + stderr)", async () => {
  const { stdout, stderr, exitCode } = await runFixture("both-pipes.ts");
  // ENOMEM (12) from the failed capture read becomes the command's exit code;
  // the Bun process itself must not crash.
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "exit=12\n",
    stderr: expect.any(String),
    exitCode: 0,
  });
});

test.skipIf(!enabled)("shell survives a capture pipe read failing during the spawn (stdout only)", async () => {
  const { stdout, stderr, exitCode } = await runFixture("stdout-only.ts");
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "exit=12\n",
    stderr: expect.any(String),
    exitCode: 0,
  });
});
