import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test } from "bun:test";
import { exists, mkdir, writeFile } from "fs/promises";
import { bunEnv, bunExe, bunEnv as env, normalizeBunSnapshot, readdirSorted, tempDir, tmpdirSync } from "harness";
import { cpSync } from "node:fs";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  getPort,
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

// The JSON document carries what the text output prints: the root package name,
// the project path, and one entry per listed line in the same order, with the
// real package name, the resolution printed after `@`, and the folder the
// package is installed in. `--all` nests each folder's own node_modules under
// `dependencies`; a leaf has no `dependencies` key.
describe("pm ls --json", () => {
  // The default bunfig saves bun.lockb, which only stores the hashes of
  // trustedDependencies. --trusted needs bun.lock.
  async function useTextLockfile() {
    await writeFile(
      join(package_dir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: false,
          registry: `${root_url}/`,
        },
      }),
    );
  }

  async function installWithMoo(root: Record<string, unknown>, moo: Record<string, unknown>) {
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1", ...root }));
    await mkdir(join(package_dir, "moo"));
    await writeFile(
      join(package_dir, "moo", "package.json"),
      JSON.stringify({ name: "moo", version: "0.1.0", ...moo }),
    );
    const [, err, exitCode] = await spawnAndCollect("install");
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(exitCode).toBe(0);
  }

  it.each([
    { name: "bun pm ls --json lists the root dependencies", cmd: ["pm", "ls"] },
    { name: "bun list --json lists the root dependencies", cmd: ["list"] },
  ])("$name", async ({ cmd }) => {
    setHandler(dummyRegistry([]));
    await installWithMoo({ dependencies: { moo: "./moo", bar: "latest" } }, {});

    const [stdout, stderr, exitCode] = await spawnAndCollect(...cmd, "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      name: "foo",
      path: package_dir,
      dependencies: [
        { name: "bar", version: "0.0.2", path: "node_modules/bar" },
        { name: "moo", version: "moo", path: "node_modules/moo" },
      ],
    });
    expect(stdout).toEndWith("\n");
    expect(exitCode).toBe(0);
  });

  it("names the package an alias resolves to and keeps the alias in path", async () => {
    setHandler(dummyRegistry([]));
    await installWithMoo({ dependencies: { "moo-1": "./moo", "bar-1": "npm:bar" } }, {});

    const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "ls", "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      name: "foo",
      path: package_dir,
      dependencies: [
        { name: "bar", version: "0.0.2", path: "node_modules/bar-1" },
        { name: "moo", version: "moo", path: "node_modules/moo-1" },
      ],
    });
    expect(exitCode).toBe(0);
  });

  it("--all nests the dependencies of a nested node_modules folder", async () => {
    setHandler(dummyRegistry([], { "0.0.3": {}, "0.0.5": {} }));
    // moo needs baz@0.0.5 while the root pins baz@0.0.3, so moo gets its own
    // node_modules/baz.
    await installWithMoo({ dependencies: { baz: "0.0.3", moo: "./moo" } }, { dependencies: { baz: "0.0.5" } });

    const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "ls", "--all", "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      name: "foo",
      path: package_dir,
      dependencies: [
        { name: "baz", version: "0.0.3", path: "node_modules/baz" },
        {
          name: "moo",
          version: "moo",
          path: "node_modules/moo",
          dependencies: [{ name: "baz", version: "0.0.5", path: "node_modules/moo/node_modules/baz" }],
        },
      ],
    });
    expect(stdout).toEndWith("\n");
    expect(exitCode).toBe(0);
  });

  it("--all lists a hoisted aliased dependency once, without a dependencies key", async () => {
    setHandler(dummyRegistry([]));
    await installWithMoo({ dependencies: { "moo-1": "./moo" } }, { dependencies: { "bar-1": "npm:bar" } });

    const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "ls", "--all", "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      name: "foo",
      path: package_dir,
      dependencies: [
        { name: "bar", version: "0.0.2", path: "node_modules/bar-1" },
        { name: "moo", version: "moo", path: "node_modules/moo-1" },
      ],
    });
    expect(exitCode).toBe(0);
  });

  it("--trusted lists only the trusted dependencies", async () => {
    setHandler(dummyRegistry([]));
    await useTextLockfile();
    await installWithMoo({ dependencies: { moo: "./moo", bar: "latest" }, trustedDependencies: ["bar"] }, {});

    const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "ls", "--trusted", "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      name: "foo",
      path: package_dir,
      dependencies: [{ name: "bar", version: "0.0.2", path: "node_modules/bar" }],
    });
    expect(exitCode).toBe(0);
  });

  it("--trusted prints an empty list when nothing is trusted", async () => {
    setHandler(dummyRegistry([]));
    await useTextLockfile();
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "latest" }, trustedDependencies: [] }),
    );
    const [, err, installExitCode] = await spawnAndCollect("install");
    expect(err).not.toContain("error:");
    expect(installExitCode).toBe(0);

    const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "ls", "--trusted", "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      name: "foo",
      path: package_dir,
      dependencies: [],
    });
    expect(stdout).toEndWith("\n");
    expect(exitCode).toBe(0);
  });

  it("--all --trusted lists the trusted dependencies of every node_modules folder as a flat list", async () => {
    setHandler(dummyRegistry([]));
    await useTextLockfile();
    await installWithMoo(
      { dependencies: { moo: "./moo" }, trustedDependencies: ["bar"] },
      { dependencies: { bar: "latest" } },
    );

    const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "ls", "--all", "--trusted", "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      name: "foo",
      path: package_dir,
      dependencies: [{ name: "bar", version: "0.0.2", path: "node_modules/bar" }],
    });
    expect(exitCode).toBe(0);
  });

  it("lists a workspace the root also depends on once", async () => {
    setHandler(dummyRegistry([]));
    await installWorkspacesTheRootDependsOn(true);

    const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "ls", "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      name: "foo",
      path: package_dir,
      dependencies: [
        { name: "bar", version: "0.0.2", path: "node_modules/bar" },
        { name: "bar", version: "0.0.2", path: "node_modules/bar-alias" },
        { name: "ws-once", version: "workspace:packages/ws-once", path: "node_modules/ws-once" },
        { name: "ws-twice", version: "workspace:packages/ws-twice", path: "node_modules/ws-twice" },
        { name: "ws-undeclared", version: "workspace:packages/ws-undeclared", path: "node_modules/ws-undeclared" },
      ],
    });
    expect(exitCode).toBe(0);
  });

  it("prints an empty list when the lockfile has no packages", async () => {
    // `bun install` without dependencies writes no lockfile; one is left behind
    // after the last dependency is removed.
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));
    await writeFile(
      join(package_dir, "bun.lock"),
      JSON.stringify({ lockfileVersion: 1, workspaces: { "": { name: "foo" } }, packages: {} }),
    );

    const [text, textErr, textExitCode] = await spawnAndCollect("pm", "ls");
    expect(textErr).toBe("");
    expect(text).toBe("");
    expect(textExitCode).toBe(0);

    const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "ls", "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ name: "foo", path: package_dir, dependencies: [] });
    expect(stdout).toEndWith("\n");
    expect(exitCode).toBe(0);
  });

  it("keeps the missing lockfile error on stderr", async () => {
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));

    const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "ls", "--json");
    expect(stdout).toBe("");
    expect(stderr).toContain("missing lockfile");
    expect(exitCode).toBe(1);
  });
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

