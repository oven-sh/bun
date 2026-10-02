import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("console depth", () => {
  const deepObject = {
    level1: {
      level2: {
        level3: {
          level4: {
            level5: {
              level6: {
                level7: {
                  level8: {
                    level9: {
                      level10: "deep value",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  const testScript = `console.log(${JSON.stringify(deepObject)});`;

  function normalizeOutput(output: string): string {
    // Normalize line endings and trim whitespace
    return output.replace(/\r\n?/g, "\n").trim();
  }

  test("default console depth should be 2", async () => {
    await using dir = tempDir("console-depth-default", {
      "test.js": testScript,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(normalizeOutput(stdout)).toMatchInlineSnapshot(`
"{
  level1: {
    level2: {
      level3: [Object ...],
    },
  },
}"
`);
  });

  test("--console-depth flag sets custom depth", async () => {
    await using dir = tempDir("console-depth-cli", {
      "test.js": testScript,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--console-depth", "3", "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(normalizeOutput(stdout)).toMatchInlineSnapshot(`
"{
  level1: {
    level2: {
      level3: {
        level4: [Object ...],
      },
    },
  },
}"
`);
  });

  test("--console-depth with higher value shows deeper nesting", async () => {
    await using dir = tempDir("console-depth-high", {
      "test.js": testScript,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--console-depth", "10", "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(normalizeOutput(stdout)).toMatchInlineSnapshot(`
"{
  level1: {
    level2: {
      level3: {
        level4: {
          level5: {
            level6: {
              level7: {
                level8: {
                  level9: {
                    level10: \"deep value\",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}"
`);
  });

  test("bunfig.toml console.depth configuration", async () => {
    await using dir = tempDir("console-depth-bunfig", {
      "test.js": testScript,
      "bunfig.toml": `[console]\ndepth = 4`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(normalizeOutput(stdout)).toMatchInlineSnapshot(`
"{
  level1: {
    level2: {
      level3: {
        level4: {
          level5: [Object ...],
        },
      },
    },
  },
}"
`);
  });

  test("CLI flag overrides bunfig.toml", async () => {
    await using dir = tempDir("console-depth-override", {
      "test.js": testScript,
      "bunfig.toml": `[console]\ndepth = 6`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--console-depth", "2", "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(normalizeOutput(stdout)).toMatchInlineSnapshot(`
"{
  level1: {
    level2: {
      level3: [Object ...],
    },
  },
}"
`);
  });

  test("invalid --console-depth value shows error", async () => {
    await using dir = tempDir("console-depth-invalid", {
      "test.js": testScript,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--console-depth", "invalid", "test.js"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(1);
    const allOutput = normalizeOutput(stdout + stderr);
    expect(allOutput).toMatchInlineSnapshot(
      `"error: Invalid value for --console-depth: \"invalid\". Must be a positive integer"`,
    );
  });

  test("edge case: depth 0 should show infinite depth", async () => {
    await using dir = tempDir("console-depth-zero", {
      "test.js": testScript,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--console-depth", "0", "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(normalizeOutput(stdout)).toMatchInlineSnapshot(`
"{
  level1: {
    level2: {
      level3: {
        level4: {
          level5: {
            level6: {
              level7: {
                level8: {
                  level9: {
                    level10: \"deep value\",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}"
`);
  });

  test("bunfig.toml depth=0 should show infinite depth", async () => {
    await using dir = tempDir("console-depth-bunfig-zero", {
      "test.js": testScript,
      "bunfig.toml": `[console]\ndepth = 0`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(normalizeOutput(stdout)).toMatchInlineSnapshot(`
"{
  level1: {
    level2: {
      level3: {
        level4: {
          level5: {
            level6: {
              level7: {
                level8: {
                  level9: {
                    level10: \"deep value\",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}"
`);
  });

  test("console depth affects console.log, console.error, and console.warn", async () => {
    const testScriptMultiple = `
      const obj = ${JSON.stringify(deepObject)};
      console.log("LOG:", obj);
      console.error("ERROR:", obj);
      console.warn("WARN:", obj);
    `;

    await using dir = tempDir("console-depth-multiple", {
      "test.js": testScriptMultiple,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--console-depth", "2", "test.js"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(normalizeOutput(stdout + stderr)).toMatchInlineSnapshot(`
"LOG: {
  level1: {
    level2: {
      level3: [Object ...],
    },
  },
}
ERROR: {
  level1: {
    level2: {
      level3: [Object ...],
    },
  },
}
WARN: {
  level1: {
    level2: {
      level3: [Object ...],
    },
  },
}"
`);
  });
});
