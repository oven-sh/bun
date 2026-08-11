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
  expect(result.exitCode).toBe(null);
  expect(result.signalCode).toBe("SIGKILL");
});

// The parameterized SIGINT tests below run a long-lived bin (originally vite's
// dev server) through the different ways `bun` can launch one: a node_modules
// bin by name, a package.json script, and the bin file itself, with and without
// --bun. `long-running` is a local stand-in for vite: it prints a line once it
// is up and then idles without installing a SIGINT handler, so the signal must
// terminate it. It is installed as a file: dependency so `bun install` links
// node_modules/.bin the same way it would for a registry package, without
// contacting a registry.
//
// Each test only spawns the bin, waits for first stdout, sends SIGINT, and
// asserts on exit state — none of them mutate the project directory, so one
// shared install in beforeAll is enough.
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
        "long-running": "file:./long-running",
      },
    }),
    "long-running/package.json": JSON.stringify({
      name: "long-running",
      version: "1.0.0",
      bin: { "long-running": "cli.js" },
    }),
    // Like vite, this never exits on its own within the test; the timer only
    // bounds how long a stray process can outlive a failed test.
    "long-running/cli.js": `#!/usr/bin/env node
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