describe("pm bin --json", () => {
  it("prints the path of the local bin folder", async () => {
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));

    const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "bin", "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ path: join(package_dir, "node_modules", ".bin") });
    expect(stdout).toEndWith("\n");
    expect(exitCode).toBe(0);
  });

  it("prints the path of the global bin folder with -g", async () => {
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));
    const globalDir = join(package_dir, "global");
    await mkdir(globalDir);
    await writeFile(join(globalDir, "package.json"), JSON.stringify({ name: "global", version: "0.0.1" }));
    const binDir = join(package_dir, "global-bin");

    await using proc = spawn({
      cmd: [bunExe(), "pm", "bin", "-g", "--json"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: { ...env, BUN_INSTALL_GLOBAL_DIR: globalDir, BUN_INSTALL_BIN: binDir },
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ path: binDir });
    expect(stdout).toEndWith("\n");
    expect(exitCode).toBe(0);
  });
});

describe("pm cache --json", () => {
  it("prints the path of the cache folder", async () => {
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));
    const cacheDir = join(package_dir, "node_modules", ".cache");

    await using proc = spawn({
      cmd: [bunExe(), "pm", "cache", "--json"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: { ...env, BUN_INSTALL_CACHE_DIR: cacheDir },
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ path: cacheDir });
    expect(stdout).toEndWith("\n");
    expect(exitCode).toBe(0);
  });
});

