// https://github.com/oven-sh/bun/issues/29169
//
// process.ppid was a lazy PropertyCallback in BunProcess.cpp, so
// the value was captured once on first access and cached on the
// process object. If the original parent died and the child was
// reparented to init (or a subreaper), process.ppid stayed
// frozen at the dead pid — breaking the common orphan-detection
// pattern `if (process.ppid === 1) exit()`. Node.js exposes ppid
// as a live getter; this test pins that contract.
//
// Test structure: spawn a parent bash that spawns a bun child,
// capture the child's pid, kill the parent, wait for the kernel
// to report reparenting via /proc/<child>/stat, then send
// SIGUSR1 to the child to tell it to write its current
// process.ppid to a file and exit. The test drives every step
// from the outside; the child is passive.
//
// Reading the child's final answer from a file on disk (rather
// than stdout) sidesteps the various ways a pipe can race with
// process exit: the child writes the file with an atomic temp+
// rename, then exits — the test polls for the file to exist.
// Signals + files, no fd lifecycle, no wallclock assumptions.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";

// Read field 4 (ppid) of /proc/<pid>/stat. Field 2 (comm) can
// contain spaces and parens, so split on the LAST ')' rather
// than whitespace.
//
// If the pid's /proc entry is gone — e.g. CI infra killed the
// child out from under us — rethrow as a message that names the
// actual failure mode. The raw ENOENT is confusing post-mortem.
function kernelPpidOf(pid: number): number {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new Error(`bun child (pid ${pid}) exited before reparenting was observed`);
    }
    throw e;
  }
  return parseInt(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1], 10);
}

