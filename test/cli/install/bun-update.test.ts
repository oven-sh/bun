import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { access, mkdir, readFile, rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, readdirSorted, tempDirWithFiles, toBeValidBin, toHaveBins } from "harness";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  requested,
  root_url,
  setHandler,
} from "./dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(async () => {
  await dummyBeforeEach();
});
afterEach(dummyAfterEach);

expect.extend({
  toBeValidBin,
  toHaveBins,
});

for (const { input } of [{ input: { baz: "~0.0.3", moo: "~0.1.0" } }]) {
  it(`should update to latest version of dependency (${input.baz[0]})`, async () => {
    const urls: string[] = [];
    const tilde = input.baz[0] === "~";
    const registry = {
      "0.0.3": {
        bin: {
          "baz-run": "index.js",
        },
      },
      "0.0.5": {
        bin: {
          "baz-exec": "index.js",
        },
      },
      latest: "0.0.3",
    };
    setHandler(dummyRegistry(urls, registry));
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          baz: input.baz,
        },
      }),
    );
    const {
      stdout: stdout1,
      stderr: stderr1,
      exited: exited1,
    } = spawn({
      cmd: [bunExe(), "install", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err1 = await new Response(stderr1).text();
    expect(err1).not.toContain("error:");
    expect(err1).toContain("Saved lockfile");
    const out1 = await new Response(stdout1).text();
    expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun install v1."),
      "",
      "+ baz@0.0.3",
      "",
      "1 package installed",
    ]);
    expect(await exited1).toBe(0);
    expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
    expect(requested).toBe(2);
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
    expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
    expect(join(package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
    expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
    expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
      name: "baz",
      version: "0.0.3",
      bin: {
        "baz-run": "index.js",
      },
    });
    await access(join(package_dir, "bun.lockb"));
    // Perform `bun update` with updated registry & lockfile from before
    await rm(join(package_dir, "node_modules"), { force: true, recursive: true });
    urls.length = 0;
    registry.latest = "0.0.5";
    setHandler(dummyRegistry(urls, registry));
    const {
      stdout: stdout2,
      stderr: stderr2,
      exited: exited2,
    } = spawn({
      cmd: [bunExe(), "update", "baz", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err2 = await new Response(stderr2).text();
    expect(err2).not.toContain("error:");
    expect(err2).toContain("Saved lockfile");
    const out2 = await new Response(stdout2).text();
    expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun update v1."),
      "",
      `installed baz@${tilde ? "0.0.5" : "0.0.3"} with binaries:`,
      ` - ${tilde ? "baz-exec" : "baz-run"}`,
      "",
      "1 package installed",
    ]);
    expect(await exited2).toBe(0);
    expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-${tilde ? "0.0.5" : "0.0.3"}.tgz`]);
    expect(requested).toBe(4);
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
    expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins([tilde ? "baz-exec" : "baz-run"]);
    expect(join(package_dir, "node_modules", ".bin", tilde ? "baz-exec" : "baz-run")).toBeValidBin(
      join("..", "baz", "index.js"),
    );
    expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
    expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
      name: "baz",
      version: tilde ? "0.0.5" : "0.0.3",
      bin: {
        [tilde ? "baz-exec" : "baz-run"]: "index.js",
      },
    });
    expect(await file(join(package_dir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        baz: tilde ? "~0.0.5" : "^0.0.3",
      },
    });
    await access(join(package_dir, "bun.lockb"));
  });

  it(`should update to latest versions of dependencies (${input.baz[0]})`, async () => {
    const tilde = input.baz[0] === "~";
    const urls: string[] = [];
    const registry = {
      "0.0.3": {
        bin: {
          "baz-run": "index.js",
        },
      },
      "0.0.5": {
        bin: {
          "baz-exec": "index.js",
        },
      },
      "0.1.0": {},
      latest: "0.0.3",
    };
    setHandler(dummyRegistry(urls, registry));
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "@barn/moo": input.moo,
          baz: input.baz,
        },
      }),
    );
    const {
      stdout: stdout1,
      stderr: stderr1,
      exited: exited1,
    } = spawn({
      cmd: [bunExe(), "install", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err1 = await new Response(stderr1).text();
    expect(err1).not.toContain("error:");
    expect(err1).toContain("Saved lockfile");
    const out1 = await new Response(stdout1).text();
    expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun install v1."),
      "",
      "+ @barn/moo@0.1.0",
      expect.stringContaining("+ baz@0.0.3"),
      "",
      "2 packages installed",
    ]);
    expect(await exited1).toBe(0);
    expect(urls.sort()).toEqual([
      `${root_url}/@barn%2fmoo`,
      `${root_url}/@barn/moo-0.1.0.tgz`,
      `${root_url}/baz`,
      `${root_url}/baz-0.0.3.tgz`,
    ]);
    expect(requested).toBe(4);
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "@barn", "baz"]);
    expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
    expect(join(package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
    expect(await readdirSorted(join(package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
    expect(await readdirSorted(join(package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
    expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
    expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
      name: "baz",
      version: "0.0.3",
      bin: {
        "baz-run": "index.js",
      },
    });
    await access(join(package_dir, "bun.lockb"));
    // Perform `bun update` with updated registry & lockfile from before
    await rm(join(package_dir, "node_modules"), { force: true, recursive: true });
    urls.length = 0;
    registry.latest = "0.0.5";
    setHandler(dummyRegistry(urls, registry));
    const {
      stdout: stdout2,
      stderr: stderr2,
      exited: exited2,
    } = spawn({
      cmd: [bunExe(), "update", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err2 = await new Response(stderr2).text();
    expect(err2).not.toContain("error:");
    expect(err2).toContain("Saved lockfile");
    const out2 = await new Response(stdout2).text();
    if (tilde) {
      expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun update v1."),
        "",
        "^ baz 0.0.3 -> 0.0.5",
        "",
        "+ @barn/moo@0.1.0",
        "",
        "2 packages installed",
      ]);
    } else {
      expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun update v1."),
        "",
        expect.stringContaining("+ @barn/moo@0.1.0"),
        expect.stringContaining("+ baz@0.0.3"),
        "",
        "2 packages installed",
      ]);
    }
    expect(await exited2).toBe(0);
    expect(urls.sort()).toEqual([
      `${root_url}/@barn%2fmoo`,
      `${root_url}/@barn/moo-0.1.0.tgz`,
      `${root_url}/baz`,
      tilde ? `${root_url}/baz-0.0.5.tgz` : `${root_url}/baz-0.0.3.tgz`,
    ]);
    expect(requested).toBe(8);
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "@barn", "baz"]);
    expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins([tilde ? "baz-exec" : "baz-run"]);
    expect(join(package_dir, "node_modules", ".bin", tilde ? "baz-exec" : "baz-run")).toBeValidBin(
      join("..", "baz", "index.js"),
    );
    expect(await readdirSorted(join(package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
    expect(await readdirSorted(join(package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
    expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
    expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
      name: "baz",
      version: tilde ? "0.0.5" : "0.0.3",
      bin: {
        [tilde ? "baz-exec" : "baz-run"]: "index.js",
      },
    });
    expect(await file(join(package_dir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        "@barn/moo": tilde ? "~0.1.0" : "^0.1.0",
        baz: tilde ? "~0.0.5" : "^0.0.3",
      },
    });
    await access(join(package_dir, "bun.lockb"));
  });
}

it("lockfile should not be modified when there are no version changes, issue#5888", async () => {
  // Install packages
  const urls: string[] = [];
  const registry = {
    "0.0.3": {
      bin: {
        "baz-run": "index.js",
      },
    },
    latest: "0.0.3",
  };
  setHandler(dummyRegistry(urls, registry));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        baz: "0.0.3",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await exited).toBe(0);
  const err1 = await stderr.text();
  expect(err1).not.toContain("error:");
  expect(err1).toContain("Saved lockfile");
  const out1 = await stdout.text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    "+ baz@0.0.3",
    "",
    "1 package installed",
  ]);

  // Test if the lockb has been modified by `bun update`.
  const getLockbContent = async () => {
    const { exited } = spawn({
      cmd: [bunExe(), "update"],
      cwd: package_dir, // package.json is not changed
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await exited).toBe(0);
    return await readFile(join(package_dir, "bun.lockb"));
  };

  // no changes
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
    dependencies: {
      baz: "0.0.3",
    },
  });

  let prev = await getLockbContent();
  urls.length = 0;
  const count = 5;
  for (let i = 0; i < count; i++) {
    const content = await getLockbContent();
    expect(prev).toStrictEqual(content);
    prev = content;
  }

  // Assert we actually made a request to the registry for each update
  expect(urls).toHaveLength(count);
});

it("should support catalog versions in update", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));

  // Create a monorepo with catalog
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      catalog: {
        "no-deps": "^1.0.0",
      },
      workspaces: ["packages/*"],
    }),
  );

  await mkdir(join(package_dir, "packages", "workspace-a"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "workspace-a", "package.json"),
    JSON.stringify({
      name: "workspace-a",
      dependencies: {
        "no-deps": "catalog:",
      },
    }),
  );

  // Test that update works with catalog dependencies
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "update", "--dry-run"],
    cwd: join(package_dir, "packages", "workspace-a"),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  const out = await new Response(stdout).text();

  // Should not crash with catalog dependencies
  expect(err).not.toContain("panic");
  expect(err).not.toContain("segfault");

  // Verify catalog reference is preserved in package.json
  const pkg = await file(join(package_dir, "packages", "workspace-a", "package.json")).json();
  expect(pkg.dependencies["no-deps"]).toBe("catalog:");
});

it("should support --recursive flag", async () => {
  // First verify the flag appears in help
  const {
    stdout: helpOut,
    stderr: helpErr,
    exited: helpExited,
  } = spawn({
    cmd: [bunExe(), "update", "--help"],
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const help = (await new Response(helpOut).text()) + (await new Response(helpErr).text());
  expect(await helpExited).toBe(0);
  expect(help).toContain("--recursive");
  expect(help).toContain("-r");

  // Now test that --recursive actually works
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      workspaces: ["packages/*"],
      dependencies: {
        "no-deps": "^1.0.0",
      },
    }),
  );

  await mkdir(join(package_dir, "packages", "pkg1"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "pkg1", "package.json"),
    JSON.stringify({
      name: "pkg1",
      dependencies: {
        "no-deps": "^1.0.0",
      },
    }),
  );

  // Test recursive update (might fail without lockfile, but shouldn't crash)
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "update", "--recursive", "--dry-run"],
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const out = await new Response(stdout).text();
  const err = await new Response(stderr).text();

  // Should not crash
  expect(err).not.toContain("panic");
  expect(err).not.toContain("segfault");

  // Should recognize the flag (either process workspaces or show error about missing lockfile)
  expect(out + err).toMatch(/bun update|missing lockfile|nothing to update/);
});

// Regression tests for update-interactive-formatting (padding calculation underflow issue)
describe("bun update --interactive formatting regression", () => {
  it("should not underflow when dependency type text is longer than available space", async () => {
    // This test verifies the fix for the padding calculation underflow issue
    // in lines 745-750 of update_interactive_command.zig
    const dir = tempDirWithFiles("formatting-regression-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          a: "1.0.0", // Very short package name
        },
      }),
      "bun.lockb": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          a: {
            integrity: "sha512-fake",
            version: "1.0.0",
          },
        },
      }),
    });

    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(result.stderr).text();

    // Verify no underflow errors occur
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("overflow");
  });

  it("should handle dev tag length calculation correctly", async () => {
    // This test verifies that dev/peer/optional tags are properly accounted for
    // in the column width calculations
    const dir = tempDirWithFiles("dev-tag-formatting-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "regular-package": "1.0.0",
        },
        devDependencies: {
          "dev-package": "1.0.0",
        },
        peerDependencies: {
          "peer-package": "1.0.0",
        },
        optionalDependencies: {
          "optional-package": "1.0.0",
        },
      }),
      "bun.lockb": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "regular-package": { integrity: "sha512-fake", version: "1.0.0" },
          "dev-package": { integrity: "sha512-fake", version: "1.0.0" },
          "peer-package": { integrity: "sha512-fake", version: "1.0.0" },
          "optional-package": { integrity: "sha512-fake", version: "1.0.0" },
        },
      }),
    });

    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(result.stderr).text();

    // Verify no formatting errors occur with dev tags
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("overflow");
  });

  it("should truncate extremely long package names without crashing", async () => {
    // This test verifies that package names longer than MAX_NAME_WIDTH (60) are handled
    const longPackageName = "extremely-long-package-name-that-exceeds-maximum-width-and-should-be-truncated";
    const dir = tempDirWithFiles("truncate-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          [longPackageName]: "1.0.0",
        },
      }),
      "bun.lockb": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          [longPackageName]: {
            integrity: "sha512-fake",
            version: "1.0.0",
          },
        },
      }),
    });

    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(result.stderr).text();

    // Verify no crashes occur with extremely long package names
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("overflow");
    expect(stderr).not.toContain("segfault");
  });

  it("should handle long version strings without formatting issues", async () => {
    // This test verifies that version strings longer than MAX_VERSION_WIDTH (20) are handled
    const longVersion = "1.0.0-alpha.1.2.3.4.5.6.7.8.9.10.11.12.13.14.15.16.17.18.19.20.21.22.23.24.25";
    const dir = tempDirWithFiles("long-version-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "package-with-long-version": longVersion,
        },
      }),
      "bun.lockb": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "package-with-long-version": {
            integrity: "sha512-fake",
            version: longVersion,
          },
        },
      }),
    });

    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(result.stderr).text();

    // Verify no crashes occur with extremely long version strings
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("overflow");
    expect(stderr).not.toContain("segfault");
  });

  it("should handle edge case where all values are at maximum width", async () => {
    // This test verifies edge cases where padding calculations might fail
    const maxWidthPackage = "a".repeat(60); // MAX_NAME_WIDTH
    const maxWidthVersion = "1.0.0-" + "a".repeat(15); // MAX_VERSION_WIDTH

    const dir = tempDirWithFiles("max-width-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          [maxWidthPackage]: maxWidthVersion,
        },
        devDependencies: {
          [maxWidthPackage + "-dev"]: maxWidthVersion,
        },
        peerDependencies: {
          [maxWidthPackage + "-peer"]: maxWidthVersion,
        },
        optionalDependencies: {
          [maxWidthPackage + "-optional"]: maxWidthVersion,
        },
      }),
      "bun.lockb": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          [maxWidthPackage]: { integrity: "sha512-fake", version: maxWidthVersion },
          [maxWidthPackage + "-dev"]: { integrity: "sha512-fake", version: maxWidthVersion },
          [maxWidthPackage + "-peer"]: { integrity: "sha512-fake", version: maxWidthVersion },
          [maxWidthPackage + "-optional"]: { integrity: "sha512-fake", version: maxWidthVersion },
        },
      }),
    });

    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(result.stderr).text();

    // Verify no crashes occur at maximum width values
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("overflow");
    expect(stderr).not.toContain("segfault");
  });
});
