import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test } from "bun:test";
import { exists, mkdir, writeFile } from "fs/promises";
import { bunEnv, bunExe, bunEnv as env, normalizeBunSnapshot, readdirSorted, tempDir, tmpdirSync } from "harness";
import { cpSync, mkdirSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
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
  expect(await exists(cache_dir)).toBeFalse();
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

function seedPruneCache(cache: string) {
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  const isWindows = process.platform === "win32";
  const link = (target: string, path: string) => symlinkSync(target, path, isWindows ? "junction" : "dir");

  mkdirSync(join(cache, "old-pkg@1.0.0@@@1"), { recursive: true });
  writeFileSync(join(cache, "old-pkg@1.0.0@@@1", "index.js"), "old");
  mkdirSync(join(cache, "old-pkg"));
  link(join(cache, "old-pkg@1.0.0@@@1"), join(cache, "old-pkg", "1.0.0@@@1"));

  mkdirSync(join(cache, "new-pkg@2.0.0@@@1"));
  writeFileSync(join(cache, "new-pkg@2.0.0@@@1", "index.js"), "new");
  mkdirSync(join(cache, "new-pkg"));
  link(join(cache, "new-pkg@2.0.0@@@1"), join(cache, "new-pkg", "2.0.0@@@1"));

  mkdirSync(join(cache, "@scope", "old-scoped@1.0.0@@@1"), { recursive: true });
  writeFileSync(join(cache, "@scope", "old-scoped@1.0.0@@@1", "index.js"), "scoped");
  mkdirSync(join(cache, "@scope", "old-scoped"));
  link(join(cache, "@scope", "old-scoped@1.0.0@@@1"), join(cache, "@scope", "old-scoped", "1.0.0@@@1"));

  mkdirSync(join(cache, "@GH@owner-repo-abc123@@@1"));
  writeFileSync(join(cache, "@GH@owner-repo-abc123@@@1", "index.js"), "github");

  // Never pruned: the global store, bare git clones, manifests and extraction staging dirs.
  mkdirSync(join(cache, "links", "store-pkg@1.0.0-abcdef"), { recursive: true });
  writeFileSync(join(cache, "links", "store-pkg@1.0.0-abcdef", "index.js"), "store");
  mkdirSync(join(cache, "0123456789abcdef.git"));
  writeFileSync(join(cache, "0123456789abcdef.git", "HEAD"), "ref");
  writeFileSync(join(cache, "0123456789abcdef.npm"), "manifest");
  mkdirSync(join(cache, ".deadbeef-1.old-pkg"));
  writeFileSync(join(cache, ".deadbeef-1.old-pkg", "index.js"), "staging");
  mkdirSync(join(cache, "@t@"));
  writeFileSync(join(cache, "@t@", "0123456789abcdef.pile"), "transpiled");

  for (const stale of [
    "old-pkg@1.0.0@@@1",
    "@scope/old-scoped@1.0.0@@@1",
    "@GH@owner-repo-abc123@@@1",
    "links/store-pkg@1.0.0-abcdef",
    "0123456789abcdef.git",
    "0123456789abcdef.npm",
    ".deadbeef-1.old-pkg",
    "@t@",
  ]) {
    utimesSync(join(cache, stale), old, old);
  }
}

async function runCachePrune(cwd: string, cache: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "cache", "prune", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cache },
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("bun pm cache prune", () => {
  test("removes packages older than --max-age and their index links", async () => {
    using dir = tempDir("pm-cache-prune", {
      "package.json": JSON.stringify({ name: "cache-prune", version: "1.0.0" }),
    });
    const cache = join(String(dir), "cache");
    seedPruneCache(cache);

    const { stdout, stderr, exitCode } = await runCachePrune(String(dir), cache);
    expect(stderr).toBe("");
    expect(stdout).toBe("Removed 3 packages older than 30 days (15 bytes)\n");
    expect(exitCode).toBe(0);

    expect(await readdirSorted(cache)).toEqual([
      ".deadbeef-1.old-pkg",
      "0123456789abcdef.git",
      "0123456789abcdef.npm",
      "@t@",
      "links",
      "new-pkg",
      "new-pkg@2.0.0@@@1",
    ]);
    expect(await readdirSorted(join(cache, "new-pkg"))).toEqual(["2.0.0@@@1"]);
    expect(await readdirSorted(join(cache, "links"))).toEqual(["store-pkg@1.0.0-abcdef"]);

    const again = await runCachePrune(String(dir), cache);
    expect(again.stderr).toBe("");
    expect(again.stdout).toBe("Done! Checked 1 package, none older than 30 days (nothing to prune)\n");
    expect(again.exitCode).toBe(0);
  });

  test("--dry-run lists the stale packages and removes nothing", async () => {
    using dir = tempDir("pm-cache-prune-dry", {
      "package.json": JSON.stringify({ name: "cache-prune-dry", version: "1.0.0" }),
    });
    const cache = join(String(dir), "cache");
    seedPruneCache(cache);
    const before = await readdirSorted(cache);

    const { stdout, stderr, exitCode } = await runCachePrune(String(dir), cache, "--dry-run");
    expect(stderr).toBe("");
    expect(stdout.split("\n").slice(0, 3).sort()).toEqual([
      "- @GH@owner-repo-abc123@@@1 (6 bytes)",
      "- @scope/old-scoped@1.0.0@@@1 (6 bytes)",
      "- old-pkg@1.0.0@@@1 (3 bytes)",
    ]);
    expect(stdout).toEndWith(
      "3 packages older than 30 days can be removed (15 bytes, checked 4)\nRun without --dry-run to remove them.\n",
    );
    expect(exitCode).toBe(0);

    expect(await readdirSorted(cache)).toEqual(before);
    expect(await readdirSorted(join(cache, "old-pkg"))).toEqual(["1.0.0@@@1"]);
    expect(await readdirSorted(join(cache, "@scope"))).toEqual(["old-scoped", "old-scoped@1.0.0@@@1"]);
  });

  test("--max-age selects the age threshold", async () => {
    using dir = tempDir("pm-cache-prune-age", {
      "package.json": JSON.stringify({ name: "cache-prune-age", version: "1.0.0" }),
    });
    const cache = join(String(dir), "cache");
    seedPruneCache(cache);

    const keep = await runCachePrune(String(dir), cache, "--max-age", "60");
    expect(keep.stderr).toBe("");
    expect(keep.stdout).toBe("Done! Checked 4 packages, none older than 60 days (nothing to prune)\n");
    expect(keep.exitCode).toBe(0);

    const all = await runCachePrune(String(dir), cache, "--max-age", "0");
    expect(all.stderr).toBe("");
    expect(all.stdout).toBe("Removed 4 packages older than 0 days (18 bytes)\n");
    expect(all.exitCode).toBe(0);
    expect(await readdirSorted(cache)).toEqual([
      ".deadbeef-1.old-pkg",
      "0123456789abcdef.git",
      "0123456789abcdef.npm",
      "@t@",
      "links",
    ]);

    const bad = await runCachePrune(String(dir), cache, "--max-age", "soon");
    expect(bad.stderr).toContain("invalid --max-age value: soon");
    expect(bad.exitCode).toBe(1);
  });

  test("runs outside a project and with no cache directory", async () => {
    using dir = tempDir("pm-cache-prune-no-project", {});
    const cache = join(String(dir), "cache");
    seedPruneCache(cache);

    const { stdout, stderr, exitCode } = await runCachePrune(String(dir), cache);
    expect(stderr).toBe("");
    expect(stdout).toBe("Removed 3 packages older than 30 days (15 bytes)\n");
    expect(exitCode).toBe(0);

    const missing = await runCachePrune(String(dir), join(String(dir), "missing"));
    expect(missing.stderr).toBe("");
    expect(missing.stdout).toBe("Done! No cache directory (nothing to prune)\n");
    expect(missing.exitCode).toBe(0);
    expect(await exists(join(String(dir), "missing"))).toBeFalse();

    // An empty BUN_INSTALL_CACHE_DIR resolves to the working directory.
    const empty = await runCachePrune(String(dir), "");
    expect(empty.stderr).toContain("refusing to prune");
    expect(empty.exitCode).toBe(1);
  });
});

it("bun pm cache prune removes packages that bun install cached and leaves the rest of the cache alone", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: { "bar": "0.0.2", "@scope/bar": "0.0.2" },
    }),
  );
  // dummyBeforeEach writes `cache = false`, which sends packages to node_modules/.cache.
  const cache = join(package_dir, "bun-cache");
  await writeFile(
    join(package_dir, "bunfig.toml"),
    Bun.TOML.stringify({ install: { registry: `${root_url}/`, saveTextLockfile: false } }),
  );
  const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: cache };

  async function install() {
    await using proc = Bun.spawn({ cmd: [bunExe(), "install"], cwd: package_dir, stdout: "pipe", stderr: "pipe", env });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("2 packages installed");
    expect(exitCode).toBe(0);
  }

  await install();
  const tarballs = () => urls.filter(url => url.endsWith(".tgz")).length;
  expect(tarballs()).toBe(2);

  // Things that live next to the packages in the cache root and must survive a prune.
  mkdirSync(join(cache, "@t@"));
  writeFileSync(join(cache, "@t@", "0123456789abcdef.pile"), "transpiled");
  mkdirSync(join(cache, "links", "store-pkg@1.0.0-abcdef"), { recursive: true });
  writeFileSync(join(cache, "links", "store-pkg@1.0.0-abcdef", "index.js"), "store");

  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  for (const entry of readdirSync(cache, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (!entry.isSymbolicLink()) utimesSync(path, old, old);
  }

  const before = await readdirSorted(cache);
  expect(before).toContain("bar");
  expect(before).toContain("@scope");
  expect(before.some(name => name.startsWith("bar@0.0.2"))).toBeTrue();
  const scopedBefore = await readdirSorted(join(cache, "@scope"));
  expect(scopedBefore).toContain("bar");
  expect(scopedBefore.some(name => name.startsWith("bar@0.0.2"))).toBeTrue();

  const { stdout, stderr, exitCode } = await runCachePrune(package_dir, cache);
  expect(stderr).toBe("");
  expect(stdout).toStartWith("Removed 2 packages older than 30 days (");
  expect(exitCode).toBe(0);

  const after = await readdirSorted(cache);
  expect(after.filter(name => !name.endsWith(".npm"))).toEqual(["@t@", "links"]);
  expect(after.filter(name => name.endsWith(".npm"))).toHaveLength(2);
  expect(await readdirSorted(join(cache, "@t@"))).toEqual(["0123456789abcdef.pile"]);
  expect(await readdirSorted(join(cache, "links"))).toEqual(["store-pkg@1.0.0-abcdef"]);

  // A fresh install downloads the pruned packages again.
  rmSync(join(package_dir, "node_modules"), { recursive: true });
  await install();
  expect(tarballs()).toBe(4);
});
