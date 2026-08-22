// https://github.com/oven-sh/bun/issues/18906
// Changing only a workspace's "version" in its package.json must be written to bun.lock by the
// next `bun install`, and the install after that must see no changes.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Every case below runs three or four `bun install`s back to back, concurrently with its siblings.
setDefaultTimeout(30_000);

function project(prefix: string, pkgA: Record<string, unknown>) {
  return tempDir(prefix, {
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    "packages/pkg-a/package.json": JSON.stringify(pkgA),
    "packages/pkg-b/package.json": JSON.stringify({
      name: "pkg-b",
      version: "1.0.0",
      dependencies: { "pkg-a": "workspace:*" },
    }),
  });
}

async function install(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  return { stdout, stderr };
}

async function installSavesLockfile(cwd: string, ...args: string[]) {
  const { stderr } = await install(cwd, ...args);
  expect(stderr).toContain("Saved lockfile");
}

async function installIsNoop(cwd: string, ...args: string[]) {
  const { stdout, stderr } = await install(cwd, ...args);
  expect(stderr).not.toContain("Saved lockfile");
  expect(stdout).toContain("no changes");
}

function lockfile(cwd: string) {
  return Bun.file(join(cwd, "bun.lock")).text();
}

function setPkgA(cwd: string, pkgA: Record<string, unknown>) {
  return Bun.write(join(cwd, "packages", "pkg-a", "package.json"), JSON.stringify(pkgA));
}

