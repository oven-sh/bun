import { expect, it, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";

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
        "start": "${bunExe()} index.js"
      }
    }
  `,
  });

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
    }).toEqual(isWindows ? {
      killed: true,
      exitCode: 1,
      signalCode: null,
    } : {
      killed: true,
      exitCode: null,
      signalCode: "SIGINT",
    });
  });
}
