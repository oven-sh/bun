// `bun install` starts the HTTP client thread unconditionally. When the OS
// refuses the thread (EAGAIN under a tight `ulimit -u` / RLIMIT_NPROC or a
// container pids limit) that is the environment's limit, not a bug in bun, so
// it must be reported as a plain error with exit code 1 instead of going
// through the crash reporter ("oh no: Bun has crashed", bun.report link).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, compileFixture, isLinux, isMusl, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// Models a process sitting at its thread limit: every further pthread_create
// fails with `code`, the way pthread_create reports errors (a returned errno).
const shimC = (code: string) => /* c */ `
#include <errno.h>
#include <pthread.h>

int pthread_create(pthread_t *thread, const pthread_attr_t *attr, void *(*start)(void *), void *arg) {
  (void)thread; (void)attr; (void)start; (void)arg;
  return ${code};
}
`;

// bun-musl is statically linked, so LD_PRELOAD cannot intercept pthread_create.
describe.skipIf(!isLinux || isMusl || !cc)("bun install when the HTTP client thread cannot be started", () => {
  test.concurrent.each([
    // [pthread_create result, how it is reported, whether the thread-limit hint applies]
    ["EAGAIN", "EAGAIN", true],
    ["EPERM", "EPERM", false],
    // A code bun has no errno name for is reported with the OS's own description.
    ["9999", "Unknown error 9999 (os error 9999)", false],
  ])("pthread_create returning %s exits 1 with an error naming %s", async (code, reported, hintApplies) => {
    using dir = tempDir(`install-thread-spawn-${code}`, {
      "shim.c": shimC(code),
      "package.json": JSON.stringify({ name: "thread-spawn-failure", dependencies: {} }),
    });
    const shim = compileFixture(join(String(dir), "shim.c"));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
        LD_PRELOAD: [shim, bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

    expect(stderr).toContain(`Failed to start HTTP Client thread: ${reported}`);
    expect(stderr.includes("ulimit -u")).toBe(hintApplies);
    expect(stderr).not.toContain("Bun has crashed");
    expect(exitCode).toBe(1);
  });
});
