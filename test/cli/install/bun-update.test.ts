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

// Spawn the debug bun in `package_dir`, asserting it succeeded with no errors.
async function runInPackageDir(cmd: string[]) {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), ...cmd, "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });
  const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
  return { out, err };
}

// https://github.com/oven-sh/bun/issues/13388
// `bun update` must write the same resolved version into bun.lock's workspace
// entries that it writes into package.json, preserving the pin level and the
// `npm:<name>@` prefix of aliases, so the next `bun install` has nothing to do.
for (const args of [["update", "--latest"], ["update"], ["update", "baz", "baz-alias"]]) {
  it(`${args.join(" ")} saves the resolved version range into the lockfile, issue#13388`, async () => {
    const urls: string[] = [];
    // `~0.0.3` so the plain `bun update` variants can move within the range once 0.0.5 appears.
    const registry: Record<string, any> = { "0.0.3": {}, latest: "0.0.3" };
    setHandler(dummyRegistry(urls, registry));
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "baz": "~0.0.3",
          "baz-alias": "npm:baz@~0.0.3",
        },
      }),
    );

    // Text lockfile so the workspace entries can be asserted directly.
    await runInPackageDir(["install", "--save-text-lockfile"]);

    // A newer version within the range appears; every variant resolves to 0.0.5.
    registry["0.0.5"] = {};
    registry.latest = "0.0.5";
    setHandler(dummyRegistry(urls, registry));
    await runInPackageDir(args);

    expect(await file(join(package_dir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        "baz": "~0.0.5",
        "baz-alias": "npm:baz@~0.0.5",
      },
    });
    const lockfile = await file(join(package_dir, "bun.lock")).text();
    expect(lockfile).toContain(`"baz": "~0.0.5"`);
    expect(lockfile).toContain(`"baz-alias": "npm:baz@~0.0.5"`);
    expect(lockfile).not.toContain("latest");

    // package.json and bun.lock agree, so the next install has nothing to rewrite.
    const { err } = await runInPackageDir(["install"]);
    expect(err).not.toContain("Saved lockfile");
  });
}

// https://github.com/oven-sh/bun/issues/13388
// `bun update <name>` on a versionless scoped alias records no dependency
// group for the entry, and bun.lock must still end at the same resolved
// range package.json gets.
it("update <name> of a versionless scoped alias keeps the files in agreement, issue#13388", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.1.0": {}, latest: "0.1.0" }));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "foo", dependencies: { "scoped-alias": "npm:@barn/moo" } }),
  );

  await runInPackageDir(["install", "--save-text-lockfile"]);
  await runInPackageDir(["update", "scoped-alias"]);

  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
    dependencies: { "scoped-alias": "^0.1.0" },
  });
  const lockfile = await file(join(package_dir, "bun.lock")).text();
  expect(lockfile).toContain(`"scoped-alias": "^0.1.0"`);

  const { err } = await runInPackageDir(["install"]);
  expect(err).not.toContain("Saved lockfile");
});

