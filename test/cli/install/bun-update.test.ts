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

it("update <name> updates a named catalog entry instead of adding a root dependency, issue#32808", async () => {
  const urls: string[] = [];
  const registry = {
    "0.0.3": { bin: { "baz-run": "index.js" } },
    "0.0.5": { bin: { "baz-exec": "index.js" } },
    latest: "0.0.5",
  };
  setHandler(dummyRegistry(urls, registry));

  // `baz` lives only in a named catalog; workspaces consume it via `catalog:ai`.
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
      catalogs: { ai: { baz: "~0.0.3" } },
    }),
  );
  await mkdir(join(package_dir, "packages", "server"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "server", "package.json"),
    JSON.stringify({ name: "server", dependencies: { baz: "catalog:ai" } }),
  );

  const install = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  const [installErr, installCode] = await Promise.all([new Response(install.stderr).text(), install.exited]);
  expect(installErr).not.toContain("error:");
  expect(installCode).toBe(0);

  const proc = spawn({
    cmd: [bunExe(), "update", "baz"],
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(err).not.toContain("error:");
  expect(code).toBe(0);

  const root = await file(join(package_dir, "package.json")).json();
  // No spurious top-level dependency is synthesized for the catalog package.
  expect(root.dependencies).toBeUndefined();
  // The catalog entry is bumped in place, preserving the `~` prefix.
  expect(root.catalogs).toEqual({ ai: { baz: "~0.0.5" } });
  // The workspace reference stays pointed at the catalog.
  const server = await file(join(package_dir, "packages", "server", "package.json")).json();
  expect(server.dependencies.baz).toBe("catalog:ai");
  // Not the spurious `installed baz@latest` the old code printed.
  expect(out).not.toContain("installed baz@");
});

it("update <name> updates the default catalog entry, issue#32808", async () => {
  const urls: string[] = [];
  const registry = {
    "0.0.3": { bin: { "baz-run": "index.js" } },
    "0.0.5": { bin: { "baz-exec": "index.js" } },
    latest: "0.0.5",
  };
  setHandler(dummyRegistry(urls, registry));

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
      catalog: { baz: "~0.0.3" },
    }),
  );
  await mkdir(join(package_dir, "packages", "server"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "server", "package.json"),
    JSON.stringify({ name: "server", dependencies: { baz: "catalog:" } }),
  );

  const install = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  const [installErr, installCode] = await Promise.all([new Response(install.stderr).text(), install.exited]);
  expect(installErr).not.toContain("error:");
  expect(installCode).toBe(0);

  const proc = spawn({
    cmd: [bunExe(), "update", "baz"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(err).not.toContain("error:");
  expect(code).toBe(0);

  const root = await file(join(package_dir, "package.json")).json();
  expect(root.dependencies).toBeUndefined();
  expect(root.catalog).toEqual({ baz: "~0.0.5" });
  const server = await file(join(package_dir, "packages", "server", "package.json")).json();
  expect(server.dependencies.baz).toBe("catalog:");
});

it("update <name> re-resolves a catalog entry when a newer in-range version is published, issue#32808", async () => {
  const urls: string[] = [];
  // Install while only 0.0.3 is published, so the lockfile pins baz@0.0.3.
  setHandler(dummyRegistry(urls, { "0.0.3": { bin: { "baz-run": "index.js" } }, latest: "0.0.3" }));

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
      catalogs: { ai: { baz: "~0.0.3" } },
    }),
  );
  await mkdir(join(package_dir, "packages", "server"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "server", "package.json"),
    JSON.stringify({ name: "server", dependencies: { baz: "catalog:ai" } }),
  );

  const install = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  const [installErr, installCode] = await Promise.all([new Response(install.stderr).text(), install.exited]);
  expect(installErr).not.toContain("error:");
  expect(installCode).toBe(0);

  // 0.0.5 is published afterwards; `bun update baz` must re-resolve past the
  // locked 0.0.3 to the latest in-range version and bump the catalog entry.
  setHandler(
    dummyRegistry(urls, {
      "0.0.3": { bin: { "baz-run": "index.js" } },
      "0.0.5": { bin: { "baz-exec": "index.js" } },
      latest: "0.0.5",
    }),
  );
  const proc = spawn({
    cmd: [bunExe(), "update", "baz"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(err).not.toContain("error:");
  expect(code).toBe(0);

  const root = await file(join(package_dir, "package.json")).json();
  expect(root.dependencies).toBeUndefined();
  expect(root.catalogs).toEqual({ ai: { baz: "~0.0.5" } });
});

it("update <name> --latest bumps a catalog entry past its range, issue#32808", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.3": { bin: { "baz-run": "index.js" } },
      "0.0.5": { bin: { "baz-exec": "index.js" } },
      latest: "0.0.5",
    }),
  );

  // An exact catalog pin: a bare update can't move it, but `--latest` must.
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
      catalogs: { ai: { baz: "0.0.3" } },
    }),
  );
  await mkdir(join(package_dir, "packages", "server"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "server", "package.json"),
    JSON.stringify({ name: "server", dependencies: { baz: "catalog:ai" } }),
  );

  const install = spawn({ cmd: [bunExe(), "install"], cwd: package_dir, stdout: "ignore", stderr: "pipe", env });
  const [installErr, installCode] = await Promise.all([new Response(install.stderr).text(), install.exited]);
  expect(installErr).not.toContain("error:");
  expect(installCode).toBe(0);

  const proc = spawn({
    cmd: [bunExe(), "update", "baz", "--latest"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(err).not.toContain("error:");
  expect(code).toBe(0);

  const root = await file(join(package_dir, "package.json")).json();
  expect(root.dependencies).toBeUndefined();
  expect(root.catalogs).toEqual({ ai: { baz: "^0.0.5" } });
  const server = await file(join(package_dir, "packages", "server", "package.json")).json();
  expect(server.dependencies.baz).toBe("catalog:ai");
});

it("update <name>@<version> sets the catalog constraint to the requested version, issue#32808", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.3": { bin: { "baz-run": "index.js" } },
      "0.0.5": { bin: { "baz-exec": "index.js" } },
      latest: "0.0.5",
    }),
  );

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
      catalogs: { ai: { baz: "~0.0.3" } },
    }),
  );
  await mkdir(join(package_dir, "packages", "server"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "server", "package.json"),
    JSON.stringify({ name: "server", dependencies: { baz: "catalog:ai" } }),
  );

  const install = spawn({ cmd: [bunExe(), "install"], cwd: package_dir, stdout: "ignore", stderr: "pipe", env });
  const [installErr, installCode] = await Promise.all([new Response(install.stderr).text(), install.exited]);
  expect(installErr).not.toContain("error:");
  expect(installCode).toBe(0);

  // An explicit exact request must win over the catalog's `~` constraint.
  const proc = spawn({
    cmd: [bunExe(), "update", "baz@0.0.5"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(err).not.toContain("error:");
  expect(code).toBe(0);

  const root = await file(join(package_dir, "package.json")).json();
  expect(root.dependencies).toBeUndefined();
  expect(root.catalogs).toEqual({ ai: { baz: "0.0.5" } });
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
