// A blocked signal is never delivered, and the set of blocked signals survives
// execve. So a launcher that has a signal blocked (JVM and Go wrappers, some
// supervisors, `env --block-signal`) starts bun with it blocked: like node, bun
// clears the mask at startup (src/bun_bin/lib.rs), and, like libuv, it execs
// every child with an empty mask whatever its own looks like (posix_spawn_bun
// in src/jsc/bindings/bun-spawn.cpp). The last test covers the one place bun
// used to block a signal itself: forwarding one to a `bun run` script
// (src/jsc/bindings/c-bindings.cpp).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isAndroid, isLinux, isPosix, libcPathForDlopen, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SIGTERM = 15;

const cc = isPosix ? Bun.which("cc") || Bun.which("clang") || Bun.which("gcc") : null;

// `block-sigterm <command...>`: blocks SIGTERM, then execs the command.
const LAUNCHER_C = /* c */ `
#include <signal.h>
#include <unistd.h>
int main(int argc, char** argv) {
  sigset_t set;
  sigemptyset(&set);
  sigaddset(&set, SIGTERM);
  if (argc < 2 || sigprocmask(SIG_BLOCK, &set, 0) != 0) return 98;
  execvp(argv[1], argv + 1);
  return 99;
}
`;

// `sh` sends SIGTERM to itself. It dies from it, unless it inherited the signal
// blocked: then the signal stays pending and the script exits 0.
const KILL_SELF = "kill -TERM $$";

// Runs that script through each way bun has of starting a process and reports
// how each of them saw it end.
const CHILDREN_KILLED_FIXTURE = /* js */ `
  import { spawnSync as nodeSpawnSync } from "node:child_process";
  const script = ${JSON.stringify(KILL_SELF)};
  const sync = Bun.spawnSync({ cmd: ["sh", "-c", script] });
  const spawned = Bun.spawn({ cmd: ["sh", "-c", script] });
  await spawned.exited;
  const node = nodeSpawnSync("sh", ["-c", script]);
  const shell = await Bun.$\`sh -c \${script}\`.nothrow().quiet();
  console.log(JSON.stringify({
    spawnSync: [sync.exitCode, sync.signalCode],
    spawn: [spawned.exitCode, spawned.signalCode],
    child_process: [node.status, node.signal],
    shell: shell.exitCode,
  }));
`;

const CHILDREN_KILLED = {
  spawnSync: [null, "SIGTERM"],
  spawn: [null, "SIGTERM"],
  child_process: [null, "SIGTERM"],
  shell: 128 + SIGTERM,
};

// /proc/<pid>/status shows the mask as a hex bitmask; with SIGTERM blocked it reads ...4000.
const SIG_BLK_LINE = /^SigBlk:\s*(\S+)$/m;
const NOTHING_BLOCKED = "0000000000000000";

let dir: ReturnType<typeof tempDir> | undefined;
let launcher: string;