describe("pm hash --json", () => {
  it.each(["hash", "hash-print"])("bun pm %s --json prints the hash the text output prints", async subcommand => {
    setHandler(dummyRegistry([]));
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "latest" } }),
    );
    const [, err, installExitCode] = await spawnAndCollect("install");
    expect(err).not.toContain("error:");
    expect(installExitCode).toBe(0);

    const [text, textErr, textExitCode] = await spawnAndCollect("pm", subcommand);
    expect(textErr).toBe("");
    expect(text).toMatch(/^[0-9A-Fa-f]{16}-[0-9A-Fa-f]{16}-[0-9A-Fa-f]{16}-[0-9A-Fa-f]{16}$/);
    expect(textExitCode).toBe(0);

    const [stdout, stderr, exitCode] = await spawnAndCollect("pm", subcommand, "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ hash: text });
    expect(stdout).toEndWith("\n");
    expect(exitCode).toBe(0);
  });

  it("keeps the missing lockfile error on stderr", async () => {
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));

    const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "hash", "--json");
    expect(stdout).toBe("");
    expect(stderr).toContain("missing lockfile");
    expect(exitCode).toBe(1);
  });
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

describe("pm whoami --json", () => {
  it.each([
    { name: "bun whoami --json prints the username the registry reports", cmd: ["whoami"] },
    { name: "bun pm whoami --json prints the username the registry reports", cmd: ["pm", "whoami"] },
  ])("$name", async ({ cmd }) => {
    const requests: string[] = [];
    setHandler(async request => {
      requests.push(`${request.method} ${new URL(request.url).pathname} ${request.headers.get("authorization")}`);
      return new Response(JSON.stringify({ username: "whoami-json" }));
    });
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));
    await writeFile(
      join(package_dir, ".npmrc"),
      `registry=http://localhost:${getPort()}/\n//localhost:${getPort()}/:_authToken=whoami-json-token\n`,
    );

    const [stdout, stderr, exitCode] = await spawnAndCollect(...cmd, "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ username: "whoami-json" });
    expect(stdout).toEndWith("\n");
    expect(requests).toEqual(["GET /-/whoami Bearer whoami-json-token"]);
    expect(exitCode).toBe(0);
  });

  it("reports a username from .npmrc without asking the registry", async () => {
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));
    await writeFile(
      join(package_dir, ".npmrc"),
      `//localhost:${getPort()}/:username=whoami-npmrc\n//localhost:${getPort()}/:_password=123456\n`,
    );

    const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "whoami", "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ username: "whoami-npmrc" });
    expect(requested).toBe(0);
    expect(exitCode).toBe(0);
  });

  it("keeps the authentication error on stderr", async () => {
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));

    const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "whoami", "--json");
    expect(stdout).toBe("");
    expect(stderr).toContain("missing authentication");
    expect(exitCode).toBe(1);
  });
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
