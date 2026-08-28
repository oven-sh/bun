// Bun starts some threads on first use: the HTTP client thread (fetch, S3,
// bun install, auto-install), the bundle thread (Bun.build) and, on POSIX, the
// IO thread that waits on pipes and the thread that waits for child processes
// on a kernel without pidfd. The OS can refuse a thread: pthread_create
// fails with EAGAIN at a thread or pid limit, CreateThread fails with
// ERROR_COMMITMENT_LIMIT when Windows cannot commit the stack. That is a limit
// of the machine, so it has to come back as an error, not as a crash report.
//
// The LD_PRELOAD shim in thread-spawn-fail-shim.c makes every pthread_create
// fail while a marker file exists. The fixtures create the marker right before
// the call under test, so the threads Bun starts at startup are not affected,
// and delete it again to check that the next call starts the thread after all.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, compileFixture, isLinux, isMusl, tempDir } from "harness";
import { join } from "node:path";

// bun-musl is statically linked, so LD_PRELOAD cannot intercept pthread_create.
const canRun = isLinux && !isMusl && !!(Bun.which("cc") || Bun.which("clang") || Bun.which("gcc"));
const shimPath = canRun ? compileFixture(join(import.meta.dir, "thread-spawn-fail-shim.c"), { flags: ["-ldl"] }) : "";

// The marker exists only while the call under test runs. JSC and bmalloc also
// start threads on demand (GC helpers, the scavenger, and more at exit) and
// abort when the OS refuses one, so the window has to be as short as possible,
// and a collection right before it starts the threads a collection during it
// would need (they stay up for 10s of inactivity).
const WHILE_REFUSED = /* js */ `
import { unlinkSync, writeFileSync } from "node:fs";
const marker = process.env.REFUSE_THREADS_WHILE_EXISTS;
async function whileRefused(call) {
  Bun.gc(false);
  Bun.gc(true);
  writeFileSync(marker, "");
  try {
    return { resolved: await call() };
  } catch (e) {
    return { rejected: { name: e.name, code: e.code, syscall: e.syscall, message: e.message, path: e.path } };
  } finally {
    unlinkSync(marker);
  }
}
function print(value) {
  console.log(JSON.stringify(value));
}
`;

const FETCH_FIXTURE = /* js */ `
${WHILE_REFUSED}
using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
const unhandled = new Promise(resolve => process.on("unhandledRejection", e => resolve(e.code)));

print(await whileRefused(() => fetch(server.url)));
// Nobody handles this one: it has to reach unhandledRejection like any other
// failed fetch.
await whileRefused(() => void fetch(server.url));
print({ unhandled: await unhandled });
print({ afterwards: await (await fetch(server.url)).text() });
`;

// Built at runtime so the transpiler cannot resolve it. A bare specifier with
// no node_modules anywhere above the file goes through auto-install, which
// starts the HTTP thread before it creates the package manager.
const AUTO_INSTALL_FIXTURE = /* js */ `
${WHILE_REFUSED}
const specifier = ["left", "pad"].join("-");
print(await whileRefused(() => import.meta.resolveSync(specifier)));
`;

// One request per S3 code path that starts the thread: a simple request, a
// listing and a streamed download. Each fails before it touches the network.
const S3_FIXTURE = /* js */ `
${WHILE_REFUSED}
const client = new Bun.S3Client({
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "bucket",
  endpoint: "http://127.0.0.1:1",
});
print(await whileRefused(() => client.file("a.txt").text()));
print(await whileRefused(() => client.list()));
print(await whileRefused(() => new Response(client.file("a.txt").stream()).text()));
`;

const BUILD_FIXTURE = /* js */ `
${WHILE_REFUSED}
const entrypoints = [import.meta.dir + "/entry.js"];
print(await whileRefused(() => Bun.build({ entrypoints })));
const result = await Bun.build({ entrypoints });
print({ afterwards: result.success, text: await result.outputs[0].text() });
`;

