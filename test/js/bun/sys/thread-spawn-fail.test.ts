// Bun starts some threads on first use: the HTTP client thread (fetch, S3,
// bun install, auto-install), the bundle thread (Bun.build) and, on POSIX, the
// IO thread that waits on pipes. The OS can refuse a thread: pthread_create
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

// JSC starts its GC helper threads, and bmalloc its scavenger thread, when a
// collection first needs them, and both abort when the OS refuses. A collection
// while the marker exists (debug builds collect often) must therefore find them
// running: a collection right before the marker starts them, and they stay up
// for 10s of inactivity, far longer than the refused call takes.
const REFUSE_THREADS = /* js */ `
import { unlinkSync, writeFileSync } from "node:fs";
const marker = process.env.REFUSE_THREADS_WHILE_EXISTS;
function refuseThreads() {
  Bun.gc(false);
  Bun.gc(true);
  writeFileSync(marker, "");
}
function allowThreads() {
  unlinkSync(marker);
}
`;

const FETCH_FIXTURE = /* js */ `
${REFUSE_THREADS}
using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
const unhandled = new Promise(resolve => process.on("unhandledRejection", e => resolve(e.code)));

refuseThreads();
try {
  await fetch(server.url);
  console.log(JSON.stringify({ first: "resolved" }));
} catch (e) {
  console.log(JSON.stringify({ first: "rejected", name: e.name, code: e.code, message: e.message, path: e.path }));
}
// Nobody handles this one: it has to reach unhandledRejection like any other
// failed fetch.
fetch(server.url);
console.log(JSON.stringify({ unhandled: await unhandled }));
allowThreads();

const res = await fetch(server.url);
console.log(JSON.stringify({ second: await res.text() }));
`;

// Built at runtime so the transpiler cannot resolve it. A bare specifier with
// no node_modules anywhere above the file goes through auto-install, which
// starts the HTTP thread before it creates the package manager.
const AUTO_INSTALL_FIXTURE = /* js */ `
${REFUSE_THREADS}
const specifier = ["left", "pad"].join("-");
refuseThreads();
try {
  console.log(JSON.stringify({ resolved: import.meta.resolveSync(specifier) }));
} catch (e) {
  console.log(JSON.stringify({ caught: e.message }));
}
`;

// One request per S3 code path that starts the thread: a simple request, a
// listing and a streamed download. Each fails before it touches the network.
const S3_FIXTURE = /* js */ `
${REFUSE_THREADS}
const client = new Bun.S3Client({
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "bucket",
  endpoint: "http://127.0.0.1:1",
});
const requests = {
  text: () => client.file("a.txt").text(),
  list: () => client.list(),
  stream: () => new Response(client.file("a.txt").stream()).text(),
};
refuseThreads();
for (const [name, request] of Object.entries(requests)) {
  try {
    await request();
    console.log(JSON.stringify({ [name]: "resolved" }));
  } catch (e) {
    console.log(JSON.stringify({ [name]: "rejected", code: e.code, message: e.message }));
  }
}
`;

const BUILD_FIXTURE = /* js */ `
${REFUSE_THREADS}
const entrypoints = [import.meta.dir + "/entry.js"];

refuseThreads();
try {
  await Bun.build({ entrypoints });
  console.log(JSON.stringify({ first: "resolved" }));
} catch (e) {
  console.log(JSON.stringify({ first: "rejected", code: e.code, message: e.message }));
}
allowThreads();

const result = await Bun.build({ entrypoints });
console.log(JSON.stringify({ second: result.success, text: await result.outputs[0].text() }));
`;

// The read runs on a work pool thread, so a regular file is read first, while
// that thread can still be started. The pipe has no data, so the next read
// parks on the IO thread, which is the one that is refused.
const STDIN_FIXTURE = /* js */ `
${REFUSE_THREADS}
await Bun.file(import.meta.path).text();
refuseThreads();
console.log("reading stdin");
await Bun.stdin.text();
console.log("unreachable");
`;

// The schedule of bun_threading::spawn_with_retry.
const ATTEMPTS_PER_START = 20;

async function runFixture(dir: string, options: { stdin?: "pipe" } = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    cwd: dir,
    env: {
      ...bunEnv,
      LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shimPath}:${bunEnv.LD_PRELOAD}` : shimPath,
      REFUSE_THREADS_WHILE_EXISTS: join(dir, "refuse-threads"),
      // Without the fix the child crashes. Never upload that.
      BUN_ENABLE_CRASH_REPORTING: "0",
    },
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

test.concurrent.skipIf(!canRun)(
  "fetch() rejects when the HTTP thread cannot be started; the next fetch starts it",
  async () => {
    using dir = tempDir("refuse-threads-fetch", { "fixture.js": FETCH_FIXTURE });
    const { stdout, stderr, refused, exitCode } = await runFixture(String(dir));

    expect({ stdout: jsonLines(stdout), stderr, refused, exitCode }).toEqual({
      stdout: [
        {
          first: "rejected",
          name: "TypeError",
          code: "EAGAIN",
          message: "Failed to start the HTTP client thread: Resource temporarily unavailable (os error 11)",
          path: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/),
        },
        { unhandled: "EAGAIN" },
        { second: "ok" },
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
    stdout: [{ caught: 'Failed to start the HTTP client thread: EAGAIN while resolving "left-pad"' }],
    stderr: "",
    refused: ATTEMPTS_PER_START,
    exitCode: 0,
  });
});

test.concurrent.skipIf(!canRun)("S3 requests fail when the HTTP thread cannot be started", async () => {
  using dir = tempDir("refuse-threads-s3", { "fixture.js": S3_FIXTURE });
  const { stdout, stderr, refused, exitCode } = await runFixture(String(dir));

  const rejected = {
    code: "EAGAIN",
    message: "Failed to start the HTTP client thread: Resource temporarily unavailable (os error 11)",
  };
  expect({ stdout: jsonLines(stdout), stderr, refused, exitCode }).toEqual({
    stdout: [
      { text: "rejected", ...rejected },
      { list: "rejected", ...rejected },
      { stream: "rejected", ...rejected },
    ],
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
          first: "rejected",
          code: "EAGAIN",
          message: "Failed to start the bundler thread: Resource temporarily unavailable (os error 11)",
        },
        { second: true, text: expect.stringContaining("42") },
      ],
      stderr: "",
      refused: ATTEMPTS_PER_START,
      exitCode: 0,
    });
  },
);

test.concurrent.skipIf(!canRun)(
  "a read that needs the IO thread exits with an error when it cannot be started",
  async () => {
    using dir = tempDir("refuse-threads-stdin", { "fixture.js": STDIN_FIXTURE });
    const { stdout, stderr, refused, exitCode, signalCode } = await runFixture(String(dir), { stdin: "pipe" });

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
