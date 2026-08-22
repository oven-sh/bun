import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test } from "bun:test";
import { chmod, copyFile, exists, link, lstat, mkdir, symlink, writeFile } from "fs/promises";
import { bunEnv, bunExe, bunEnv as env, normalizeBunSnapshot, readdirSorted, tempDir, tmpdirSync } from "harness";
import { cpSync } from "node:fs";
import { basename, join } from "path";
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
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(async () => {
  await dummyBeforeEach();
});
afterEach(dummyAfterEach);

it("should list top-level dependency", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        moo: "./moo",
      },
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.1.0",
      dependencies: {
        bar: "latest",
      },
    }),
  );
  {
    const { stderr, stdout, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  urls.length = 0;
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "ls"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await stderr.text()).toBe("");
  expect(await stdout.text()).toBe(`${package_dir} node_modules (2 installed)
└── moo@moo
`);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(2);
});

it("should list all dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        moo: "./moo",
      },
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.1.0",
      dependencies: {
        bar: "latest",
      },
    }),
  );
  {
    const { stderr, stdout, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  urls.length = 0;
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "ls", "--all"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await stderr.text()).toBe("");
  expect(await stdout.text()).toBe(`${package_dir} node_modules
├── bar@0.0.2
└── moo@moo
`);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(2);
});

it("should list top-level aliased dependency", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "moo-1": "./moo",
      },
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.1.0",
      dependencies: {
        "bar-1": "npm:bar",
      },
    }),
  );
  {
    const { stderr, stdout, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  urls.length = 0;
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "ls"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await stderr.text()).toBe("");
  expect(await stdout.text()).toBe(`${package_dir} node_modules (2 installed)
└── moo-1@moo
`);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(2);
});

it("should list aliased dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "moo-1": "./moo",
      },
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.1.0",
      dependencies: {
        "bar-1": "npm:bar",
      },
    }),
  );
  {
    const { stderr, stdout, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  urls.length = 0;
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "ls", "--all"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await stderr.text()).toBe("");
  expect(await stdout.text()).toBe(`${package_dir} node_modules
├── bar-1@0.0.2
└── moo-1@moo
`);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(2);
});

it("should list only trusted dependencies with --trusted", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: {
        cache: false,
        registry: `${root_url}/`,
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        moo: "./moo",
        bar: "latest",
      },
      trustedDependencies: ["bar"],
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.1.0",
    }),
  );
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }
  urls.length = 0;

  // --trusted shows only bar (in trustedDependencies), not moo
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "pm", "ls", "--trusted"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await stderr.text()).toBe("");
    expect(await stdout.text()).toBe(`${package_dir} node_modules (2 installed)
└── bar@0.0.2
`);
    expect(await exited).toBe(0);
  }

  // without --trusted still shows both
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "pm", "ls"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await stderr.text()).toBe("");
    expect(await stdout.text()).toBe(`${package_dir} node_modules (2 installed)
├── bar@0.0.2
└── moo@moo
`);
    expect(await exited).toBe(0);
  }
});

it("should list only trusted dependencies with --all --trusted", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: {
        cache: false,
        registry: `${root_url}/`,
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        moo: "./moo",
      },
      trustedDependencies: ["bar"],
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.1.0",
      dependencies: {
        bar: "latest",
      },
    }),
  );
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }
  urls.length = 0;

  // `bar` is a transitive dependency of `moo` (untrusted). Trust is by
  // package name, so `--all --trusted` must still find it regardless of
  // where it sits in the tree.
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "ls", "--all", "--trusted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await stderr.text()).toBe("");
  expect(await stdout.text()).toBe(`${package_dir} node_modules
└── bar@0.0.2
`);
  expect(await exited).toBe(0);
});

it("should list trusted transitive dependencies under untrusted parents with --all --trusted (isolated)", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  // Isolated linker gives every package its own nested node_modules, so the
  // trusted transitive dep lives under an untrusted parent folder.
  await writeFile(
    join(package_dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: {
        cache: false,
        registry: `${root_url}/`,
        linker: "isolated",
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        moo: "./moo",
      },
      trustedDependencies: ["bar"],
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.1.0",
      dependencies: {
        bar: "latest",
      },
    }),
  );
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }
  urls.length = 0;

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "ls", "--all", "--trusted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await stderr.text()).toBe("");
  expect(await stdout.text()).toBe(`${package_dir} node_modules
└── bar@0.0.2
`);
  expect(await exited).toBe(0);
});