describe.concurrent("bun.lock tracks workspace package.json versions", () => {
  for (const linker of ["isolated", "hoisted"]) {
    test(`version bump is written once (--linker=${linker})`, async () => {
      using dir = project(`issue-18906-${linker}`, { name: "pkg-a", version: "1.0.0" });
      const cwd = String(dir);

      await installSavesLockfile(cwd, `--linker=${linker}`);
      expect(await lockfile(cwd)).toMatchInlineSnapshot(`
        "{
          "lockfileVersion": 2,
          "configVersion": 1,
          "workspaces": {
            "": {
              "name": "root",
            },
            "packages/pkg-a": {
              "name": "pkg-a",
              "version": "1.0.0",
            },
            "packages/pkg-b": {
              "name": "pkg-b",
              "version": "1.0.0",
              "dependencies": {
                "pkg-a": "workspace:*",
              },
            },
          },
          "packages": {
            "pkg-a": ["pkg-a@workspace:packages/pkg-a"],

            "pkg-b": ["pkg-b@workspace:packages/pkg-b"],
          }
        }
        "
      `);

      await setPkgA(cwd, { name: "pkg-a", version: "2.0.0" });
      await installSavesLockfile(cwd, `--linker=${linker}`);
      expect(await lockfile(cwd)).toMatchInlineSnapshot(`
        "{
          "lockfileVersion": 2,
          "configVersion": 1,
          "workspaces": {
            "": {
              "name": "root",
            },
            "packages/pkg-a": {
              "name": "pkg-a",
              "version": "2.0.0",
            },
            "packages/pkg-b": {
              "name": "pkg-b",
              "version": "1.0.0",
              "dependencies": {
                "pkg-a": "workspace:*",
              },
            },
          },
          "packages": {
            "pkg-a": ["pkg-a@workspace:packages/pkg-a"],

            "pkg-b": ["pkg-b@workspace:packages/pkg-b"],
          }
        }
        "
      `);

      await installIsNoop(cwd, `--linker=${linker}`);
    });
  }

  test("version bump with --lockfile-only", async () => {
    using dir = project("issue-18906-lockfile-only", { name: "pkg-a", version: "1.0.0" });
    const cwd = String(dir);

    await installSavesLockfile(cwd);
    await setPkgA(cwd, { name: "pkg-a", version: "2.0.0" });
    await installSavesLockfile(cwd, "--lockfile-only");
    expect(await lockfile(cwd)).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "root",
          },
          "packages/pkg-a": {
            "name": "pkg-a",
            "version": "2.0.0",
          },
          "packages/pkg-b": {
            "name": "pkg-b",
            "version": "1.0.0",
            "dependencies": {
              "pkg-a": "workspace:*",
            },
          },
        },
        "packages": {
          "pkg-a": ["pkg-a@workspace:packages/pkg-a"],

          "pkg-b": ["pkg-b@workspace:packages/pkg-b"],
        }
      }
      "
    `);

    await installIsNoop(cwd);
  });

  test("build metadata change is written once", async () => {
    using dir = project("issue-18906-build", { name: "pkg-a", version: "1.0.0+build.1" });
    const cwd = String(dir);

    await installSavesLockfile(cwd);
    await setPkgA(cwd, { name: "pkg-a", version: "1.0.0+build.2" });
    await installSavesLockfile(cwd);
    expect(await lockfile(cwd)).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "root",
          },
          "packages/pkg-a": {
            "name": "pkg-a",
            "version": "1.0.0+build.2",
          },
          "packages/pkg-b": {
            "name": "pkg-b",
            "version": "1.0.0",
            "dependencies": {
              "pkg-a": "workspace:*",
            },
          },
        },
        "packages": {
          "pkg-a": ["pkg-a@workspace:packages/pkg-a"],

          "pkg-b": ["pkg-b@workspace:packages/pkg-b"],
        }
      }
      "
    `);

    await installIsNoop(cwd);
  });

  test("prerelease change is written once", async () => {
    using dir = project("issue-18906-pre", { name: "pkg-a", version: "1.0.0" });
    const cwd = String(dir);

    await installSavesLockfile(cwd);
    await setPkgA(cwd, { name: "pkg-a", version: "1.0.0-beta.1+build.7" });
    await installSavesLockfile(cwd);
    expect(await lockfile(cwd)).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "root",
          },
          "packages/pkg-a": {
            "name": "pkg-a",
            "version": "1.0.0-beta.1+build.7",
          },
          "packages/pkg-b": {
            "name": "pkg-b",
            "version": "1.0.0",
            "dependencies": {
              "pkg-a": "workspace:*",
            },
          },
        },
        "packages": {
          "pkg-a": ["pkg-a@workspace:packages/pkg-a"],

          "pkg-b": ["pkg-b@workspace:packages/pkg-b"],
        }
      }
      "
    `);

    await setPkgA(cwd, { name: "pkg-a", version: "1.0.0-beta.2+build.7" });
    await installSavesLockfile(cwd);
    expect(await lockfile(cwd)).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "root",
          },
          "packages/pkg-a": {
            "name": "pkg-a",
            "version": "1.0.0-beta.2+build.7",
          },
          "packages/pkg-b": {
            "name": "pkg-b",
            "version": "1.0.0",
            "dependencies": {
              "pkg-a": "workspace:*",
            },
          },
        },
        "packages": {
          "pkg-a": ["pkg-a@workspace:packages/pkg-a"],

          "pkg-b": ["pkg-b@workspace:packages/pkg-b"],
        }
      }
      "
    `);

    await installIsNoop(cwd);
  });

  // "1.0.0-" parses with an empty prerelease identifier, which bun.lock writes back as "1.0.0".
  // Reinstalling must not treat the two spellings as a change.
  test("empty prerelease identifier does not cause a rewrite on every install", async () => {
    using dir = project("issue-18906-empty-pre", { name: "pkg-a", version: "1.0.0-" });
    const cwd = String(dir);

    await installSavesLockfile(cwd);
    expect(await lockfile(cwd)).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "root",
          },
          "packages/pkg-a": {
            "name": "pkg-a",
            "version": "1.0.0",
          },
          "packages/pkg-b": {
            "name": "pkg-b",
            "version": "1.0.0",
            "dependencies": {
              "pkg-a": "workspace:*",
            },
          },
        },
        "packages": {
          "pkg-a": ["pkg-a@workspace:packages/pkg-a"],

          "pkg-b": ["pkg-b@workspace:packages/pkg-b"],
        }
      }
      "
    `);

    await installIsNoop(cwd);
  });

  test("adding a version is written once", async () => {
    using dir = project("issue-18906-add", { name: "pkg-a" });
    const cwd = String(dir);

    await installSavesLockfile(cwd);
    expect(await lockfile(cwd)).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "root",
          },
          "packages/pkg-a": {
            "name": "pkg-a",
          },
          "packages/pkg-b": {
            "name": "pkg-b",
            "version": "1.0.0",
            "dependencies": {
              "pkg-a": "workspace:*",
            },
          },
        },
        "packages": {
          "pkg-a": ["pkg-a@workspace:packages/pkg-a"],

          "pkg-b": ["pkg-b@workspace:packages/pkg-b"],
        }
      }
      "
    `);

    await setPkgA(cwd, { name: "pkg-a", version: "1.0.0" });
    await installSavesLockfile(cwd);
    expect(await lockfile(cwd)).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "root",
          },
          "packages/pkg-a": {
            "name": "pkg-a",
            "version": "1.0.0",
          },
          "packages/pkg-b": {
            "name": "pkg-b",
            "version": "1.0.0",
            "dependencies": {
              "pkg-a": "workspace:*",
            },
          },
        },
        "packages": {
          "pkg-a": ["pkg-a@workspace:packages/pkg-a"],

          "pkg-b": ["pkg-b@workspace:packages/pkg-b"],
        }
      }
      "
    `);

    await installIsNoop(cwd);
  });

  test("removing a version is written once", async () => {
    using dir = project("issue-18906-remove", { name: "pkg-a", version: "1.0.0" });
    const cwd = String(dir);

    await installSavesLockfile(cwd);
    await setPkgA(cwd, { name: "pkg-a" });
    await installSavesLockfile(cwd);
    expect(await lockfile(cwd)).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 2,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "root",
          },
          "packages/pkg-a": {
            "name": "pkg-a",
          },
          "packages/pkg-b": {
            "name": "pkg-b",
            "version": "1.0.0",
            "dependencies": {
              "pkg-a": "workspace:*",
            },
          },
        },
        "packages": {
          "pkg-a": ["pkg-a@workspace:packages/pkg-a"],

          "pkg-b": ["pkg-b@workspace:packages/pkg-b"],
        }
      }
      "
    `);

    await installIsNoop(cwd);
  });
});
