import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, gcTick } from "harness";

// Continuing fuzz testing - avoiding known crash cases to find more bugs
// This version skips the integer overflow case to let us find other issues

describe("Bun.spawn continued fuzz test", () => {
  test("fuzz spawn with controlled edge cases", async () => {
    const iterations = 100;
    let crashCount = 0;

    // Controlled edge cases that won't immediately hit known bugs
    const edgeCaseStrings = ["", " ", "\n", "\t", "\u0000", "\uFFFD", "../etc/passwd", ".", "..", "🚀"];

    const stdioOptions = ["pipe", "inherit", "ignore", null, undefined];

    for (let i = 0; i < iterations; i++) {
      try {
        const testType = i % 8;

        switch (testType) {
          case 0: // Invalid cwd
            try {
              spawn({
                cmd: [bunExe(), "--version"],
                cwd: edgeCaseStrings[i % edgeCaseStrings.length],
                stdout: "pipe",
                stderr: "pipe",
              });
            } catch (e) {}
            break;

          case 1: // Null bytes in env
            try {
              const proc = spawn({
                cmd: [bunExe(), "-e", "console.log(process.env.TEST)"],
                env: { TEST: "value\u0000test", ...bunEnv },
                stdout: "pipe",
                stderr: "pipe",
              });
              await proc.exited;
            } catch (e) {}
            break;

          case 2: // Invalid stdin types
            try {
              const proc = spawn({
                cmd: [bunExe(), "--version"],
                stdin: edgeCaseStrings[i % edgeCaseStrings.length] as any,
                stdout: "pipe",
              });
              await proc.exited;
            } catch (e) {}
            break;

          case 3: // Rapid kill after spawn
            try {
              const proc = spawn({
                cmd: [bunExe(), "-e", "await Bun.sleep(1000)"],
                stdout: "ignore",
              });
              proc.kill();
              proc.kill(); // Double kill
              await proc.exited;
            } catch (e) {}
            break;

          case 4: // Stream operations in weird order
            try {
              const proc = spawn({
                cmd: [bunExe(), "-e", "console.log('test')"],
                stdout: "pipe",
              });

              proc.stdout.cancel();
              proc.kill();

              await proc.exited;
            } catch (e) {}
            break;

          case 5: // Multiple ref/unref
            try {
              const proc = spawn({
                cmd: [bunExe(), "--version"],
                stdout: "ignore",
              });
              proc.ref();
              proc.unref();
              proc.ref();
              proc.unref();
              await proc.exited;
            } catch (e) {}
            break;

          case 6: // spawnSync with weird options
            try {
              spawnSync({
                cmd: [bunExe(), "--version"],
                env: { "": "empty key", ...bunEnv },
              });
            } catch (e) {}
            break;

          case 7: // Invalid command with various stdio
            try {
              spawn({
                cmd: ["\u0000"],
                stdin: stdioOptions[i % stdioOptions.length] as any,
                stdout: stdioOptions[i % stdioOptions.length] as any,
                stderr: stdioOptions[i % stdioOptions.length] as any,
              });
            } catch (e) {}
            break;
        }

        if (i % 20 === 0) {
          gcTick();
        }
      } catch (e) {
        console.error("Unexpected outer error:", e);
        crashCount++;
      }
    }

    expect(crashCount).toBe(0);
  }, 60000);

  test("fuzz with file descriptor edge cases", async () => {
    // Test boundary conditions for file descriptors
    const fds = [3, 4, 10, 100, 255];

    for (const fd of fds) {
      try {
        const proc = spawn({
          cmd: [bunExe(), "--version"],
          stdin: fd,
          stdout: "pipe",
        });
        await proc.exited;
      } catch (e) {
        // Expected - these should error gracefully
      }
    }

    gcTick();
  });

  test("fuzz with concurrent spawns and kills", async () => {
    const procs = [];

    // Spawn 20 processes
    for (let i = 0; i < 20; i++) {
      try {
        const proc = spawn({
          cmd: [bunExe(), "-e", "await Bun.sleep(100)"],
          stdout: "ignore",
          stderr: "ignore",
        });
        procs.push(proc);
      } catch (e) {}
    }

    // Kill them in random order
    for (let i = 0; i < procs.length; i++) {
      const idx = Math.floor(Math.random() * procs.length);
      try {
        procs[idx]?.kill();
      } catch (e) {}
    }

    // Wait for all
    await Promise.allSettled(procs.map(p => p?.exited));

    gcTick();
  });

  test("fuzz with stdin write operations", async () => {
    const sizes = [0, 1, 100, 1000, 10000];

    for (const size of sizes) {
      try {
        const data = new Uint8Array(size).fill(65);

        const proc = spawn({
          cmd: [bunExe(), "-e", "await Bun.sleep(10)"],
          stdin: "pipe",
          stdout: "ignore",
        });

        try {
          proc.stdin.write(data);
          proc.stdin.write(data); // Write twice
          proc.stdin.end();
          proc.stdin.end(); // End twice
        } catch (e) {
          // Expected
        }

        await proc.exited;
      } catch (e) {
        // Expected
      }
    }

    gcTick();
  });

  test("fuzz with process properties access", async () => {
    for (let i = 0; i < 20; i++) {
      try {
        const proc = spawn({
          cmd: [bunExe(), "-e", "await Bun.sleep(10)"],
          stdout: "pipe",
          stderr: "pipe",
        });

        // Access properties in various orders
        const _ = proc.pid;
        const __ = proc.exitCode;
        const ___ = proc.killed;
        const ____ = proc.signalCode;

        // Try to read from streams immediately
        try {
          const reader = proc.stdout.getReader();
          reader.releaseLock();
        } catch (e) {}

        proc.kill();
        await proc.exited;

        // Access after exit
        const _____ = proc.exitCode;
        const ______ = proc.killed;

        try {
          proc.resourceUsage();
        } catch (e) {}
      } catch (e) {
        // Expected
      }
    }

    gcTick();
  });

  test("fuzz spawnSync with various stdin", () => {
    const inputs = [
      new Uint8Array(0),
      new Uint8Array(1).fill(0),
      new Uint8Array(100).fill(65),
      new Uint8Array(10000).fill(65),
      Buffer.from("test"),
      Buffer.from("\u0000"),
      Buffer.from("test\u0000test"),
    ];

    for (const input of inputs) {
      try {
        const result = spawnSync({
          cmd: [bunExe(), "-e", "console.log('ok')"],
          stdin: input,
        });

        result.stdout?.toString();
        result.stderr?.toString();
      } catch (e) {
        // Expected
      }
    }

    gcTick();
  });

  test("fuzz with env edge cases", async () => {
    const envTests = [
      { "": "empty key" },
      { "KEY": "" },
      { "KEY": "\u0000" },
      { "KEY\u0000": "value" },
      { "KEY": "value\u0000value" },
      { "🚀": "rocket" },
      { "KEY": "🚀" },
      Object.fromEntries(
        Array(100)
          .fill(0)
          .map((_, i) => [`K${i}`, `V${i}`]),
      ),
    ];

    for (const env of envTests) {
      try {
        const proc = spawn({
          cmd: [bunExe(), "-e", "console.log('ok')"],
          env: { ...bunEnv, ...env },
          stdout: "pipe",
        });
        await proc.exited;
      } catch (e) {
        // Expected
      }
    }

    gcTick();
  });

  test("fuzz with cwd edge cases", async () => {
    const cwds = [
      "/nonexistent/path",
      "/tmp/../tmp/../tmp",
      ".",
      "..",
      "",
      "\u0000",
      "/\u0000/test",
      "relative/path",
      "./././././",
    ];

    for (const cwd of cwds) {
      try {
        const proc = spawn({
          cmd: [bunExe(), "--version"],
          cwd: cwd,
          stdout: "ignore",
        });
        await proc.exited;
      } catch (e) {
        // Expected - most should error
      }
    }

    gcTick();
  });
});
