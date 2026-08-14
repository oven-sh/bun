import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { access, exists, mkdir, readFile, rm, writeFile } from "fs/promises";
import { VerdaccioRegistry, bunExe, bunEnv as env, pack, readdirSorted, toBeValidBin, toHaveBins } from "harness";
import { basename, dirname, join } from "path";
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

async function runInstall(cwd = package_dir, ...args: string[]) {
  const { stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--linker=hoisted", ...args],
    cwd,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  const [err, code] = await Promise.all([stderr.text(), exited]);
  expect(err).not.toContain("error:");
  expect(code).toBe(0);
}

async function writeTextLockfileBunfig() {
  await writeFile(
    join(package_dir, "bunfig.toml"),
    `[install]\ncache = false\nregistry = "${root_url}/"\nsaveTextLockfile = true\nlinker = "hoisted"\n`,
  );
}

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

// Multiple `--filter` patterns select the union of matches (any positive), minus negations.
it("--filter with multiple patterns selects the union of matching workspaces", async () => {
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
  for (const n of ["pkg-a", "pkg-b", "pkg-c"]) {
    await mkdir(join(package_dir, "packages", n), { recursive: true });
    await writeFile(
      join(package_dir, "packages", n, "package.json"),
      JSON.stringify({ name: n, dependencies: { baz: "~0.0.3" } }),
    );
  }

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
    cmd: [bunExe(), "update", "--filter", "pkg-a", "--filter", "pkg-b", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  expect(await new Response(stderr).text()).not.toContain("error:");
  expect(await exited).toBe(0);

  expect({
    root: (await file(join(package_dir, "package.json")).json()).dependencies.baz,
    a: (await file(join(package_dir, "packages", "pkg-a", "package.json")).json()).dependencies.baz,
    b: (await file(join(package_dir, "packages", "pkg-b", "package.json")).json()).dependencies.baz,
    c: (await file(join(package_dir, "packages", "pkg-c", "package.json")).json()).dependencies.baz,
  }).toEqual({ root: "~0.0.3", a: "~0.0.5", b: "~0.0.5", c: "~0.0.3" });
});

// https://github.com/oven-sh/bun/issues/33176
const FAN_OUT_FILES = {
  "package.json": { name: "root", private: true, workspaces: ["packages/*"], dependencies: { baz: "0.0.3" } },
  "packages/pkg-a/package.json": { name: "pkg-a", dependencies: { baz: "~0.0.3" } },
  "packages/pkg-b/package.json": { name: "pkg-b", devDependencies: { baz: "^0.0.3" } },
  "packages/pkg-c/package.json": { name: "pkg-c" },
};

async function fanOutTexts() {
  const texts: string[] = [];
  for (const rel of Object.keys(FAN_OUT_FILES)) texts.push(await file(join(package_dir, rel)).text());
  return texts;
}

const fanOutJson = (rel: keyof typeof FAN_OUT_FILES) => file(join(package_dir, rel)).json();

// Root pins baz exactly, pkg-a uses `~`, pkg-b uses `^` in devDependencies and pkg-c does not depend on it.
async function fanOutRepo(
  registryVersions: Record<string, object | string> = { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" },
) {
  setHandler(dummyRegistry([], registryVersions));
  await writeTextLockfileBunfig();
  for (const [rel, json] of Object.entries(FAN_OUT_FILES)) {
    await mkdir(dirname(join(package_dir, rel)), { recursive: true });
    await writeFile(join(package_dir, rel), JSON.stringify(json, null, 2) + "\n");
  }
  await runInstall();
  return fanOutTexts();
}

async function spawnUpdate(...args: string[]) {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "update", ...args, "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
  return { out, err, exitCode };
}

it("named update -r --latest rewrites every workspace that declares the name, keeping each file's style", async () => {
  const [, , , pkgC] = await fanOutRepo();
  const { err, exitCode } = await spawnUpdate("baz", "-r", "--latest");
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect((await fanOutJson("package.json")).dependencies.baz).toBe("0.0.5");
  expect((await fanOutJson("packages/pkg-a/package.json")).dependencies.baz).toBe("~0.0.5");
  expect((await fanOutJson("packages/pkg-b/package.json")).devDependencies.baz).toBe("^0.0.5");
  expect(await file(join(package_dir, "packages", "pkg-c", "package.json")).text()).toBe(pkgC);
});

it("named update --filter rewrites only the selected workspace", async () => {
  const [root, , pkgB, pkgC] = await fanOutRepo();
  const { err, exitCode } = await spawnUpdate("baz", "--filter", "pkg-a", "--latest");
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect((await fanOutJson("packages/pkg-a/package.json")).dependencies.baz).toBe("~0.0.5");
  expect(await fanOutTexts()).toEqual([root, expect.any(String), pkgB, pkgC]);
});

it("named update accepts -F as the short form of --filter", async () => {
  const [root, , pkgB, pkgC] = await fanOutRepo();
  const { err, exitCode } = await spawnUpdate("baz", "-F", "pkg-a", "--latest");
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect((await fanOutJson("packages/pkg-a/package.json")).dependencies.baz).toBe("~0.0.5");
  expect(await fanOutTexts()).toEqual([root, expect.any(String), pkgB, pkgC]);
});

it("named update --filter of a workspace that does not depend on the name is an error", async () => {
  const before = await fanOutRepo();
  const lockBefore = await file(join(package_dir, "bun.lock")).text();
  const { err, exitCode } = await spawnUpdate("baz", "--filter", "pkg-c");
  expect(err).toContain('"baz" is only a dependency of other workspaces, so there is nothing to update here');
  expect(exitCode).toBe(1);
  expect(await fanOutTexts()).toEqual(before);
  expect(await file(join(package_dir, "bun.lock")).text()).toBe(lockBefore);
});

it("named update -r with a name missing from the lockfile is an error", async () => {
  const before = await fanOutRepo();
  const { err, exitCode } = await spawnUpdate("nope", "-r");
  expect(err).toContain('"nope" is not in the lockfile, so there is nothing to update');
  expect(exitCode).toBe(1);
  expect(await fanOutTexts()).toEqual(before);
});

// Root's exact pin and pkg-b's `^0.0.3` (which excludes 0.0.5) only move with --latest.
it("named update -r moves the ranges and keeps bun.lock in sync", async () => {
  const [, , , pkgC] = await fanOutRepo({ "0.0.3": {}, latest: "0.0.3" });
  setHandler(dummyRegistry([], { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" }));
  const { err, exitCode } = await spawnUpdate("baz", "-r");
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect((await fanOutJson("packages/pkg-a/package.json")).dependencies.baz).toBe("~0.0.5");
  expect((await fanOutJson("packages/pkg-b/package.json")).devDependencies.baz).toBe("^0.0.3");
  expect((await fanOutJson("package.json")).dependencies.baz).toBe("0.0.3");
  expect(await file(join(package_dir, "packages", "pkg-c", "package.json")).text()).toBe(pkgC);
  await runInstall(package_dir, "--frozen-lockfile");
});

it("named update -r --dry-run writes nothing", async () => {
  const before = await fanOutRepo();
  const { err, exitCode } = await spawnUpdate("baz", "-r", "--latest", "--dry-run");
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect(await fanOutTexts()).toEqual(before);
});

// https://github.com/oven-sh/bun/issues/33176
// A workspace member's `catalog:` reference must survive `bun update`: the
// version lives in the root catalog, not inline in the member.
it("--recursive preserves a workspace member's catalog: reference", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" }));

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
      catalog: { baz: "^0.0.3" },
    }),
  );
  await mkdir(join(package_dir, "packages", "pkg-a"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "pkg-a", "package.json"),
    JSON.stringify({ name: "pkg-a", dependencies: { baz: "catalog:" } }),
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

  const root = await file(join(package_dir, "package.json")).json();
  const a = await file(join(package_dir, "packages", "pkg-a", "package.json")).json();
  // The member keeps the catalog reference; the catalog definition is unchanged.
  expect(a.dependencies.baz).toBe("catalog:");
  expect(root.catalog.baz).toBe("^0.0.3");
});

// `--filter` excluding root must not touch the root package.json (catalogs included),
// so the lockfile stays consistent with the on-disk root.
it("--filter excluding root leaves root (and its catalog) untouched", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" }));

  const rootJson = JSON.stringify({
    name: "root",
    private: true,
    workspaces: ["packages/*"],
    catalog: { baz: "^0.0.3" },
    dependencies: { baz: "^0.0.3" },
  });
  await writeFile(join(package_dir, "package.json"), rootJson);
  await mkdir(join(package_dir, "packages", "pkg-a"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "pkg-a", "package.json"),
    JSON.stringify({ name: "pkg-a", dependencies: { baz: "catalog:" } }),
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
    cmd: [bunExe(), "update", "--filter", "pkg-a", "--latest", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  expect(await new Response(stderr).text()).not.toContain("error:");
  expect(await exited).toBe(0);

  // Root is not a `--filter pkg-a` target; nothing in its package.json changes.
  expect(await file(join(package_dir, "package.json")).text()).toBe(rootJson);
  expect((await file(join(package_dir, "packages", "pkg-a", "package.json")).json()).dependencies.baz).toBe("catalog:");
  // pkg-a's `catalog:` dep stays within the catalog range; `--latest` must not bypass it.
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
    version: "0.0.3",
  });

  // A subsequent frozen-lockfile install must pass (no catalog drift vs. lockfile).
  const frozen = spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  expect(await new Response(frozen.stderr).text()).not.toContain("error:");
  expect(await frozen.exited).toBe(0);
});

// `-r` from inside a member must write root's catalog and direct deps in one
// pass (the member-commit path carries both).
it("--recursive --latest from a member updates root's catalog and direct deps together", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" }));

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
      catalog: { baz: "^0.0.3" },
      dependencies: { baz: "^0.0.3" },
    }),
  );
  await mkdir(join(package_dir, "packages", "pkg-a"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "pkg-a", "package.json"),
    JSON.stringify({ name: "pkg-a", dependencies: { baz: "catalog:" } }),
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
    cwd: join(package_dir, "packages", "pkg-a"),
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  expect(await new Response(stderr).text()).not.toContain("error:");
  expect(await exited).toBe(0);

  const root = await file(join(package_dir, "package.json")).json();
  const a = await file(join(package_dir, "packages", "pkg-a", "package.json")).json();
  expect(root.dependencies.baz).toBe("^0.0.5");
  expect(root.catalog.baz).toBe("^0.0.5");
  expect(a.dependencies.baz).toBe("catalog:");
});