// An HTML route builds on the same bundle thread. `hmr: false` takes the plain
// route, which builds again on every request, so the request after the refused
// one starts the thread. The HTTP client thread is started by the first request,
// before threads are refused.
const HTML_ROUTE_FIXTURE = /* js */ `
${WHILE_REFUSED}
import index from "./index.html";
using server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  development: { hmr: false },
  routes: { "/": index, "/ping": new Response("pong") },
});
await (await fetch(new URL("/ping", server.url))).text();
const { resolved: refused } = await whileRefused(() => fetch(server.url));
print({ status: refused.status, body: await refused.text() });
const afterwards = await fetch(server.url);
print({ afterwards: afterwards.status, html: (await afterwards.text()).includes("<h1>hello</h1>") });
`;

// The read runs on a work pool thread, so a regular file is read first, while
// that thread can still be started. The pipe has no data, so the next read
// parks on the IO thread, which is the one that is refused (by stack size: the
// pool may start one more worker for the read). The process exits inside the
// call.
const STDIN_FIXTURE = /* js */ `
${WHILE_REFUSED}
await Bun.file(import.meta.path).text();
console.log("reading stdin");
print(await whileRefused(() => Bun.stdin.text()));
`;

// Without pidfd (BUN_FEATURE_FLAG_FORCE_WAITER_THREAD stands in for a kernel or
// a seccomp filter without it), the first Bun.spawn() starts the thread that
// waits for the children. The child is left running so that the refusal, not
// its exit, decides the outcome. It is killed afterwards.
const SPAWN_FIXTURE = /* js */ `
${WHILE_REFUSED}
const stdio = ["ignore", "ignore", "ignore"];
let refusedChild;
print(
  await whileRefused(() => {
    refusedChild = Bun.spawn({ cmd: ["sleep", "30"], stdio });
    return refusedChild.exited;
  }),
);
print({ exitCode: refusedChild.exitCode, signalCode: refusedChild.signalCode });
process.kill(refusedChild.pid, "SIGKILL");
print({ afterwards: await Bun.spawn({ cmd: ["sleep", "0"], stdio }).exited });
`;

// The schedule of bun_threading::spawn_with_retry.
const ATTEMPTS_PER_START = 20;

// With REFUSE_THREADS_WITH_STACK_SIZE the shim refuses only the thread that asks
// for that stack size, which singles one of Bun's threads out from the others
// that may start in the same window. The sizes are the ones the sources ask for.
// bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE. `bun install` runs no
// JS that could arm the marker, so the marker exists from the start, and the
// size keeps the allocators' threads (default stack) out, which abort when
// refused.
const HTTP_THREAD_STACK_SIZE = 4 * 1024 * 1024;
// src/io/lib.rs
const IO_THREAD_STACK_SIZE = 2 * 1024 * 1024;
// WaiterThreadPosix::STACK_SIZE in src/spawn/process.rs
const WAITER_THREAD_STACK_SIZE = 512 * 1024;

