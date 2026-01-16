import { expect, it, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

// Test that bun run properly waits for child to handle SIGINT
// On Windows, we skip this because process.kill uses TerminateProcess (not a real signal).
// The Windows CTRL+C fix is tested manually - GenerateConsoleCtrlEvent would affect the test runner too.
test.skipIf(isWindows)("bun run forwards SIGINT to child and waits for graceful exit", async () => {
  const dir = tempDirWithFiles("ctrlc-forward", {
    "server.js": /*js*/ `
      // Simple script that handles SIGINT gracefully
      console.log("ready");

      process.on("SIGINT", () => {
        console.log("received SIGINT, shutting down gracefully");
        process.exit(42);
      });

      // Keep alive
      setTimeout(() => {}, 999999);
    `,
    "package.json": JSON.stringify({
      name: "ctrlc-forward",
      scripts: {
        start: "bun server.js",
      },
    }),
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "start"],
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  // Collect all stdout
  const chunks: Uint8Array[] = [];
  const reader = proc.stdout.getReader();

  // Wait for "ready" signal
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    const text = new TextDecoder().decode(value);
    if (text.includes("ready")) break;
  }

  // Send SIGINT to bun run process
  process.kill(proc.pid, "SIGINT");

  // Read remaining output
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  reader.releaseLock();

  // Wait for exit
  const exitCode = await proc.exited;
  const stdout = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

  // Verify the child received and handled SIGINT
  expect(stdout).toContain("ready");
  expect(stdout).toContain("received SIGINT");
  expect(exitCode).toBe(42);
});

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

for (const mode of [
  ["vite"],
  ["dev"],
  ...(isWindows ? [] : [["./node_modules/.bin/vite"]]),
  ["--bun", "vite"],
  ["--bun", "dev"],
  ...(isWindows ? [] : [["--bun", "./node_modules/.bin/vite"]]),
]) {
  it("kills on SIGINT in: 'bun " + mode.join(" ") + "'", async () => {
    const dir = tempDirWithFiles("ctrlc", {
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
    expect(
      Bun.spawnSync({
        cmd: [bunExe(), "install"],
        cwd: dir,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).exitCode,
    ).toBe(0);
    const proc = Bun.spawn({
      cmd: [bunExe(), ...mode],
      cwd: dir,
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

    // wait for exit or 200ms
    await Promise.race([proc.exited, Bun.sleep(200)]);

    // wait to allow a moment to be killed
    await Bun.sleep(100); // wait for kill
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