// https://github.com/oven-sh/bun/issues/13388
// A positional request with an explicit version. `bun update` of a recorded
// dependency re-pins from its original literal (keeping any `npm:` alias
// prefix), of an unrecorded one it saves `^<resolved>`, and
// `bun add <name>@<range>` keeps the requested range.
for (const { label, init, args, expected } of [
  {
    label: "update existing@range",
    init: { baz: "~0.0.3" },
    args: ["update", "baz@~0.0.4"],
    expected: { baz: "~0.0.5" },
  },
  {
    label: "update existing@exact",
    init: { baz: "~0.0.3" },
    args: ["update", "baz@0.0.5"],
    expected: { baz: "~0.0.5" },
  },
  {
    // `baz` has no recorded entry and its range is satisfied by the already
    // locked 0.0.3, so both files get the `^<resolved>` fallback.
    label: "update new@range",
    init: { "baz-alias": "npm:baz@~0.0.3" },
    args: ["update", "baz@~0.0.3"],
    expected: { "baz-alias": "npm:baz@~0.0.3", baz: "^0.0.3" },
  },
  {
    // The requested `npm:` spec replaces the in-memory package.json literal
    // the lockfile is built from, so the alias prefix must come from the
    // recorded original, not from that literal.
    label: "update alias@npm:target@range",
    init: { "baz-alias": "npm:baz@~0.0.3" },
    args: ["update", "baz-alias@npm:baz@~0.0.4"],
    expected: { "baz-alias": "npm:baz@~0.0.5" },
  },
  {
    // A bare positional range on an alias only resolves when the alias name
    // is itself a registry package, so this uses a self-alias. Here the
    // replaced in-memory literal (`~0.0.4`) has no prefix at all.
    label: "update self-alias@range",
    init: { baz: "npm:baz@~0.0.3" },
    args: ["update", "baz@~0.0.4"],
    expected: { baz: "npm:baz@~0.0.5" },
  },
  {
    // A NEW dependency added via a positional `bun update` records no
    // `updating_packages` entry, so the lockfile takes the `^<resolved>`
    // fallback. That fallback must keep the request's `npm:<target>@` prefix,
    // like the package.json edit's matching no-entry branch does.
    label: "update NEW-alias@npm:target@range",
    init: { baz: "~0.0.3" },
    args: ["update", "new-alias@npm:baz@~0.0.4"],
    expected: { baz: "~0.0.3", "new-alias": "npm:baz@^0.0.5" },
  },
  { label: "add existing@range", init: { baz: "~0.0.3" }, args: ["add", "baz@~0.0.4"], expected: { baz: "~0.0.4" } },
]) {
  it(`${label} saves the same literal into both files, issue#13388`, async () => {
    const urls: string[] = [];
    const registry: Record<string, any> = { "0.0.3": {}, latest: "0.0.3" };
    setHandler(dummyRegistry(urls, registry));
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", dependencies: init }));

    await runInPackageDir(["install", "--save-text-lockfile"]);

    registry["0.0.5"] = {};
    registry.latest = "0.0.5";
    setHandler(dummyRegistry(urls, registry));
    await runInPackageDir(args);

    expect(await file(join(package_dir, "package.json")).json()).toEqual({ name: "foo", dependencies: expected });
    const lockfile = await file(join(package_dir, "bun.lock")).text();
    for (const [name, literal] of Object.entries(expected)) {
      expect(lockfile).toContain(`"${name}": "${literal}"`);
    }

    const { err } = await runInPackageDir(["install"]);
    expect(err).not.toContain("Saved lockfile");
  });
}

// https://github.com/oven-sh/bun/issues/13388
// When a package exists in two dependency groups, only one group moves in
// package.json, and no-arg and positional updates pick different groups. The
// untouched group's bun.lock entry must stay unchanged too.
for (const { args, expected } of [
  { args: ["update", "--latest"], expected: { dependencies: "~0.0.3", devDependencies: "~0.0.5" } },
  { args: ["update"], expected: { dependencies: "~0.0.3", devDependencies: "~0.0.5" } },
  { args: ["update", "baz"], expected: { dependencies: "~0.0.5", devDependencies: "~0.0.3" } },
]) {
  it(`${args.join(" ")} leaves the other group untouched in the lockfile, issue#13388`, async () => {
    const urls: string[] = [];
    const registry: Record<string, any> = { "0.0.3": {}, latest: "0.0.3" };
    setHandler(dummyRegistry(urls, registry));
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: { "baz": "~0.0.3" },
        devDependencies: { "baz": "~0.0.3" },
      }),
    );

    await runInPackageDir(["install", "--save-text-lockfile"]);

    registry["0.0.5"] = {};
    registry.latest = "0.0.5";
    setHandler(dummyRegistry(urls, registry));
    await runInPackageDir(args);

    expect(await file(join(package_dir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: { "baz": expected.dependencies },
      devDependencies: { "baz": expected.devDependencies },
    });
    const lockfile = await file(join(package_dir, "bun.lock")).text();
    const workspaces = lockfile.slice(0, lockfile.indexOf(`"packages"`));
    expect(workspaces).toContain(`"baz": "~0.0.3"`);
    expect(workspaces).toContain(`"baz": "~0.0.5"`);

    const { err } = await runInPackageDir(["install"]);
    expect(err).not.toContain("Saved lockfile");
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