it("should list nothing with --trusted when no dependencies are trusted", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: {
        cache: false,
        registry: `${root_url}/`,
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "latest",
      },
      trustedDependencies: [],
    }),
  );
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }
  urls.length = 0;

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "ls", "--trusted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await stderr.text()).toBe("");
  expect(await stdout.text()).toBe(`${package_dir} node_modules (1 installed)
`);
  expect(await exited).toBe(0);
});

async function spawnAndCollect(...args: string[]): Promise<[stdout: string, stderr: string, exitCode: number]> {
  await using proc = spawn({
    cmd: [bunExe(), ...args],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
}

// The root package has one dependency entry per workspace member plus one per
// declaration: ws-once has two entries, ws-twice three, ws-undeclared one, and
// the registry package bar two. `bun pm ls` must print one line per node_modules
// entry. bar-alias is its own node_modules entry even though it resolves to the
// same package as bar, so it stays listed.
async function installWorkspacesTheRootDependsOn(saveTextLockfile: boolean) {
  await writeFile(
    join(package_dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: {
        cache: false,
        registry: `${root_url}/`,
        saveTextLockfile,
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      workspaces: ["packages/*"],
      dependencies: {
        bar: "latest",
        "bar-alias": "npm:bar",
        "ws-twice": "workspace:*",
      },
      devDependencies: {
        bar: "latest",
        "ws-once": "workspace:*",
        "ws-twice": "workspace:*",
      },
      trustedDependencies: ["ws-once"],
    }),
  );
  for (const name of ["ws-once", "ws-twice", "ws-undeclared"]) {
    await mkdir(join(package_dir, "packages", name), { recursive: true });
    await writeFile(join(package_dir, "packages", name, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  }
  const [, err, exitCode] = await spawnAndCollect("install");
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(exitCode).toBe(0);
}

it.each([
  { lockfile: "bun.lock", saveTextLockfile: true },
  { lockfile: "bun.lockb", saveTextLockfile: false },
])("should list a workspace the root also depends on once ($lockfile)", async ({ lockfile, saveTextLockfile }) => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await installWorkspacesTheRootDependsOn(saveTextLockfile);
  expect(await exists(join(package_dir, lockfile))).toBeTrue();
  urls.length = 0;

  const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "ls");
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout, package_dir)).toMatchInlineSnapshot(`
    "<dir> node_modules (5 installed)
    ├── bar@0.0.2
    ├── bar-alias@0.0.2
    ├── ws-once@workspace:packages/ws-once
    ├── ws-twice@workspace:packages/ws-twice
    └── ws-undeclared@workspace:packages/ws-undeclared"
  `);
  expect(exitCode).toBe(0);
  expect(urls).toEqual([]);
});

// bun.lockb stores only the hashes of trustedDependencies and bun does not trust
// a hash alone, so --trusted lists nothing from a bun.lockb. Use bun.lock here.
it("should list a trusted workspace the root also depends on once with --trusted", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await installWorkspacesTheRootDependsOn(true);
  urls.length = 0;

  const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "ls", "--trusted");
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout, package_dir)).toMatchInlineSnapshot(`
    "<dir> node_modules (5 installed)
    └── ws-once@workspace:packages/ws-once"
  `);
  expect(exitCode).toBe(0);
  expect(urls).toEqual([]);
});

// The root's optional peer on bar is bound to the copy of bar that moo brings
// in. The listing must still show it: it is one of the root's own dependencies.
it("should list a root optional peer that a dependency provides", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        moo: "./moo",
      },
      peerDependencies: {
        bar: "*",
      },
      peerDependenciesMeta: {
        bar: { optional: true },
      },
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.1.0",
      dependencies: {
        bar: "latest",
      },
    }),
  );
  const [, err, installExitCode] = await spawnAndCollect("install");
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(installExitCode).toBe(0);
  urls.length = 0;

  const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "ls");
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout, package_dir)).toMatchInlineSnapshot(`
    "<dir> node_modules (2 installed)
    ├── bar@0.0.2
    └── moo@moo"
  `);
  expect(exitCode).toBe(0);
  expect(urls).toEqual([]);
});

