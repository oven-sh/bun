// `bun install` starts the HTTP client thread unconditionally. When the OS
// refuses the thread (EAGAIN under a tight `ulimit -u` / RLIMIT_NPROC or a
// container pids limit) that is the environment's limit, not a bug in bun, so
// it must be reported as a plain error with exit code 1 instead of going
// through the crash reporter ("oh no: Bun has crashed", bun.report link).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, compileFixture, isASAN, isLinux, isMusl, tempDir } from "harness";
import { readdir, rm } from "node:fs/promises";
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

// bun-musl is statically linked, and ASAN builds carry their own pthread_create
// interceptor in the executable, so LD_PRELOAD cannot intercept pthread_create in either.
describe.skipIf(!isLinux || isMusl || isASAN || !cc)(
  "bun install when the HTTP client thread cannot be started",
  () => {
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
  },
);

// Only the first thread starts: the HTTP client's.
const onlyTheFirstThreadC = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <unistd.h>

int pthread_create(pthread_t *thread, const pthread_attr_t *attr, void *(*start)(void *), void *arg) {
  static int created;
  if (__atomic_fetch_add(&created, 1, __ATOMIC_SEQ_CST) > 0) {
    (void)!write(2, "refused a thread\\n", 17);
    return EAGAIN;
  }
  return ((int (*)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *))dlsym(RTLD_NEXT, "pthread_create"))(thread, attr, start, arg);
}
`;

// After a 304 the main thread queues the manifest's cache entry on a pool that never runs it.
test.skipIf(!isLinux || isMusl || isASAN || !cc)(
  "bun install exits when no worker of the thread pool can be started",
  async () => {
    const statuses: number[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        const headers = { etag: '"v1"', "cache-control": "no-cache" };
        const status = request.headers.get("if-none-match") === headers.etag ? 304 : 200;
        statuses.push(status);
        if (status === 304) return new Response(null, { status, headers });
        const version = { name: "dep", version: "1.0.0", dist: { tarball: `${server.url}dep-1.0.0.tgz` } };
        return Response.json(
          { name: "dep", "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": version } },
          { headers },
        );
      },
    });
    using dir = tempDir("install-no-pool-worker", {
      "shim.c": onlyTheFirstThreadC,
      "package.json": JSON.stringify({ name: "no-pool-worker", dependencies: { dep: "^1.0.0" } }),
      "bunfig.toml": `[install]\nregistry = "${server.url}"\n`,
    });
    const shim = compileFixture(join(String(dir), "shim.c"), { flags: ["-ldl"] });

    async function resolve(env: Record<string, string> = {}) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--lockfile-only"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"), ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
      return { stderr, exitCode };
    }

    expect(await resolve()).toEqual({ stderr: expect.not.stringContaining("error:"), exitCode: 0 });
    await rm(join(String(dir), "bun.lock"));

    const { stderr, exitCode } = await resolve({ LD_PRELOAD: [shim, bunEnv.LD_PRELOAD].filter(Boolean).join(":") });
    expect(stderr).toContain("refused a thread");
    expect(stderr).not.toContain("error:");
    expect(statuses).toEqual([200, 304]);
    expect(exitCode).toBe(0);
  },
);

// With the packages in the cache and no node_modules, the hoisted linker hands them to the thread pool.
test.skipIf(!isLinux || isMusl || isASAN || !cc)(
  "the hoisted linker links a new node_modules when no worker of the thread pool can be started",
  async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        const name = new URL(request.url).pathname.slice(1).replace(/-1\.0\.0\.tgz$/, "");
        const version = { name, version: "1.0.0", dist: { tarball: `${server.url}${name}-1.0.0.tgz` } };
        if (!request.url.endsWith(".tgz")) {
          return Response.json({ name, "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": version } });
        }
        const files = { "package/package.json": JSON.stringify({ name, version: "1.0.0" }) };
        return new Response(await new Bun.Archive(files, { compress: "gzip" }).bytes());
      },
    });
    using dir = tempDir("install-link-no-pool-worker", {
      "shim.c": onlyTheFirstThreadC,
      "package.json": JSON.stringify({ name: "no-pool-worker", dependencies: { one: "1.0.0", two: "1.0.0" } }),
      "bunfig.toml": `[install]\nregistry = "${server.url}"\nlinker = "hoisted"\n`,
    });
    const shim = compileFixture(join(String(dir), "shim.c"), { flags: ["-ldl"] });

    async function install(env: Record<string, string> = {}, prefix: string[] = []) {
      await using proc = Bun.spawn({
        cmd: [...prefix, bunExe(), "install"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"), ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
      return { stderr, exitCode };
    }

    expect(await install()).toEqual({ stderr: expect.not.stringContaining("error:"), exitCode: 0 });
    await rm(join(String(dir), "node_modules"), { recursive: true });

    const { stderr, exitCode } = await install({ LD_PRELOAD: [shim, bunEnv.LD_PRELOAD].filter(Boolean).join(":") });
    expect(stderr).toContain("refused a thread");
    expect(stderr).not.toContain("error:");
    expect((await readdir(join(String(dir), "node_modules"))).sort()).toEqual(["one", "two"]);
    expect(exitCode).toBe(0);

    // Replaced packages are deleted on the thread pool too.
    for (const prefix of [[], ["sh", "-c", 'ulimit -n 200 && exec "$0" "$@"']]) {
      for (const name of ["one", "two"]) {
        await rm(join(String(dir), "node_modules", name, "package.json"));
        await Bun.write(
          join(String(dir), "node_modules", name, "package.json"),
          JSON.stringify({ name, version: "0.0.1" }),
        );
      }
      const replaced = await install({ LD_PRELOAD: [shim, bunEnv.LD_PRELOAD].filter(Boolean).join(":") }, prefix);
      expect(replaced).toEqual({ stderr: expect.not.stringContaining("error:"), exitCode: 0 });
      expect((await readdir(join(String(dir), "node_modules"))).sort()).toEqual(["one", "two"]);
    }
  },
);