// https://github.com/oven-sh/bun/issues/33176
it("--filter with a path targets only the matching workspace", async () => {
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
    cmd: [bunExe(), "update", "--filter", "./packages/pkg-a", "--linker=hoisted"],
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
  expect(b.dependencies.baz).toBe("~0.0.3");
  expect(root.dependencies.baz).toBe("~0.0.3");
});

// https://github.com/oven-sh/bun/issues/33176
it("--filter with a negated pattern updates everything except the excluded workspace", async () => {
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
    cmd: [bunExe(), "update", "--filter", "!pkg-a", "--linker=hoisted"],
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
  // `!pkg-a` excludes pkg-a but keeps the root and sibling members.
  expect(a.dependencies.baz).toBe("~0.0.3");
  expect(b.dependencies.baz).toBe("~0.0.5");
  expect(root.dependencies.baz).toBe("~0.0.5");
});

async function setupWorkspaces(
  root: object,
  members: Record<string, object>,
  versions: Record<string, object | string> = { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" },
) {
  setHandler(dummyRegistry([], versions));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"], ...root }),
  );
  for (const [name, body] of Object.entries(members)) {
    await mkdir(join(package_dir, "packages", name), { recursive: true });
    await writeFile(join(package_dir, "packages", name, "package.json"), JSON.stringify({ name, ...body }));
  }
  await runInstall();
}

const BAZ_0_0_3_ONLY = { "0.0.3": {}, latest: "0.0.3" };
const bumpBazTo_0_0_5 = () => setHandler(dummyRegistry([], { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" }));

async function runUpdate(args: string[], cwd = package_dir) {
  const { stderr, exited } = spawn({
    cmd: [bunExe(), "update", ...args, "--linker=hoisted"],
    cwd,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  const [err, code] = await Promise.all([stderr.text(), exited]);
  expect(err).not.toContain("error:");
  expect(code).toBe(0);
  return err;
}

const pkgJson = (name: string) => file(join(package_dir, "packages", name, "package.json")).json();

// https://github.com/oven-sh/bun/issues/23507
for (const group of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
  it(`--recursive --latest updates a member's ${group}`, async () => {
    await setupWorkspaces({}, { "pkg-a": { [group]: { baz: "0.0.3" } } });
    await runUpdate(["--recursive", "--latest"]);
    expect((await pkgJson("pkg-a"))[group]).toEqual({ baz: "0.0.5" });
  });
}

// https://github.com/oven-sh/bun/issues/23507
it("--recursive --latest updates an npm: aliased dep in a member, preserving the alias", async () => {
  await setupWorkspaces({}, { "pkg-a": { dependencies: { aliased: "npm:baz@0.0.3" } } });
  await runUpdate(["--recursive", "--latest"]);
  expect((await pkgJson("pkg-a")).dependencies).toEqual({ aliased: "npm:baz@0.0.5" });
});

// https://github.com/oven-sh/bun/issues/23507
it("--recursive does not rewrite workspace: protocol references between members", async () => {
  await setupWorkspaces(
    {},
    {
      "pkg-a": { version: "1.0.0", dependencies: { baz: "~0.0.3" } },
      "pkg-b": { dependencies: { "pkg-a": "workspace:*", baz: "~0.0.3" } },
    },
  );
  await runUpdate(["--recursive"]);
  expect((await pkgJson("pkg-b")).dependencies).toEqual({ "pkg-a": "workspace:*", baz: "~0.0.5" });
  expect((await pkgJson("pkg-a")).dependencies).toEqual({ baz: "~0.0.5" });
});

// https://github.com/oven-sh/bun/issues/23507
it("--recursive from inside a member updates siblings and root", async () => {
  await setupWorkspaces(
    { dependencies: { baz: "~0.0.3" } },
    {
      "pkg-a": { dependencies: { baz: "~0.0.3" } },
      "pkg-b": { dependencies: { baz: "~0.0.3" } },
    },
  );
  await runUpdate(["--recursive"], join(package_dir, "packages", "pkg-a"));
  expect({
    root: (await file(join(package_dir, "package.json")).json()).dependencies.baz,
    a: (await pkgJson("pkg-a")).dependencies.baz,
    b: (await pkgJson("pkg-b")).dependencies.baz,
  }).toEqual({ root: "~0.0.5", a: "~0.0.5", b: "~0.0.5" });
});

// https://github.com/oven-sh/bun/issues/23507
it("--filter with a glob plus a negation scopes to the matched set minus the exclusion", async () => {
  await setupWorkspaces(
    { dependencies: { baz: "~0.0.3" } },
    {
      "pkg-a": { dependencies: { baz: "~0.0.3" } },
      "pkg-b": { dependencies: { baz: "~0.0.3" } },
      "pkg-c": { dependencies: { baz: "~0.0.3" } },
    },
  );
  await runUpdate(["--filter", "pkg-*", "--filter", "!pkg-c"]);
  expect({
    root: (await file(join(package_dir, "package.json")).json()).dependencies.baz,
    a: (await pkgJson("pkg-a")).dependencies.baz,
    b: (await pkgJson("pkg-b")).dependencies.baz,
    c: (await pkgJson("pkg-c")).dependencies.baz,
  }).toEqual({ root: "~0.0.3", a: "~0.0.5", b: "~0.0.5", c: "~0.0.3" });
});

// https://github.com/oven-sh/bun/issues/23507
it("--recursive --dry-run writes no workspace package.json", async () => {
  await setupWorkspaces({ dependencies: { baz: "~0.0.3" } }, { "pkg-a": { dependencies: { baz: "~0.0.3" } } });
  const rootBefore = await file(join(package_dir, "package.json")).text();
  const aBefore = await file(join(package_dir, "packages", "pkg-a", "package.json")).text();
  await runUpdate(["--recursive", "--latest", "--dry-run"]);
  expect(await file(join(package_dir, "package.json")).text()).toBe(rootBefore);
  expect(await file(join(package_dir, "packages", "pkg-a", "package.json")).text()).toBe(aBefore);
});

// https://github.com/oven-sh/bun/issues/23507
it("--recursive preserves each member's pin style independently", async () => {
  await setupWorkspaces(
    {},
    {
      "pkg-a": { dependencies: { baz: "^0.0.3" } },
      "pkg-b": { dependencies: { baz: "~0.0.3" } },
      "pkg-c": { dependencies: { baz: "0.0.3" } },
    },
  );
  await runUpdate(["--recursive", "--latest"]);
  expect({
    a: (await pkgJson("pkg-a")).dependencies.baz,
    b: (await pkgJson("pkg-b")).dependencies.baz,
    c: (await pkgJson("pkg-c")).dependencies.baz,
  }).toEqual({ a: "^0.0.5", b: "~0.0.5", c: "0.0.5" });
});

// https://github.com/oven-sh/bun/issues/23507
it("--filter with a scoped glob (@scope/*) targets only those members", async () => {
  await setupWorkspaces(
    { dependencies: { baz: "~0.0.3" } },
    {
      "scope-a": { name: "@scope/a", dependencies: { baz: "~0.0.3" } },
      "scope-b": { name: "@scope/b", dependencies: { baz: "~0.0.3" } },
      "other": { dependencies: { baz: "~0.0.3" } },
    },
  );
  await runUpdate(["--filter", "@scope/*"]);
  expect({
    root: (await file(join(package_dir, "package.json")).json()).dependencies.baz,
    a: (await pkgJson("scope-a")).dependencies.baz,
    b: (await pkgJson("scope-b")).dependencies.baz,
    other: (await pkgJson("other")).dependencies.baz,
  }).toEqual({ root: "~0.0.3", a: "~0.0.5", b: "~0.0.5", other: "~0.0.3" });
});

// https://github.com/oven-sh/bun/issues/23507
for (const depLiteral of ["^0.0.3", "0.0.3"]) {
  it(`--recursive --latest does not bypass a root overrides entry (member dep literal ${depLiteral})`, async () => {
    await setupWorkspaces({ overrides: { baz: "0.0.3" } }, { "pkg-a": { dependencies: { baz: depLiteral } } });
    await runUpdate(["--recursive", "--latest"]);
    // The override pins baz to 0.0.3; --latest must not resolve past it.
    expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
      version: "0.0.3",
    });
  });
}

// https://github.com/oven-sh/bun/issues/23507
it("--recursive --no-save updates node_modules but not any package.json", async () => {
  await setupWorkspaces({}, { "pkg-a": { dependencies: { baz: "~0.0.3" } } });
  const aBefore = await file(join(package_dir, "packages", "pkg-a", "package.json")).text();
  await runUpdate(["--recursive", "--no-save"]);
  expect(await file(join(package_dir, "packages", "pkg-a", "package.json")).text()).toBe(aBefore);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
    version: "0.0.5",
  });
});

it("--recursive --latest keeps a member's dist-tag literal and follows the tag", async () => {
  await setupWorkspaces({}, { "pkg-a": { dependencies: { baz: "latest" } } }, BAZ_0_0_3_ONLY);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
    version: "0.0.3",
  });
  bumpBazTo_0_0_5();
  await runUpdate(["--recursive", "--latest"]);
  expect((await pkgJson("pkg-a")).dependencies).toEqual({ baz: "latest" });
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
    version: "0.0.5",
  });
});

