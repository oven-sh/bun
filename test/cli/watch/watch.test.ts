import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isPosix, isWindows, tempDir, tmpdirSync } from "harness";
import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
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

// https://github.com/oven-sh/bun/issues/13539
//
// On POSIX `--watch` runs the script in-process with a `while (true)` event
// loop so the watcher can keep the process alive between runs. If the script
// registers `process.on('SIGINT', …)` the default disposition is replaced —
// the handler runs, but nothing breaks out of that loop, so Ctrl+C can never
// terminate the process short of SIGKILL.
//
// Windows uses a supervisor + Job Object and doesn't have this problem.
describe.skipIf(!isPosix)("--watch / --hot with a JS signal handler", () => {
  for (const flag of ["--watch", "--hot"] as const) {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      it(`${flag}: exits on ${signal} after running the handler`, async () => {
        using dir = tempDir("watch-signal", {
          "child.mjs": `setInterval(() => {}, 1000);`,
          "cluster.mjs": `
            const children = [];
            for (let i = 0; i < 2; i++) {
              children.push(Bun.spawn([process.execPath, "child.mjs"], {
                stdio: ["ignore", "ignore", "ignore"],
                env: process.env,
              }));
            }
            process.on(${JSON.stringify(signal)}, () => {
              console.log("HANDLER_RAN");
              for (const c of children) c.kill();
            });
            process.on("exit", () => console.log("EXIT_RAN"));
            // Handler must be installed before the test sends the signal,
            // so READY goes last.
            console.log("READY " + children.map(c => c.pid).join(","));
          `,
        });

        await using proc = Bun.spawn({
          cmd: [bunExe(), flag, "cluster.mjs"],
          env: bunEnv,
          cwd: String(dir),
          stdio: ["ignore", "pipe", "pipe"],
        });

        let childPids: number[] = [];
        const stdoutLines: string[] = [];
        for await (const line of forEachLine(proc.stdout)) {
          stdoutLines.push(line);
          if (line.startsWith("READY ")) {
            childPids = line
              .slice("READY ".length)
              .split(",")
              .map(s => parseInt(s, 10));
            proc.kill(signal);
          }
        }
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

        // Handler ran first, then the normal exit path (process.on('exit')),
        // then the process actually terminated with 128 + signal.
        expect(stderr).toBe("");
        expect(stdoutLines).toContain("HANDLER_RAN");
        expect(stdoutLines).toContain("EXIT_RAN");
        expect(childPids.length).toBe(2);
        expect(exitCode).toBe(signal === "SIGINT" ? 130 : 143);

        // The grandchildren the script spawned must not outlive it.
        for (const pid of childPids) {
          expect(() => process.kill(pid, 0)).toThrow();
        }
      });
    }
  }

  it("--watch: kills Bun.spawn children on file-change reload", async () => {
    using dir = tempDir("watch-reload-spawn", {
      "child.mjs": `setInterval(() => {}, 1000);`,
      "entry.mjs": `
        const children = [];
        for (let i = 0; i < 2; i++) {
          children.push(Bun.spawn([process.execPath, "child.mjs"], {
            stdio: ["ignore", "ignore", "ignore"],
            env: process.env,
          }));
        }
        console.log("SPAWNED " + children.map(c => c.pid).join(","));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--watch", "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdio: ["ignore", "pipe", "inherit"],
    });

    const lines = forEachLine(proc.stdout);

    // Use .next() directly — `for await … break/return` would call
    // `return()` on the generator and close it for subsequent calls.
    const nextGeneration = async () => {
      while (true) {
        const { value: line, done } = await lines.next();
        if (done) throw new Error("watcher exited without spawning");
        if (line.startsWith("SPAWNED ")) {
          return line
            .slice("SPAWNED ".length)
            .split(",")
            .map(s => parseInt(s, 10));
        }
      }
    };

    const isRunning = async (pid: number) => {
      try {
        const t = await Bun.file(`/proc/${pid}/status`).text();
        return !t.includes("State:\tZ");
      } catch {
        return false; // gone entirely
      }
    };

    // Three generations: before the fix all six children would still be
    // running here; after, only the two from the current generation are.
    const gen1 = await nextGeneration();
    await writeFile(join(String(dir), "entry.mjs"), (await Bun.file(join(String(dir), "entry.mjs")).text()) + "\n// 1");
    const gen2 = await nextGeneration();
    await writeFile(join(String(dir), "entry.mjs"), (await Bun.file(join(String(dir), "entry.mjs")).text()) + "\n// 2");
    const gen3 = await nextGeneration();

    // `kill -0` succeeds on zombies too, so on Linux check /proc state
    // directly. On macOS there's no /proc, so fall back to `kill -0` for
    // gen1 only — it's been through two reap passes (gen2 and gen3 startup)
    // so it's fully gone, whereas gen2 may briefly still be a zombie.
    // Either way, before the fix gen1 would still be a live running
    // process on both platforms.
    if (process.platform === "linux") {
      for (const pid of [...gen1, ...gen2]) {
        expect(await isRunning(pid)).toBe(false);
      }
    } else {
      for (const pid of gen1) {
        expect(() => process.kill(pid, 0)).toThrow();
      }
    }

    proc.kill("SIGKILL");
    await proc.exited;
    for (const pid of [...gen2, ...gen3]) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  });
});
