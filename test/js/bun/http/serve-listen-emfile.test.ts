import { expect, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { connect } from "net";

// When the process is at its fd limit and a connection is waiting in the
// listen backlog, accept() returns EMFILE. The listener poll is
// level-triggered, so before the fix the loop woke immediately again, failed
// accept() again, and pegged a core. With the fix the listener is unpolled
// until the next sweep tick, so the process blocks in epoll_wait/kevent.
test.skipIf(!isPosix)("Bun.serve does not spin at 100% CPU when accept() fails with EMFILE", async () => {
  using dir = tempDir("serve-emfile", {
    "server.ts": /* ts */ `
      import { openSync, closeSync, readSync, writeSync } from "fs";

      const server = Bun.serve({
        port: 0,
        fetch() { return new Response("ok"); },
      });

      // Exhaust file descriptors so the next accept() returns EMFILE.
      const held: number[] = [];
      while (true) {
        try {
          held.push(openSync("/dev/null", "r"));
        } catch (e: any) {
          if (e?.code !== "EMFILE" && e?.code !== "ENFILE") throw e;
          break;
        }
      }

      // process.stdout lazily allocates an fd on first use, which would fail
      // now; write to the existing fd 1 directly.
      writeSync(1, JSON.stringify({ port: server.port, held: held.length }) + "\\n");

      // Wait for the parent to tell us a connection is in the backlog.
      // (Blocking read on fd 0; parent writes a single byte after connecting.)
      readSync(0, Buffer.alloc(1));

      // Sample CPU time over a fixed window. A spinning accept loop consumes
      // ~100% of a core; a correctly paused listener consumes ~0.
      const wallMs = 800;
      const before = process.cpuUsage();
      await Bun.sleep(wallMs);
      const used = process.cpuUsage(before);
      const cpuMs = (used.user + used.system) / 1000;

      writeSync(1, JSON.stringify({ cpuMs, wallMs }) + "\\n");

      for (const fd of held) closeSync(fd);
      server.stop(true);
    `,
  });

  await using proc = Bun.spawn({
    // Lower both soft and hard RLIMIT_NOFILE so adjust_ulimit() cannot raise
    // it back, and the child exhausts fds quickly.
    cmd: ["/bin/sh", "-c", `ulimit -n 128 && exec "$@"`, "sh", bunExe(), "server.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderrPromise = proc.stderr.text();
  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const readLine = async () => {
    while (true) {
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) {
        const stderr = await stderrPromise;
        throw new Error(`child exited before producing a line; stderr:\n${stderr}\nstdout so far:\n${buf}`);
      }
      buf += dec.decode(value, { stream: true });
    }
  };

  const ready = JSON.parse(await readLine()) as { port: number; held: number };
  expect(ready.port).toBeGreaterThan(0);
  expect(ready.held).toBeGreaterThan(0);

  // Put a connection in the listen backlog and send a request so
  // TCP_DEFER_ACCEPT lets the listener poll fire. In the child, accept()
  // now fails with EMFILE.
  const sock = connect({ port: ready.port, host: "127.0.0.1" });
  await once(sock, "connect");
  await new Promise<void>((resolve, reject) => {
    sock.once("error", reject);
    sock.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", err =>
      err ? reject(err) : resolve(),
    );
  });
  sock.on("error", () => {});

  proc.stdin.write("go\n");

  const sample = JSON.parse(await readLine()) as { cpuMs: number; wallMs: number };
  sock.destroy();
  await proc.stdin.end();

  const [stderr, exitCode] = await Promise.all([stderrPromise, proc.exited]);

  // A spinning loop burns roughly wallMs of CPU; a paused listener burns ~0.
  expect({ ...sample, spin: sample.cpuMs > sample.wallMs / 2, stderr }).toEqual({
    cpuMs: expect.any(Number),
    wallMs: 800,
    spin: false,
    stderr: "",
  });
  expect(exitCode).toBe(0);
});