// https://github.com/oven-sh/bun/issues/23507
it("--recursive is idempotent: a second run changes nothing", async () => {
  await setupWorkspaces({ dependencies: { baz: "~0.0.3" } }, { "pkg-a": { dependencies: { baz: "~0.0.3" } } });
  await runUpdate(["--recursive"]);
  const rootAfter = await file(join(package_dir, "package.json")).json();
  const aAfter = await pkgJson("pkg-a");
  expect(aAfter.dependencies.baz).toBe("~0.0.5");
  await runUpdate(["--recursive"]);
  expect(await file(join(package_dir, "package.json")).json()).toEqual(rootAfter);
  expect(await pkgJson("pkg-a")).toEqual(aAfter);
});

it("--filter matching nothing writes no package.json", async () => {
  await setupWorkspaces({ dependencies: { baz: "~0.0.3" } }, { "pkg-a": { dependencies: { baz: "~0.0.3" } } });
  const rootBefore = await file(join(package_dir, "package.json")).text();
  const aBefore = await file(join(package_dir, "packages", "pkg-a", "package.json")).text();
  const err = await runUpdate(["--filter", "does-not-exist"]);
  expect(err).toContain('warn: No workspace packages matched the filter "does-not-exist"');
  expect(await file(join(package_dir, "package.json")).text()).toBe(rootBefore);
  expect(await file(join(package_dir, "packages", "pkg-a", "package.json")).text()).toBe(aBefore);
});

it("--recursive tolerates a member with no dependency groups", async () => {
  await setupWorkspaces(
    { dependencies: { baz: "~0.0.3" } },
    { empty: { version: "1.0.0" }, "pkg-a": { dependencies: { baz: "~0.0.3" } } },
  );
  await runUpdate(["--recursive"]);
  expect((await pkgJson("pkg-a")).dependencies.baz).toBe("~0.0.5");
  expect(await pkgJson("empty")).toEqual({ name: "empty", version: "1.0.0" });
});

// https://github.com/oven-sh/bun/issues/23507
it("--recursive updates only one group when a member lists the same dep in two groups", async () => {
  await setupWorkspaces({}, { "pkg-a": { dependencies: { baz: "~0.0.3" }, devDependencies: { baz: "~0.0.3" } } });
  await runUpdate(["--recursive"]);
  const a = await pkgJson("pkg-a");
  // Matches the existing single-workspace behavior: only one group's entry is rewritten.
  expect([a.dependencies.baz, a.devDependencies.baz].sort()).toEqual(["~0.0.3", "~0.0.5"]);
});