it("should remove all cache", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "moo-1": "./moo",
      },
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.1.0",
      dependencies: {
        "bar-1": "npm:bar",
      },
    }),
  );
  let cache_dir: string = join(package_dir, "node_modules", ".cache");
  {
    const { stderr, stdout, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        BUN_INSTALL_CACHE_DIR: cache_dir,
      },
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(cache_dir)).toContain("bar");

  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "pm", "cache"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: cache_dir,
    },
  });
  expect(await new Response(stderr1).text()).toBe("");
  expect(await new Response(stdout1).text()).toBe(cache_dir);
  expect(await exited1).toBe(0);

  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "pm", "cache", "rm"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: cache_dir,
    },
  });
  expect(await new Response(stderr2).text()).toBe("");
  expect(await new Response(stdout2).text()).toInclude("Cleared 'bun install' cache\n");
  expect(await exited2).toBe(0);
  // The entries are removed. The directory itself stays, so a cache directory that is a
  // symlink or a mount point keeps working.
  expect(await readdirSorted(cache_dir)).toEqual([]);
});

it("bun install treats an empty BUN_INSTALL_CACHE_DIR as unset instead of caching into the project", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  using side = tempDir("pm-cache-empty-var-install", { "home/.keep": "", "tmp/.keep": "" });
  // dummyBeforeEach writes a bunfig.toml that disables the cache. This test needs it on.
  await writeFile(join(package_dir, "bunfig.toml"), `[install]\nregistry = "${root_url}/"\n`);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "0.0.2",
      },
    }),
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    env: cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: "", BUN_INSTALL: undefined, XDG_CACHE_HOME: undefined }),
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("+ bar@0.0.2");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  const isManifest = (name: string) => name.endsWith(".npm");
  expect((await readdirSorted(package_dir)).filter(name => name.includes("@@") || isManifest(name))).toEqual([]);
  const homeCache = await readdirSorted(join(String(side), "home", ".bun", "install", "cache"));
  expect(homeCache).toContain("bar@0.0.2@@localhost@@@1");
  // The manifest name hashes the registry URL, which includes the port.
  expect(homeCache.filter(isManifest)).toHaveLength(1);
});

/**
 * Environment for the `bun pm cache` tests. Every directory the cache directory
 * resolution can fall back to, and the temp directory that `bun pm cache rm` sweeps for
 * bunx entries, is inside `side`, so neither behavior under test can reach anything
 * outside the test's own temp directories. `BUN_INSTALL_CACHE_DIR` is unset unless the
 * test sets it. An override of `undefined` unsets the variable.
 */
function cacheEnv(side: string, overrides: Record<string, string | undefined> = {}): NodeJS.Dict<string> {
  const spawnEnv: NodeJS.Dict<string> = {
    ...env,
    HOME: join(side, "home"),
    USERPROFILE: join(side, "home"),
    XDG_CACHE_HOME: join(side, "xdg-cache"),
    BUN_INSTALL: join(side, "bun-install"),
    TMPDIR: join(side, "tmp"),
    TMP: join(side, "tmp"),
    TEMP: join(side, "tmp"),
    ...overrides,
  };
  if (!("BUN_INSTALL_CACHE_DIR" in overrides)) {
    delete spawnEnv.BUN_INSTALL_CACHE_DIR;
  }
  for (const key of Object.keys(spawnEnv)) {
    if (spawnEnv[key] === undefined) delete spawnEnv[key];
  }
  return spawnEnv;
}

