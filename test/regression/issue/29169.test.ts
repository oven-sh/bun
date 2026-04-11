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
// kill the parent, and have the CHILD tell us (via a single
// stdout line) whether its process.ppid updated. The child does
// the comparison itself so the test doesn't need to poll — we
// just wait for that one line.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

test.skipIf(!isLinux)("process.ppid is live after parent death (#29169)", async () => {
  using dir = tempDir("issue-29169", {
    // The child is itself the code under test. It:
    //   1. records its starting `process.ppid` and writes one
    //      `initial` line so the test can confirm the getter
    //      reflects the live parent while the parent is alive.
    //   2. polls process.ppid on a 25 ms interval. When
    //      `process.ppid` no longer matches the starting value
    //      AND also matches `/proc/self/stat` (kernel ground
    //      truth), it writes a single `reparented` line and
    //      exits. No external signal needed.
    //   3. if the live getter is broken the starting value is
    //      cached forever — the child writes no `reparented`
    //      line and the test fails on pipe close, not on a
    //      wallclock timeout.
    "child.js": `
      const fs = require("fs");
      function kernelPpid() {
        const stat = fs.readFileSync("/proc/self/stat", "utf8");
        // Field 4 of /proc/pid/stat is the real ppid. comm
        // (field 2) can contain spaces and parens, so split
        // on the last ')'.
        return parseInt(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1], 10);
      }

      function write(tag, js, kernel) {
        process.stdout.write(tag + " js=" + js + " kernel=" + kernel + "\\n");
      }

      const startingPpid = process.ppid;
      write("initial", startingPpid, kernelPpid());

      const iv = setInterval(() => {
        const js = process.ppid;
        if (js === startingPpid) return;
        // js has moved — confirm against the kernel and emit
        // one final line. Both values are sampled in the same
        // event-loop tick so the test's unambiguous assertion
        // (js === kernel && js !== startingPpid) holds.
        const kernel = kernelPpid();
        if (kernel !== startingPpid && kernel === js) {
          clearInterval(iv);
          write("reparented", js, kernel);
          process.exit(0);
        }
      }, 25);
    `,
  });

  // Parent shell: print our pid and the bun child's pid on
  // stderr so the test knows who to kill and who to clean up,
  // then exec bun in the background and wait. SIGKILL on bash
  // does NOT propagate to the backgrounded child; the child is
  // reparented by the kernel to init (or a subreaper). `setsid`
  // puts bash in its own session so no job-control signals leak
  // to the child either.
  await using parent = Bun.spawn({
    cmd: [
      "setsid",
      "bash",
      "-c",
      `echo PARENT=$$ 1>&2; "$1" "$2" & CHILD=$!; echo CHILDPID=$CHILD 1>&2; wait $CHILD`,
      "bash",
      bunExe(),
      `${dir}/child.js`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  // Read the parent bash pid and the bun child pid off stderr.
  const decoder = new TextDecoder();
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
  expect(parentPid, "parent bash must print its pid on stderr").toBeGreaterThan(1);
  expect(childPid, "parent bash must print the bun child pid on stderr").toBeGreaterThan(1);

  // Line-reader over the child's stdout. Throws if the pipe
  // closes before a full line arrives — which is exactly what
  // we want the test to fail on if the fix regresses (the
  // child keeps polling forever and we never get a
  // `reparented` line, so the pipe eventually closes on test
  // teardown).
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

  function parseLine(line: string): { tag: string; js: number; kernel: number } {
    const m = line.match(/^(\w+) js=(\d+) kernel=(\d+)$/);
    if (!m) throw new Error(`unexpected child output line: ${JSON.stringify(line)}`);
    return { tag: m[1], js: Number(m[2]), kernel: Number(m[3]) };
  }

  // try/finally guarantees we SIGTERM the reparented child
  // even if a readLine()/parseLine() throws mid-assertion.
  // Without this, a thrown exception would leave the child
  // running until the test runner process exits.
  let reparented: { tag: string; js: number; kernel: number };
  try {
    // `initial` line: proves the live getter reflects the
    // starting parent while the parent is still alive.
    const initial = parseLine(await readLine());
    expect(initial.tag).toBe("initial");
    expect(initial.js).toBe(parentPid!);
    expect(initial.kernel).toBe(parentPid!);

    // Kill the parent bash. The child is backgrounded inside
    // the shell so SIGKILL on bash does NOT propagate — it
    // keeps running and gets reparented.
    process.kill(parentPid!, "SIGKILL");

    // Now wait for the child's verdict. A single blocking
    // readLine(): the child emits `reparented` exactly once
    // when its own `process.ppid` has moved off the starting
    // value AND matches the kernel. If the live-getter fix
    // regresses, the child's `process.ppid` stays frozen at
    // `startingPpid` forever and readLine() eventually throws
    // — which is a clean failure, not a wallclock timeout.
    reparented = parseLine(await readLine());
  } finally {
    // The child was reparented to init (or a subreaper), so we
    // can signal it directly. It has almost certainly exited
    // on its own by now (it calls process.exit after writing
    // the `reparented` line), but a SIGTERM is a cheap
    // belt-and-braces guard for the error paths.
    try {
      process.kill(childPid!, "SIGTERM");
    } catch {}
  }

  // The core assertion: process.ppid moved off the dead parent
  // pid AND matches the kernel's view. Before the fix,
  // `reparented` would never be emitted (js stuck at the dead
  // parentPid) and readLine() would have thrown above.
  expect(reparented.tag).toBe("reparented");
  expect(reparented.js).toBe(reparented.kernel);
  expect(reparented.js).not.toBe(parentPid);
});
