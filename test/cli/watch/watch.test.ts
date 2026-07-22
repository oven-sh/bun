import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, expect, it } from "bun:test";
import { bunEnv, bunExe, isBroken, isPosix, isWindows, tempDir, tmpdirSync } from "harness";
import { rmSync, writeFileSync } from "node:fs";
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

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// --watch restarts via execve() on the same pid, so children spawned by the
// previous generation stay parented to the watcher. Without cleanup every
// restart leaks one child forever (and the first one to bind a port blocks
// every later generation with EADDRINUSE).
it.skipIf(!isPosix)("--watch kills the previous generation's child processes on restart", async () => {
  using dir = tempDir("watch-subprocess-leak", {
    "dep.ts": "export const v = 0;\n",
    "entry.ts": `
      import { v } from "./dep";
      const kid = Bun.spawn({ cmd: ["sleep", "555"], stdout: "ignore", stderr: "ignore" });
      console.log("BOOT gen=" + v + " kid=" + kid.pid);
      setInterval(() => {}, 1000);
    `,
  });
  const depPath = join(String(dir), "dep.ts");

  const kids: number[] = [];
  watchee = spawn({
    cmd: [bunExe(), "--no-clear-screen", "--watch", "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });
  try {
    const GENERATIONS = 4;
    const decoder = new TextDecoder();
    let buffered = "";
    outer: for await (const chunk of watchee.stdout) {
      buffered += decoder.decode(chunk);
      let nl: number;
      while ((nl = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 1);
        const m = /^BOOT gen=(\d+) kid=(\d+)$/.exec(line);
        if (!m) continue;
        const gen = Number(m[1]);
        kids.push(Number(m[2]));
        if (gen === GENERATIONS) break outer;
        // Touch the dependency to trigger the next restart. Wait for the
        // next BOOT line (condition, not time) to know it took effect.
        writeFileSync(depPath, `export const v = ${gen + 1};\n`);
      }
    }

    expect(kids.length).toBe(GENERATIONS + 1);

    // Every generation's child except the current one should be gone.
    const leaked = kids.slice(0, -1).filter(pidAlive);
    expect(leaked).toEqual([]);
    // The current generation's child is still running.
    expect(pidAlive(kids.at(-1)!)).toBe(true);
  } finally {
    watchee.kill("SIGKILL");
    await watchee.exited;
    for (const pid of kids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
});
