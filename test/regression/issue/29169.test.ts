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
// capture the child's pid, kill the parent, then wait for the
// kernel to report the reparenting via /proc/<child>/stat. Once
// the kernel confirms, ask the child (via stdin) to print its
// current process.ppid and compare against the kernel's view.
// The test drives every step from the outside; the child is
// passive. No polling loops or wallclock assumptions inside the
// child, no explicit test timeout needed.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

// Read field 4 (ppid) of /proc/<pid>/stat. Field 2 (comm) can
// contain spaces and parens, so split on the LAST ')' rather
// than whitespace.
function kernelPpidOf(pid: number): number {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return parseInt(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1], 10);
}

test.skipIf(!isLinux)("process.ppid is live after parent death (#29169)", async () => {
  using dir = tempDir("issue-29169", {
    // The child is passive: it prints one initial line with
    // process.ppid, then blocks on a single byte from stdin,
    // then prints a final line with process.ppid. The test
    // drives the order of events from outside.
    "child.js": `
      process.stdout.write("initial " + process.ppid + "\\n");
      process.stdin.once("data", () => {
        process.stdout.write("final " + process.ppid + "\\n");
        process.exit(0);
      });
    `,
  });

  // Parent shell: print its pid and the bun child's pid on
  // stderr, then exec bun in the background with bash's stdin
  // redirected to the child, then wait on the child. SIGKILL
  // on this bash does NOT propagate to the backgrounded child.
  // `setsid` puts bash in its own session so TTY job-control
  // can't leak in either.
  await using parent = Bun.spawn({
    cmd: [
      "setsid",
      "bash",
      "-c",
      // $$ = bash pid; $! = pid of the last backgrounded job.
      // `<&0` hands bash's stdin to the bun child so the test
      // can write one byte to parent.stdin and it reaches the
      // child.
      `echo PARENT=$$ 1>&2; "$1" "$2" <&0 & CHILD=$!; echo CHILDPID=$CHILD 1>&2; wait $CHILD`,
      "bash",
      bunExe(),
      `${dir}/child.js`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
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

  // Line reader over the child's stdout.
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
    //    real OS condition, not a wallclock — reparenting
    //    happens within microseconds of bash being reaped.
    //    setImmediate yields one event-loop turn per attempt
    //    so we're not busy-waiting.
    while (kernelPpidOf(childPid!) === parentPid) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    reparentedKernel = kernelPpidOf(childPid!);

    // 4) Tell the child to print its current process.ppid and
    //    exit. This single write-then-read proves the live
    //    getter fires AFTER kernel-confirmed reparenting.
    parent.stdin.write("\n");
    await parent.stdin.end();

    const finalLine = (await readLine()).match(/^final (\d+)$/);
    expect(finalLine, "child must print 'final <n>' after stdin signal").not.toBeNull();
    reparentedJs = Number(finalLine![1]);
  } finally {
    // child.js exits on its own after the final line, but
    // signal it in case readLine/parseLine threw above.
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
});
