import { beforeAll, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithFiles } from "harness";
import { join } from "path";

test.skipIf(isWindows)("verify that we can call sigint 4096 times", () => {
  using dir = tempDir("ctrlc", {
    "index.js": /*js*/ `
      let count = 0;
        process.exitCode = 1;

        const handler = () => {
          count++;
          if (count === 1024 * 4) {
            process.off("SIGINT", handler);
            process.exitCode = 0;
            clearTimeout(timer);
          }
        };
        process.on("SIGINT", handler);
        var timer = setTimeout(() => {}, 999999);
        var remaining = 1024 * 4;

        function go() {
          for (var i = 0, end = Math.min(1024, remaining); i < end; i++) {
            process.kill(process.pid, "SIGINT");
          }
          remaining -= i;

          if (remaining > 0) {
            setTimeout(go, 10);
          }
        }
        go();
    `,
  });

  const result = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "index.js")],
    cwd: dir,
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
  });
  expect(result.exitCode).toBe(0);
  expect(result.signalCode).toBeUndefined();
});

test.skipIf(isWindows)("verify that we forward SIGINT from parent to child in bun run", () => {
  using dir = tempDir("ctrlc", {
    "index.js": `
      let count = 0;
      process.exitCode = 1;
      process.once("SIGINT", () => {
        process.kill(process.pid, "SIGKILL");
      });
      setTimeout(() => {}, 999999)
      process.kill(process.ppid, "SIGINT");
  `,
    "package.json": `
    {
      "name": "ctrlc",
      "scripts": {
        "start": " ${bunExe()} index.js"
      }
    }
  `,
  });
  console.log(dir);
  const result = Bun.spawnSync({
    cmd: [bunExe(), "start"],
    cwd: dir,
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
  });
  expect<number | null>(result.exitCode).toBe(null);
  expect(result.signalCode).toBe("SIGKILL");
});

// The SIGINT tests below launch a long-lived bin three ways: by bin name, through
// a package.json script, and as a file, each with and without --bun.
// `long-running` stands in for a dev server such as vite: it prints a line when
// it is up, then idles with no SIGINT handler, so the signal must terminate it.
// It is a `file:` dependency: `bun install` links it into node_modules/.bin like
// a registry package, without a request to a registry.
//
// No test changes the project directory, so all of them share one install.
let projectDir: string;
let installExitCode: number | null;

beforeAll(() => {
  projectDir = tempDirWithFiles("ctrlc", {
    "package.json": JSON.stringify({
      name: "ctrlc",
      scripts: {
        "dev": "long-running",
      },
      devDependencies: {
        // The folder is not named `long-running`: `bun long-running` looks for
        // that path in cwd before it looks in node_modules/.bin.
        "long-running": "file:./long-running-src",
      },
    }),
    "long-running-src/package.json": JSON.stringify({
      name: "long-running",
      version: "1.0.0",
      bin: { "long-running": "cli.js" },
    }),
    // The timer only limits how long a stray process outlives a failed test.
    "long-running-src/cli.js": `#!/usr/bin/env node
console.log("long-running is ready");
setTimeout(() => {}, 60_000);
`,
  });
  installExitCode = Bun.spawnSync({
    cmd: [bunExe(), "install"],
    cwd: projectDir,
    env: bunEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).exitCode;
});

for (const mode of [
  ["long-running"],
  ["dev"],
  ...(isWindows ? [] : [["./node_modules/.bin/long-running"]]),
  ["--bun", "long-running"],
  ["--bun", "dev"],
  ...(isWindows ? [] : [["--bun", "./node_modules/.bin/long-running"]]),
]) {
  it("kills on SIGINT in: 'bun " + mode.join(" ") + "'", async () => {
    expect(installExitCode).toBe(0);
    const proc = Bun.spawn({
      cmd: [bunExe(), ...mode],
      cwd: projectDir,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "inherit",
      env: bunEnv,
    });

    // wait for the bin to start
    const reader = proc.stdout.getReader();
    await reader.read(); // wait for first bit of stdout
    reader.releaseLock();

    expect(proc.killed).toBe(false);

    // send sigint
    process.kill(proc.pid, "SIGINT");

    // wait for exit (or 300ms max — same total grace period as before)
    await Promise.race([proc.exited, Bun.sleep(300)]);

    expect({
      killed: proc.killed,
      exitCode: proc.exitCode,
      signalCode: proc.signalCode,
    }).toEqual(
      isWindows
        ? {
            killed: true,
            exitCode: 1,
            signalCode: null,
          }
        : {
            killed: true,
            exitCode: null,
            signalCode: "SIGINT",
          },
    );
  });
}