async function pmCache(args: string[], cwd: string, spawnEnv: NodeJS.Dict<string>, exe: string = bunExe()) {
  await using proc = Bun.spawn({
    cmd: [exe, "pm", "cache", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: spawnEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const sideFiles = {
  "home/.ssh/id_canary": "keep",
  "bun-install/bin/bun-canary": "keep",
  "bun-install/install/cache/bar@0.0.2@@@1/package.json": "{}",
  "bun-install/install/cache/0123456789abcdef.npm": "manifest",
  "xdg-cache/.keep": "",
  "tmp/.keep": "",
};

const projectFiles = {
  "proj/package.json": JSON.stringify({ name: "demo" }),
  "proj/src/index.ts": "console.log(1);\n",
  "proj/.git/HEAD": "ref: refs/heads/main\n",
  "sibling/keep.txt": "keep",
};

const projectEntries = [".git", "package.json", "src"];
const envCacheEntries = ["0123456789abcdef.npm", "bar@0.0.2@@@1"];

// The bunx count is always 0: `cacheEnv` points the temp directory at an empty one.
const cleared = {
  stdout: "Cleared 'bun install' cache\nCleared 0 cached 'bunx' packages\n",
  stderr: "",
  exitCode: 0,
};

function refused(cacheDir: string, reason: string) {
  return {
    stdout: "Cleared 0 cached 'bunx' packages\n",
    stderr:
      `error: refusing to clear "${cacheDir}": ${reason}\n` +
      "note: the cache directory comes from $BUN_INSTALL_CACHE_DIR or $BUN_INSTALL. " +
      "Point it at a directory that holds nothing but the bun install cache.\n",
    exitCode: 1,
  };
}

describe("bun pm cache with an empty variable", () => {
  test("an empty BUN_INSTALL_CACHE_DIR falls through to the next location", async () => {
    using side = tempDir("pm-cache-empty-cache-dir", sideFiles);
    using root = tempDir("pm-cache-empty-cache-dir-project", projectFiles);
    const proj = join(String(root), "proj");
    const spawnEnv = cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: "" });
    const envCache = join(String(side), "bun-install", "install", "cache");

    expect(await pmCache([], proj, spawnEnv)).toEqual({ stdout: envCache, stderr: "", exitCode: 0 });

    expect(await pmCache(["rm"], proj, spawnEnv)).toEqual(cleared);
    expect(await readdirSorted(proj)).toEqual(projectEntries);
    expect(await readdirSorted(envCache)).toEqual([]);
  });

  test("an empty BUN_INSTALL falls through to the next location", async () => {
    using side = tempDir("pm-cache-empty-bun-install", sideFiles);
    using root = tempDir("pm-cache-empty-bun-install-project", projectFiles);
    const proj = join(String(root), "proj");
    const spawnEnv = cacheEnv(String(side), { BUN_INSTALL: "" });

    expect(await pmCache([], proj, spawnEnv)).toEqual({
      stdout: join(String(side), "xdg-cache", ".bun", "install", "cache"),
      stderr: "",
      exitCode: 0,
    });
    expect(await exists(join(proj, "install"))).toBeFalse();
  });
});

describe("bun pm cache rm refuses a cache directory that holds more than the cache", () => {
  test("the project directory", async () => {
    using side = tempDir("pm-cache-rm-project", sideFiles);
    using root = tempDir("pm-cache-rm-project-project", projectFiles);
    const proj = join(String(root), "proj");

    const result = await pmCache(["rm"], proj, cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: proj }));
    expect(await readdirSorted(proj)).toEqual(projectEntries);
    expect(result).toEqual(refused(proj, `it is the project directory ("${proj}")`));
  });

  test("a parent of the project directory (relative setting)", async () => {
    using side = tempDir("pm-cache-rm-parent", sideFiles);
    using root = tempDir("pm-cache-rm-parent-project", projectFiles);
    const proj = join(String(root), "proj");

    const result = await pmCache(["rm"], proj, cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: ".." }));
    expect(await readdirSorted(String(root))).toEqual(["proj", "sibling"]);
    expect(await readdirSorted(proj)).toEqual(projectEntries);
    expect(result).toEqual(refused(String(root), `it contains the project directory ("${proj}")`));
  });

  test("the directory the command runs from, inside a workspace", async () => {
    using side = tempDir("pm-cache-rm-cwd", sideFiles);
    using root = tempDir("pm-cache-rm-cwd-workspace", {
      "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      "packages/a/package.json": JSON.stringify({ name: "a" }),
      "packages/b/package.json": JSON.stringify({ name: "b" }),
    });
    const packages = join(String(root), "packages");
    const cwd = join(packages, "a");

    const result = await pmCache(["rm"], cwd, cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: packages }));
    expect(await readdirSorted(packages)).toEqual(["a", "b"]);
    expect(result).toEqual(refused(packages, `it contains the current directory ("${cwd}")`));
  });

  test("the home directory", async () => {
    using side = tempDir("pm-cache-rm-home", sideFiles);
    using root = tempDir("pm-cache-rm-home-project", projectFiles);
    const proj = join(String(root), "proj");
    const home = join(String(side), "home");

    const result = await pmCache(["rm"], proj, cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: home }));
    expect(await exists(join(home, ".ssh", "id_canary"))).toBeTrue();
    expect(result).toEqual(refused(home, `it is the home directory ("${home}")`));
  });

  test("$BUN_INSTALL", async () => {
    using side = tempDir("pm-cache-rm-bun-install", sideFiles);
    using root = tempDir("pm-cache-rm-bun-install-project", projectFiles);
    const proj = join(String(root), "proj");
    const bunInstall = join(String(side), "bun-install");

    const result = await pmCache(["rm"], proj, cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: bunInstall }));
    expect(await exists(join(bunInstall, "bin", "bun-canary"))).toBeTrue();
    expect(result).toEqual(refused(bunInstall, `it is $BUN_INSTALL ("${bunInstall}")`));
  });

  test("the directory that holds the running bun executable", async () => {
    using side = tempDir("pm-cache-rm-exe", sideFiles);
    using root = tempDir("pm-cache-rm-exe-project", projectFiles);
    const proj = join(String(root), "proj");
    // Run a second name for the binary from inside the temp tree. Without the refusal,
    // this command deletes the directory that holds the binary, which must not be the
    // build directory.
    const bin = join(String(root), "bin");
    const exe = join(bin, basename(bunExe()));
    await mkdir(bin);
    await link(bunExe(), exe).catch(async () => {
      await copyFile(bunExe(), exe);
      await chmod(exe, 0o755);
    });

    const result = await pmCache(["rm"], proj, cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: bin }), exe);
    expect(await exists(exe)).toBeTrue();
    expect(result).toEqual(refused(bin, `it contains the bun executable ("${exe}")`));
  });

  test("a symlink to the home directory", async () => {
    using side = tempDir("pm-cache-rm-symlink-home", sideFiles);
    using root = tempDir("pm-cache-rm-symlink-home-project", projectFiles);
    const proj = join(String(root), "proj");
    const home = join(String(side), "home");
    const link = join(String(root), "cache-link");
    await symlink(home, link, "junction");

    const result = await pmCache(["rm"], proj, cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: link }));
    expect(await exists(join(home, ".ssh", "id_canary"))).toBeTrue();
    expect(result).toEqual(refused(home, `it is the home directory ("${home}")`));
  });
});

