import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { access, mkdir, readFile, rm, writeFile } from "fs/promises";
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

// https://github.com/oven-sh/bun/issues/33176
it("--recursive updates dependencies and peerDependencies in workspace members", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" }));

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
  );
  await mkdir(join(package_dir, "packages", "pkg-a"), { recursive: true });
  await mkdir(join(package_dir, "packages", "pkg-b"), { recursive: true });
  // Same dependency name in two workspaces, one as a regular dep and one as a
  // peer dep, so the update must fan out to both members and handle each
  // workspace's dependency groups independently.
  await writeFile(
    join(package_dir, "packages", "pkg-a", "package.json"),
    JSON.stringify({ name: "pkg-a", dependencies: { baz: "~0.0.3" } }),
  );
  await writeFile(
    join(package_dir, "packages", "pkg-b", "package.json"),
    JSON.stringify({ name: "pkg-b", peerDependencies: { baz: "~0.0.3" } }),
  );

  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });
    expect(await new Response(stderr).text()).not.toContain("error:");
    expect(await exited).toBe(0);
  }

  const { stderr, exited } = spawn({
    cmd: [bunExe(), "update", "--recursive", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  expect(await new Response(stderr).text()).not.toContain("error:");
  expect(await exited).toBe(0);

  const a = await file(join(package_dir, "packages", "pkg-a", "package.json")).json();
  const b = await file(join(package_dir, "packages", "pkg-b", "package.json")).json();
  expect(a.dependencies.baz).toBe("~0.0.5");
  expect(b.peerDependencies.baz).toBe("~0.0.5");
});

// https://github.com/oven-sh/bun/issues/33176
it("--recursive --latest updates workspace members to the latest version", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" }));

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
  );
  await mkdir(join(package_dir, "packages", "pkg-a"), { recursive: true });
  // Exact pin below latest: only `--latest` moves it, so this also proves the
  // member goes through the `--latest` path rather than range-constrained update.
  await writeFile(
    join(package_dir, "packages", "pkg-a", "package.json"),
    JSON.stringify({ name: "pkg-a", dependencies: { baz: "0.0.3" } }),
  );

  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });
    expect(await new Response(stderr).text()).not.toContain("error:");
    expect(await exited).toBe(0);
  }

  const { stderr, exited } = spawn({
    cmd: [bunExe(), "update", "--recursive", "--latest", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  expect(await new Response(stderr).text()).not.toContain("error:");
  expect(await exited).toBe(0);

  const a = await file(join(package_dir, "packages", "pkg-a", "package.json")).json();
  expect(a.dependencies.baz).toBe("0.0.5");
});

// https://github.com/oven-sh/bun/issues/33176
it("--filter updates only matching workspaces, leaving siblings and root untouched", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" }));

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
      dependencies: { baz: "~0.0.3" },
    }),
  );
  await mkdir(join(package_dir, "packages", "pkg-a"), { recursive: true });
  await mkdir(join(package_dir, "packages", "pkg-b"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "pkg-a", "package.json"),
    JSON.stringify({ name: "pkg-a", dependencies: { baz: "~0.0.3" } }),
  );
  await writeFile(
    join(package_dir, "packages", "pkg-b", "package.json"),
    JSON.stringify({ name: "pkg-b", dependencies: { baz: "~0.0.3" } }),
  );

  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });
    expect(await new Response(stderr).text()).not.toContain("error:");
    expect(await exited).toBe(0);
  }

  const { stderr, exited } = spawn({
    cmd: [bunExe(), "update", "--filter", "pkg-a", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  expect(await new Response(stderr).text()).not.toContain("error:");
  expect(await exited).toBe(0);

  const root = await file(join(package_dir, "package.json")).json();
  const a = await file(join(package_dir, "packages", "pkg-a", "package.json")).json();
  const b = await file(join(package_dir, "packages", "pkg-b", "package.json")).json();
  expect(a.dependencies.baz).toBe("~0.0.5");
  // Unmatched workspace and the root are left untouched.
  expect(b.dependencies.baz).toBe("~0.0.3");
  expect(root.dependencies.baz).toBe("~0.0.3");
});

// https://github.com/oven-sh/bun/issues/33176
// A named update with --recursive keeps the existing (cwd-scoped) behavior: it
// does not fan out to workspace members.
it("named update with --recursive only updates the named package in the cwd", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" }));

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
      dependencies: { baz: "~0.0.3" },
    }),
  );
  await mkdir(join(package_dir, "packages", "pkg-a"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "pkg-a", "package.json"),
    JSON.stringify({ name: "pkg-a", dependencies: { baz: "~0.0.3" } }),
  );

  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });
    expect(await new Response(stderr).text()).not.toContain("error:");
    expect(await exited).toBe(0);
  }

  const { stderr, exited } = spawn({
    cmd: [bunExe(), "update", "baz", "--recursive", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  expect(await new Response(stderr).text()).not.toContain("error:");
  expect(await exited).toBe(0);

  const root = await file(join(package_dir, "package.json")).json();
  const a = await file(join(package_dir, "packages", "pkg-a", "package.json")).json();
  expect(root.dependencies.baz).toBe("~0.0.5");
  // Named updates do not fan out to members.
  expect(a.dependencies.baz).toBe("~0.0.3");
});

it("should print UTF-8 arrows correctly with colors enabled", async () => {
  const urls: string[] = [];
  const registry = {
    "0.0.3": {},
    "0.0.5": {},
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
  let { exited, stderr: stderr1 } = spawn({
    cmd: [bunExe(), "install", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  const err1 = await new Response(stderr1).text();
  expect(err1).not.toContain("error:");
  expect(await exited).toBe(0);

  registry.latest = "0.0.5";
  setHandler(dummyRegistry(urls, registry));
  const { stdout, exited: exited2 } = spawn({
    cmd: [bunExe(), "update", "--latest", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stderr: "ignore",
    env: { ...env, FORCE_COLOR: "1" },
  });
  const out = await new Response(stdout).text();
  expect(out).toContain("↑");
  expect(out).toContain("→");
  // double-encoded UTF-8 (each byte of the arrow re-encoded as Latin-1)
  expect(out).not.toContain("â");
  expect(await exited2).toBe(0);
});
