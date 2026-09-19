// A child that dies from a signal is reported by dying from that same signal:
// `bun run <package.json script>`, `bun run <binary>` and `bun install`'s
// lifecycle scripts all end in `raise_ignoring_panic_handler_raw`
// (src/bun_core/Global.rs), so whatever is waiting on bun sees the child's real
// termination status.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isGlibc, isLinux, isPosix, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";

test.skipIf(!isPosix)("bun run propagates SIGKILL from a child without hitting unreachable", async () => {
  using dir = tempDir("run-sigkill", {
    "package.json": JSON.stringify({
      name: "t",
      scripts: { go: `${bunExe()} -e 'process.kill(process.pid, "SIGKILL")'` },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "go"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The outer `bun run` must itself die by SIGKILL re-raised from the child.
  // If `bun.sys.sigaction` routed through `std.posix.sigaction`'s
  // `else => unreachable`, this would be SIGILL (debug) or undefined.
  expect(stderr).toContain("SIGKILL");
  expect(stdout).toBe("");
  expect(proc.signalCode).toBe("SIGKILL");
  expect(exitCode).not.toBe(0);
});

const { SIGINT, SIGTERM } = constants.signals;

/**
 * The fixture's `start` and `postinstall` scripts, and what the
 * `bun run <binary>` case hands to `sh`: dies from SIGTERM whatever signal
 * mask it inherited from bun.
 */
const dieFromSigterm = "exec ./sigmask unblock sh -c 'kill -TERM $$'";

function project(prefix: string) {
  return tempDir(prefix, {
    "package.json": JSON.stringify({
      name: "propagate-signal",
      version: "1.0.0",
      scripts: { start: dieFromSigterm, postinstall: dieFromSigterm },
    }),
    // `sigmask block|unblock <command...>`: adds SIGTERM to the signal mask or
    // removes it, then execs the command. The mask survives execve, so this is
    // how a launcher hands bun a blocked signal, and how the script above gets
    // rid of it again.
    "sigmask.c": `
      #include <signal.h>
      #include <string.h>
      #include <unistd.h>
      int main(int argc, char** argv) {
        sigset_t set;
        sigemptyset(&set);
        sigaddset(&set, SIGTERM);
        if (argc < 3 || sigprocmask(strcmp(argv[1], "block") == 0 ? SIG_BLOCK : SIG_UNBLOCK, &set, 0) != 0) return 98;
        execvp(argv[2], argv + 2);
        return 99;
      }
    `,
    // What the kernel makes of a default-action signal that the init of a pid
    // namespace raises at itself.
    "raise.c": "int raise(int sig) { (void)sig; return 0; }\n",
  });
}

/**
 * Every command that re-raises, with the line it prints before doing so. The
 * line shows that the child really died from SIGTERM (as opposed to exiting
 * 143) and that it was the re-raise that ended bun.
 */
const entryPoints: [name: string, cmd: string[], reports: string][] = [
  [
    "bun run <package.json script>",
    [bunExe(), "run", "start"],
    'error: script "start" was terminated by signal SIGTERM',
  ],
  [
    "bun run <binary>",
    [bunExe(), "run", "sh", "-c", dieFromSigterm],
    'error: Failed to run "sh" due to signal SIGTERM',
  ],
  [
    "bun install lifecycle script",
    [bunExe(), "install"],
    'error: postinstall script from "propagate-signal" terminated by SIGTERM',
  ],
];

type Proc = Bun.Subprocess<"ignore", "pipe", "pipe">;

async function ending(proc: Proc) {
  const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { exitCode: proc.exitCode, signalCode: proc.signalCode, stderr };
}

type Ending = Awaited<ReturnType<typeof ending>>;

async function run(cmd: string[], cwd: string, env: NodeJS.Dict<string> = bunEnv) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  // `await`ed here, or leaving the scope kills the process mid-run.
  return await ending(proc);
}

function expectEnding({ stderr, ...status }: Ending, reports: string, expected: Omit<Ending, "stderr">) {
  expect(stderr).toContain(reports);
  expect(status, stderr).toEqual(expected);
}

const cc = isPosix ? Bun.which("cc") || Bun.which("clang") || Bun.which("gcc") : null;

async function compile(cwd: string, args: string[]) {
  const { exitCode, stderr } = await run([cc!, ...args], cwd);
  expect(exitCode, stderr).toBe(0);
}

// The re-raise has to unblock the signal first; otherwise raise() only leaves it
// pending and bun does not die from it. A launcher that blocked the signal is
// how a blocked one gets handed to bun from outside.
describe.concurrent.skipIf(!cc)("dies from the child's signal when bun was started with it blocked", () => {
  test.each(entryPoints)("%s", async (_, cmd, reports) => {
    using dir = project("propagate-signal-blocked");
    const sigmask = join(String(dir), "sigmask");
    await compile(String(dir), ["-o", sigmask, "sigmask.c"]);

    expectEnding(await run([sigmask, "block", ...cmd], String(dir)), reports, {
      exitCode: null,
      signalCode: "SIGTERM",
    });
  });
});

// As the init of a pid namespace (a container whose entrypoint is bun, with no
// `--init` in front of it) bun cannot kill itself: the kernel discards the
// re-raise, raise() returns, and bun has to report the signal the way a shell
// does, as exit status 128 + signo. Preloading a raise() that does nothing
// stands in for the kernel here; the real thing is exercised further down.
describe.concurrent.skipIf(!cc || !isGlibc)("exits 128 + signo when the re-raise is discarded", () => {
  test.each(entryPoints)("%s", async (_, cmd, reports) => {
    using dir = project("propagate-signal-discarded");
    await compile(String(dir), ["-o", "sigmask", "sigmask.c"]);
    const preload = join(String(dir), "libraise.so");
    await compile(String(dir), ["-shared", "-fPIC", "-o", preload, "raise.c"]);

    const ended = await run(cmd, String(dir), { ...bunEnv, LD_PRELOAD: preload });
    expectEnding(ended, reports, { exitCode: 128 + SIGTERM, signalCode: null });
  });
});

// Unprivileged user namespaces are how a test gets a pid namespace without
// being root; kernels and sandboxes that refuse them skip this part. The
// processes inside are found through /proc/<pid>/task/<tid>/children.
const unshare = ["unshare", "--user", "--map-root-user", "--pid", "--fork"];
const canBecomePid1 =
  isLinux &&
  (() => {
    try {
      readFileSync(`/proc/self/task/${process.pid}/children`);
      return Bun.spawnSync({ cmd: [...unshare, "true"], stdio: ["ignore", "ignore", "ignore"] }).exitCode === 0;
    } catch {
      return false;
    }
  })();

/** A file under /proc, or "" while the process it belongs to is not (or no longer) there. */
function procRead(path: string): string {
  try {
    return readFileSync(`/proc/${path}`, "utf8");
  } catch {
    return "";
  }
}

/** Direct children of `pid`, whichever of its threads forked them. */
function childrenOf(pid: number): number[] {
  let tids: string[];
  try {
    tids = readdirSync(`/proc/${pid}/task`);
  } catch {
    return [];
  }
  return tids.flatMap(tid => procRead(`${pid}/task/${tid}/children`).split(/\s+/).filter(Boolean).map(Number));
}

/**
 * Resolves once everything under `proc` (unshare) is up: its child is bun,
 * PID 1 inside the namespace, and bun's child is the script, which has exec'd
 * into `sleep`. Both pids are the ones seen from out here.
 */
async function waitForScript(proc: Proc): Promise<{ bun: number; script: number }> {
  while (proc.exitCode === null && proc.signalCode === null) {
    const [bun] = childrenOf(proc.pid);
    const [script] = bun === undefined ? [] : childrenOf(bun);
    if (script !== undefined && procRead(`${script}/comm`) === "sleep\n") return { bun, script };
    await Bun.sleep(10);
  }
  const { stderr, ...status } = await ending(proc);
  throw new Error(`exited before the script was up: ${JSON.stringify(status)}\n${stderr}`);
}

describe.concurrent.skipIf(!canBecomePid1)("as PID 1 of a pid namespace", () => {
  // Stays around until it is signalled; `exec` makes `sleep` itself bun's child.
  const script = "exec sleep 30";

  function pid1Project() {
    return tempDir("propagate-signal-pid1", {
      "package.json": JSON.stringify({
        name: "propagate-signal",
        version: "1.0.0",
        scripts: { start: script, postinstall: script },
      }),
    });
  }

  function spawnAsPid1(cmd: string[], cwd: string) {
    return Bun.spawn({ cmd: [...unshare, ...cmd], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  }

  // `docker stop` and Ctrl-C arrive at bun, which forwards them to the script.
  test.each([
    ["SIGTERM", SIGTERM, 'error: script "start" was terminated by signal SIGTERM'],
    ["SIGINT", SIGINT, `$ ${script}`],
  ] as const)("bun run <package.json script> forwards %s and exits 128 + signo", async (signal, signo, reports) => {
    using dir = pid1Project();
    await using proc = spawnAsPid1([bunExe(), "run", "start"], String(dir));
    const { bun } = await waitForScript(proc);
    process.kill(bun, signal);

    expectEnding(await ending(proc), reports, { exitCode: 128 + signo, signalCode: null });
  });

  test("bun run <binary> forwards SIGTERM and exits 128 + signo", async () => {
    using dir = pid1Project();
    await using proc = spawnAsPid1([bunExe(), "run", "sh", "-c", script], String(dir));
    const { bun } = await waitForScript(proc);
    process.kill(bun, "SIGTERM");

    expectEnding(await ending(proc), 'error: Failed to run "sh" due to signal SIGTERM', {
      exitCode: 128 + SIGTERM,
      signalCode: null,
    });
  });

  // Nothing is forwarded to lifecycle scripts: this is the script itself being
  // killed (by the OOM killer, say) under a `bun install` entrypoint.
  test("bun install exits 128 + signo when a lifecycle script is killed", async () => {
    using dir = pid1Project();
    await using proc = spawnAsPid1([bunExe(), "install"], String(dir));
    const { script: scriptPid } = await waitForScript(proc);
    process.kill(scriptPid, "SIGTERM");

    expectEnding(await ending(proc), 'error: postinstall script from "propagate-signal" terminated by SIGTERM', {
      exitCode: 128 + SIGTERM,
      signalCode: null,
    });
  });
});