beforeAll(async () => {
  if (!cc) return;
  dir = tempDir("inherited-signal-mask", { "block-sigterm.c": LAUNCHER_C });
  launcher = join(String(dir), "block-sigterm");
  await using proc = Bun.spawn({
    cmd: [cc, "-o", launcher, "block-sigterm.c"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`compiling the launcher failed:\n${stderr}${stdout}`);
});

afterAll(() => {
  dir?.[Symbol.dispose]();
});

async function run(cmd: string[]) {
  await using proc = Bun.spawn({ cmd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode: proc.exitCode, signalCode: proc.signalCode };
}

/** The JSON line a fixture printed, plus whatever would explain it not having printed one. */
async function report(cmd: string[]) {
  const { stdout, stderr, exitCode, signalCode } = await run(cmd);
  let result: unknown = stdout;
  try {
    result = JSON.parse(stdout);
  } catch {}
  return { result, stderr, exitCode, signalCode };
}

function reported(result: unknown) {
  return { result, stderr: "", exitCode: 0, signalCode: null };
}

describe.concurrent.skipIf(!cc)("started with SIGTERM blocked", () => {
  test("bun still dies from SIGTERM", async () => {
    const ended = await run([
      launcher,
      bunExe(),
      "-e",
      'process.kill(process.pid, "SIGTERM"); console.log("survived")',
    ]);
    expect(ended).toEqual({ stdout: "", stderr: "", exitCode: null, signalCode: "SIGTERM" });
  });

  test("the children bun spawns still die from SIGTERM", async () => {
    expect(await report([launcher, bunExe(), "-e", CHILDREN_KILLED_FIXTURE])).toEqual(reported(CHILDREN_KILLED));
  });

  test.skipIf(!isLinux)("neither bun nor its children have anything blocked", async () => {
    const fixture = /* js */ `
      import { readFileSync } from "node:fs";
      const child = Bun.spawnSync({ cmd: ["cat", "/proc/self/status"] });
      console.log(JSON.stringify({
        bun: readFileSync("/proc/self/status", "utf8").match(${SIG_BLK_LINE})[1],
        child: child.stdout.toString().match(${SIG_BLK_LINE})[1],
      }));
    `;
    expect(await report([launcher, bunExe(), "-e", fixture])).toEqual(
      reported({ bun: NOTHING_BLOCKED, child: NOTHING_BLOCKED }),
    );
  });

  test("bun run forwards SIGTERM to the script and dies from it", async () => {
    using project = tempDir("inherited-signal-mask-run", {
      "package.json": JSON.stringify({
        name: "inherited-signal-mask",
        // `exec`: the process that has to be killable is the script itself.
        scripts: { start: "echo ready; exec sleep 30" },
      }),
    });
    await using proc = Bun.spawn({
      cmd: [launcher, bunExe(), "run", "start"],
      cwd: String(project),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      // For cleanup should the test fail: a bun that fails it is one that ignores SIGTERM.
      killSignal: "SIGKILL",
    });
    // `ready` is printed by the script, so by now bun has installed its forwarding
    // handler and knows the script's pid. The launcher exec'd into bun, so
    // proc.pid is bun.
    const reader = proc.stdout.getReader();
    let seen = "";
    while (!seen.includes("ready\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += Buffer.from(value).toString();
    }
    expect(seen).toBe("ready\n");
    proc.kill("SIGTERM");

    const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('script "start" was terminated by signal SIGTERM');
    expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: null, signalCode: "SIGTERM" });
  });
});

// No launcher involved: bun's own thread blocks SIGTERM before spawning, and the
// children must not inherit that either.
test.concurrent.skipIf(!isPosix)("children do not inherit a signal bun itself has blocked", async () => {
  // Linux (glibc, musl, bionic) numbers SIG_BLOCK 0; Darwin and FreeBSD number it 1.
  const SIG_BLOCK = isLinux || isAndroid ? 0 : 1;
  const fixture = /* js */ `
    import { dlopen, FFIType, ptr } from "bun:ffi";
    const libc = dlopen(${JSON.stringify(libcPathForDlopen())}, {
      sigemptyset: { args: [FFIType.ptr], returns: FFIType.i32 },
      sigaddset: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
      pthread_sigmask: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    }).symbols;
    // Larger than any platform's sigset_t.
    const set = new Uint8Array(256);
    libc.sigemptyset(ptr(set));
    libc.sigaddset(ptr(set), ${SIGTERM});
    if (libc.pthread_sigmask(${SIG_BLOCK}, ptr(set), null) !== 0) throw new Error("pthread_sigmask failed");
    ${CHILDREN_KILLED_FIXTURE}
  `;
  expect(await report([bunExe(), "-e", fixture])).toEqual(reported(CHILDREN_KILLED));
});

/** Contents of a /proc file, or "" once the process it belongs to is gone. */
function procRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// /proc/<pid>/task/<tid>/children needs CONFIG_PROC_CHILDREN.
const canListChildren =
  isLinux &&
  (() => {
    try {
      readFileSync(`/proc/self/task/${process.pid}/children`);
      return true;
    } catch {
      return false;
    }
  })();

// `bun run` only learns the script's pid once the spawn returns; a signal that
// arrives before that is forwarded afterwards, outside the signal handler. That
// forwarding must not leave the signal blocked in bun: the re-raise that ends
// `bun run` once the script has died from it would then fall through to
// abort(), and bun would die from SIGABRT instead. The script shows up in
// bun's children the moment it is created, while bun is still suspended in
// vfork, so a signal sent right then is delivered before bun has the pid.
// Whether or not an attempt wins that race, bun has to die from SIGTERM.
test.skipIf(!canListChildren)("bun run forwards a signal that arrives before it knows the script's pid", async () => {
  using project = tempDir("inherited-signal-mask-early", {
    "package.json": JSON.stringify({ name: "inherited-signal-mask", scripts: { start: "exec sleep 30" } }),
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "start"],
      cwd: String(project),
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
      killSignal: "SIGKILL",
    });
    const children = `/proc/${proc.pid}/task/${proc.pid}/children`;
    // Spinning, not awaiting: the window is the script's pre-exec setup, a
    // fraction of a millisecond. The deadline only bounds a bun that never spawns.
    const deadline = performance.now() + 3_000;
    while (procRead(children).trim() === "" && performance.now() < deadline) {}
    proc.kill("SIGTERM");

    const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('script "start" was terminated by signal SIGTERM');
    expect({ attempt, exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({
      attempt,
      exitCode: null,
      signalCode: "SIGTERM",
    });
  }
});
