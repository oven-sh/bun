import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import net from "node:net";
import fs from "node:fs";

// When accept(2) fails with EMFILE/ENFILE, the level-triggered listener poll
// must not busy-spin the event loop. The reserved spare-fd shed drains the
// kernel backlog so epoll_wait goes back to blocking.
//
// The assertion is CPU time consumed over a fixed wall-clock window, read from
// /proc/<pid>/stat, so this is Linux-only. (The underlying fix is POSIX-wide.)
describe.skipIf(!isLinux)("net.Server under EMFILE", () => {
  test("does not busy-spin the event loop while accept() fails with EMFILE", async () => {
    const child = `
      const net = require("node:net");
      const fs = require("node:fs");
      const held = [], filler = [];
      const srv = net.createServer(c => { held.push(c); c.on("error", () => {}); });
      srv.on("error", e => console.log("SERVER-ERROR " + e.code));
      srv.listen(0, "127.0.0.1", () => {
        console.log("PORT " + srv.address().port);
        try { for (;;) filler.push(fs.openSync("/dev/null", "r")); }
        catch (e) { console.log("EXHAUSTED " + e.code + " nfd=" + filler.length); }
      });
      // Keep alive for the parent's measurement; parent SIGKILLs when done.
      setInterval(() => {}, 60000);
    `;

    // Run the child under a low fd limit so exhaustion is cheap and
    // deterministic. bash -c 'ulimit -n N && exec ...' applies the soft limit
    // to the exec'd process only.
    await using proc = Bun.spawn({
      cmd: ["bash", "-c", 'ulimit -n 200 && exec "$0" -e "$1"', bunExe(), child],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    let buf = "";
    const stderrDrain = proc.stderr.text();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    const waitLine = async (re: RegExp) => {
      for (;;) {
        const m = buf.match(re);
        if (m) return m;
        const { value, done } = await reader.read();
        if (done) throw new Error("child exited early; stdout so far: " + JSON.stringify(buf));
        buf += decoder.decode(value, { stream: true });
      }
    };

    const port = Number((await waitLine(/PORT (\d+)/))[1]);
    const exhausted = await waitLine(/EXHAUSTED (\w+)/);
    expect(exhausted[1]).toBe("EMFILE");

    // Queue connections the child cannot accept(). Their SYN/ACK handshake
    // completes into the kernel accept backlog; the child's accept4() then
    // fails with EMFILE on every attempt.
    const clients: net.Socket[] = [];
    for (let i = 0; i < 12; i++) {
      const s = net.connect(port, "127.0.0.1");
      s.on("error", () => {});
      clients.push(s);
    }

    // Let the connects land and the child's first accept attempt happen.
    await Bun.sleep(400);

    // Measure the child's CPU time (utime+stime, in USER_HZ ticks) over a
    // quiescent window. Nothing can make forward progress here: the child has
    // zero free fds and the clients are stuck in the backlog. A correct
    // implementation is idle in epoll_wait; the bug spins accept4→EMFILE at
    // ~100% of a core.
    const cpuSeconds = () => {
      const stat = fs.readFileSync(`/proc/${proc.pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
      return (Number(fields[11]) + Number(fields[12])) / 100;
    };
    const c0 = cpuSeconds();
    await Bun.sleep(1500);
    const dcpu = cpuSeconds() - c0;

    for (const s of clients) s.destroy();
    proc.kill("SIGKILL");
    reader.releaseLock();
    await Promise.all([proc.exited, stderrDrain]);

    // Generous threshold: the spin pegs a full core (~1.5s over 1.5s); an
    // idle process measures ~0s. 0.5s is far above any debug/ASAN noise floor
    // and far below the bug.
    expect(dcpu).toBeLessThan(0.5);
  });
});
