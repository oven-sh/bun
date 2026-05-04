import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, setDefaultTimeout } from "bun:test";
import { access, exists, mkdir, readFile, rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, readdirSorted, toBeValidBin, toHaveBins } from "harness";
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

// ASAN + slow CI filesystems can push individual install spawns past the
// default 5s timeout. `setDefaultTimeout` is read at `it()` call time, so it
// must run during module load (before the `it()` declarations below), not
// inside `beforeAll`. Match the convention other install test files use.
setDefaultTimeout(1000 * 60 * 5);
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

// https://github.com/oven-sh/bun/issues/29793
it("hoisted install removes stale workspace-local node_modules that shadow the hoisted version", async () => {
  const registry = {
    "0.0.3": {},
    "0.0.5": {},
    latest: "0.0.5",
  };
  setHandler(dummyRegistry([], registry));

  // Root workspace — declares the workspace, no deps.
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/backend"],
    }),
  );

  // Backend workspace depends on baz.
  await mkdir(join(package_dir, "packages", "backend"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "backend", "package.json"),
    JSON.stringify({
      name: "@repro/backend",
      dependencies: { baz: "^0.0.3" },
    }),
  );

  // Pre-existing stale workspace-local package, simulating what an earlier
  // package-local install (or manual edit) can leave behind.
  await mkdir(join(package_dir, "packages", "backend", "node_modules", "baz"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "backend", "node_modules", "baz", "package.json"),
    JSON.stringify({ name: "baz", version: "0.0.0-stale" }),
  );

  const { stderr, exited } = spawn({
    cmd: [bunExe(), "update", "--latest", "baz", "--linker=hoisted"],
    cwd: join(package_dir, "packages", "backend"),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(await exited).toBe(0);

  // baz should be hoisted to root node_modules at the updated version …
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
    name: "baz",
    version: "0.0.5",
  });

  // … and the stale workspace-local copy must be gone so module resolution
  // from the backend workspace finds the hoisted one instead of the shadow.
  expect(await exists(join(package_dir, "packages", "backend", "node_modules", "baz"))).toBe(false);
});

// Guard against over-eager pruning: a workspace-local copy that the lockfile
// legitimately places there (because it couldn't hoist due to a root conflict)
// must survive a subsequent install.
it("hoisted install preserves non-hoistable workspace-local packages", async () => {
  const registry = {
    "0.0.3": {},
    "0.0.5": {},
    latest: "0.0.5",
  };
  setHandler(dummyRegistry([], registry));

  // Root pins baz@0.0.3; workspace pins baz@0.0.5 → the workspace copy can't
  // hoist and must live at `packages/backend/node_modules/baz`.
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/backend"],
      dependencies: { baz: "0.0.3" },
    }),
  );

  await mkdir(join(package_dir, "packages", "backend"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "backend", "package.json"),
    JSON.stringify({
      name: "@repro/backend",
      dependencies: { baz: "0.0.5" },
    }),
  );

  // Initial install lays everything out.
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await new Response(stderr).text()).not.toContain("error:");
    expect(await exited).toBe(0);
  }

  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
    name: "baz",
    version: "0.0.3",
  });
  expect(
    await file(join(package_dir, "packages", "backend", "node_modules", "baz", "package.json")).json(),
  ).toMatchObject({
    name: "baz",
    version: "0.0.5",
  });

  // Second install must not wipe the legitimate workspace-local copy.
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await new Response(stderr).text()).not.toContain("error:");
    expect(await exited).toBe(0);
  }

  expect(
    await file(join(package_dir, "packages", "backend", "node_modules", "baz", "package.json")).json(),
  ).toMatchObject({
    name: "baz",
    version: "0.0.5",
  });
});

// `bun install --filter <subset>` must not destroy legitimate nested packages
// in a workspace that was excluded by the filter. The prune walks the
// unfiltered tree layout, so entries the full lockfile expects are kept.
it("hoisted install with --filter preserves excluded workspace's non-hoistable packages", async () => {
  const registry = {
    "0.0.3": {},
    "0.0.5": {},
    latest: "0.0.5",
  };
  setHandler(dummyRegistry([], registry));

  // Root pins baz@0.0.3 and declares one workspace that pins baz@0.0.5. The
  // workspace's copy can't hoist (root already claims baz) so it lands at
  // `packages/excluded/node_modules/baz`.
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
      dependencies: { baz: "0.0.3" },
    }),
  );
  await mkdir(join(package_dir, "packages", "excluded"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "excluded", "package.json"),
    JSON.stringify({ name: "excluded", dependencies: { baz: "0.0.5" } }),
  );
  await mkdir(join(package_dir, "packages", "target"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "target", "package.json"),
    JSON.stringify({ name: "target", dependencies: { baz: "0.0.3" } }),
  );

  // First, a full install lays out both workspaces' node_modules.
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await new Response(stderr).text()).not.toContain("error:");
    expect(await exited).toBe(0);
  }

  // Confirm the expected layout before the filtered install runs: root gets
  // 0.0.3, the excluded workspace has its own 0.0.5.
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
    name: "baz",
    version: "0.0.3",
  });
  expect(
    await file(join(package_dir, "packages", "excluded", "node_modules", "baz", "package.json")).json(),
  ).toMatchObject({
    name: "baz",
    version: "0.0.5",
  });

  // Leave a stale directory in the workspace we'll exclude — the prune still
  // cleans it up because it's not in the lockfile anywhere.
  await mkdir(join(package_dir, "packages", "excluded", "node_modules", "stale"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "excluded", "node_modules", "stale", "package.json"),
    JSON.stringify({ name: "stale", version: "0.0.0" }),
  );

  // Now run an install filtered to `target` only.
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--filter", "target", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await new Response(stderr).text()).not.toContain("error:");
    expect(await exited).toBe(0);
  }

  // The excluded workspace's legit non-hoistable copy must still be there.
  expect(
    await file(join(package_dir, "packages", "excluded", "node_modules", "baz", "package.json")).json(),
  ).toMatchObject({
    name: "baz",
    version: "0.0.5",
  });
  // And the genuinely stale entry in that same directory is gone.
  expect(await exists(join(package_dir, "packages", "excluded", "node_modules", "stale"))).toBe(false);
});

// Stale scoped packages (`@scope/pkg`) must also be pruned, and the empty
// `@scope` directory shouldn't be left behind.
it("hoisted install prunes stale scoped workspace-local entries", async () => {
  const registry = {
    "0.0.3": {},
    "0.0.5": {},
    latest: "0.0.5",
  };
  setHandler(dummyRegistry([], registry));

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/backend"],
    }),
  );
  await mkdir(join(package_dir, "packages", "backend"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "backend", "package.json"),
    JSON.stringify({
      name: "@repro/backend",
      dependencies: { baz: "^0.0.3" },
    }),
  );

  // Pre-existing stale scoped package.
  await mkdir(join(package_dir, "packages", "backend", "node_modules", "@stale", "pkg"), {
    recursive: true,
  });
  await writeFile(
    join(package_dir, "packages", "backend", "node_modules", "@stale", "pkg", "package.json"),
    JSON.stringify({ name: "@stale/pkg", version: "0.0.0" }),
  );

  const { stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await new Response(stderr).text()).not.toContain("error:");
  expect(await exited).toBe(0);

  // The scoped package directory is gone, along with the empty `@stale` parent.
  expect(await exists(join(package_dir, "packages", "backend", "node_modules", "@stale", "pkg"))).toBe(false);
  expect(await exists(join(package_dir, "packages", "backend", "node_modules", "@stale"))).toBe(false);
});