describe("bun pm cache rm clears the entries and keeps the directory", () => {
  test("a cache directory that is a symlink", async () => {
    using side = tempDir("pm-cache-rm-symlink", sideFiles);
    using root = tempDir("pm-cache-rm-symlink-project", projectFiles);
    const proj = join(String(root), "proj");
    const target = join(String(side), "bun-install", "install", "cache");
    const link = join(String(root), "cache-link");
    await symlink(target, link, "junction");
    expect(await readdirSorted(target)).toEqual(envCacheEntries);

    expect(await pmCache(["rm"], proj, cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: link }))).toEqual(cleared);
    expect(await readdirSorted(target)).toEqual([]);
    expect((await lstat(link)).isSymbolicLink()).toBeTrue();
    expect(await readdirSorted(link)).toEqual([]);
  });

  test("an entry that is a symlink is unlinked, not followed", async () => {
    using side = tempDir("pm-cache-rm-entry-symlink", sideFiles);
    using root = tempDir("pm-cache-rm-entry-symlink-project", projectFiles);
    const proj = join(String(root), "proj");
    const envCache = join(String(side), "bun-install", "install", "cache");
    const sibling = join(String(root), "sibling");
    await symlink(sibling, join(envCache, "escape@1.0.0@@@1"), "junction");

    expect(await pmCache(["rm"], proj, cacheEnv(String(side)))).toEqual(cleared);
    expect(await readdirSorted(envCache)).toEqual([]);
    expect(await readdirSorted(sibling)).toEqual(["keep.txt"]);
  });

  test("a cache directory that does not exist is not created", async () => {
    using side = tempDir("pm-cache-rm-missing", sideFiles);
    using root = tempDir("pm-cache-rm-missing-project", projectFiles);
    const proj = join(String(root), "proj");
    const missing = join(String(side), "does-not-exist");

    expect(await pmCache(["rm"], proj, cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: missing }))).toEqual(cleared);
    expect(await exists(missing)).toBeFalse();
  });

  test("a cache directory named by the project's .npmrc is not the one cleared", async () => {
    using side = tempDir("pm-cache-rm-npmrc", sideFiles);
    using root = tempDir("pm-cache-rm-npmrc-project", { ...projectFiles, "proj/.npmrc": "cache=.\n" });
    const proj = join(String(root), "proj");
    const envCache = join(String(side), "bun-install", "install", "cache");
    const spawnEnv = cacheEnv(String(side));

    // `bun pm cache` (like `bun install`) reads the directory from the .npmrc...
    expect(await pmCache([], proj, spawnEnv)).toEqual({ stdout: proj, stderr: "", exitCode: 0 });

    // ...but a file committed to the repository cannot choose what `bun pm cache rm` deletes.
    expect(await pmCache(["rm"], proj, spawnEnv)).toEqual(cleared);
    expect(await readdirSorted(proj)).toEqual([".git", ".npmrc", "package.json", "src"]);
    expect(await readdirSorted(envCache)).toEqual([]);
  });
});