// 30 s explicit timeout: this test spawns `setsid bash`, has it
// spawn a bun child, kills bash, polls /proc for the kernel to
// do its reparenting, then signals the child to write out its
// observation. All the "waits" are on real OS events (not
// wallclocks), but on slow / contended CI hosts the cumulative
// process-spawn + syscall overhead can exceed bun's default 5 s
// test timeout. The test/CLAUDE.md "no timeout" rule exists to
// prevent setTimeout-based condition fakery; the explicit
// timeout here is a lane for cold-CI headroom, not a wait.
test.skipIf(!isLinux)(
  "process.ppid is live after parent death (#29169)",
  async () => {
    // Empty temp dir; child.js is written into it below once we
    // know the directory path so the script can embed outPath.
    using dir = tempDir("issue-29169", {});
    const outPath = `${String(dir)}/final_ppid.txt`;
    // The child is passive: it writes one initial line to
    // stdout, then on SIGUSR1 writes its current process.ppid
    // to a file atomically (write-then-rename) and exits. The
    // test drives the order of events from outside.
    //
    // fs.writeSync(1, ...) for the initial line because
    // process.stdout.write is buffered. The final ppid goes
    // through fs.renameSync for atomicity — the file either
    // exists with the full ppid or doesn't exist at all, so
    // the test can poll for its existence and read it in one
    // shot with no half-written-file races.
    const childSrc = `
    const fs = require("fs");
    const outPath = ${JSON.stringify(outPath)};
    const tmpPath = outPath + ".tmp";

    fs.writeSync(1, "initial " + process.ppid + "\\n");

    process.on("SIGUSR1", () => {
      fs.writeFileSync(tmpPath, String(process.ppid));
      fs.renameSync(tmpPath, outPath);
      process.exit(0);
    });

    setInterval(() => {}, 60_000);
  `;
    const childPath = `${String(dir)}/child.js`;
    writeFileSync(childPath, childSrc);

    // Parent shell: print its pid and the bun child's pid on
    // stderr, then exec bun in the background and wait on the
    // child. SIGKILL on this bash does NOT propagate to the
    // backgrounded child. `setsid` puts bash in its own session
    // so TTY job-control can't leak in either.
    await using parent = Bun.spawn({
      cmd: [
        "setsid",
        "bash",
        "-c",
        // $$ = bash pid; $! = pid of the last backgrounded job.
        `echo PARENT=$$ 1>&2; "$1" "$2" & CHILD=$!; echo CHILDPID=$CHILD 1>&2; wait $CHILD`,
        "bash",
        bunExe(),
        childPath,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    const decoder = new TextDecoder();

    // Read parent bash pid and bun child pid from stderr.
    let parentPid: number | undefined;
    let childPid: number | undefined;
    {
      const reader = parent.stderr.getReader();
      let buf = "";
      while (parentPid === undefined || childPid === undefined) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const pm = buf.match(/PARENT=(\d+)/);
        if (pm) parentPid = Number(pm[1]);
        const cm = buf.match(/CHILDPID=(\d+)/);
        if (cm) childPid = Number(cm[1]);
      }
    }
    expect(parentPid, "parent bash must print PARENT on stderr").toBeGreaterThan(1);
    expect(childPid, "parent bash must print CHILDPID on stderr").toBeGreaterThan(1);

    // Read one line from the child's stdout. Only used for the
    // 'initial' line; the 'final' ppid comes through a file.
    const stdoutReader = parent.stdout.getReader();
    let stdoutBuf = "";
    async function readLine(): Promise<string> {
      while (!stdoutBuf.includes("\n")) {
        const { value, done } = await stdoutReader.read();
        if (done) throw new Error("child stdout closed before a line was read");
        stdoutBuf += decoder.decode(value, { stream: true });
      }
      const nl = stdoutBuf.indexOf("\n");
      const line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      return line;
    }

    let reparentedJs!: number;
    let reparentedKernel!: number;
    try {
      // 1) Initial: child reports process.ppid while bash is
      //    still alive. Must equal the bash pid.
      const initial = (await readLine()).match(/^initial (\d+)$/);
      expect(initial, "child must print 'initial <n>' first").not.toBeNull();
      expect(Number(initial![1])).toBe(parentPid!);

      // 2) Kill bash. The backgrounded child is reparented by
      //    the kernel (to init, or a subreaper — either works).
      process.kill(parentPid!, "SIGKILL");

      // 3) Wait for the kernel to report the reparenting by
      //    polling /proc/<childPid>/stat. This is waiting on a
      //    real OS condition, not a wallclock deadline. The 1 ms
      //    sleep yields to the kernel scheduler so bash's
      //    exit_notify (which does the reparenting) can run on a
      //    loaded CI host — pure setImmediate monopolized the
      //    CPU enough on debian-13 to race the kernel.
      while (kernelPpidOf(childPid!) === parentPid) {
        await Bun.sleep(1);
      }
      reparentedKernel = kernelPpidOf(childPid!);

      // 4) Tell the child to write its current process.ppid to
      //    outPath and exit. Poll for the file to appear. This
      //    proves the live getter fires AFTER kernel-confirmed
      //    reparenting.
      process.kill(childPid!, "SIGUSR1");

      while (true) {
        try {
          reparentedJs = Number(readFileSync(outPath, "utf8").trim());
          break;
        } catch (e: any) {
          if (e?.code !== "ENOENT") throw e;
          await Bun.sleep(1);
        }
      }
    } finally {
      // child.js exits on its own from the SIGUSR1 handler; this
      // is belt-and-braces for the error paths.
      try {
        process.kill(childPid!, "SIGTERM");
      } catch {}
    }

    // Core assertions:
    //   * process.ppid moved off the dead parent pid
    //   * process.ppid matches what /proc says (the live getter
    //     is in agreement with the kernel)
    // Before the fix, reparentedJs would still equal parentPid
    // because the cached value was never refreshed.
    expect(reparentedJs).not.toBe(parentPid);
    expect(reparentedJs).toBe(reparentedKernel);

    // Confirm bash actually died from our SIGKILL. Bun resolves
    // signaled exits as 128 + signal.
    expect(await parent.exited).toBe(128 + 9); // SIGKILL
    expect(parent.signalCode).toBe("SIGKILL");
  },
  30_000,
);