async function runFixture(
  dir: string,
  options: { args?: string[]; env?: Record<string, string>; stdin?: "pipe"; exitsMidway?: boolean } = {},
) {
  const env: Record<string, string | undefined> = {
    ...bunEnv,
    // The assertions match the strerror text of libc, which follows LC_MESSAGES.
    LC_ALL: "C",
    LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shimPath}:${bunEnv.LD_PRELOAD}` : shimPath,
    REFUSE_THREADS_WHILE_EXISTS: join(dir, "refuse-threads"),
    // Without the fix the child crashes. Never upload that.
    BUN_ENABLE_CRASH_REPORTING: "0",
    ...options.env,
  };
  if (options.exitsMidway) {
    // The child exits from inside a read, so the natives that its JS objects
    // and the read still own are never freed. LeakSanitizer cannot see
    // through JSC cells to them and would report them (last option wins).
    env.ASAN_OPTIONS = [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":");
  }
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...(options.args ?? ["fixture.js"])],
    cwd: dir,
    env,
    stdin: options.stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const stderrLines = stderr.split("\n");
  const refused = stderrLines.filter(line => line === "shim: pthread_create refused").length;
  return {
    stdout,
    // What the child itself wrote to stderr.
    stderr: stderrLines.filter(line => line !== "shim: pthread_create refused").join("\n"),
    refused,
    exitCode,
    signalCode: proc.signalCode,
  };
}

/** The fixtures print one JSON object per line. A line that is not JSON (the
 * fixture died) is kept as text, so the assertion shows what happened. */
function jsonLines(stdout: string) {
  return stdout
    .split("\n")
    .filter(line => line !== "")
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return line;
      }
    });
}

const HTTP_THREAD_REFUSED = "Failed to start the HTTP client thread: Resource temporarily unavailable (os error 11)";

test.concurrent.skipIf(!canRun)(
  "fetch() rejects when the HTTP thread cannot be started; the next fetch starts it",
  async () => {
    using dir = tempDir("refuse-threads-fetch", { "fixture.js": FETCH_FIXTURE });
    const { stdout, stderr, refused, exitCode } = await runFixture(String(dir));

    expect({ stdout: jsonLines(stdout), stderr, refused, exitCode }).toEqual({
      stdout: [
        {
          rejected: {
            name: "TypeError",
            code: "EAGAIN",
            message: HTTP_THREAD_REFUSED,
            path: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/),
          },
        },
        { unhandled: "EAGAIN" },
        { afterwards: "ok" },
      ],
      stderr: "",
      // Two fetches while refused, each one retried per the schedule.
      refused: 2 * ATTEMPTS_PER_START,
      exitCode: 0,
    });
  },
);

test.concurrent.skipIf(!canRun)("auto-install reports a refused HTTP thread as a resolve error", async () => {
  using dir = tempDir("refuse-threads-auto-install", { "fixture.js": AUTO_INSTALL_FIXTURE });
  const { stdout, stderr, refused, exitCode } = await runFixture(String(dir));

  expect({ stdout: jsonLines(stdout), stderr, refused, exitCode }).toEqual({
    stdout: [
      {
        rejected: {
          name: "ResolveMessage",
          code: "ERR_MODULE_NOT_FOUND",
          message: 'Failed to start the HTTP client thread: EAGAIN while resolving "left-pad"',
        },
      },
    ],
    stderr: "",
    refused: ATTEMPTS_PER_START,
    exitCode: 0,
  });
});

test.concurrent.skipIf(!canRun)(
  "bun install prints an error and exits 1 when the HTTP thread cannot be started",
  async () => {
    using dir = tempDir("refuse-threads-install", {
      "package.json": JSON.stringify({ name: "refuse-threads", dependencies: {} }),
      "refuse-threads": "",
    });
    const { stdout, stderr, refused, exitCode, signalCode } = await runFixture(String(dir), {
      args: ["install"],
      env: {
        REFUSE_THREADS_WITH_STACK_SIZE: String(HTTP_THREAD_STACK_SIZE),
        BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
      },
    });

    expect({ stdout, stderr, refused, exitCode, signalCode }).toEqual({
      stdout: "",
      stderr:
        `error: ${HTTP_THREAD_REFUSED}\n` +
        "note: The process is out of memory, or it reached a thread limit (ulimit -u, or the pids limit of its cgroup).\n",
      refused: ATTEMPTS_PER_START,
      exitCode: 1,
      signalCode: null,
    });
  },
);

test.concurrent.skipIf(!canRun)("S3 requests fail when the HTTP thread cannot be started", async () => {
  using dir = tempDir("refuse-threads-s3", { "fixture.js": S3_FIXTURE });
  const { stdout, stderr, refused, exitCode } = await runFixture(String(dir));

  const rejected = (path: string) => ({
    rejected: { name: "S3Error", code: "EAGAIN", message: HTTP_THREAD_REFUSED, path },
  });
  expect({ stdout: jsonLines(stdout), stderr, refused, exitCode }).toEqual({
    stdout: [rejected("a.txt"), rejected(""), rejected("a.txt")],
    stderr: "",
    refused: 3 * ATTEMPTS_PER_START,
    exitCode: 0,
  });
});

test.concurrent.skipIf(!canRun)(
  "Bun.build() rejects when the bundle thread cannot be started; the next build starts it",
  async () => {
    using dir = tempDir("refuse-threads-build", {
      "fixture.js": BUILD_FIXTURE,
      "entry.js": "export const answer = 42;\n",
    });
    const { stdout, stderr, refused, exitCode } = await runFixture(String(dir));

    expect({ stdout: jsonLines(stdout), stderr, refused, exitCode }).toEqual({
      stdout: [
        {
          rejected: {
            name: "Error",
            code: "EAGAIN",
            message: "Failed to start the bundler thread: Resource temporarily unavailable (os error 11)",
          },
        },
        { afterwards: true, text: expect.stringContaining("42") },
      ],
      stderr: "",
      refused: ATTEMPTS_PER_START,
      exitCode: 0,
    });
  },
);

test.concurrent.skipIf(!canRun)(
  "an HTML route answers 500 when the bundle thread cannot be started; the next request starts it",
  async () => {
    using dir = tempDir("refuse-threads-html-route", {
      "fixture.js": HTML_ROUTE_FIXTURE,
      "index.html": "<!DOCTYPE html><html><body><h1>hello</h1></body></html>\n",
    });
    const { stdout, stderr, refused, exitCode } = await runFixture(String(dir));

    expect({ stdout: jsonLines(stdout), stderr, refused, exitCode }).toEqual({
      stdout: [
        { status: 500, body: "" },
        { afterwards: 200, html: true },
      ],
      // The development server prints the build error.
      stderr: expect.stringContaining(
        "Failed to start the bundler thread: Resource temporarily unavailable (os error 11)",
      ),
      refused: ATTEMPTS_PER_START,
      exitCode: 0,
    });
  },
);

test.concurrent.skipIf(!canRun)(
  "Bun.spawn() reports a refused process waiter thread through exited; the next spawn starts it",
  async () => {
    using dir = tempDir("refuse-threads-spawn", { "fixture.js": SPAWN_FIXTURE });
    const { stdout, stderr, refused, exitCode } = await runFixture(String(dir), {
      env: {
        BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1",
        REFUSE_THREADS_WITH_STACK_SIZE: String(WAITER_THREAD_STACK_SIZE),
      },
    });

    expect({ stdout: jsonLines(stdout), stderr, refused, exitCode }).toEqual({
      stdout: [
        {
          rejected: {
            name: "Error",
            code: "EAGAIN",
            syscall: "pthread_create",
            message: "EAGAIN: resource temporarily unavailable, pthread_create",
          },
        },
        { exitCode: null, signalCode: null },
        { afterwards: 0 },
      ],
      stderr: "",
      // Bun.spawn() tries to watch the child, then once more when it finds the
      // child still running.
      refused: 2 * ATTEMPTS_PER_START,
      exitCode: 0,
    });
  },
);

test.concurrent.skipIf(!canRun)(
  "a read that needs the IO thread exits with an error when it cannot be started",
  async () => {
    using dir = tempDir("refuse-threads-stdin", { "fixture.js": STDIN_FIXTURE });
    const { stdout, stderr, refused, exitCode, signalCode } = await runFixture(String(dir), {
      env: { REFUSE_THREADS_WITH_STACK_SIZE: String(IO_THREAD_STACK_SIZE) },
      stdin: "pipe",
      exitsMidway: true,
    });

    expect({ stdout, stderr, refused, exitCode, signalCode }).toEqual({
      stdout: "reading stdin\n",
      stderr:
        "error: Failed to start the IO thread: Resource temporarily unavailable (os error 11)\n" +
        "note: The process is out of memory, or it reached a thread limit (ulimit -u, or the pids limit of its cgroup).\n",
      refused: ATTEMPTS_PER_START,
      exitCode: 1,
      signalCode: null,
    });
  },
);
