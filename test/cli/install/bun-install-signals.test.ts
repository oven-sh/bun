// How `bun install` dies on SIGINT / SIGTERM / SIGHUP.
//
// The interesting case is bun as PID 1 of a pid namespace, which is what a
// container whose entrypoint is `bun install` (no `--init`) looks like. The
// kernel only delivers a signal to init when init has a handler for it, and it
// also discards the SIG_DFL re-raise that handler does, so without special
// handling `docker stop` is ignored and the install runs to completion.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, tempDir } from "harness";
import { join } from "node:path";

const signals: [NodeJS.Signals, number][] = [
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGHUP", 129],
];

// Unprivileged user namespaces are how a test gets a pid namespace without
// root. Kernels or container runtimes that refuse them skip the PID 1 cases.
const unshare = ["unshare", "--user", "--map-root-user", "--pid", "--fork"];
const canBecomePid1 = (() => {
  if (!isLinux) return false;
  try {
    return Bun.spawnSync({ cmd: [...unshare, "true"], stdio: ["ignore", "ignore", "ignore"] }).exitCode === 0;
  } catch {
    return false;
  }
})();

/**
 * A project whose only dependency lives on a registry that accepts the
 * manifest request and never answers it, so `bun install` sits in "Resolving"
 * until it is signalled. `requested` resolving proves bun is fully up (signal
 * dispositions are configured before argv is even parsed), which is when the
 * tests send their signal.
 *
 * The idle timeout bounds the failure mode: an install that wrongly survives
 * its signal gives up on the manifest after a few seconds and exits 1. It is
 * long enough that a passing run never races it: the signal goes out as soon
 * as `requested` resolves.
 */
function stalledInstall() {
  const dir = tempDir("install-signals", {
    "package.json": JSON.stringify({ name: "install-signals", dependencies: { "stalled-dep": "1.0.0" } }),
  });
  const requested = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<Response>();
  const registry = Bun.serve({
    port: 0,
    fetch() {
      requested.resolve();
      return answer.promise;
    },
  });
  return {
    cmd: [bunExe(), "install", "--registry", `http://127.0.0.1:${registry.port}/`],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
      BUN_CONFIG_HTTP_IDLE_TIMEOUT: "5",
      BUN_CONFIG_HTTP_RETRY_COUNT: "0",
    },
    requested: requested.promise,
    answerNotFound: () => answer.resolve(new Response(null, { status: 404 })),
    [Symbol.dispose]() {
      answer.resolve(new Response(null, { status: 404 }));
      registry.stop(true);
      dir[Symbol.dispose]();
    },
  };
}

describe.concurrent.skipIf(!canBecomePid1)("bun install as PID 1 of a pid namespace", () => {
  test.each(signals)("exits 128 + signo on %s", async (signal, exitCode) => {
    using install = stalledInstall();
    await using proc = Bun.spawn({
      cmd: [...unshare, ...install.cmd],
      cwd: install.cwd,
      env: install.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    await install.requested;

    // `proc` is unshare, waiting on its one child: bun, which is PID 1 inside
    // the new namespace. Signal bun from out here, the way `docker stop` does.
    // unshare exits with whatever status bun exits with.
    //
    // The file is empty if bun is already gone (an empty split would still be
    // one element, and kill(0) would signal this test runner's process group).
    const children = (await Bun.file(`/proc/${proc.pid}/task/${proc.pid}/children`).text())
      .split(/\s+/)
      .filter(Boolean);
    expect(children).toEqual([expect.stringMatching(/^\d+$/)]);
    process.kill(Number(children[0]), signal);

    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }, stdout + stderr).toEqual({
      exitCode,
      signalCode: null,
    });
  });
});

// Outside of a pid namespace the handler above must stay invisible: the
// process has to die *by* the signal (so a shell script running `bun install`
// still aborts on Ctrl-C), not exit with 128 + signo itself.
describe.concurrent.skipIf(!isPosix)("bun install on a terminal", () => {
  test.each(signals)("is killed by %s", async signal => {
    using install = stalledInstall();
    await using proc = Bun.spawn({
      cmd: install.cmd,
      cwd: install.cwd,
      env: install.env,
      terminal: { data() {} },
    });
    await install.requested;

    proc.kill(signal);
    await proc.exited;
    proc.terminal!.close();

    expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: null, signalCode: signal });
  });

  test.each(signals)("keeps %s ignored when it was inherited that way", async signal => {
    using install = stalledInstall();
    let output = "";
    const ptyClosed = Promise.withResolvers<void>();
    await using proc = Bun.spawn({
      // `trap '' SIG` makes the shell ignore the signal; exec hands that
      // disposition to bun, just like `nohup` or a shell backgrounding a job.
      cmd: ["sh", "-c", `trap '' ${signal.slice(3)}; exec "$@"`, "sh", ...install.cmd],
      cwd: install.cwd,
      env: install.env,
      terminal: {
        data(_terminal, chunk) {
          output += new TextDecoder().decode(chunk);
        },
        exit() {
          ptyClosed.resolve();
        },
      },
    });
    await install.requested;

    // An ignored signal is discarded by the kernel before kill() returns, so
    // bun is provably unaffected by the time the registry answers and it
    // finishes the install on its own terms (a failed resolution, exit 1).
    proc.kill(signal);
    install.answerNotFound();
    await proc.exited;
    await ptyClosed.promise;
    proc.terminal!.close();

    expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }, output).toEqual({ exitCode: 1, signalCode: null });
    expect(output).toContain("stalled-dep");
  });
});
