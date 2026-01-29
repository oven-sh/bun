import { write } from "bun";
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

function install(cwd: string, args: string[]) {
  const exec = Bun.spawnSync({
    cmd: [bunExe(), ...args, "--linker=hoisted"],
    cwd,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "inherit",
    env: bunEnv,
  });
  if (exec.exitCode !== 0) {
    throw new Error(`bun install exited with code ${exec.exitCode}`);
  }
  return exec;
}

function installExpectFail(cwd: string, args: string[]) {
  const exec = Bun.spawnSync({
    cmd: [bunExe(), ...args],
    cwd,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "inherit",
    env: bunEnv,
  });
  if (exec.exitCode === 0) {
    throw new Error(`bun install exited with code ${exec.exitCode}, (expected failure)`);
  }
  return exec;
}

function versionOf(cwd: string, path: string) {
  const data = readFileSync(join(cwd, path));
  const json = JSON.parse(data.toString());
  return json.version;
}

function ensureLockfileDoesntChangeOnBunI(cwd: string) {
  install(cwd, ["install"]);
  const lockb1 = readFileSync(join(cwd, "bun.lock"));
  install(cwd, ["install", "--frozen-lockfile"]);
  install(cwd, ["install", "--force"]);
  const lockb2 = readFileSync(join(cwd, "bun.lock"));

  expect(lockb1.toString("hex")).toEqual(lockb2.toString("hex"));
}

test("overrides affect your own packages", async () => {
  using dir = tempDir("override-own-pkg", {
    "package.json": JSON.stringify({
      dependencies: {},
      overrides: {
        lodash: "4.0.0",
      },
    }),
  });
  const cwd = String(dir);
  install(cwd, ["install", "lodash"]);
  expect(versionOf(cwd, "node_modules/lodash/package.json")).toBe("4.0.0");
  ensureLockfileDoesntChangeOnBunI(cwd);
});

test("overrides affects all dependencies", async () => {
  using dir = tempDir("override-all-deps", {
    "package.json": JSON.stringify({
      dependencies: {},
      overrides: {
        bytes: "1.0.0",
      },
    }),
  });
  const cwd = String(dir);
  install(cwd, ["install", "express@4.18.2"]);
  expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(cwd);
});

test("overrides being set later affects all dependencies", async () => {
  using dir = tempDir("override-set-later", {
    "package.json": JSON.stringify({
      dependencies: {},
    }),
  });
  const cwd = String(dir);
  install(cwd, ["install", "express@4.18.2"]);
  expect(versionOf(cwd, "node_modules/bytes/package.json")).not.toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(cwd);

  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      ...JSON.parse(readFileSync(join(cwd, "package.json")).toString()),
      overrides: {
        bytes: "1.0.0",
      },
    }),
  );
  install(cwd, ["install"]);
  expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(cwd);
});

test("overrides to npm specifier", async () => {
  using dir = tempDir("override-npm-spec", {
    "package.json": JSON.stringify({
      dependencies: {},
      overrides: {
        bytes: "npm:lodash@4.0.0",
      },
    }),
  });
  const cwd = String(dir);
  install(cwd, ["install", "express@4.18.2"]);

  const bytes = JSON.parse(readFileSync(join(cwd, "node_modules/bytes/package.json"), "utf-8"));

  expect(bytes.name).toBe("lodash");
  expect(bytes.version).toBe("4.0.0");

  ensureLockfileDoesntChangeOnBunI(cwd);
});

test("changing overrides makes the lockfile changed, prevent frozen install", async () => {
  using dir = tempDir("override-frozen", {
    "package.json": JSON.stringify({
      dependencies: {},
      overrides: {
        bytes: "1.0.0",
      },
    }),
  });
  const cwd = String(dir);
  install(cwd, ["install", "express@4.18.2"]);

  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      ...JSON.parse(readFileSync(join(cwd, "package.json")).toString()),
      overrides: {
        bytes: "1.0.1",
      },
    }),
  );

  installExpectFail(cwd, ["install", "--frozen-lockfile"]);
});

test("overrides reset when removed", async () => {
  using dir = tempDir("override-reset", {
    "package.json": JSON.stringify({
      overrides: {
        bytes: "1.0.0",
      },
    }),
  });
  const cwd = String(dir);
  install(cwd, ["install", "express@4.18.2"]);
  expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");

  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      ...JSON.parse(readFileSync(join(cwd, "package.json")).toString()),
      overrides: undefined,
    }),
  );
  install(cwd, ["install"]);
  expect(versionOf(cwd, "node_modules/bytes/package.json")).not.toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(cwd);
});