// https://github.com/oven-sh/bun/issues/23507
it("--recursive with multiple workspace globs fans out to every matched directory", async () => {
  setHandler(dummyRegistry([], { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" }));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "root", private: true, workspaces: ["apps/*", "packages/*"] }),
  );
  for (const [dir, name] of [
    ["apps", "app-a"],
    ["packages", "pkg-a"],
  ] as const) {
    await mkdir(join(package_dir, dir, name), { recursive: true });
    await writeFile(
      join(package_dir, dir, name, "package.json"),
      JSON.stringify({ name, dependencies: { baz: "~0.0.3" } }),
    );
  }
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--linker=hoisted"],
      cwd: package_dir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });
    const [err, code] = await Promise.all([stderr.text(), exited]);
    expect(err).not.toContain("error:");
    expect(code).toBe(0);
  }
  await runUpdate(["--recursive"]);
  expect((await file(join(package_dir, "apps", "app-a", "package.json")).json()).dependencies.baz).toBe("~0.0.5");
  expect((await file(join(package_dir, "packages", "pkg-a", "package.json")).json()).dependencies.baz).toBe("~0.0.5");
});

// https://github.com/oven-sh/bun/issues/23507
it("bun outdated -r is empty after bun update -r --latest", async () => {
  await setupWorkspaces(
    { dependencies: { baz: "~0.0.3" } },
    {
      "pkg-a": { dependencies: { baz: "~0.0.3" } },
      "pkg-b": { devDependencies: { baz: "0.0.3" } },
    },
  );
  await runUpdate(["--recursive", "--latest"]);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "outdated", "--recursive"],
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
  expect(err).not.toContain("error:");
  expect(out).not.toContain("baz");
  expect(code).toBe(0);
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

type PerNameManifests = Record<
  string,
  { versions: Record<string, { dependencies?: Record<string, string> }>; latest: string }
>;

async function packPerName(tgzDir: string, manifests: PerNameManifests) {
  for (const [name, { versions }] of Object.entries(manifests)) {
    for (const [version, extra] of Object.entries(versions)) {
      const staging = join(tgzDir, ".staging", `${name}-${version}`);
      await mkdir(staging, { recursive: true });
      await writeFile(join(staging, "package.json"), JSON.stringify({ name, version, ...extra }));
      await pack(staging, env, "--destination", tgzDir);
    }
  }
}

// Unlike `dummyRegistry`, this serves a distinct manifest per package name from tarballs packed by `packPerName`.
function perNameHandler(tgzDir: string, manifests: PerNameManifests) {
  return (request: Request) => {
    const url = request.url;
    if (url.endsWith(".tgz")) return new Response(file(join(tgzDir, basename(url))));
    const name = url.slice(url.indexOf("/", root_url.length) + 1);
    const entry = manifests[name];
    if (!entry) return new Response("not found", { status: 404 });
    const versions: Record<string, object> = {};
    for (const [version, extra] of Object.entries(entry.versions)) {
      versions[version] = { name, version, dist: { tarball: `${url}-${version}.tgz` }, ...extra };
    }
    return new Response(JSON.stringify({ name, versions, "dist-tags": { latest: entry.latest } }));
  };
}

async function perNameRegistry(tgzDir: string, manifests: PerNameManifests) {
  await packPerName(tgzDir, manifests);
  return perNameHandler(tgzDir, manifests);
}

async function runIn(cwd: string, ...args: string[]) {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
  return out;
}

const runInPackageDir = (...args: string[]) => runIn(package_dir, ...args);

// The set of `shared@<version>` resolutions in the text lockfile.
async function lockedSharedResolutions() {
  const lock = await file(join(package_dir, "bun.lock")).text();
  return [...new Set(lock.match(/"shared@[\d.]+"/g))].sort();
}

// A named update only re-resolves the rows of the workspace it runs in; another workspace's own entry is left alone.
it("bun update <name> from the root leaves a member's own entry alone; running it inside the member moves it", async () => {
  setHandler(
    await perNameRegistry(join(package_dir, ".tarballs"), {
      shared: { versions: { "1.0.0": {}, "1.1.0": {}, "2.0.0": {} }, latest: "2.0.0" },
    }),
  );
  await writeTextLockfileBunfig();
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: { shared: "^2.0.0" } }),
  );
  const pkgOneDir = join(package_dir, "packages", "pkg-one");
  const pkgOneJson = join(pkgOneDir, "package.json");
  await mkdir(pkgOneDir, { recursive: true });
  await writeFile(pkgOneJson, JSON.stringify({ name: "pkg-one", version: "1.0.0", dependencies: { shared: "1.0.0" } }));
  await runInPackageDir("install");

  // Widening the range keeps the stale 1.0.0 on a plain install, since it still satisfies the new range.
  await writeFile(
    pkgOneJson,
    JSON.stringify({ name: "pkg-one", version: "1.0.0", dependencies: { shared: "^1.0.0" } }),
  );
  await runInPackageDir("install");
  expect(await lockedSharedResolutions()).toEqual(['"shared@1.0.0"', '"shared@2.0.0"']);

  const pkgOneShared = () => file(join(pkgOneDir, "node_modules", "shared", "package.json")).json();

  await runInPackageDir("update", "shared");
  expect(await lockedSharedResolutions()).toEqual(['"shared@1.0.0"', '"shared@2.0.0"']);
  expect(await pkgOneShared()).toMatchObject({ version: "1.0.0" });

  await runIn(pkgOneDir, "update", "shared");
  expect(await lockedSharedResolutions()).toEqual(['"shared@1.1.0"', '"shared@2.0.0"']);
  expect(await pkgOneShared()).toMatchObject({ version: "1.1.0" });

  await runIn(pkgOneDir, "update", "shared");
  expect(await lockedSharedResolutions()).toEqual(['"shared@1.1.0"', '"shared@2.0.0"']);
  expect(await pkgOneShared()).toMatchObject({ version: "1.1.0" });
});

// The same invariant one level deeper: a dependency on `<name>` owned by a
// preserved parent package must also re-enter the resolve queue.
it("should update transitive resolutions of a named package", async () => {
  setHandler(
    await perNameRegistry(join(package_dir, ".tarballs"), {
      shared: { versions: { "1.0.0": {}, "1.1.0": {} }, latest: "1.1.0" },
      "dep-x": { versions: { "1.0.0": { dependencies: { shared: "^1.0.0" } } }, latest: "1.0.0" },
    }),
  );
  await writeTextLockfileBunfig();
  // dep-x@1.0.0 depends on shared@^1.0.0, which dedupes onto the root's
  // exact shared@1.0.0 at install time.
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "root", dependencies: { shared: "1.0.0", "dep-x": "^1.0.0" } }),
  );
  await runInPackageDir("install");
  expect(await lockedSharedResolutions()).toEqual(['"shared@1.0.0"']);

  // The root's exact `1.0.0` cannot move; dep-x's `^1.0.0` must move to 1.1.0.
  await runInPackageDir("update", "shared");
  expect(await lockedSharedResolutions()).toEqual(['"shared@1.0.0"', '"shared@1.1.0"']);
  expect(
    await file(join(package_dir, "node_modules", "dep-x", "node_modules", "shared", "package.json")).json(),
  ).toMatchObject({ version: "1.1.0" });
});

it("bun update <name> --latest holds back only the root's entry; a transitive edge declared as a dist-tag keeps following it", async () => {
  setHandler(
    await perNameRegistry(join(package_dir, ".tarballs"), {
      shared: { versions: { "1.0.0": {}, "1.1.0": {} }, latest: "1.0.0" },
      "dep-x": { versions: { "1.0.0": { dependencies: { shared: "latest" } } }, latest: "1.0.0" },
    }),
  );
  await writeTextLockfileBunfig();
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "root", dependencies: { shared: "1.1.0", "dep-x": "1.0.0" } }),
  );
  await runInPackageDir("install");
  expect(await lockedSharedResolutions()).toEqual(['"shared@1.0.0"', '"shared@1.1.0"']);

  await runInPackageDir("update", "shared", "--latest");
  expect((await file(join(package_dir, "package.json")).json()).dependencies).toEqual({
    shared: "1.1.0",
    "dep-x": "1.0.0",
  });
  expect(await lockedSharedResolutions()).toEqual(['"shared@1.0.0"', '"shared@1.1.0"']);
  expect(
    await file(join(package_dir, "node_modules", "dep-x", "node_modules", "shared", "package.json")).json(),
  ).toMatchObject({ version: "1.0.0" });
  expect(await file(join(package_dir, "node_modules", "shared", "package.json")).json()).toMatchObject({
    version: "1.1.0",
  });
});

it("bun update <name> --latest on a dist-tag entry follows the tag even when it moved backwards", async () => {
  const tgzDir = join(package_dir, ".tarballs");
  const versions = { "1.0.0": {}, "1.1.0": {} };
  await packPerName(tgzDir, { shared: { versions, latest: "1.1.0" } });
  setHandler(perNameHandler(tgzDir, { shared: { versions, latest: "1.1.0" } }));
  await writeTextLockfileBunfig();
  const packageJson = { name: "root", dependencies: { shared: "latest" } };
  await writeFile(join(package_dir, "package.json"), JSON.stringify(packageJson));
  await runInPackageDir("install");
  expect(await lockedSharedResolutions()).toEqual(['"shared@1.1.0"']);

  setHandler(perNameHandler(tgzDir, { shared: { versions, latest: "1.0.0" } }));
  await runInPackageDir("update", "shared", "--latest");
  expect(await file(join(package_dir, "package.json")).json()).toStrictEqual(packageJson);
  expect(await lockedSharedResolutions()).toEqual(['"shared@1.0.0"']);
  expect(await file(join(package_dir, "node_modules", "shared", "package.json")).json()).toMatchObject({
    version: "1.0.0",
  });

  await runInPackageDir("update");
  expect(await file(join(package_dir, "package.json")).json()).toStrictEqual(packageJson);
  expect(await lockedSharedResolutions()).toEqual(['"shared@1.0.0"']);
});

// `shared` is only reachable through dep-x; the install below pins 1.0.0 before the registry starts serving 1.1.0.
async function setupTransitiveOnlyShared() {
  const tgzDir = join(package_dir, ".tarballs");
  const depX = { "dep-x": { versions: { "1.0.0": { dependencies: { shared: "^1.0.0" } } }, latest: "1.0.0" } };
  const published = { ...depX, shared: { versions: { "1.0.0": {}, "1.1.0": {} }, latest: "1.1.0" } };
  await packPerName(tgzDir, published);
  setHandler(perNameHandler(tgzDir, { ...depX, shared: { versions: { "1.0.0": {} }, latest: "1.0.0" } }));
  await writeTextLockfileBunfig();
  const packageJson = { name: "root", dependencies: { "dep-x": "^1.0.0" } };
  await writeFile(join(package_dir, "package.json"), JSON.stringify(packageJson));
  await runInPackageDir("install");
  expect(await lockedSharedResolutions()).toStrictEqual(['"shared@1.0.0"']);
  setHandler(perNameHandler(tgzDir, published));
  return packageJson;
}

it("bun update <name> updates a package that is only a transitive dependency without adding it to package.json", async () => {
  const packageJson = await setupTransitiveOnlyShared();
  await runInPackageDir("update", "shared");
  expect(await file(join(package_dir, "package.json")).json()).toStrictEqual(packageJson);
  expect(await lockedSharedResolutions()).toStrictEqual(['"shared@1.1.0"']);
  expect(await file(join(package_dir, "node_modules", "shared", "package.json")).json()).toMatchObject({
    version: "1.1.0",
  });
});

it("bun update updates transitive dependencies", async () => {
  const packageJson = await setupTransitiveOnlyShared();
  const out = await runInPackageDir("update");
  expect(out).toContain("updating:\n  shared@1.0.0 → 1.1.0\n");
  expect(await file(join(package_dir, "package.json")).json()).toStrictEqual(packageJson);
  expect(await lockedSharedResolutions()).toStrictEqual(['"shared@1.1.0"']);
  expect(await file(join(package_dir, "node_modules", "shared", "package.json")).json()).toMatchObject({
    version: "1.1.0",
  });
});

it("bun update <name> rejects a name that is not in the lockfile", async () => {
  const packageJson = await setupTransitiveOnlyShared();
  const lockBefore = await file(join(package_dir, "bun.lock")).text();
  const { stderr, exited } = spawn({
    cmd: [bunExe(), "update", "not-a-dep"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env,
  });
  expect(await stderr.text()).toContain('error: "not-a-dep" is not in the lockfile, so there is nothing to update');
  expect(await exited).toBe(1);
  expect(await file(join(package_dir, "package.json")).json()).toStrictEqual(packageJson);
  expect(await file(join(package_dir, "bun.lock")).text()).toBe(lockBefore);
});

// Registry: no-deps 1.0.0/1.0.1/1.1.0/2.0.0; a-dep 1.0.1..1.0.10; dep-with-tags latest=3.0.0, pre-2=2.0.1; @types/* 1.0.0/2.0.0.
describe("bun update <name> semantics", () => {
  type Json = Record<string, any>;
  const verdaccio = new VerdaccioRegistry();

  beforeAll(async () => {
    await verdaccio.start();
  });

  afterAll(() => {
    verdaccio.stop();
  });

  const GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  // A manifest argument is either a bare dependency map or an object of package.json fields (groups, scripts).
  const isFields = (json: Json) => Object.keys(json).some(key => GROUPS.includes(key) || key === "scripts");
  const manifest = (json: Json): Json =>
    isFields(json) ? { name: "foo", ...json } : { name: "foo", dependencies: json };
  const declared = (json: Json): Record<string, string> =>
    isFields(json) ? Object.assign({}, ...GROUPS.map(group => json[group] ?? {})) : json;
  const stringify = (json: Json) => JSON.stringify(json, null, 2) + "\n";
  const packageJsonOf = (dir: string, rel = ""): Promise<Json> => file(join(dir, rel, "package.json")).json();
  const packageJsonText = (dir: string, rel = "") => file(join(dir, rel, "package.json")).text();
  const lockText = (dir: string) => file(join(dir, "bun.lock")).text();
  const lock = async (dir: string): Promise<Json> => Bun.JSONC.parse(await lockText(dir)) as Json;
  const installedVersion = async (dir: string, name: string): Promise<string> =>
    (await file(join(dir, "node_modules", name, "package.json")).json()).version;

  async function run(dir: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd: dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  async function install(dir: string, ...args: string[]) {
    const { stderr, exitCode } = await run(dir, "install", ...args);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    return stderr;
  }

  async function update(dir: string, ...args: string[]) {
    const result = await run(dir, "update", ...args);
    expect(result.stderr).not.toContain("error:");
    expect(result.exitCode).toBe(0);
    return result;
  }

  async function createDir(files: Record<string, Json | string>) {
    const { packageDir } = await verdaccio.createTestDir({
      bunfigOpts: { saveTextLockfile: true, linker: "hoisted" },
      files: Object.fromEntries(
        Object.entries(files).map(([path, json]) => [path, typeof json === "string" ? json : stringify(json)]),
      ),
    });
    return packageDir;
  }

  async function setup(json: Json) {
    const dir = await createDir({ "package.json": manifest(json) });
    await install(dir);
    return dir;
  }

  // Pin exactly, then widen: the locked versions still satisfy the new ranges, so only `bun update` moves them.
  async function stale(pinned: Json, widened: Json) {
    const dir = await setup(pinned);
    await writeFile(join(dir, "package.json"), stringify(manifest(widened)));
    expect(await install(dir)).toContain("Saved lockfile");
    for (const [name, literal] of Object.entries(declared(pinned))) {
      expect(await installedVersion(dir, name)).toBe(literal.replace(/^npm:[^@]+@/, ""));
    }
    return dir;
  }

  // Every version of `name` resolved anywhere in bun.lock, including behind an alias.
  async function lockedVersions(dir: string, name: string) {
    const { packages } = await lock(dir);
    const versions = Object.values(packages as Record<string, [string]>)
      .map(([resolution]) => resolution)
      .filter(resolution => resolution.startsWith(`${name}@`))
      .map(resolution => resolution.slice(name.length + 1));
    return [...new Set(versions)].sort();
  }

  // `expected` is a dependency map, or an object of groups when several groups are asserted at once.
  async function expectInSync(dir: string, expected: Json) {
    const groups: Json = isFields(expected) ? expected : { dependencies: expected };
    const packageJson = await packageJsonOf(dir);
    const root = (await lock(dir)).workspaces[""];
    for (const group of GROUPS) {
      if (!(group in groups)) continue;
      expect(packageJson[group]).toEqual(groups[group]);
      expect(root[group]).toEqual(groups[group]);
    }
    await install(dir, "--frozen-lockfile");
  }

  async function expectUnchanged(dir: string, before: { packageJson: string; lock: string }) {
    expect(await packageJsonText(dir)).toBe(before.packageJson);
    expect(await lockText(dir)).toBe(before.lock);
  }

  const snapshotFiles = async (dir: string) => ({ packageJson: await packageJsonText(dir), lock: await lockText(dir) });

  const SIBLINGS_PINNED = { "no-deps": "1.0.0", "a-dep": "1.0.1" };
  const SIBLINGS_WIDENED = { "no-deps": "^1.0.0", "a-dep": "^1.0.1" };

  for (const flags of [[], ["--latest"]]) {
    it.concurrent(`bun update ${["a-dep", ...flags].join(" ")} leaves a stale unnamed sibling alone`, async () => {
      const dir = await stale(SIBLINGS_PINNED, SIBLINGS_WIDENED);
      await update(dir, "a-dep", ...flags);
      await expectInSync(dir, { "no-deps": "^1.0.0", "a-dep": "^1.0.10" });
      expect(await lockedVersions(dir, "a-dep")).toEqual(["1.0.10"]);
      expect(await lockedVersions(dir, "no-deps")).toEqual(["1.0.0"]);
      expect(await installedVersion(dir, "a-dep")).toBe("1.0.10");
      expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
    });
  }

  it.concurrent("bun update <name> keeps a dist-tag literal as written", async () => {
    const dir = await setup({ "dep-with-tags": "pre-2" });
    expect(await installedVersion(dir, "dep-with-tags")).toBe("2.0.1");
    await update(dir, "dep-with-tags");
    await expectInSync(dir, { "dep-with-tags": "pre-2" });
    expect(await lockedVersions(dir, "dep-with-tags")).toEqual(["2.0.1"]);
  });

  for (const args of [[], ["dep-with-tags"]]) {
    it.concurrent(
      `bun update ${[...args, "--latest"].join(" ")} keeps a dist-tag literal and follows the tag`,
      async () => {
        const dir = await setup({ "dep-with-tags": "pre-2" });
        expect(await installedVersion(dir, "dep-with-tags")).toBe("2.0.1");
        const lockBefore = await lockText(dir);
        await update(dir, ...args, "--latest");
        await expectInSync(dir, { "dep-with-tags": "pre-2" });
        expect(await lockedVersions(dir, "dep-with-tags")).toEqual(["2.0.1"]);
        expect(await installedVersion(dir, "dep-with-tags")).toBe("2.0.1");
        expect(await lockText(dir)).toBe(lockBefore);
      },
    );
  }

  it.concurrent("bun update --latest keeps a dist-tag literal next to a range it does rewrite", async () => {
    const dir = await setup({ "dep-with-tags": "pre-2", "no-deps": "~1.0.0" });
    const { stdout } = await update(dir, "--latest");
    await expectInSync(dir, { "dep-with-tags": "pre-2", "no-deps": "~2.0.0" });
    expect(await lockedVersions(dir, "dep-with-tags")).toEqual(["2.0.1"]);
    expect(await lockedVersions(dir, "no-deps")).toEqual(["2.0.0"]);
    expect(stdout).toContain("no-deps");
    expect(stdout).not.toContain("dep-with-tags");
  });

  it.concurrent("bun update --latest keeps an aliased dist-tag", async () => {
    const dir = await setup({ tagged: "npm:dep-with-tags@pre-2" });
    const before = await snapshotFiles(dir);
    await update(dir, "--latest");
    await expectUnchanged(dir, before);
    await expectInSync(dir, { tagged: "npm:dep-with-tags@pre-2" });
    expect(await installedVersion(dir, "tagged")).toBe("2.0.1");
  });

  it.concurrent("bun update --latest is a no-op on `latest` literals whose tag has not moved", async () => {
    const dir = await setup({ "no-deps": "latest", aliased: "npm:a-dep@latest" });
    const before = await snapshotFiles(dir);
    const { stderr } = await update(dir, "--latest");
    expect(stderr).not.toContain("Saved lockfile");
    await expectUnchanged(dir, before);
    expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
    expect(await installedVersion(dir, "aliased")).toBe("1.0.10");
  });

  it.concurrent.each<[string, string, string[]]>([
    ["*", "2.0.0", []],
    ["1", "1.1.0", []],
    ["1.x", "1.1.0", []],
    [">=1.0.0 <2", "1.1.0", []],
    ["1.0.0 - 1.0.1", "1.0.1", []],
    ["npm:no-deps@1.x", "1.1.0", []],
    ["*", "2.0.0", ["no-deps"]],
  ])(
    "a plain update keeps the range %p as written and only moves bun.lock to %p (extra args: %p)",
    async (literal, version, names) => {
      const pin = literal.startsWith("npm:") ? "npm:no-deps@1.0.0" : "1.0.0";
      const dir = await stale({ "no-deps": pin }, { "no-deps": literal });
      await update(dir, ...names);
      await expectInSync(dir, { "no-deps": literal });
      expect(await lockedVersions(dir, "no-deps")).toEqual([version]);
      expect(await installedVersion(dir, "no-deps")).toBe(version);
    },
  );

  it.concurrent("--latest still rewrites a non-caret range", async () => {
    const dir = await setup({ "no-deps": "1.x" });
    await update(dir, "--latest");
    await expectInSync(dir, { "no-deps": "^2.0.0" });
    expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
  });

  it.concurrent("bun update <name>@<range> on a non-caret entry writes the caret form", async () => {
    const dir = await setup({ "no-deps": "*" });
    await update(dir, "no-deps@1");
    await expectInSync(dir, { "no-deps": "^1.1.0" });
    expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
  });

  it.concurrent("bun update <real name> reaches a dependency declared behind an npm: alias", async () => {
    const dir = await stale({ aliased: "npm:no-deps@1.0.0" }, { aliased: "npm:no-deps@~1.0.0" });
    expect(await lockedVersions(dir, "no-deps")).toEqual(["1.0.0"]);
    await update(dir, "no-deps");
    await expectInSync(dir, { aliased: "npm:no-deps@~1.0.1" });
    expect(await lockedVersions(dir, "no-deps")).toEqual(["1.0.1"]);
    expect(await installedVersion(dir, "aliased")).toBe("1.0.1");
  });

  it.concurrent(
    "bun update <real name> moves the plain entry and the aliased entry, each within its own range",
    async () => {
      const dir = await stale(
        { "no-deps": "1.0.0", aliased: "npm:no-deps@1.0.0" },
        { "no-deps": "^1.0.0", aliased: "npm:no-deps@~1.0.0" },
      );
      await update(dir, "no-deps");
      await expectInSync(dir, { "no-deps": "^1.1.0", aliased: "npm:no-deps@~1.0.1" });
      expect(await lockedVersions(dir, "no-deps")).toEqual(["1.0.1", "1.1.0"]);
      expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
      expect(await installedVersion(dir, "aliased")).toBe("1.0.1");
    },
  );

  it.concurrent("bun update <real name> --latest moves an aliased entry to latest in its pin style", async () => {
    const dir = await setup({ aliased: "npm:no-deps@~1.0.0" });
    expect(await installedVersion(dir, "aliased")).toBe("1.0.1");
    await update(dir, "no-deps", "--latest");
    await expectInSync(dir, { aliased: "npm:no-deps@~2.0.0" });
    expect(await lockedVersions(dir, "no-deps")).toEqual(["2.0.0"]);
    expect(await installedVersion(dir, "aliased")).toBe("2.0.0");
  });

  for (const flag of ["--latest", "-L"]) {
    it.concurrent(`bun update <name>@<version> ${flag} is an error and writes nothing`, async () => {
      const dir = await setup({ "no-deps": "~1.0.0" });
      const before = await snapshotFiles(dir);
      const { stderr, exitCode } = await run(dir, "update", "no-deps@1", flag);
      expect(stderr).toContain("error: --latest cannot be combined with a version");
      expect(stderr).not.toContain("Saved lockfile");
      await expectUnchanged(dir, before);
      expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");
      expect(exitCode).not.toBe(0);
    });
  }

  it.concurrent("bun update <name> --dry-run writes nothing", async () => {
    const dir = await stale({ "no-deps": "1.0.0" }, { "no-deps": "^1.0.0" });
    const before = await snapshotFiles(dir);
    const { stderr } = await update(dir, "no-deps", "--dry-run");
    expect(stderr).not.toContain("Saved lockfile");
    await expectUnchanged(dir, before);
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
  });

  it.concurrent("bun update leaves an =x.y.z pin untouched", async () => {
    const dir = await setup({ "no-deps": "=1.0.0" });
    const before = await snapshotFiles(dir);
    await update(dir);
    await expectUnchanged(dir, before);
    await expectInSync(dir, { "no-deps": "=1.0.0" });
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
  });

  it.concurrent("-L is an alias of --latest, bare and named", async () => {
    const bare = await setup({ "no-deps": "~1.0.0", "a-dep": "~1.0.1" });
    await update(bare, "-L");
    await expectInSync(bare, { "no-deps": "~2.0.0", "a-dep": "~1.0.10" });

    const named = await setup({ "no-deps": "~1.0.0", "a-dep": "~1.0.1" });
    await update(named, "no-deps", "-L");
    await expectInSync(named, { "no-deps": "~2.0.0", "a-dep": "~1.0.1" });

    const { stdout, exitCode } = await run(named, "update", "--help");
    expect(stdout).toContain("-L, --latest");
    expect(stdout).toContain("-d, --dev");
    expect(exitCode).toBe(0);
  });

  it.concurrent("bun up is an alias of bun update", async () => {
    const dir = await stale({ "no-deps": "1.0.0" }, { "no-deps": "^1.0.0" });
    const up = await run(dir, "up");
    expect(up.stderr).not.toContain("error:");
    expect(up.exitCode).toBe(0);
    await expectInSync(dir, { "no-deps": "^1.1.0" });

    const upLatest = await run(dir, "up", "no-deps", "-L");
    expect(upLatest.stderr).not.toContain("error:");
    expect(upLatest.exitCode).toBe(0);
    await expectInSync(dir, { "no-deps": "^2.0.0" });

    const help = await run(dir, "up", "--help");
    expect(help.stdout).toContain("bun update");
    expect(help.exitCode).toBe(0);
  });

  it.concurrent("bun up wins over a package.json script named up; bun run up still runs the script", async () => {
    const scripts = { up: "echo SCRIPT_RAN" };
    const dir = await stale(
      { dependencies: { "no-deps": "1.0.0" }, scripts },
      { dependencies: { "no-deps": "^1.0.0" }, scripts },
    );
    const up = await run(dir, "up");
    expect(up.stdout).not.toContain("SCRIPT_RAN");
    expect(up.exitCode).toBe(0);
    await expectInSync(dir, { "no-deps": "^1.1.0" });

    const script = await run(dir, "run", "up");
    expect(script.stdout).toContain("SCRIPT_RAN");
    expect(script.exitCode).toBe(0);
  });

  describe("patterns", () => {
    const TRIO_PINNED = { "no-deps": "1.0.0", "a-dep": "1.0.1", "dep-with-tags": "1.0.0" };
    const TRIO_WIDENED = { "no-deps": "^1.0.0", "a-dep": "^1.0.1", "dep-with-tags": "^1.0.0" };

    it.concurrent("bun update '@types/*' --latest updates the matching packages and nothing else", async () => {
      const dir = await stale(
        { "@types/no-deps": "1.0.0", "@types/is-number": "1.0.0", "no-deps": "1.0.0" },
        { "@types/no-deps": "^1.0.0", "@types/is-number": "^1.0.0", "no-deps": "^1.0.0" },
      );
      await update(dir, "@types/*", "--latest");
      await expectInSync(dir, { "@types/no-deps": "^2.0.0", "@types/is-number": "^2.0.0", "no-deps": "^1.0.0" });
      expect(await lockedVersions(dir, "no-deps")).toEqual(["1.0.0"]);
      expect(await installedVersion(dir, "@types/no-deps")).toBe("2.0.0");
      expect(await installedVersion(dir, "@types/is-number")).toBe("2.0.0");
    });

    it.concurrent("two patterns update the union within their ranges", async () => {
      const dir = await stale(TRIO_PINNED, TRIO_WIDENED);
      await update(dir, "a-*", "dep-*");
      await expectInSync(dir, { "no-deps": "^1.0.0", "a-dep": "^1.0.10", "dep-with-tags": "^1.0.1" });
      expect(await lockedVersions(dir, "no-deps")).toEqual(["1.0.0"]);
      expect(await lockedVersions(dir, "a-dep")).toEqual(["1.0.10"]);
      expect(await lockedVersions(dir, "dep-with-tags")).toEqual(["1.0.1"]);
    });

    it.concurrent("--dry-run with a pattern writes nothing", async () => {
      const dir = await stale(TRIO_PINNED, TRIO_WIDENED);
      const before = await snapshotFiles(dir);
      const { stderr } = await update(dir, "a-*", "--dry-run");
      expect(stderr).not.toContain("Saved lockfile");
      await expectUnchanged(dir, before);
      expect(await installedVersion(dir, "a-dep")).toBe("1.0.1");
    });

    it.concurrent.each([
      [[], { "no-deps": "^1.0.0", "a-dep": "^1.0.10", "dep-with-tags": "^1.0.1" }],
      [["--latest"], { "no-deps": "^1.0.0", "a-dep": "^1.0.10", "dep-with-tags": "^3.0.0" }],
    ])("a negation pattern updates everything except the match (flags: %p)", async (flags, expected) => {
      const dir = await stale(TRIO_PINNED, TRIO_WIDENED);
      await update(dir, "!no-deps", ...flags);
      await expectInSync(dir, expected);
      expect(await lockedVersions(dir, "no-deps")).toEqual(["1.0.0"]);
    });

    it.concurrent("a positive pattern minus a negation updates the matched set minus the exclusion", async () => {
      const dir = await stale(TRIO_PINNED, TRIO_WIDENED);
      await update(dir, "*-*", "!a-dep");
      await expectInSync(dir, { "no-deps": "^1.1.0", "a-dep": "^1.0.1", "dep-with-tags": "^1.0.1" });
      expect(await lockedVersions(dir, "a-dep")).toEqual(["1.0.1"]);
    });

    it.concurrent.each([
      ["zzz-*", 'error: no packages in bun.lock match "zzz-*"'],
      ["@types/*@2", "error: a version cannot be combined with a pattern: @types/*@2"],
    ])("bun update %p is an error that writes nothing", async (arg, message) => {
      const dir = await setup({ "no-deps": "~1.0.0" });
      const before = await snapshotFiles(dir);
      const { stderr, exitCode } = await run(dir, "update", arg);
      expect(stderr).toContain(message);
      expect(stderr).not.toContain("unrecognised dependency format");
      await expectUnchanged(dir, before);
      expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");
      expect(exitCode).toBe(1);
    });
  });

  describe("group selectors", () => {
    const THREE_GROUPS_PINNED = {
      dependencies: { "no-deps": "1.0.0" },
      devDependencies: { "a-dep": "1.0.1" },
      optionalDependencies: { "dep-with-tags": "1.0.0" },
    };
    const THREE_GROUPS_WIDENED = {
      dependencies: { "no-deps": "^1.0.0" },
      devDependencies: { "a-dep": "^1.0.1" },
      optionalDependencies: { "dep-with-tags": "^1.0.0" },
    };

    it.concurrent.each(["--dev", "-D"])("%s updates only devDependencies", async flag => {
      const dir = await stale(THREE_GROUPS_PINNED, THREE_GROUPS_WIDENED);
      await update(dir, flag);
      await expectInSync(dir, {
        dependencies: { "no-deps": "^1.0.0" },
        devDependencies: { "a-dep": "^1.0.10" },
        optionalDependencies: { "dep-with-tags": "^1.0.0" },
      });
      expect(await lockedVersions(dir, "no-deps")).toEqual(["1.0.0"]);
      expect(await lockedVersions(dir, "dep-with-tags")).toEqual(["1.0.0"]);
      expect(await lockedVersions(dir, "a-dep")).toEqual(["1.0.10"]);
      expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
      expect(await installedVersion(dir, "a-dep")).toBe("1.0.10");
    });

    it.concurrent.each(["--prod", "-P", "--production", "-p"])(
      "%s updates dependencies and optionalDependencies and keeps devDependencies installed",
      async flag => {
        const dir = await stale(THREE_GROUPS_PINNED, THREE_GROUPS_WIDENED);
        await update(dir, flag);
        await expectInSync(dir, {
          dependencies: { "no-deps": "^1.1.0" },
          devDependencies: { "a-dep": "^1.0.1" },
          optionalDependencies: { "dep-with-tags": "^1.0.1" },
        });
        expect(await lockedVersions(dir, "a-dep")).toEqual(["1.0.1"]);
        expect(await installedVersion(dir, "a-dep")).toBe("1.0.1");
        expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
        expect(await installedVersion(dir, "dep-with-tags")).toBe("1.0.1");
      },
    );

    it.concurrent("--dev composes with --latest", async () => {
      const dir = await setup({
        dependencies: { "dep-with-tags": "~1.0.0" },
        devDependencies: { "no-deps": "~1.0.0" },
      });
      await update(dir, "--dev", "--latest");
      await expectInSync(dir, {
        dependencies: { "dep-with-tags": "~1.0.0" },
        devDependencies: { "no-deps": "~2.0.0" },
      });
      expect(await lockedVersions(dir, "dep-with-tags")).toEqual(["1.0.1"]);
    });

    it.concurrent("--dev with a name declared in another group updates nothing", async () => {
      const dir = await stale(
        { dependencies: { "no-deps": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } },
        { dependencies: { "no-deps": "^1.0.0" }, devDependencies: { "a-dep": "^1.0.1" } },
      );
      const before = await snapshotFiles(dir);
      const { stderr, exitCode } = await run(dir, "update", "no-deps", "--dev");
      expect(stderr).toContain('error: no dependencies in the selected groups match "no-deps"');
      await expectUnchanged(dir, before);
      expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
      expect(exitCode).toBe(1);
    });
  });

  // Nothing is stale after `install` (no-deps ^ -> 1.1.0, ~ -> 1.0.1); what varies is which package.json files get rewritten.
  describe("bun update <name> -r / --filter", () => {
    const FILES: Record<string, Json | string> = {
      "package.json": { name: "root", workspaces: ["packages/*"], dependencies: { "no-deps": "^1.0.0" } },
      "packages/api/package.json": {
        name: "api",
        version: "1.0.0",
        dependencies: { "no-deps": "^1.0.0", "a-dep": "^1.0.1", aliased: "npm:no-deps@~1.0.0" },
      },
      "packages/web/package.json": '{"name":"web","peerDependencies":{"no-deps":"~1.0.0"}}',
      "packages/pkg-a/package.json": {
        name: "pkg-a",
        devDependencies: { "no-deps": "^1.0.0" },
        dependencies: { api: "workspace:*" },
      },
      "packages/pkg-b/package.json": '{"name":"pkg-b"}',
    };
    const MEMBERS = ["", "packages/api", "packages/web", "packages/pkg-a", "packages/pkg-b"] as const;
    type Texts = Record<(typeof MEMBERS)[number], string>;

    async function texts(dir: string): Promise<Texts> {
      const out = {} as Texts;
      for (const rel of MEMBERS) out[rel] = await packageJsonText(dir, rel);
      return out;
    }

    async function fanOut() {
      const dir = await createDir(FILES);
      await install(dir);
      expect(await lockedVersions(dir, "no-deps")).toEqual(["1.0.1", "1.1.0"]);
      return { dir, before: await texts(dir), lockBefore: await lockText(dir) };
    }

    const API_UPDATED = { "no-deps": "^1.1.0", "a-dep": "^1.0.1", aliased: "npm:no-deps@~1.0.1" };

    it.concurrent("--filter rewrites the selected workspace only, reaching an alias by its real name", async () => {
      const { dir, before } = await fanOut();
      await update(dir, "no-deps", "--filter", "api");
      expect((await packageJsonOf(dir, "packages/api")).dependencies).toEqual(API_UPDATED);
      const after = await texts(dir);
      expect(after).toEqual({ ...before, "packages/api": after["packages/api"] });
      const { workspaces } = await lock(dir);
      expect(workspaces["packages/api"].dependencies).toEqual(API_UPDATED);
      expect(workspaces[""].dependencies).toEqual({ "no-deps": "^1.0.0" });
      await install(dir, "--frozen-lockfile");
    });

    it.concurrent.each([[["-r"]], [["--filter", "*"]]])(
      "%p rewrites every workspace declaring the name, in whichever group, and leaves the rest byte-identical",
      async flags => {
        const { dir, before } = await fanOut();
        await update(dir, "no-deps", ...flags);
        expect((await packageJsonOf(dir)).dependencies).toEqual({ "no-deps": "^1.1.0" });
        expect((await packageJsonOf(dir, "packages/api")).dependencies).toEqual(API_UPDATED);
        expect(await packageJsonOf(dir, "packages/web")).toEqual({
          name: "web",
          peerDependencies: { "no-deps": "~1.0.1" },
        });
        expect(await packageJsonOf(dir, "packages/pkg-a")).toEqual({
          name: "pkg-a",
          devDependencies: { "no-deps": "^1.1.0" },
          dependencies: { api: "workspace:*" },
        });
        expect(await packageJsonText(dir, "packages/pkg-b")).toBe(before["packages/pkg-b"]);
        const { workspaces } = await lock(dir);
        expect(workspaces[""].dependencies).toEqual({ "no-deps": "^1.1.0" });
        expect(workspaces["packages/api"].dependencies).toEqual(API_UPDATED);
        expect(workspaces["packages/web"].peerDependencies).toEqual({ "no-deps": "~1.0.1" });
        expect(workspaces["packages/pkg-a"].devDependencies).toEqual({ "no-deps": "^1.1.0" });
        await install(dir, "--frozen-lockfile");
      },
    );

    it.concurrent(
      "--latest with two filters leaves unselected workspaces' ranges in package.json and bun.lock",
      async () => {
        const { dir, before } = await fanOut();
        await update(dir, "no-deps", "--latest", "--filter", "api", "--filter", "pkg-a");
        expect((await packageJsonOf(dir, "packages/api")).dependencies).toEqual({
          "no-deps": "^2.0.0",
          "a-dep": "^1.0.1",
          aliased: "npm:no-deps@~2.0.0",
        });
        expect((await packageJsonOf(dir, "packages/pkg-a")).devDependencies).toEqual({ "no-deps": "^2.0.0" });
        expect(await packageJsonText(dir)).toBe(before[""]);
        expect(await packageJsonText(dir, "packages/web")).toBe(before["packages/web"]);
        expect(await packageJsonText(dir, "packages/pkg-b")).toBe(before["packages/pkg-b"]);
        expect((await lock(dir)).workspaces[""].dependencies).toEqual({ "no-deps": "^1.0.0" });
        expect(await lockedVersions(dir, "no-deps")).toEqual(["1.0.1", "1.1.0", "2.0.0"]);
        await install(dir, "--frozen-lockfile");
      },
    );

    it.concurrent("several names never add a name to a workspace that does not declare it", async () => {
      const { dir, before } = await fanOut();
      await update(dir, "no-deps", "a-dep", "--filter", "api", "--filter", "web");
      expect((await packageJsonOf(dir, "packages/api")).dependencies).toEqual({ ...API_UPDATED, "a-dep": "^1.0.10" });
      expect(await packageJsonOf(dir, "packages/web")).toEqual({
        name: "web",
        peerDependencies: { "no-deps": "~1.0.1" },
      });
      const after = await texts(dir);
      expect(after).toEqual({
        ...before,
        "packages/api": after["packages/api"],
        "packages/web": after["packages/web"],
      });
      expect(JSON.stringify((await lock(dir)).workspaces["packages/web"])).not.toContain("a-dep");
      await install(dir, "--frozen-lockfile");
    });

    it.concurrent.each([
      [
        ["no-deps", "--filter", "pkg-b"],
        '"no-deps" is only a dependency of other workspaces, so there is nothing to update here',
      ],
      [["is-number", "--filter", "api"], '"is-number" is not in the lockfile, so there is nothing to update'],
      [["no-deps", "--filter", "nope"], 'No workspace packages matched the filter "nope"'],
    ])("bun update %p is an error that writes nothing", async (args, message) => {
      const { dir, before, lockBefore } = await fanOut();
      const { stderr, exitCode } = await run(dir, "update", ...args);
      expect(stderr).toContain(message);
      expect(await texts(dir)).toEqual(before);
      expect(await lockText(dir)).toBe(lockBefore);
      expect(exitCode).toBe(1);
    });

    it.concurrent("--dry-run writes nothing", async () => {
      const { dir, before, lockBefore } = await fanOut();
      const { stderr } = await update(dir, "no-deps", "--filter", "api", "--dry-run");
      expect(stderr).not.toContain("Saved lockfile");
      expect(await texts(dir)).toEqual(before);
      expect(await lockText(dir)).toBe(lockBefore);
    });

    it.concurrent("--filter decides the target, not the cwd", async () => {
      const { dir, before } = await fanOut();
      const { stderr, exitCode } = await run(join(dir, "packages", "web"), "update", "no-deps", "--filter", "api");
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect((await packageJsonOf(dir, "packages/api")).dependencies).toEqual(API_UPDATED);
      expect(await packageJsonText(dir, "packages/web")).toBe(before["packages/web"]);
      expect(await packageJsonText(dir)).toBe(before[""]);
    });

    it.concurrent("a catalog reference keeps the member's literal and moves the root catalog entry", async () => {
      const dir = await createDir({
        "package.json": { name: "root", workspaces: { packages: ["packages/*"], catalog: { "no-deps": "^1.0.0" } } },
        "packages/api/package.json": { name: "api", dependencies: { "no-deps": "catalog:" } },
        "packages/web/package.json": '{"name":"web","dependencies":{"no-deps":"catalog:"}}',
      });
      await install(dir);
      const webBefore = await packageJsonText(dir, "packages/web");
      await update(dir, "no-deps", "--latest", "--filter", "api");
      expect((await packageJsonOf(dir, "packages/api")).dependencies).toEqual({ "no-deps": "catalog:" });
      expect((await packageJsonOf(dir)).workspaces.catalog).toEqual({ "no-deps": "^2.0.0" });
      expect((await lock(dir)).catalog).toEqual({ "no-deps": "^2.0.0" });
      expect(await packageJsonText(dir, "packages/web")).toBe(webBefore);
      expect(await lockedVersions(dir, "no-deps")).toEqual(["2.0.0"]);
      await install(dir, "--frozen-lockfile");
    });

    // root -> app -> lib -> util; tool -> lib (devDependency); lone has no workspace edges.
    it.concurrent("an unnamed update accepts relation selectors", async () => {
      const dir = await createDir({
        "package.json": {
          name: "root",
          workspaces: ["packages/*"],
          dependencies: { app: "workspace:*", "dep-with-tags": "1.0.0" },
        },
        "packages/app/package.json": {
          name: "app",
          version: "1.0.0",
          dependencies: { lib: "workspace:*", "is-number": "1.0.0" },
        },
        "packages/lib/package.json": {
          name: "lib",
          version: "1.0.0",
          dependencies: { util: "workspace:*", "no-deps": "1.0.0" },
        },
        "packages/util/package.json": { name: "util", version: "1.0.0", dependencies: { "a-dep": "1.0.1" } },
        "packages/tool/package.json": {
          name: "tool",
          version: "1.0.0",
          devDependencies: { lib: "workspace:*" },
          dependencies: { "@types/is-number": "1.0.0" },
        },
        "packages/lone/package.json": { name: "lone", version: "1.0.0", dependencies: { "@types/no-deps": "1.0.0" } },
      });
      await install(dir);
      const untouched = ["", "packages/app", "packages/tool", "packages/lone"];
      const before = await Promise.all(untouched.map(rel => packageJsonText(dir, rel)));

      await update(dir, "--latest", "--filter", "lib...");
      const libDeps = { util: "workspace:*", "no-deps": "2.0.0" };
      const utilDeps = { "a-dep": "1.0.10" };
      expect((await packageJsonOf(dir, "packages/lib")).dependencies).toEqual(libDeps);
      expect((await packageJsonOf(dir, "packages/util")).dependencies).toEqual(utilDeps);
      expect(await Promise.all(untouched.map(rel => packageJsonText(dir, rel)))).toEqual(before);
      const { workspaces } = await lock(dir);
      expect(workspaces["packages/lib"].dependencies).toEqual(libDeps);
      expect(workspaces["packages/util"].dependencies).toEqual(utilDeps);
      await install(dir, "--frozen-lockfile");
    });

    // Installed once, then every node_modules is removed and a stale entry is planted in web's, so what an update links back is observable.
    async function linkRepo(linker: "hoisted" | "isolated") {
      const dir = await createDir({
        "package.json": { name: "root", workspaces: ["packages/*"], dependencies: { "a-dep": "^1.0.1" } },
        "packages/api/package.json": { name: "api", dependencies: { "no-deps": "^1.0.0" } },
        "packages/web/package.json": { name: "web", dependencies: { "is-number": "1.0.0" } },
      });
      await install(dir, `--linker=${linker}`);
      await rm(join(dir, "node_modules"), { recursive: true, force: true });
      if (linker === "isolated") {
        await rm(join(dir, "packages", "api", "node_modules"), { recursive: true, force: true });
        await rm(join(dir, "packages", "web", "node_modules"), { recursive: true, force: true });
      }
      await mkdir(join(dir, "packages", "web", "node_modules", "stale"), { recursive: true });
      await writeFile(join(dir, "packages", "web", "node_modules", "stale", "package.json"), '{"name":"stale"}');
      return dir;
    }

    const installed = (dir: string, rels: string[]) => Promise.all(rels.map(rel => exists(join(dir, rel))));

    const HOISTED_LINK_PATHS = [
      "node_modules/api",
      "node_modules/no-deps/package.json",
      "node_modules/web",
      "node_modules/is-number",
      "node_modules/a-dep",
      "packages/web/node_modules/stale/package.json",
    ];

    it.concurrent("a named --filter update links only the selected workspace (hoisted)", async () => {
      const dir = await linkRepo("hoisted");
      await update(dir, "no-deps", "--filter", "api", "--linker=hoisted");
      expect(await installed(dir, HOISTED_LINK_PATHS)).toEqual([true, true, false, false, false, true]);
      await install(dir, "--linker=hoisted");
      expect(await installed(dir, ["node_modules/is-number", "node_modules/a-dep"])).toEqual([true, true]);
    });

    it.concurrent("a named --filter update links only the selected workspace (isolated)", async () => {
      const dir = await linkRepo("isolated");
      await update(dir, "no-deps", "--filter", "api", "--linker=isolated");
      expect(
        await installed(dir, [
          "packages/api/node_modules/no-deps/package.json",
          "packages/web/node_modules/is-number",
          "packages/web/node_modules/stale/package.json",
          "node_modules/web",
        ]),
      ).toEqual([true, false, true, false]);
      await install(dir, "--linker=isolated");
      expect(await installed(dir, ["packages/web/node_modules/is-number/package.json"])).toEqual([true]);
    });

    it.concurrent("an unnamed --filter update links only the selected workspace", async () => {
      const dir = await linkRepo("hoisted");
      await update(dir, "--filter", "api", "--linker=hoisted");
      expect(await installed(dir, HOISTED_LINK_PATHS)).toEqual([true, true, false, false, false, true]);
    });

    it.concurrent.each([[["-r"]], [["--filter", "*"]]])(
      "a named update with %p still links every workspace and the root",
      async flags => {
        const dir = await linkRepo("hoisted");
        await update(dir, "no-deps", ...flags, "--linker=hoisted");
        expect(
          await installed(dir, [
            "node_modules/api",
            "node_modules/web",
            "node_modules/no-deps",
            "node_modules/is-number",
            "node_modules/a-dep",
          ]),
        ).toEqual([true, true, true, true, true]);
      },
    );
  });
});