it("bun pm migrate", async () => {
  const test_dir = tmpdirSync();

  cpSync(join(import.meta.dir, "migration/contoso-test"), test_dir, { recursive: true });

  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "pm", "migrate", "--force"],
    cwd: test_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  expect(exitCode).toBe(0);

  expect(stdout.toString("utf-8")).toBe("");
  expect(stderr.toString("utf-8")).toEndWith("migrated lockfile from package-lock.json\n");

  const hashExec = Bun.spawnSync({
    cmd: [bunExe(), "pm", "hash"],
    cwd: test_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  expect(hashExec.exitCode).toBe(0);
  const hash = hashExec.stdout.toString("utf-8").trim();

  expect(hash).toMatchSnapshot();
});

test("bun whoami executes pm whoami", async () => {
  // Test that "bun whoami" doesn't show reservation message and instead executes pm whoami
  // First create a simple package.json
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "test-whoami",
      version: "1.0.0",
    }),
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "whoami"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stderrText, stdoutText, exitCode] = await Promise.all([
    new Response(stderr).text(),
    new Response(stdout).text(),
    exited,
  ]);

  // Should get authentication error instead of reservation message
  expect(stderrText).toContain("missing authentication");
  expect(stderrText).not.toContain("reserved for future use");
  expect(stdoutText).not.toContain("reserved for future use");

  // Exit code will be non-zero due to missing auth
  expect(exitCode).toBe(1);
});

test("bun pm whoami still works", async () => {
  // Test that "bun pm whoami" still works as expected
  // First create a simple package.json
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "test-pm-whoami",
      version: "1.0.0",
    }),
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "whoami"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stderrText, stdoutText, exitCode] = await Promise.all([
    new Response(stderr).text(),
    new Response(stdout).text(),
    exited,
  ]);

  // Should get authentication error
  expect(stderrText).toContain("missing authentication");
  expect(stderrText).not.toContain("reserved for future use");
  expect(stdoutText).not.toContain("reserved for future use");

  // Exit code will be non-zero due to missing auth
  expect(exitCode).toBe(1);
});

test.each([
  {
    name: "bun list executes pm ls",
    cmd: ["list"],
    packageName: "test-list",
    dependencies: { bar: "latest" },
    expectedOutput: (dir: string) => `${dir} node_modules (1 installed)\n└── bar@0.0.2\n`,
    checkReservationMessage: true,
  },
  {
    name: "bun pm list works as alias for bun pm ls",
    cmd: ["pm", "list"],
    packageName: "test-pm-list",
    dependencies: { bar: "latest" },
    expectedOutput: (dir: string) => `${dir} node_modules (1 installed)\n└── bar@0.0.2\n`,
    checkReservationMessage: false,
  },
  {
    name: "bun pm ls still works",
    cmd: ["pm", "ls"],
    packageName: "test-pm-ls",
    dependencies: { bar: "latest" },
    expectedOutput: (dir: string) => `${dir} node_modules (1 installed)\n└── bar@0.0.2\n`,
    checkReservationMessage: false,
  },
])("$name", async ({ cmd, packageName, dependencies, expectedOutput, checkReservationMessage }) => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: packageName,
      version: "1.0.0",
      dependencies,
    }),
  );

  // Install dependencies first
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }

  // Test the command
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), ...cmd],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const [stderrText, stdoutText, exitCode] = await Promise.all([
    new Response(stderr).text(),
    new Response(stdout).text(),
    exited,
  ]);

  expect(stderrText).toBe("");
  if (checkReservationMessage) {
    expect(stdoutText).not.toContain("reserved for future use");
  }
  expect(stdoutText).toBe(expectedOutput(package_dir));
  expect(exitCode).toBe(0);
});