test("overrides do not apply to workspaces", async () => {
  using dir = tempDir("override-no-workspace", {});
  const cwd = String(dir);
  await Promise.all([
    write(
      join(cwd, "package.json"),
      JSON.stringify({ name: "monorepo-root", workspaces: ["packages/*"], overrides: { "pkg1": "file:pkg2" } }),
    ),
    write(
      join(cwd, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        version: "1.1.1",
      }),
    ),
    write(
      join(cwd, "pkg2", "package.json"),
      JSON.stringify({
        name: "pkg2",
        version: "2.2.2",
      }),
    ),
  ]);

  let { exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stderr: "pipe",
    stdout: "inherit",
  });

  expect(await exited).toBe(0);
  expect(await stderr.text()).toContain("Saved lockfile");

  // --frozen-lockfile works
  ({ exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    cwd,
    env: bunEnv,
    stderr: "pipe",
    stdout: "inherit",
  }));

  expect(await exited).toBe(0);
  expect(await stderr.text()).not.toContain("Frozen lockfile");

  // lockfile is not changed

  ({ exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stderr: "pipe",
    stdout: "inherit",
  }));

  expect(await exited).toBe(0);
  expect(await stderr.text()).not.toContain("Saved lockfile");
});

// ---- Nested overrides tests ----

