import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunExe, gcTick } from "harness";

// This fuzz test tries many edge case combinations to find panics, segfaults, and assertion failures
// We're NOT looking for thrown errors - those are expected and handled properly
// We're looking for crashes, panics, and undefined behavior

describe("Bun.spawn fuzz test", () => {
  test("fuzz spawn with random invalid/edge case inputs", async () => {
    const iterations = 500;
    let crashCount = 0;

    // Generate various edge case values
    const edgeCaseStrings = [
      "",
      " ",
      "\0",
      "\n",
      "\r\n",
      "\t",
      "a".repeat(10000), // very long string
      "a".repeat(100000), // extremely long string
      "\u0000",
      "\uFFFD", // replacement character
      String.fromCharCode(0xd800), // unpaired surrogate
      "../../../etc/passwd",
      ".",
      "..",
      "/",
      "\\",
      "C:\\",
      "//",
      "\\\\",
      "./.",
      "./../",
      "con", // Windows reserved name
      "nul",
      "prn",
      String.fromCharCode(...Array(100).fill(0)),
      "🚀",
      "test\x00test",
      "|",
      "&",
      ";",
      "`",
      "$",
      "$(echo test)",
      "`echo test`",
    ];

    const edgeCaseNumbers = [-1, 0, 1, 2, 999, 1000, 65535, 65536, 2147483647, -2147483648, NaN, Infinity, -Infinity];

    const edgeCaseArrays = [
      [],
      [""],
      [" "],
      ["a".repeat(10000)],
      Array(100).fill("test"),
      Array(1000).fill("a"),
      ["\0"],
      ["test", "\0", "arg"],
      ...edgeCaseStrings.map(s => [bunExe(), "-e", `console.log("${s}")`]),
      [bunExe(), ...Array(50).fill("-e")],
    ];

    const edgeCaseBuffers = [
      new Uint8Array(0),
      new Uint8Array(1),
      new Uint8Array(10000),
      new Uint8Array(1000000), // 1MB
      new Uint8Array([0]),
      new Uint8Array(Array(100).fill(0)),
      new Uint8Array(Array(100).fill(255)),
      Buffer.from(""),
      Buffer.from("\0"),
      Buffer.from("test\0test"),
    ];

    const stdioOptions = ["pipe", "inherit", "ignore", null, undefined, 0, 1, 2, 999, -1];

    // Random helper functions
    const randomElement = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
    const randomInt = (max: number) => Math.floor(Math.random() * max);
    const randomBool = () => Math.random() > 0.5;

    for (let i = 0; i < iterations; i++) {
      try {
        // Randomly choose what to fuzz
        const fuzzType = randomInt(10);

        let options: any = {};
        let cmdArray: any = [bunExe(), "--version"];

        // Fuzz different aspects
        switch (fuzzType) {
          case 0: // Fuzz cmd array
            if (randomBool()) {
              cmdArray = randomElement(edgeCaseArrays);
            } else {
              cmdArray = [
                randomElement(edgeCaseStrings),
                ...Array(randomInt(10))
                  .fill(0)
                  .map(() => randomElement(edgeCaseStrings)),
              ];
            }
            break;

          case 1: // Fuzz cwd
            options.cwd = randomElement(edgeCaseStrings);
            break;

          case 2: // Fuzz env
            options.env = {};
            for (let j = 0; j < randomInt(20); j++) {
              options.env[randomElement(edgeCaseStrings)] = randomElement(edgeCaseStrings);
            }
            break;

          case 3: // Fuzz stdin
            if (randomBool()) {
              options.stdin = randomElement(stdioOptions);
            } else {
              options.stdin = randomElement(edgeCaseBuffers);
            }
            break;

          case 4: // Fuzz stdout
            options.stdout = randomElement(stdioOptions);
            break;

          case 5: // Fuzz stderr
            options.stderr = randomElement(stdioOptions);
            break;

          case 6: // Fuzz stdio array
            options.stdio = [randomElement(stdioOptions), randomElement(stdioOptions), randomElement(stdioOptions)];
            break;

          case 7: // Fuzz multiple options at once
            options.cwd = randomElement(edgeCaseStrings);
            options.stdin = randomElement(stdioOptions);
            options.stdout = randomElement(stdioOptions);
            options.stderr = randomElement(stdioOptions);
            break;

          case 8: // Fuzz with completely invalid options
            options = {
              cwd: randomElement([null, undefined, 123, true, {}, []]),
              stdin: randomElement([true, false, {}, [], "invalid"]),
              stdout: randomElement([true, false, {}, [], "invalid"]),
              env: randomElement([null, undefined, 123, true, "invalid", []]),
            };
            break;

          case 9: // Fuzz cmd with invalid types
            cmdArray = randomElement([null, undefined, 123, true, {}, "", "string not array"]);
            break;
        }

        // Try spawn - we expect it might throw, but should never crash/panic
        try {
          if (randomBool()) {
            // Test Bun.spawn
            const proc = spawn({
              cmd: cmdArray,
              ...options,
            });

            // Sometimes try to interact with the subprocess
            if (randomBool() && proc.stdin) {
              try {
                proc.stdin.write(randomElement(edgeCaseBuffers));
              } catch (e) {
                // Expected - ignore errors, we're looking for crashes
              }
            }

            if (randomBool() && proc.stdout) {
              try {
                proc.stdout.cancel();
              } catch (e) {
                // Expected - ignore errors
              }
            }

            if (randomBool()) {
              try {
                proc.kill(randomElement([0, 1, 9, 15, -1, 999, undefined]));
              } catch (e) {
                // Expected - ignore errors
              }
            }

            if (randomBool()) {
              try {
                proc.ref();
                proc.unref();
              } catch (e) {
                // Expected - ignore errors
              }
            }

            // Clean up - try to kill process if it's still running
            try {
              if (!proc.killed) {
                proc.kill();
              }
            } catch (e) {
              // Ignore
            }
          } else {
            // Test Bun.spawnSync
            const result = spawnSync({
              cmd: cmdArray,
              ...options,
            });

            // Try to access properties
            if (randomBool()) {
              try {
                result.stdout?.toString();
              } catch (e) {
                // Expected - ignore errors
              }
            }

            if (randomBool()) {
              try {
                result.stderr?.toString();
              } catch (e) {
                // Expected - ignore errors
              }
            }
          }
        } catch (e) {
          // We expect many errors - that's fine
          // We're looking for crashes, not errors
          // Just make sure the error is an actual Error object
          if (!(e instanceof Error) && typeof e !== "string") {
            console.error("Unexpected error type:", typeof e, e);
            crashCount++;
          }
        }

        // Occasionally trigger GC
        if (i % 50 === 0) {
          gcTick();
        }
      } catch (e) {
        // Outer catch for anything really unexpected
        console.error("Outer catch - unexpected error in iteration", i, e);
        crashCount++;
      }
    }

    // If we get here without crashing, the test passed
    expect(crashCount).toBe(0);
  }, 120000); // 2 minute timeout

  test("fuzz spawn with rapid succession", async () => {
    // Spawn many processes rapidly to test race conditions
    const promises = [];

    for (let i = 0; i < 100; i++) {
      try {
        const proc = spawn({
          cmd: [bunExe(), "-e", "console.log('test')"],
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
        });

        promises.push(
          proc.exited.then(() => {
            // Clean up
          }),
        );

        // Sometimes kill immediately
        if (i % 3 === 0) {
          try {
            proc.kill();
          } catch (e) {
            // Ignore
          }
        }
      } catch (e) {
        // Expected - some spawns might fail
      }
    }

    // Wait for all to complete
    await Promise.allSettled(promises);

    gcTick();
  }, 30000);

  test("fuzz spawn with large stdin/stdout", async () => {
    const sizes = [0, 1, 100, 1000, 10000, 100000, 1000000];

    for (const size of sizes) {
      try {
        const data = new Uint8Array(size).fill(65); // Fill with 'A'

        const proc = spawn({
          cmd: [bunExe(), "-e", "await Bun.stdin.stream().pipeTo(Bun.stdout.stream())"],
          stdin: "pipe",
          stdout: "pipe",
          stderr: "ignore",
        });

        // Write data
        try {
          if (proc.stdin) {
            proc.stdin.write(data);
            proc.stdin.end();
          }
        } catch (e) {
          // Expected - might fail for large sizes
        }

        // Try to read - might timeout or fail
        try {
          const reader = proc.stdout.getReader();
          const chunks: Uint8Array[] = [];
          let totalSize = 0;

          const timeout = setTimeout(() => {
            try {
              proc.kill();
            } catch (e) {
              // Ignore
            }
          }, 5000);

          try {
            while (totalSize < size) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(value);
                totalSize += value.length;
              }
            }
          } finally {
            clearTimeout(timeout);
            reader.releaseLock();
          }
        } catch (e) {
          // Expected - might fail
        }

        // Clean up
        try {
          if (!proc.killed) {
            proc.kill();
          }
        } catch (e) {
          // Ignore
        }

        await proc.exited.catch(() => {});
      } catch (e) {
        // Expected - some tests might fail
      }

      gcTick();
    }
  }, 60000);

  test("fuzz spawn with invalid file descriptors", async () => {
    const invalidFds = [-1, -2, 999, 1000, 65535, 2147483647, -2147483648];

    for (const fd of invalidFds) {
      try {
        const proc = spawn({
          cmd: [bunExe(), "--version"],
          stdin: fd,
          stdout: "pipe",
          stderr: "pipe",
        });

        await proc.exited.catch(() => {});

        try {
          if (!proc.killed) {
            proc.kill();
          }
        } catch (e) {
          // Ignore
        }
      } catch (e) {
        // Expected - these should throw errors, not crash
      }
    }

    gcTick();
  });

  test("fuzz spawn with unicode and null bytes", async () => {
    const weirdStrings = [
      "\u0000",
      "test\u0000test",
      "\uFFFD",
      String.fromCharCode(0xd800),
      String.fromCharCode(0xdfff),
      "🚀🔥💀",
      "\x00\x01\x02\x03",
      "a".repeat(1000) + "\u0000" + "b".repeat(1000),
    ];

    for (const str of weirdStrings) {
      try {
        const proc = spawn({
          cmd: [bunExe(), "-e", `console.log(${JSON.stringify(str)})`],
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
        });

        await proc.exited.catch(() => {});

        try {
          if (!proc.killed) {
            proc.kill();
          }
        } catch (e) {
          // Ignore
        }
      } catch (e) {
        // Expected - might fail
      }
    }

    gcTick();
  });

  test("fuzz spawnSync with various edge cases", () => {
    const testCases = [
      // Empty cmd
      { cmd: [] },
      // Empty strings
      { cmd: ["", "", ""] },
      // Very long args
      { cmd: [bunExe(), "-e", "console.log(1)", ..."x".repeat(1000).split("")] },
      // Invalid cwd
      { cmd: [bunExe(), "--version"], cwd: "/this/path/definitely/does/not/exist" },
      // Null bytes in env
      { cmd: [bunExe(), "--version"], env: { TEST: "value\u0000test" } },
      // Large number of env vars
      {
        cmd: [bunExe(), "--version"],
        env: Object.fromEntries(
          Array(1000)
            .fill(0)
            .map((_, i) => [`VAR${i}`, `value${i}`]),
        ),
      },
    ];

    for (const testCase of testCases) {
      try {
        spawnSync(testCase as any);
      } catch (e) {
        // Expected - these should throw errors, not crash
      }
    }

    gcTick();
  });

  test("fuzz spawn with stream operations", async () => {
    // Test various stream edge cases
    for (let i = 0; i < 50; i++) {
      try {
        const proc = spawn({
          cmd: [bunExe(), "-e", "console.log('test'); console.error('error')"],
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
        });

        const operations = [
          () => proc.stdout.cancel(),
          () => proc.stderr.cancel(),
          () => proc.kill(),
          () => proc.stdout.getReader().cancel(),
          () => proc.stderr.getReader().cancel(),
          () => {
            const reader = proc.stdout.getReader();
            reader.releaseLock();
          },
        ];

        // Randomly execute operations
        const op = operations[Math.floor(Math.random() * operations.length)];
        try {
          op();
        } catch (e) {
          // Expected - operations might fail
        }

        // Clean up
        try {
          if (!proc.killed) {
            proc.kill();
          }
        } catch (e) {
          // Ignore
        }

        await proc.exited.catch(() => {});
      } catch (e) {
        // Expected - some tests might fail
      }
    }

    gcTick();
  });

  test("fuzz spawn kill with various signals", async () => {
    const signals: any[] = [
      0,
      1,
      2,
      9,
      15,
      -1,
      999,
      "SIGTERM",
      "SIGKILL",
      "SIGINT",
      "SIGHUP",
      "invalid",
      null,
      undefined,
      NaN,
      Infinity,
    ];

    for (const signal of signals) {
      try {
        const proc = spawn({
          cmd: [bunExe(), "-e", "await Bun.sleep(10000)"],
          stdout: "ignore",
          stderr: "ignore",
          stdin: "ignore",
        });

        await Bun.sleep(10); // Let it start

        try {
          proc.kill(signal);
        } catch (e) {
          // Expected - invalid signals should throw
        }

        await proc.exited.catch(() => {});
      } catch (e) {
        // Expected - some might fail
      }
    }

    gcTick();
  });
});