test("bun list --all shows full dependency tree", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "test-list-all",
      version: "1.0.0",
      dependencies: {
        moo: "./moo",
      },
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.1.0",
      dependencies: {
        bar: "latest",
      },
    }),
  );

  // Install dependencies first
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }

  // Test "bun list --all"
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "list", "--all"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const [stderrText, stdoutText, exitCode] = await Promise.all([
    new Response(stderr).text(),
    new Response(stdout).text(),
    exited,
  ]);

  expect(stderrText).toBe("");
  expect(stdoutText).toBe(`${package_dir} node_modules
├── bar@0.0.2
└── moo@moo
`);
  expect(exitCode).toBe(0);
});

test("bun pm cache rm resolves the cache directory from the process environment, ignoring project-local .env overrides", async () => {
  using dir = tempDir("pm-cache-rm-project-env", {
    "package.json": JSON.stringify({ name: "cache-rm-project-env", version: "1.0.0" }),
    "unrelated/keep.txt": "do not delete",
    "bun-install/install/cache/cached-package.txt": "cached artifact",
  });
  const dirStr = String(dir);
  const unrelatedDir = join(dirStr, "unrelated");
  const bunInstallDir = join(dirStr, "bun-install");
  const realCacheDir = join(bunInstallDir, "install", "cache");

  // Project-local .env points the cache directory at an unrelated directory full of data.
  await writeFile(join(dirStr, ".env"), `BUN_INSTALL_CACHE_DIR=${unrelatedDir}\n`);

  // The process environment derives the cache location from BUN_INSTALL only;
  // BUN_INSTALL_CACHE_DIR is intentionally absent so only the project .env names one.
  const spawnEnv: NodeJS.Dict<string> = {
    ...env,
    BUN_INSTALL: bunInstallDir,
    XDG_CACHE_HOME: join(dirStr, "xdg-cache"),
    HOME: dirStr,
  };
  delete spawnEnv.BUN_INSTALL_CACHE_DIR;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "cache", "rm"],
    cwd: dirStr,
    stdout: "pipe",
    stderr: "pipe",
    env: spawnEnv,
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  // The directory named only by the project-local .env must remain intact.
  expect(await exists(join(unrelatedDir, "keep.txt"))).toBeTrue();
  // The cache derived from the process environment (BUN_INSTALL/install/cache) is what gets cleared.
  expect(await exists(join(realCacheDir, "cached-package.txt"))).toBeFalse();
  expect(stdout).toInclude("Cleared 'bun install' cache");
  expect(exitCode).toBe(0);
});

test("bun pm cache rm does not create the directory named by a project-local .env override", async () => {
  using dir = tempDir("pm-cache-rm-no-create", {
    "package.json": JSON.stringify({ name: "cache-rm-no-create", version: "1.0.0" }),
    "bun-install/install/cache/cached-package.txt": "cached artifact",
  });
  const dirStr = String(dir);
  const bunInstallDir = join(dirStr, "bun-install");
  const realCacheDir = join(bunInstallDir, "install", "cache");
  const overrideDir = join(dirStr, "env-named-cache");

  await writeFile(join(dirStr, ".env"), `BUN_INSTALL_CACHE_DIR=${overrideDir}\n`);

  const spawnEnv: NodeJS.Dict<string> = {
    ...env,
    BUN_INSTALL: bunInstallDir,
    XDG_CACHE_HOME: join(dirStr, "xdg-cache"),
    HOME: dirStr,
  };
  delete spawnEnv.BUN_INSTALL_CACHE_DIR;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "cache", "rm"],
    cwd: dirStr,
    stdout: "pipe",
    stderr: "pipe",
    env: spawnEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(await exists(overrideDir)).toBeFalse();
  expect(await exists(join(realCacheDir, "cached-package.txt"))).toBeFalse();
  expect(stdout).toInclude("Cleared 'bun install' cache");
  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);
});