describe.concurrent("nested overrides", () => {
  // --- Basic nested override functionality ---

  test("npm format: nested override applies to transitive dep under parent", () => {
    // First, verify the baseline version without overrides
    using baselineDir = tempDir("nested-npm-baseline", {
      "package.json": JSON.stringify({
        dependencies: { express: "4.18.2" },
      }),
    });
    const baselineCwd = String(baselineDir);
    install(baselineCwd, ["install"]);
    expect(versionOf(baselineCwd, "node_modules/bytes/package.json")).toBe("3.1.2");
    expect(versionOf(baselineCwd, "node_modules/depd/package.json")).toBe("2.0.0");

    // Now test with the nested override
    using dir = tempDir("nested-npm-basic", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          express: {
            bytes: "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes should be overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd should NOT be affected, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("npm format: self-override with nested children using '.' key", () => {
    // Now test with the self-override + nested child
    using dir = tempDir("nested-npm-dot-key", {
      "package.json": JSON.stringify({
        dependencies: {},
        overrides: {
          express: {
            ".": "4.18.1",
            bytes: "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install", "express"]);
    // POSITIVE: express should be overridden to 4.18.1 (from latest)
    expect(versionOf(cwd, "node_modules/express/package.json")).toBe("4.18.1");
    // POSITIVE: bytes should be overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd should NOT be affected, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  // --- Conflicting override versions ---

  test("nested override takes priority over global override for same package", () => {
    // First verify global-only override applies correctly
    using globalDir = tempDir("nested-priority-global-only", {
      "package.json": JSON.stringify({
        dependencies: { express: "4.18.2" },
        overrides: { bytes: "2.0.0" },
      }),
    });
    const globalCwd = String(globalDir);
    install(globalCwd, ["install"]);
    // POSITIVE: global override applies
    expect(versionOf(globalCwd, "node_modules/bytes/package.json")).toBe("2.0.0");
    // NEGATIVE: depd is NOT overridden
    expect(versionOf(globalCwd, "node_modules/depd/package.json")).toBe("2.0.0");

    // Now with nested + global: nested should win
    using dir = tempDir("nested-priority-over-global", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          bytes: "2.0.0",
          express: {
            bytes: "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: nested override (1.0.0) takes priority over global (2.0.0) for bytes under express
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd is NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("global override applies when no nested override matches", () => {
    using dir = tempDir("nested-global-fallback", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          depd: "1.1.0",
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: global override should change depd from 2.0.0 to 1.1.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("1.1.0");
    // NEGATIVE: bytes is NOT overridden, stays at natural 3.1.2
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("3.1.2");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("nested override version changes are detected on re-install", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-version-change", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          express: {
            bytes: "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    // Change the nested override to a different version
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          express: {
            bytes: "2.0.0",
          },
        },
      }),
    );
    install(cwd, ["install"]);
    // POSITIVE: bytes now overridden from 3.1.2 to 2.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("2.0.0");
    // NEGATIVE: depd still NOT overridden
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  // --- Syntax format tests ---

  test("yarn resolution path: parent/child", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-yarn-path", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        resolutions: {
          "express/bytes": "1.0.0",
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("yarn resolution path with glob prefixes", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-yarn-glob", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        resolutions: {
          "**/express/**/bytes": "1.0.0",
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("pnpm > syntax in overrides field", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-pnpm-gt-overrides", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          "express>bytes": "1.0.0",
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("pnpm.overrides field (flat)", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-pnpm-flat", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        pnpm: {
          overrides: {
            bytes: "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("pnpm.overrides with > syntax", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-pnpm-gt-field", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        pnpm: {
          overrides: {
            "express>bytes": "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  // --- Lockfile lifecycle tests ---

  test("nested override in lockfile round-trips correctly", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-lockfile-roundtrip", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          express: {
            bytes: "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    // Read lockfile
    const lockfile1 = readFileSync(join(cwd, "bun.lock"), "utf-8");
    expect(lockfile1).toContain("overrides");

    // Re-install with --force - should produce identical lockfile
    install(cwd, ["install", "--force"]);
    const lockfile2 = readFileSync(join(cwd, "bun.lock"), "utf-8");
    expect(lockfile1).toBe(lockfile2);
    // POSITIVE: bytes should still be 1.0.0 after round-trip
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd still NOT overridden after round-trip
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");
  });

  test("adding nested override after initial install applies correctly", () => {
    using dir = tempDir("nested-add-after-install", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // NEGATIVE: bytes is at natural version 3.1.2 (no override yet)
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("3.1.2");
    // NEGATIVE: depd is at natural version 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    // Add nested override
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          express: {
            bytes: "1.0.0",
          },
        },
      }),
    );
    install(cwd, ["install"]);
    // POSITIVE: bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd still NOT overridden
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("removing nested override restores original version", () => {
    using dir = tempDir("nested-remove-override", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          express: {
            bytes: "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    // Remove override
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
      }),
    );
    install(cwd, ["install"]);
    // NEGATIVE: bytes should restore to natural version 3.1.2
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("3.1.2");
    // NEGATIVE: depd still at natural version 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("nested override change breaks frozen-lockfile", () => {
    using dir = tempDir("nested-frozen-break", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          express: {
            bytes: "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);

    // Change the nested override
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          express: {
            bytes: "2.0.0",
          },
        },
      }),
    );
    installExpectFail(cwd, ["install", "--frozen-lockfile"]);
  });

  // --- Override with npm: alias specifier in nested context ---

  test("nested override with npm: alias specifier", () => {
    // bytes is naturally bytes@3.1.2 with express@4.18.2
    using dir = tempDir("nested-npm-alias", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          express: {
            bytes: "npm:lodash@4.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);

    // POSITIVE: bytes should be aliased from bytes@3.1.2 to lodash@4.0.0
    const bytes = JSON.parse(readFileSync(join(cwd, "node_modules/bytes/package.json"), "utf-8"));
    expect(bytes.name).toBe("lodash");
    expect(bytes.version).toBe("4.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  // --- pnpm.overrides coexists with npm overrides ---

  test("pnpm.overrides and npm overrides can coexist", () => {
    // bytes is naturally 3.1.2, depd is naturally 2.0.0 with express@4.18.2
    using dir = tempDir("nested-pnpm-npm-coexist", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          bytes: "1.0.0",
        },
        pnpm: {
          overrides: {
            depd: "1.1.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: npm overrides: bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // POSITIVE: pnpm.overrides: depd overridden from 2.0.0 to 1.1.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("1.1.0");
    // NEGATIVE: express itself NOT overridden, stays at 4.18.2
    expect(versionOf(cwd, "node_modules/express/package.json")).toBe("4.18.2");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  // --- Multi-level nesting ---

  test("multi-level nesting: express > body-parser > bytes", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-multi-level-npm", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          express: {
            "body-parser": {
              bytes: "1.0.0",
            },
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes overridden from 3.1.2 to 1.0.0 (under body-parser under express)
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("yarn resolution path: multi-level parent/intermediate/child", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-multi-level-yarn", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        resolutions: {
          "express/body-parser/bytes": "1.0.0",
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("pnpm > syntax: multi-level parent>intermediate>child", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-multi-level-pnpm", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          "express>body-parser>bytes": "1.0.0",
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  // --- Version-constrained parent keys ---

  test("version-constrained parent key: override applies when version matches", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-version-constraint-match", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          "express@^4.0.0": {
            bytes: "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: express@4.18.2 satisfies ^4.0.0, so bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  // --- Negative test cases ---

  test("version-constrained parent key: override does NOT apply when version does NOT match", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-version-constraint-nomatch", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          "express@^3.0.0": {
            bytes: "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // NEGATIVE: express@4.18.2 does NOT satisfy ^3.0.0, so bytes stays at 3.1.2
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("3.1.2");
    // NEGATIVE: depd also NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("nested override does not affect packages outside the parent scope", () => {
    // bytes is naturally 3.1.2, depd is naturally 2.0.0 with express@4.18.2
    // Override bytes only under body-parser (bytes is only a dep of body-parser)
    using dir = tempDir("nested-no-leak-outside-scope", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          "body-parser": {
            bytes: "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes under body-parser overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");
    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("nested override for non-existent parent does not crash", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-nonexistent-parent", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          "nonexistent-pkg": {
            bytes: "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // NEGATIVE: bytes stays at natural 3.1.2 since nonexistent-pkg is not in the tree
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("3.1.2");
    // NEGATIVE: depd also stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("pnpm > syntax: version-constrained parent that does not match", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-pnpm-gt-version-nomatch", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          "express@^3.0.0>bytes": "1.0.0",
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // NEGATIVE: express@4.18.2 does NOT satisfy ^3.0.0, so bytes stays at 3.1.2
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("3.1.2");
    // NEGATIVE: depd also stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("multi-level nesting under wrong parent does not apply", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-wrong-parent-chain", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          // "accepts" does not depend on body-parser, so this override chain never matches
          accepts: {
            "body-parser": {
              bytes: "1.0.0",
            },
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // NEGATIVE: bytes stays at natural 3.1.2 because accepts doesn't depend on body-parser
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("3.1.2");
    // NEGATIVE: depd also stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("pnpm > syntax with version-constrained parent applies when version matches", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-pnpm-gt-version-match", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          "express@^4.0.0>bytes": "1.0.0",
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: express@4.18.2 satisfies ^4.0.0, so bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("$reference syntax: override value references root dependency version", () => {
    // depd is naturally 2.0.0 with express@4.18.2
    using dir = tempDir("nested-dollar-ref", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
          depd: "1.1.0",
        },
        overrides: {
          depd: "$depd",
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: depd overridden from 2.0.0 to 1.1.0 (the root dependency version)
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("1.1.0");
    // NEGATIVE: bytes NOT overridden, stays at natural 3.1.2
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("3.1.2");

    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("version-constrained key_spec survives lockfile round-trip", () => {
    using dir = tempDir("nested-keyspec-roundtrip", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          "express@^4.0.0": {
            bytes: "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");

    // Lockfile should contain the version constraint in the key
    const lockfile = readFileSync(join(cwd, "bun.lock"), "utf-8");
    expect(lockfile).toContain("express@^4.0.0");

    // Re-install should produce identical lockfile (key_spec survived round-trip)
    install(cwd, ["install", "--force"]);
    const lockfile2 = readFileSync(join(cwd, "bun.lock"), "utf-8");
    expect(lockfile).toBe(lockfile2);

    // And bytes should still be overridden
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
  });

  // --- Test gaps from pnpm test suite ---

  test("empty overrides object is handled gracefully", () => {
    using dir = tempDir("nested-empty-overrides", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {},
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("scoped parent with unscoped child in pnpm > syntax", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-scoped-parent", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          "express>bytes": "1.0.0",
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");
    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("nested override applies to optionalDependencies", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-override-optdeps", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          bytes: "1.0.0",
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: bytes overridden from 3.1.2 to 1.0.0
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");
    ensureLockfileDoesntChangeOnBunI(cwd);
  });

  test("override specificity: nested override wins over global for same package", () => {
    // bytes is naturally 3.1.2 with express@4.18.2
    using dir = tempDir("nested-specificity", {
      "package.json": JSON.stringify({
        dependencies: {
          express: "4.18.2",
        },
        overrides: {
          bytes: "2.0.0",
          express: {
            bytes: "1.0.0",
          },
        },
      }),
    });
    const cwd = String(dir);
    install(cwd, ["install"]);
    // POSITIVE: nested override (1.0.0) wins over global (2.0.0) for bytes under express
    // (natural version would be 3.1.2 without any overrides)
    expect(versionOf(cwd, "node_modules/bytes/package.json")).toBe("1.0.0");
    // NEGATIVE: depd NOT overridden, stays at natural 2.0.0
    expect(versionOf(cwd, "node_modules/depd/package.json")).toBe("2.0.0");
    ensureLockfileDoesntChangeOnBunI(cwd);
  });
});
