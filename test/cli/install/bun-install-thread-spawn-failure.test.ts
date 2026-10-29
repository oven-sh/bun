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

// A pool thread asks for a stack of POOL_STACK_SIZE bytes. The first ALLOWED_POOL_THREADS threads that ask for it start.
const poolThreadsC = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <unistd.h>

int pthread_create(pthread_t *thread, const pthread_attr_t *attr, void *(*start)(void *), void *arg) {
  static int created;
  size_t stack_size = 0;
  if (attr) pthread_attr_getstacksize(attr, &stack_size);
  if (stack_size == strtoul(getenv("POOL_STACK_SIZE"), NULL, 10) &&
      __atomic_fetch_add(&created, 1, __ATOMIC_SEQ_CST) >= atoi(getenv("ALLOWED_POOL_THREADS"))) {
    (void)!write(2, "refused a thread\\n", 17);
    return EAGAIN;
  }
  return ((int (*)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *))dlsym(RTLD_NEXT, "pthread_create"))(thread, attr, start, arg);
}
`;

// The pthread_create interceptor of an ASAN build calls the shim's, and this shim lets the threads of ASAN itself start.
describe.skipIf(!isLinux || isMusl || !cc)("a thread pool whose first thread cannot be started", () => {
  // POOL_THREAD_STACK_SIZE of src/threading/ThreadPool.rs
  const poolStackSize = 4 * 1024 * 1024 * (isASAN ? 8 : 1);
  const reason = [
    "error: Failed to start a thread of the thread pool: Resource temporarily unavailable (os error 11)",
    "note: The process or thread limit may have been reached (ulimit -u, or the container's pids limit); raise it or reduce concurrency",
  ];

  async function run(dir: string, args: string[], allowedPoolThreads: number) {
    const shim = compileFixture(join(dir, "shim.c"), { flags: ["-ldl"] });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: dir,
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(dir, "cache"),
        LD_PRELOAD: [shim, bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
        POOL_STACK_SIZE: String(poolStackSize),
        ALLOWED_POOL_THREADS: String(allowedPoolThreads),
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stderr.split("\n").filter(line => line !== "");
    return {
      stdout,
      refusedAThread: lines.includes("refused a thread"),
      stderr: lines.filter(line => line !== "refused a thread"),
      exitCode,
      signalCode: proc.signalCode,
    };
  }

  test.concurrent.each([
    ["fs.promises.readFile()", ["read.cjs"]],
    ["bun build", ["build", "entry.js"]],
  ])(
    "%s ends the process with the reason",
    async (_, args) => {
      using dir = tempDir("no-pool-thread", {
        "shim.c": poolThreadsC,
        "read.cjs": `require("fs").promises.readFile(__filename).then(() => console.log("read"));`,
        "entry.js": `console.log("built");`,
      });
      expect(await run(String(dir), args, 0)).toEqual({
        stdout: "",
        refusedAThread: true,
        stderr: reason,
        exitCode: 1,
        signalCode: null,
      });
    },
    30_000,
  );

  test.concurrent.each([
    ["a static import", ["import.mjs"], "imported\n"],
    ["Bun.spawn() with a pipe", ["spawn.cjs"], "child\n"],
    ["Bun.dns.prefetch()", ["prefetch.cjs"], "prefetched\n"],
  ])(
    "%s needs no thread of the pool",
    async (_, args, stdout) => {
      using dir = tempDir("no-pool-thread-needed", {
        "shim.c": poolThreadsC,
        "import.mjs": `import "./imported.ts";`,
        "imported.ts": `console.log("imported" as string);`,
        "spawn.cjs": `
          const child = Bun.spawn(["echo", "child"], { stdout: "pipe" });
          Promise.all([child.stdout.text(), child.exited]).then(([text]) => process.stdout.write(text));`,
        "prefetch.cjs": `Bun.dns.prefetch("example.invalid", 443); console.log("prefetched");`,
      });
      expect(await run(String(dir), args, 0)).toEqual({
        stdout,
        refusedAThread: true,
        stderr: [],
        exitCode: 0,
        signalCode: null,
      });
    },
    30_000,
  );

  // The server closes each file when its response is sent. The requests come from here: the HTTP client thread of the
  // server's process would ask for the same stack as a pool thread.
  test.concurrent(
    "Bun.serve() goes on answering with files",
    async () => {
      using dir = tempDir("serve-no-pool-thread", {
        "shim.c": poolThreadsC,
        "serve.cjs": `
          const server = Bun.serve({
            port: 0,
            fetch(request) {
              if (request.url.endsWith("/stop")) {
                server.stop();
                return new Response("stopped");
              }
              return new Response(Bun.file(__dirname + "/file.txt"));
            },
          });
          console.log(server.port);`,
        "file.txt": "in a file",
      });
      const shim = compileFixture(join(String(dir), "shim.c"), { flags: ["-ldl"] });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "serve.cjs"],
        cwd: String(dir),
        env: {
          ...bunEnv,
          LD_PRELOAD: [shim, bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
          POOL_STACK_SIZE: String(poolStackSize),
          ALLOWED_POOL_THREADS: "0",
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 20_000,
        killSignal: "SIGKILL",
      });
      const stderr = proc.stderr.text();
      const reader = proc.stdout.getReader();
      const port = parseInt(new TextDecoder().decode((await reader.read()).value));
      reader.releaseLock();
      const answers: string[] = [];
      for (const path of ["one", "two", "three", "stop"]) {
        answers.push(await (await fetch(`http://localhost:${port}/${path}`)).text());
      }
      const lines = (await stderr).split("\n").filter(line => line !== "");
      expect({
        answers,
        refusedAThread: lines.includes("refused a thread"),
        stderr: lines.filter(line => line !== "refused a thread"),
        exitCode: await proc.exited,
        signalCode: proc.signalCode,
      }).toEqual({
        answers: ["in a file", "in a file", "in a file", "stopped"],
        refusedAThread: true,
        stderr: [],
        exitCode: 0,
        signalCode: null,
      });
    },
    30_000,
  );

  // With nothing in the cache, the main thread hands the manifest to the pool. Nothing else can read it.
  test.concurrent(
    "bun install ends with the reason when a manifest waits for the first thread",
    async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          const version = { name: "dep", version: "1.0.0", dist: { tarball: `${server.url}dep-1.0.0.tgz` } };
          return Response.json({ name: "dep", "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": version } });
        },
      });
      using dir = tempDir("install-no-pool-thread", {
        "shim.c": poolThreadsC,
        "package.json": JSON.stringify({ name: "no-pool-thread", dependencies: { dep: "^1.0.0" } }),
        "bunfig.toml": `[install]\nregistry = "${server.url}"\n`,
      });
      // The HTTP client thread asks for the same stack as a pool thread, except in an ASAN build.
      const { refusedAThread, stderr, exitCode, signalCode } = await run(
        String(dir),
        ["install", "--lockfile-only"],
        isASAN ? 0 : 1,
      );
      expect({
        refusedAThread,
        stderr: stderr.filter(line => /^(error|note)\b/.test(line)),
        exitCode,
        signalCode,
      }).toEqual({
        refusedAThread: true,
        stderr: reason,
        exitCode: 1,
        signalCode: null,
      });
    },
    30_000,
  );

  // It looks up the registry's address ahead of time, on the pool. Nothing waits for that.
  test.concurrent(
    "bun install with nothing to do needs no thread of the pool",
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
      using dir = tempDir("install-nothing-to-do", {
        "shim.c": poolThreadsC,
        "package.json": JSON.stringify({ name: "nothing-to-do", dependencies: { dep: "1.0.0" } }),
        "bunfig.toml": `[install]\nregistry = "${server.url}"\n`,
      });
      await using installed = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), "cache") },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await installed.exited).toBe(0);

      // A registry that is not this machine: its name goes to the resolver.
      await Bun.write(join(String(dir), "bunfig.toml"), `[install]\nregistry = "http://example.invalid:1/"\n`);
      const { stdout, refusedAThread, stderr, exitCode, signalCode } = await run(
        String(dir),
        ["install"],
        isASAN ? 0 : 1,
      );
      expect({
        stdout: stdout.includes("Checked 1 install across 2 packages (no changes)"),
        refusedAThread,
        stderr: stderr.filter(line => /^(error|note)\b/.test(line)),
        exitCode,
        signalCode,
      }).toEqual({ stdout: true, refusedAThread: true, stderr: [], exitCode: 0, signalCode: null });
    },
    30_000,
  );

  test.concurrent(
    "the threads there are do the work when a later thread is refused",
    async () => {
      using dir = tempDir("one-pool-thread", {
        "shim.c": poolThreadsC,
        "reads.cjs": `
          const reads = Array.from({ length: 8 }, () => require("fs").promises.readFile(__filename));
          Promise.all(reads).then(all => console.log("read", all.length));`,
      });
      expect(await run(String(dir), ["reads.cjs"], 1)).toEqual({
        stdout: "read 8\n",
        refusedAThread: true,
        stderr: [],
        exitCode: 0,
        signalCode: null,
      });
    },
    30_000,
  );
});
