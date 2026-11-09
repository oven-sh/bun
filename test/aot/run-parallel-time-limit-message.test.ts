import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const isCanary = Bun.spawnSync([bunExe(), "--revision"]).stdout.toString().includes("-canary");

test.skipIf(!isLinux || !isCanary)(
  "the time limit message of run-parallel.ts reports CPU time and thread states, and the stacks stand behind what the run said",
  async () => {
    using dir = tempDir("run-parallel-time-limit-message", {
      "tsconfig.json": "{}",
      "sleeps.js": `console.log("begun");\nawait Bun.sleep(600_000);\n`,
      "spins.js": `console.log("begun");\nfor (let i = 0; ; i++) if (i === process.argv.length - 100) break;\n`,
    });
    const root = String(dir);
    const files = ["sleeps.js", "spins.js"].map(name => join(root, name));
    const { stdout, exitCode } = await run(
      [bunExe(), join(import.meta.dir, "run-parallel.ts"), `--root=${root}`, "--jobs=2", "--seconds=8", ...files],
      root,
      bunEnv,
    );
    const failures = stdout
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(({ state }) => state === "fail");
    const messages = Object.fromEntries(
      failures.map(({ file, message }) => [file.slice(root.length + 1), message as string]),
    );
    const threads = Object.fromEntries(
      failures.map(({ file, actual }) => [file.slice(root.length + 1), actual.stderr as string]),
    );
    const message = /^it ended by SIGKILL: it ran over 8 s \(CPU time (\d+\.\d) s; threads: (.+)\)$/;
    const [sleeps, spins] = [message.exec(messages["sleeps.js"]), message.exec(messages["spins.js"])];
    expect(messages).toEqual({
      "sleeps.js": expect.stringMatching(message),
      "spins.js": expect.stringMatching(message),
    });
    expect(Number(sleeps![1])).toBeLessThan(2);
    expect(Number(spins![1])).toBeGreaterThan(Number(sleeps![1]));
    expect(spins![2]).toMatch(/\b\d+ R\b/);
    // The first thread is the one that runs the program. Of one that sleeps the driver names the system call and what called it, of one that runs nothing more.
    expect(threads["sleeps.js"]).toMatch(
      /\nthe threads of \d+ at the time limit:\n.+ \(\d+\), S: system call \d+\(.+\)\n    \S/,
    );
    expect(threads["spins.js"]).toMatch(/\nthe threads of \d+ at the time limit:\n.+ \(\d+\), R: running\n/);
    // The names are read out of the table of symbols, by gdb.
    if (Bun.which("gdb")) expect(threads["sleeps.js"]).toMatch(/\n    us_loop_run_bun_tick \+ \d+\n/);
    expect(exitCode).toBe(1);
  },
  120_000,
);
