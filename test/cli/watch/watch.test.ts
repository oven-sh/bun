import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isBroken, isDebug, isWindows, tempDir, tmpdirSync } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";

let watchee: Subprocess;

for (const dir of ["dir", "©️"]) {
  it.todoIf(isBroken && isWindows)(
    `should watch files${dir === "dir" ? "" : " (non-ascii path)"}`,
    async () => {
      const cwd = join(tmpdirSync(), dir);
      const path = join(cwd, "watchee.js");

      const updateFile = async (i: number) => {
        await Bun.write(path, `console.log(${i}, __dirname);`);
      };

      let i = 0;
      await updateFile(i);
      await Bun.sleep(1000);
      watchee = spawn({
        cwd,
        cmd: [bunExe(), "--watch", "watchee.js"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });

      for await (const line of watchee.stdout) {
        if (i == 10) break;
        var str = new TextDecoder().decode(line);
        expect(str).toContain(`${i} ${cwd}`);
        i++;
        await updateFile(i);
      }
      rmSync(path);
    },
    10000,
  );
}

afterEach(() => {
  watchee?.kill();
});

// https://github.com/oven-sh/bun/issues/32400
// A custom SIGINT handler that cleans up a ref'd resource used to hang the
// --watch/--hot run-loop forever: the handler ran, the event loop drained, but
// the watcher kept the process alive. It should exit like a plain `bun run`
// (and like `node --watch`) once the loop drains after the signal.
describe.each(["--watch", "--hot"])("%s exits on SIGINT after the handler cleans up", flag => {
  it.skipIf(isWindows)(
    "issue #32400",
    async () => {
      using dir = tempDir("watch-sigint", {
        "serve.ts": `
          const server = Bun.serve({ port: 0, fetch() { return new Response("OK"); } });
          process.on("SIGINT", async () => {
            await server.stop();
            console.log("CLEANED_UP");
          });
          console.log("READY");
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", flag, "serve.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Drain stderr concurrently so the watch banner can't fill the pipe.
      const stderrDone = proc.stderr.text();

      // Wait until the server is up and the SIGINT handler is installed.
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let stdout = "";
      let ready = false;
      while (!ready) {
        const { done, value } = await reader.read();
        if (done) break;
        stdout += decoder.decode(value, { stream: true });
        if (stdout.includes("READY")) ready = true;
      }
      reader.releaseLock();
      expect(ready).toBe(true);

      process.kill(proc.pid, "SIGINT");

      // On the fixed build the handler stops the server, the loop drains and
      // the process exits. On the buggy build the --watch/--hot loop blocks
      // forever, so this await hangs and the test times out (the fail-before
      // state). The handler caught SIGINT, so the exit is clean (code 0, no
      // signalCode), not a signal kill.
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(proc.signalCode).toBe(null);
      await stderrDone.catch(() => {});
    },
    isDebug ? 30_000 : 15_000,
  );
});
