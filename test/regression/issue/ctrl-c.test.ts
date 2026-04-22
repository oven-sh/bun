import { beforeAll, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

test.skipIf(isWindows)("verify that we can call sigint 4096 times", () => {
  const dir = tempDirWithFiles("ctrlc", {
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
  const dir = tempDirWithFiles("ctrlc", {
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

// Share a single vite install across all of the parameterized SIGINT tests below.
// Each test only spawns vite, waits for first stdout, sends SIGINT, and asserts on
// exit state — none of them mutate the project directory, so reusing one install
// avoids redundant `bun install` + tempdir setup work per iteration.
let viteDir: string;
let viteInstallExitCode: number | null;

beforeAll(() => {
  viteDir = tempDirWithFiles("ctrlc", {
    "package.json": JSON.stringify({
      name: "ctrlc",
      scripts: {
        "dev": "vite",
      },
      devDependencies: {
        "vite": "^6.0.1",
      },
    }),
  });
  viteInstallExitCode = Bun.spawnSync({
    cmd: [bunExe(), "install"],
    cwd: viteDir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).exitCode;
});

for (const mode of [
  ["vite"],
  ["dev"],
  ...(isWindows ? [] : [["./node_modules/.bin/vite"]]),
  ["--bun", "vite"],
  ["--bun", "dev"],
  ...(isWindows ? [] : [["--bun", "./node_modules/.bin/vite"]]),
]) {
  it("kills on SIGINT in: 'bun " + mode.join(" ") + "'", async () => {
    expect(viteInstallExitCode).toBe(0);
    const proc = Bun.spawn({
      cmd: [bunExe(), ...mode],
      cwd: viteDir,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "inherit",
      env: { ...bunEnv, PORT: "9876" },
    });

    // wait for vite to start
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
