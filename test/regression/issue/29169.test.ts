// https://github.com/oven-sh/bun/issues/29169
//
// process.ppid was a lazy PropertyCallback in BunProcess.cpp, so
// the value was captured once on first access and then cached on
// the process object. If the original parent died and the child
// was reparented to init (or a subreaper), process.ppid stayed
// frozen at the original (now-dead) PID. Node.js exposes ppid as
// a live getter — so orphan-detection patterns like
// `if (process.ppid === 1) exit()` silently broke on bun.
//
// The fix: expose ppid as a CustomAccessor that calls getppid()
// / uv_os_getppid() on every access. This test spawns a parent
// shell that spawns a bun child, kills the parent, and verifies
// the child's reported ppid updates to match the kernel's view
// from /proc/self/stat.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

// Explicit timeout: the polling loop reads up to ~200 lines at
// 25 ms each (~5 s) on top of process-spawning overhead, so the
// default 5 s bun test timeout is too tight on slow CI hosts.
test.skipIf(!isLinux)("process.ppid is live after parent death (#29169)", async () => {
  using dir = tempDir("issue-29169", {
    "child.js": `
      const fs = require("fs");
      function readKernelPpid() {
        const stat = fs.readFileSync("/proc/self/stat", "utf8");
        // Field 4 of /proc/pid/stat is the real ppid. The second
        // field (comm) can contain spaces and parens, so split on
        // the last ')'.
        const after = stat.slice(stat.lastIndexOf(")") + 2);
        return parseInt(after.split(" ")[1], 10);
      }

      // Print one line with both values. The harness reads these
      // until the reported ppid matches the kernel's view.
      function report(tag) {
        process.stdout.write(
          tag + " js=" + process.ppid + " kernel=" + readKernelPpid() + "\\n",
        );
      }

      report("initial");
      const iv = setInterval(() => report("tick"), 25);
      // Keep the process alive indefinitely — the parent of the
      // parent will kill it once the test assertions are done.
      process.on("SIGTERM", () => {
        clearInterval(iv);
        process.exit(0);
      });
    `,
  });

  // Launch a parent bash process that:
  //   1. Spawns the bun child with stdout piped up to us (fd 1).
  //   2. Prints its own PID on stderr (so we know whom to kill).
  //   3. Waits forever. When we kill this bash, its child (bun)
  //      is reparented to PID 1 (init) — or to a subreaper, but
  //      in either case the ppid *must* change from the bash pid.
  //
  // `setsid` gives bash its own session so killing it doesn't
  // accidentally take the bun child with it via job-control
  // signals.
  await using parent = Bun.spawn({
    cmd: [
      "setsid",
      "bash",
      "-c",
      // Print our pid on stderr, then exec bun in the background,
      // then `wait` so bash doesn't exit on its own. When bash is
      // killed, the backgrounded bun child gets reparented.
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

  // Pull the parent's pid (and, for debugging, the bun child's
  // pid) out of stderr before we do anything else.
  let parentPid: number | undefined;
  let childPid: number | undefined;
  const stderrReader = parent.stderr.getReader();
  const decoder = new TextDecoder();
  let stderrBuf = "";
  while (parentPid === undefined || childPid === undefined) {
    const { value, done } = await stderrReader.read();
    if (done) break;
    stderrBuf += decoder.decode(value, { stream: true });
    const pm = stderrBuf.match(/PARENT=(\d+)/);
    if (pm) parentPid = Number(pm[1]);
    const cm = stderrBuf.match(/CHILDPID=(\d+)/);
    if (cm) childPid = Number(cm[1]);
  }
  expect(parentPid, "parent bash must report its pid on stderr").toBeGreaterThan(1);
  expect(childPid, "parent bash must report the bun child pid on stderr").toBeGreaterThan(1);

  // Read the first "initial" line from the bun child's stdout.
  // Its reported ppid should equal the parent bash pid while the
  // parent is still alive.
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

  const initial = parseLine(await readLine());
  expect(initial.tag).toBe("initial");
  expect(initial.js).toBe(parentPid!);
  expect(initial.kernel).toBe(parentPid!);

  // Kill the parent bash. The bun child is backgrounded inside
  // the shell, so SIGKILL on bash does NOT propagate — the bun
  // child keeps running and is reparented by the kernel.
  process.kill(parentPid!, "SIGKILL");

  // Now read lines from the child until the reported ppid
  // changes away from the dead parent. Give it a reasonable
  // number of ticks (the child reports every 25 ms) so the test
  // doesn't hang if the fix isn't in place — each failing read
  // is a fresh line, and bun's test timeout will kick in.
  //
  // Each report() call reads `process.ppid` and then
  // `/proc/self/stat` as two separate userspace operations, so
  // reparenting can race between them: we can see
  // js=parentPid kernel=newPpid on one line even when the live
  // getter is working correctly. Don't trust that single mixed
  // sample — take another line; on the NEXT tick both reads
  // should see the new ppid. Only samples where `line.js`
  // already differs from `parentPid` are unambiguous proof that
  // the live getter kicked in.
  let reparented: { tag: string; js: number; kernel: number } | undefined;
  for (let i = 0; i < 400; i++) {
    const line = parseLine(await readLine());
    if (line.js !== parentPid) {
      reparented = line;
      break;
    }
    if (line.kernel !== parentPid) {
      // Mixed sample: the kernel reparented between this line's
      // two reads. Take one more sample — on the next tick, a
      // correct live getter reports the new ppid in both fields.
      // If the bug is present, the NEXT read still has
      // js=parentPid and this becomes the assertion failure
      // (we record the mixed sample as a fallback so the test
      // reports a meaningful diff rather than timing out).
      const next = parseLine(await readLine());
      reparented = next.js !== parentPid ? next : line;
      break;
    }
  }

  // Tell the bun child to shut down cleanly before we assert —
  // otherwise a failing assertion leaves it alive. SIGTERM on
  // the child pid; it's now reparented to PID 1 (or a subreaper)
  // so we can signal it directly.
  try {
    process.kill(childPid!, "SIGTERM");
  } catch {}

  expect(reparented, "bun child never reported a new ppid after parent kill").toBeDefined();
  // The core assertion: after the parent dies, process.ppid
  // must match what the kernel says (from /proc/self/stat).
  // Before the fix, js stayed at the dead parentPid while
  // kernel showed the new reaper pid.
  expect(reparented!.js).toBe(reparented!.kernel);
  expect(reparented!.js).not.toBe(parentPid);
}, 30_000);
