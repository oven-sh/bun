import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import path from "path";

describe("process.on", () => {
  it("when called from the main thread", () => {
    const result = Bun.spawnSync({
      cmd: [bunExe(), path.join(__dirname, "process-on-fixture.ts")],
      env: bunEnv,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    expect(result.exitCode).toBe(0);
  });

  it("should work inside --compile", () => {
    const dir = tempDirWithFiles("process-on-test", {
      "process-on-fixture.ts": require("fs").readFileSync(require.resolve("./process-on-fixture.ts"), "utf-8"),
      "package.json": `{
        "name": "process-on-test",
        "type": "module",
        "scripts": {
          "start": "bun run process-on-fixture.ts"
        }
      }`,
    });
    const result1 = Bun.spawnSync({
      cmd: [bunExe(), "build", "--compile", path.join(dir, "./process-on-fixture.ts"), "--outfile=./out"],
      env: bunEnv,
      cwd: dir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    expect(result1.exitCode).toBe(0);

    const result2 = Bun.spawnSync({
      cmd: ["./out"],
      env: bunEnv,
      cwd: dir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(result2.exitCode).toBe(0);
  });

  it("should work inside a macro", () => {
    const dir = tempDirWithFiles("process-on-test", {
      "process-on-fixture.ts": require("fs").readFileSync(require.resolve("./process-on-fixture.ts"), "utf-8"),
      "entry.ts": `import { initialize } from "./process-on-fixture.ts" with {type: "macro"};
      initialize();`,
      "package.json": `{
        "name": "process-on-test",
        "type": "module",
        "scripts": {
          "start": "bun run entry.ts"
        }
      }`,
    });

    expect(
      Bun.spawnSync({
        cmd: [bunExe(), "build", "--target=bun", path.join(dir, "entry.ts"), "--outfile=./out.ts"],
        env: bunEnv,
        cwd: dir,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).exitCode,
    ).toBe(0);

    const result2 = Bun.spawnSync({
      cmd: [bunExe(), "run", "./out.ts"],
      env: bunEnv,
      cwd: dir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(result2.exitCode).toBe(0);
  });
});

describe("signal default disposition", () => {
  it("SIGHUP terminates process when no JS listeners are registered", async () => {
    await using child = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // Keep the process alive without registering any signal listeners
        setInterval(() => {}, 60000);
        // Give the event loop a moment to settle, then send SIGHUP to self
        setTimeout(() => {
          process.kill(process.pid, "SIGHUP");
        }, 50);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode, signalCode] = await Promise.all([
      child.stdout.text(),
      child.stderr.text(),
      child.exited,
      child.signalCode,
    ]);

    // Process should be terminated by SIGHUP (exit code null, signal SIGHUP)
    // or exit with 128 + 1 = 129
    if (signalCode) {
      expect(signalCode).toBe("SIGHUP");
    } else {
      expect(exitCode).toBe(128 + 1);
    }
  });

  it("SIGTERM terminates process when no JS listeners are registered", async () => {
    await using child = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        setInterval(() => {}, 60000);
        setTimeout(() => {
          process.kill(process.pid, "SIGTERM");
        }, 50);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode, signalCode] = await Promise.all([
      child.stdout.text(),
      child.stderr.text(),
      child.exited,
      child.signalCode,
    ]);

    if (signalCode) {
      expect(signalCode).toBe("SIGTERM");
    } else {
      expect(exitCode).toBe(128 + 15);
    }
  });

  it("signal with JS listener does NOT terminate process", async () => {
    await using child = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let handled = false;
        process.on("SIGUSR1", () => {
          handled = true;
          process.exit(0);
        });
        setTimeout(() => {
          process.kill(process.pid, "SIGUSR1");
        }, 50);
        setTimeout(() => {
          // Fallback exit if signal handler didn't fire
          process.exit(1);
        }, 5000);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await child.exited;
    expect(exitCode).toBe(0);
  });

  it("removing all listeners restores default disposition", async () => {
    await using child = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // Add then remove listener
        const handler = () => {};
        process.on("SIGHUP", handler);
        process.removeListener("SIGHUP", handler);

        setInterval(() => {}, 60000);
        setTimeout(() => {
          process.kill(process.pid, "SIGHUP");
        }, 50);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode, signalCode] = await Promise.all([
      child.stdout.text(),
      child.stderr.text(),
      child.exited,
      child.signalCode,
    ]);

    // After removing all listeners, SIGHUP should use default disposition
    if (signalCode) {
      expect(signalCode).toBe("SIGHUP");
    } else {
      expect(exitCode).toBe(128 + 1);
    }
  });
});
