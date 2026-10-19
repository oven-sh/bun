import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test } from "bun:test";
import { chmod, copyFile, exists, link, mkdir, rm, symlink, writeFile } from "fs/promises";
import {
  bunEnv,
  bunExe,
  bunEnv as env,
  isLinux,
  isWindows,
  normalizeBunSnapshot,
  readdirSorted,
  tempDir,
  tls,
  tmpdirSync,
  unprivilegedSpawnOptions,
} from "harness";
import { cpSync, mkdirSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { basename, join } from "path";
import { TestRegistry } from "registry";
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

// A tarball package's label is the URL it was installed from, which has no length
// limit. `--all` prints a label in two places: the header of a package that has its own
// nested node_modules (moo, whose bar/baz conflict with the root's), and the line of a
// package that has none (bar).
it("should list all dependencies when a resolution is longer than 512 bytes", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.2": {}, "0.0.3": {}, "0.0.5": {}, latest: "0.0.3" }));
  const barUrl = `${root_url}/${Buffer.alloc(600, "a").toString()}/bar-0.0.2.tgz`;
  const mooUrl = `${root_url}/${Buffer.alloc(600, "b").toString()}/moo-0.1.0.tgz`;
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: barUrl,
        baz: "0.0.5",
        // moo-0.1.0.tgz depends on bar@0.0.2 and baz@latest
        moo: mooUrl,
      },
    }),
  );
  {
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(exitCode).toBe(0);
  }
  await using proc = spawn({
    cmd: [bunExe(), "pm", "ls", "--all"],
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(`${package_dir} node_modules
├── bar@${barUrl}
├── baz@0.0.5
└── moo@${mooUrl}
    ├── bar@0.0.2
    └── baz@0.0.3
`);
  expect(exitCode).toBe(0);
});

it("should not list packages missing from node_modules", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "latest",
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
  // simulates `bun prune --production` or a platform-mismatched optional
  // dependency: the package is in the lockfile but not on disk
  await rm(join(package_dir, "node_modules", "bar"), { recursive: true });
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
    expect(await stdout.text()).toBe(`${package_dir} node_modules (1 installed)
└── moo@moo
`);
    expect(await exited).toBe(0);
  }
  {
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
└── moo@moo
`);
    expect(await exited).toBe(0);
  }
});

it("should list the packages in bun.lock when node_modules does not exist", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
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
  await rm(join(package_dir, "node_modules"), { recursive: true });
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "ls"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await stderr.text()).toBe("");
  expect(await stdout.text()).toBe(`${package_dir} node_modules (1 installed)
└── bar@0.0.2
`);
  expect(await exited).toBe(0);
});

describe.concurrent("bun pm ls lists what's on disk", () => {
  const registry = new TestRegistry();
  beforeAll(() => registry.start());
  afterAll(() => registry.stop());

  async function project(bunfigOpts: { linker: "hoisted" | "isolated"; globalStore?: boolean }, files: object) {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts,
      files: Object.fromEntries(Object.entries(files).map(([path, json]) => [path, JSON.stringify(json)])),
    });
    return {
      packageDir,
      async bun(...args: string[]) {
        await using proc = spawn({
          cmd: [bunExe(), ...args],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
          env: { ...env, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") },
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout: stdout.replaceAll(packageDir, "<dir>"), stderr, exitCode };
      },
    };
  }
  const listed = (...lines: string[]) => ({ stdout: lines.join("\n") + "\n", stderr: "", exitCode: 0 });

  // one-fixed-dep@1.0.0 depends on no-deps@1.0.0. `--all` prints the hoisted shape under both linkers.
  const dependencies = { "a-dep": "1.0.1", "one-fixed-dep": "1.0.0" };

  test.each([{ linker: "hoisted" }, { linker: "isolated" }, { linker: "isolated", globalStore: true }] as const)(
    "%j",
    async bunfigOpts => {
      const isolated = bunfigOpts.linker === "isolated";
      const { packageDir, bun } = await project(bunfigOpts, { "package.json": { name: "foo", dependencies } });
      expect(await bun("install")).toMatchObject({ exitCode: 0 });

      expect(await bun("pm", "ls")).toEqual(
        listed("<dir> node_modules (3 installed)", "├── a-dep@1.0.1", "└── one-fixed-dep@1.0.0"),
      );
      expect(await bun("pm", "ls", "--all")).toEqual(
        listed("<dir> node_modules", "├── a-dep@1.0.1", "├── no-deps@1.0.0", "└── one-fixed-dep@1.0.0"),
      );

      // The project can't load a-dep anymore. The isolated store still has it, which is what the count and `--all`
      // show.
      await rm(join(packageDir, "node_modules", "a-dep"), { recursive: true });
      expect(await bun("pm", "ls")).toEqual(
        listed(`<dir> node_modules (${isolated ? 3 : 2} installed)`, "└── one-fixed-dep@1.0.0"),
      );
      expect(await bun("pm", "ls", "--all")).toEqual(
        listed(
          "<dir> node_modules",
          ...(isolated ? ["├── a-dep@1.0.1"] : []),
          "├── no-deps@1.0.0",
          "└── one-fixed-dep@1.0.0",
        ),
      );

      // A transitive dependency is nowhere but in the store under the isolated linker.
      await rm(join(packageDir, "node_modules", ...(isolated ? [".bun", "no-deps@1.0.0"] : ["no-deps"])), {
        recursive: true,
      });
      expect(await bun("pm", "ls")).toEqual(
        listed(`<dir> node_modules (${isolated ? 2 : 1} installed)`, "└── one-fixed-dep@1.0.0"),
      );
      expect(await bun("pm", "ls", "--all")).toEqual(
        listed("<dir> node_modules", ...(isolated ? ["├── a-dep@1.0.1"] : []), "└── one-fixed-dep@1.0.0"),
      );

      // With no node_modules, it lists what's in bun.lock.
      await rm(join(packageDir, "node_modules"), { recursive: true });
      expect(await bun("pm", "ls")).toEqual(
        listed("<dir> node_modules (3 installed)", "├── a-dep@1.0.1", "└── one-fixed-dep@1.0.0"),
      );
      expect(await bun("pm", "ls", "--all")).toEqual(
        listed("<dir> node_modules", "├── a-dep@1.0.1", "├── no-deps@1.0.0", "└── one-fixed-dep@1.0.0"),
      );
    },
  );

  test("skips an optional peer dependency that isn't installed", async () => {
    const { packageDir, bun } = await project(
      { linker: "hoisted" },
      {
        "package.json": {
          name: "foo",
          dependencies: { "a-dep": "1.0.1" },
          peerDependencies: { "no-deps": "1.0.0" },
          peerDependenciesMeta: { "no-deps": { optional: true } },
        },
      },
    );
    expect(await bun("install")).toMatchObject({ exitCode: 0 });

    const list = listed("<dir> node_modules (1 installed)", "└── a-dep@1.0.1");
    expect(await bun("pm", "ls")).toEqual(list);
    await rm(join(packageDir, "node_modules"), { recursive: true });
    expect(await bun("pm", "ls")).toEqual(list);
    expect(await bun("pm", "ls", "--all")).toEqual(listed("<dir> node_modules", "└── a-dep@1.0.1"));
  });

  test("isolated: a dependency of the root that only a workspace member has linked", async () => {
    const { bun } = await project(
      { linker: "isolated" },
      {
        "package.json": {
          name: "foo",
          workspaces: ["packages/*"],
          dependencies: { "a-dep": "1.0.1", "no-deps": "1.0.0" },
        },
        "packages/member/package.json": { name: "member", dependencies: { "a-dep": "1.0.1" } },
      },
    );
    expect(await bun("install", "--filter", "member")).toMatchObject({ exitCode: 0 });

    const member = `└── member@workspace:${join("packages", "member")}`;
    expect(await bun("pm", "ls")).toEqual(listed("<dir> node_modules (2 installed)", member));
    expect(await bun("pm", "ls", "--all")).toEqual(listed("<dir> node_modules", "├── a-dep@1.0.1", member));
  });

  test("--production, --omit, --depth=0 and package names narrow the list", async () => {
    const { bun } = await project(
      { linker: "hoisted" },
      {
        "package.json": {
          name: "foo",
          dependencies: { "a-dep": "1.0.1" },
          devDependencies: { "one-fixed-dep": "1.0.0" },
        },
      },
    );
    expect(await bun("install")).toMatchObject({ exitCode: 0 });

    const direct = listed("<dir> node_modules (3 installed)", "├── a-dep@1.0.1", "└── one-fixed-dep@1.0.0");
    const noMatch = (header: string, names: string) => ({
      stdout: header + "\n",
      stderr: `error: no packages match: ${names}\n`,
      exitCode: 1,
    });
    const cases: [string, object][] = [
      ["pm ls", direct],
      ["pm ls --production", listed("<dir> node_modules (1 installed)", "└── a-dep@1.0.1")],
      ["pm ls --omit=dev", listed("<dir> node_modules (1 installed)", "└── a-dep@1.0.1")],
      ["list --all --prod", listed("<dir> node_modules", "└── a-dep@1.0.1")],
      ["pm ls --depth=0", direct],
      ["pm ls --all --depth 0", direct],
      [
        "pm ls --depth=1",
        {
          stdout: "",
          stderr:
            "error: bun pm ls --depth only accepts 0 (direct dependencies, the default). --all lists every installed package\n",
          exitCode: 1,
        },
      ],
      // no-deps is a dependency of one-fixed-dep only.
      ["pm ls no-deps", listed("<dir> node_modules", "└── no-deps@1.0.0")],
      ["list no-deps a-dep nope", listed("<dir> node_modules", "├── a-dep@1.0.1", "└── no-deps@1.0.0")],
      ["pm ls a-dep no-deps --depth=0", listed("<dir> node_modules (3 installed)", "└── a-dep@1.0.1")],
      ["pm ls no-deps --depth=0", noMatch("<dir> node_modules (3 installed)", "no-deps")],
      ["pm ls no-deps --production", noMatch("<dir> node_modules", "no-deps")],
      ["pm ls nope nada", noMatch("<dir> node_modules", "nope, nada")],
    ];
    const results = await Promise.all(cases.map(([cmd]) => bun(...cmd.split(" "))));
    expect(results.map((result, i) => [cases[i][0], result])).toEqual(cases);
  });
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

// bun.lockb keeps a package for each of the two entries. node_modules has one of them.
it.each([
  { lockfile: "bun.lock", saveTextLockfile: true },
  { lockfile: "bun.lockb", saveTextLockfile: false },
])("should list a name in two dependency groups once ($lockfile)", async ({ lockfile, saveTextLockfile }) => {
  setHandler(dummyRegistry([], { "0.0.3": {}, "0.0.5": {} }));
  await writeFile(
    join(package_dir, "bunfig.toml"),
    Bun.TOML.stringify({ install: { cache: false, registry: `${root_url}/`, saveTextLockfile } }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "foo", dependencies: { baz: "0.0.3" }, devDependencies: { baz: "~0.0.3" } }),
  );
  const [, err, installed] = await spawnAndCollect("install");
  expect(err).toContain("Saved lockfile");
  expect(installed).toBe(0);
  expect(await exists(join(package_dir, lockfile))).toBeTrue();

  const [stdout, stderr, exitCode] = await spawnAndCollect("pm", "ls");
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout, package_dir)).toMatchInlineSnapshot(`
    "<dir> node_modules (1 installed)
    └── baz@0.0.5"
  `);
  expect(exitCode).toBe(0);
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
  expect(await readdirSorted(cache_dir)).toEqual([]);
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

test("bun pm migrate --dry-run writes nothing", async () => {
  using dir = tempDir("pm-migrate-dry-run", {
    "package.json": JSON.stringify({ name: "dry-run", dependencies: { a: "file:./a" } }),
    "a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
    "package-lock.json": JSON.stringify({
      name: "dry-run",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "dry-run", dependencies: { a: "file:./a" } },
        "a": { version: "1.0.0" },
        "node_modules/a": { resolved: "a", link: true },
      },
    }),
  });

  expect(await runInDir(String(dir), "pm", "migrate", "--dry-run")).toEqual([
    "dry run: would write bun.lock\n",
    expect.stringMatching(/migrated lockfile from package-lock\.json\n$/),
    0,
  ]);
  expect(await readdirSorted(String(dir))).toEqual(["a", "package-lock.json", "package.json"]);

  expect(await runInDir(String(dir), "pm", "migrate")).toEqual([
    "",
    expect.stringMatching(/migrated lockfile from package-lock\.json\n$/),
    0,
  ]);
  expect(await readdirSorted(String(dir))).toEqual(["a", "bun.lock", "package-lock.json", "package.json"]);
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

describe.concurrent("bun pm whoami user-agent", () => {
  // The host may itself be a CI runner. Drop its `CI` so each case decides.
  // AGOLA_GIT_REF is the first probe in the vendor table, so no other marker
  // that leaks from the host can shadow it.
  const cleanEnv = { ...bunEnv };
  delete cleanEnv.CI;

  async function whoamiUserAgent(extraEnv: Record<string, string>): Promise<string | null> {
    let userAgent: string | null = null;
    using registry = Bun.serve({
      port: 0,
      fetch(req) {
        userAgent = req.headers.get("user-agent");
        return Response.json({ username: "whoami-ua" });
      },
    });
    using dir = tempDir("bun-pm-whoami-ua", {
      "package.json": JSON.stringify({ name: "whoami-ua", version: "1.0.0" }),
      "bunfig.toml": Bun.TOML.stringify({
        install: {
          cache: false,
          registry: { url: `http://localhost:${registry.port}`, token: "whoami-ua-token" },
        },
      }),
    });

    await using proc = spawn({
      cmd: [bunExe(), "pm", "whoami"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...cleanEnv, ...extraEnv },
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("whoami-ua\n");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    return userAgent;
  }

  const baseUserAgent = `Bun/${Bun.version} ${process.platform} ${process.arch} workspaces/false`;

  test("names the CI vendor", async () => {
    expect(await whoamiUserAgent({ AGOLA_GIT_REF: "refs/heads/main" })).toBe(`${baseUserAgent} ci/agola-ci`);
  });

  test("CI=false is not CI", async () => {
    expect(await whoamiUserAgent({ CI: "false" })).toBe(baseUserAgent);
  });

  test("CI=false wins over a vendor variable", async () => {
    expect(await whoamiUserAgent({ CI: "false", AGOLA_GIT_REF: "refs/heads/main" })).toBe(baseUserAgent);
  });
});

describe.concurrent("bun pm whoami against a registry with a self-signed certificate", () => {
  async function whoami(env: NodeJS.Dict<string>) {
    const requests: string[] = [];
    using server = Bun.serve({
      port: 0,
      tls,
      fetch(req) {
        requests.push(`${req.method} ${new URL(req.url).pathname}`);
        return Response.json({ username: "self-signed-user" });
      },
    });
    using dir = tempDir("pm-whoami-self-signed", {
      "package.json": JSON.stringify({ name: "whoami-self-signed", version: "1.0.0" }),
      "bunfig.toml": Bun.TOML.stringify({
        install: {
          cache: false,
          registry: { url: `https://localhost:${server.port}`, token: "self-signed-token" },
        },
      }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "whoami"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, requests };
  }

  test("NODE_TLS_REJECT_UNAUTHORIZED=0 turns verification off", async () => {
    const { stdout, stderr, exitCode, requests } = await whoami({ ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" });

    expect(stderr).not.toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(stdout).toBe("self-signed-user\n");
    expect(requests).toEqual(["GET /-/whoami"]);
    expect(exitCode).toBe(0);
  });

  test("verification stays on when the variable is unset", async () => {
    const { stderr, exitCode, requests } = await whoami({ ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: undefined });

    expect(stderr).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(requests).toEqual([]);
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

/**
 * Every directory the cache directory resolution can fall back to, and the temp directory that
 * `bun pm cache rm` sweeps for bunx entries, is inside `side`: neither the fixed nor the unfixed
 * behavior can reach anything outside the test's own temp directories. `BUN_INSTALL_CACHE_DIR` is
 * unset unless the test sets it; an override of `undefined` unsets the variable.
 */
function cacheEnv(side: string, overrides: Record<string, string | undefined> = {}): NodeJS.Dict<string> {
  const spawnEnv: NodeJS.Dict<string> = {
    ...env,
    HOME: join(side, "home"),
    USERPROFILE: join(side, "home"),
    XDG_CACHE_HOME: join(side, "xdg-cache"),
    BUN_INSTALL: join(side, "bun-install"),
    BUN_INSTALL_CACHE_DIR: undefined,
    TMPDIR: join(side, "tmp"),
    TMP: join(side, "tmp"),
    TEMP: join(side, "tmp"),
    ...overrides,
  };
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

function refused(cacheDir: string, what: string, bunx = "Cleared") {
  return {
    stdout: `${bunx} 0 cached 'bunx' packages\n`,
    stderr:
      `error: refusing to clear "${cacheDir}": is or contains ${what}\n` +
      "note: cache directory comes from $BUN_INSTALL_CACHE_DIR, --cache-dir, ~/.bunfig.toml or $BUN_INSTALL. " +
      "point it at a directory used only for the bun install cache\n",
    exitCode: 1,
  };
}

it("bun install treats an empty BUN_INSTALL_CACHE_DIR as unset instead of caching into the project", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  using side = tempDir("pm-cache-empty-var-install", { "home/.keep": "", "tmp/.keep": "" });
  // dummyBeforeEach writes a bunfig.toml that disables the cache. This test needs it on.
  await writeFile(join(package_dir, "bunfig.toml"), `[install]\nregistry = "${root_url}/"\n`);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "0.0.2" } }),
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    env: cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: "", BUN_INSTALL: undefined, XDG_CACHE_HOME: undefined }),
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(stdout).toContain("+ bar@0.0.2");
  expect(exitCode).toBe(0);

  const isManifest = (name: string) => name.endsWith(".npm");
  expect((await readdirSorted(package_dir)).filter(name => name.includes("@@") || isManifest(name))).toEqual([]);
  const homeCache = await readdirSorted(join(String(side), "home", ".bun", "install", "cache"));
  expect(homeCache).toContainEqual(expect.stringMatching(/^bar@0\.0\.2@@localhost__[0-9a-f]{16}@@@1$/));
  // The manifest name hashes the registry URL, which includes the port.
  expect(homeCache.filter(isManifest)).toHaveLength(1);
});

describe.concurrent("bun pm cache with an empty variable", () => {
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

  test.each([
    ["BUN_INSTALL", {}, ["xdg-cache", ".bun", "install", "cache"]],
    ["XDG_CACHE_HOME", { BUN_INSTALL: undefined }, ["home", ".bun", "install", "cache"]],
  ] as const)("an empty %s falls through to the next location", async (name, unset, expected) => {
    using side = tempDir("pm-cache-empty-variable", sideFiles);
    using root = tempDir("pm-cache-empty-variable-project", projectFiles);
    const proj = join(String(root), "proj");

    expect(await pmCache([], proj, cacheEnv(String(side), { ...unset, [name]: "" }))).toEqual({
      stdout: join(String(side), ...expected),
      stderr: "",
      exitCode: 0,
    });
    expect(await readdirSorted(proj)).toEqual(projectEntries);
  });
});

describe.concurrent("bun pm cache rm refuses a cache directory that holds more than the cache", () => {
  test("the project directory", async () => {
    using side = tempDir("pm-cache-rm-project", sideFiles);
    using root = tempDir("pm-cache-rm-project-project", projectFiles);
    const proj = join(String(root), "proj");

    const result = await pmCache(["rm"], proj, cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: proj }));
    expect(result).toEqual(refused(proj, "the project directory"));
    expect(await readdirSorted(proj)).toEqual(projectEntries);
  });

  test("the project directory, with --dry-run", async () => {
    using side = tempDir("pm-cache-rm-project-dry-run", sideFiles);
    using root = tempDir("pm-cache-rm-project-dry-run-project", projectFiles);
    const proj = join(String(root), "proj");

    const result = await pmCache(["rm", "--dry-run"], proj, cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: proj }));
    expect(result).toEqual(refused(proj, "the project directory", "Would clear"));
    expect(await readdirSorted(proj)).toEqual(projectEntries);
  });

  test("a parent of the project directory (relative setting)", async () => {
    using side = tempDir("pm-cache-rm-parent", sideFiles);
    using root = tempDir("pm-cache-rm-parent-project", projectFiles);
    const proj = join(String(root), "proj");

    const result = await pmCache(["rm"], proj, cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: ".." }));
    expect(result).toEqual(refused(String(root), "the project directory"));
    expect(await readdirSorted(String(root))).toEqual(["proj", "sibling"]);
    expect(await readdirSorted(proj)).toEqual(projectEntries);
  });

  test("the directory the command runs from, inside a workspace", async () => {
    using side = tempDir("pm-cache-rm-cwd", sideFiles);
    using root = tempDir("pm-cache-rm-cwd-workspace", {
      "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      "packages/a/package.json": JSON.stringify({ name: "a" }),
      "packages/b/package.json": JSON.stringify({ name: "b" }),
    });
    const packages = join(String(root), "packages");

    const result = await pmCache(
      ["rm"],
      join(packages, "a"),
      cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: packages }),
    );
    expect(result).toEqual(refused(packages, "the current directory"));
    expect(await readdirSorted(packages)).toEqual(["a", "b"]);
  });

  test("the home directory", async () => {
    using side = tempDir("pm-cache-rm-home", sideFiles);
    using root = tempDir("pm-cache-rm-home-project", projectFiles);
    const home = join(String(side), "home");

    const result = await pmCache(
      ["rm"],
      join(String(root), "proj"),
      cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: home }),
    );
    expect(result).toEqual(refused(home, "the home directory"));
    expect(await exists(join(home, ".ssh", "id_canary"))).toBeTrue();
  });

  test("$BUN_INSTALL", async () => {
    using side = tempDir("pm-cache-rm-bun-install", sideFiles);
    using root = tempDir("pm-cache-rm-bun-install-project", projectFiles);
    const bunInstall = join(String(side), "bun-install");

    const result = await pmCache(
      ["rm"],
      join(String(root), "proj"),
      cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: bunInstall }),
    );
    expect(result).toEqual(refused(bunInstall, "$BUN_INSTALL"));
    expect(await exists(join(bunInstall, "bin", "bun-canary"))).toBeTrue();
  });

  test("the directory that holds the running bun executable", async () => {
    using side = tempDir("pm-cache-rm-exe", sideFiles);
    using root = tempDir("pm-cache-rm-exe-project", projectFiles);
    // A second name for the binary, inside the temp tree: without the refusal this command deletes
    // the directory that holds the binary, which must not be the build directory.
    const bin = join(String(root), "bin");
    const exe = join(bin, basename(bunExe()));
    await mkdir(bin);
    await link(bunExe(), exe).catch(async () => {
      await copyFile(bunExe(), exe);
      await chmod(exe, 0o755);
    });

    const result = await pmCache(
      ["rm"],
      join(String(root), "proj"),
      cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: bin }),
      exe,
    );
    expect(result).toEqual(refused(bin, "the bun executable"));
    expect(await exists(exe)).toBeTrue();
  });

  test("a symlink to the home directory", async () => {
    using side = tempDir("pm-cache-rm-symlink-home", sideFiles);
    using root = tempDir("pm-cache-rm-symlink-home-project", projectFiles);
    const home = join(String(side), "home");
    const cacheLink = join(String(root), "cache-link");
    await symlink(home, cacheLink, "junction");

    const result = await pmCache(
      ["rm"],
      join(String(root), "proj"),
      cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: cacheLink }),
    );
    expect(result).toEqual(refused(home, "the home directory"));
    expect(await exists(join(home, ".ssh", "id_canary"))).toBeTrue();
  });
});

describe.concurrent("bun pm cache rm", () => {
  test("an entry that is a symlink is unlinked, not followed", async () => {
    using side = tempDir("pm-cache-rm-entry-symlink", sideFiles);
    using root = tempDir("pm-cache-rm-entry-symlink-project", projectFiles);
    const envCache = join(String(side), "bun-install", "install", "cache");
    const sibling = join(String(root), "sibling");
    await symlink(sibling, join(envCache, "escape@1.0.0@@@1"), "junction");

    expect(await pmCache(["rm"], join(String(root), "proj"), cacheEnv(String(side)))).toEqual(cleared);
    expect(await readdirSorted(envCache)).toEqual([]);
    expect(await readdirSorted(sibling)).toEqual(["keep.txt"]);
  });

  test("a cache directory that is a symlink is emptied, and the link still works", async () => {
    using side = tempDir("pm-cache-rm-root-symlink", {
      ...sideFiles,
      "big-disk/bar@0.0.2@@@1/package.json": "{}",
    });
    using root = tempDir("pm-cache-rm-root-symlink-project", projectFiles);
    const proj = join(String(root), "proj");
    const target = join(String(side), "big-disk");
    const spawnEnv = cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: join(String(side), "cache-link") });
    await symlink(target, join(String(side), "cache-link"), "junction");

    expect(await pmCache(["rm"], proj, spawnEnv)).toEqual(cleared);
    expect(await readdirSorted(target)).toEqual([]);
    expect(await pmCache([], proj, spawnEnv)).toEqual({ stdout: target, stderr: "", exitCode: 0 });
  });

  // Serial: `unprivilegedSpawnOptions` may change and restore the modes of directories above the test's own.
  test.serial.skipIf(isWindows)("a cache directory in a read-only parent is emptied", async () => {
    using dir = tempDir("pm-cache-rm-read-only-parent", {
      ...sideFiles,
      ...projectFiles,
      "var/cache/bar@0.0.2@@@1/package.json": "{}",
    });
    const parent = join(String(dir), "var");
    using unprivileged = unprivilegedSpawnOptions(String(dir));
    await chmod(parent, 0o555);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "cache", "rm"],
      cwd: join(String(dir), "proj"),
      env: cacheEnv(String(dir), { BUN_INSTALL_CACHE_DIR: join(parent, "cache") }),
      stdout: "pipe",
      stderr: "pipe",
      ...unprivileged,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    await chmod(parent, 0o755);

    expect({ stdout, stderr, exitCode }).toEqual(cleared);
    expect(await readdirSorted(join(parent, "cache"))).toEqual([]);
  });

  test.each([
    [["rm", "bar"], "bar"],
    [["rm", "bar@0.0.2"], "bar@0.0.2"],
    [["rm", "--dry-run", "bar"], "bar"],
    [["prune", "--max-age", "0", "bar"], "bar"],
    [["clean"], "clean"],
    [["clear", "--force"], "clear"],
  ] as const)("a word the command does not take is an error and nothing is deleted: %j", async (args, word) => {
    using side = tempDir("pm-cache-unexpected-word", sideFiles);
    using root = tempDir("pm-cache-unexpected-word-project", projectFiles);

    expect(await pmCache([...args], join(String(root), "proj"), cacheEnv(String(side)))).toEqual({
      stdout: "",
      stderr:
        `error: unexpected argument "${word}"\n` + "usage: bun pm cache [rm | prune | pack <file> | unpack <file>]\n",
      exitCode: 1,
    });
    expect(await readdirSorted(join(String(side), "bun-install", "install", "cache"))).toEqual(envCacheEntries);
  });

  test.each([[["rm"]], [["rm", "--dry-run"]]])(
    "a cache directory that does not exist is not created: %j",
    async args => {
      using side = tempDir("pm-cache-rm-missing", sideFiles);
      using root = tempDir("pm-cache-rm-missing-project", projectFiles);
      const missing = join(String(side), "does-not-exist", "cache");

      const result = await pmCache(
        args,
        join(String(root), "proj"),
        cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: missing }),
      );
      expect(result).toEqual(
        args.length === 1
          ? cleared
          : {
              stdout: `dry run: would delete 'bun install' cache at ${missing}\nWould clear 0 cached 'bunx' packages\n`,
              stderr: "",
              exitCode: 0,
            },
      );
      expect(await exists(join(String(side), "does-not-exist"))).toBeFalse();
    },
  );

  test("a cache directory named by the project's .npmrc is not the one cleared", async () => {
    using side = tempDir("pm-cache-rm-npmrc", sideFiles);
    using root = tempDir("pm-cache-rm-npmrc-project", { ...projectFiles, "proj/.npmrc": "cache=.\n" });
    const proj = join(String(root), "proj");
    const spawnEnv = cacheEnv(String(side));

    expect(await pmCache([], proj, spawnEnv)).toEqual({ stdout: proj, stderr: "", exitCode: 0 });

    expect(await pmCache(["rm"], proj, spawnEnv)).toEqual(cleared);
    expect(await readdirSorted(proj)).toEqual([".git", ".npmrc", "package.json", "src"]);
    expect(await readdirSorted(join(String(side), "bun-install", "install", "cache"))).toEqual([]);
  });

  test("--dry-run prints what would be deleted and deletes nothing", async () => {
    const uid = isWindows ? undefined : process.getuid!();
    using side = tempDir("pm-cache-rm-dry-run", {
      ...sideFiles,
      ...(uid === undefined ? {} : { [`tmp/bunx-${uid}-cowsay@latest/package.json`]: "{}" }),
    });
    using root = tempDir("pm-cache-rm-dry-run-project", projectFiles);
    const envCache = join(String(side), "bun-install", "install", "cache");

    expect(await pmCache(["rm", "--dry-run"], join(String(root), "proj"), cacheEnv(String(side)))).toEqual({
      stdout:
        `dry run: would delete 'bun install' cache at ${envCache}\n` +
        (uid === undefined
          ? "Would clear 0 cached 'bunx' packages\n"
          : `dry run: would delete ${join(String(side), "tmp", `bunx-${uid}-cowsay@latest`)}\n` +
            "Would clear 1 cached 'bunx' packages\n"),
      stderr: "",
      exitCode: 0,
    });
    expect(await readdirSorted(envCache)).toEqual(envCacheEntries);
    if (uid !== undefined)
      expect(await readdirSorted(join(String(side), "tmp"))).toContain(`bunx-${uid}-cowsay@latest`);
  });

  test.each([
    [["rm"], "was"],
    [["rm", "--dry-run"], "would be"],
  ] as const)("says that the global store goes with the cache: %j", async (args, verb) => {
    using side = tempDir("pm-cache-rm-global-store", {
      ...sideFiles,
      "bun-install/install/cache/links/foo@1.0.0@@@1/node_modules/foo/package.json": "{}",
    });
    using root = tempDir("pm-cache-rm-global-store-project", projectFiles);
    const envCache = join(String(side), "bun-install", "install", "cache");

    const { stderr, exitCode } = await pmCache([...args], join(String(root), "proj"), cacheEnv(String(side)));
    expect(stderr).toBe(`note: global store ${verb} removed too, run 'bun install' in each project that uses it\n`);
    expect(exitCode).toBe(0);
    expect(await exists(join(envCache, "links"))).toBe(args.length === 2);
  });
});

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

function seedPruneCache(cache: string) {
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

  // Never pruned: the global store, bare git clones, manifests, staging directories, what bunx
  // installed and the transpiler cache.
  mkdirSync(join(cache, "links", "store-pkg@1.0.0-abcdef"), { recursive: true });
  writeFileSync(join(cache, "links", "store-pkg@1.0.0-abcdef", "index.js"), "store");
  mkdirSync(join(cache, "0123456789abcdef.git"));
  writeFileSync(join(cache, "0123456789abcdef.git", "HEAD"), "ref");
  writeFileSync(join(cache, "0123456789abcdef.npm"), "manifest");
  mkdirSync(join(cache, ".deadbeef-1.old-pkg"));
  writeFileSync(join(cache, ".deadbeef-1.old-pkg", "index.js"), "staging");
  mkdirSync(join(cache, ".bunx-0", "cowsay@latest"), { recursive: true });
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
    ".bunx-0/cowsay@latest",
    ".bunx-0",
    "@t@",
  ]) {
    utimesSync(join(cache, stale), daysAgo(40), daysAgo(40));
  }
}
const neverPruned = [".bunx-0", ".deadbeef-1.old-pkg", "0123456789abcdef.git", "0123456789abcdef.npm", "@t@", "links"];

describe.concurrent("bun pm cache prune", () => {
  const prune = (cwd: string, cache: string, ...args: string[]) =>
    pmCache(["prune", ...args], cwd, { ...env, BUN_INSTALL_CACHE_DIR: cache });

  test("removes packages older than 30 days and their index links", async () => {
    using dir = tempDir("pm-cache-prune", { "package.json": JSON.stringify({ name: "cache-prune" }) });
    const cache = join(String(dir), "cache");
    seedPruneCache(cache);

    expect(await prune(String(dir), cache)).toEqual({
      stdout: "Removed 3 packages older than 30 days (15 bytes)\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await readdirSorted(cache)).toEqual([...neverPruned, "new-pkg", "new-pkg@2.0.0@@@1"]);
    expect(await readdirSorted(join(cache, "new-pkg"))).toEqual(["2.0.0@@@1"]);
    expect(await readdirSorted(join(cache, "links"))).toEqual(["store-pkg@1.0.0-abcdef"]);
    expect(await readdirSorted(join(cache, ".bunx-0"))).toEqual(["cowsay@latest"]);

    expect(await prune(String(dir), cache)).toEqual({
      stdout: "Done! Checked 1 package, none older than 30 days (nothing to prune)\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("--dry-run lists what the next run would remove, and removes nothing", async () => {
    using dir = tempDir("pm-cache-prune-dry", { "package.json": JSON.stringify({ name: "cache-prune-dry" }) });
    const cache = join(String(dir), "cache");
    seedPruneCache(cache);
    const before = await readdirSorted(cache);

    const { stdout, stderr, exitCode } = await prune(String(dir), cache, "--dry-run");
    expect(stderr).toBe("");
    const lines = stdout.split("\n");
    expect(lines.slice(0, 3).sort()).toEqual([
      "- @GH@owner-repo-abc123@@@1",
      "- @scope/old-scoped@1.0.0@@@1",
      "- old-pkg@1.0.0@@@1",
    ]);
    expect(lines.slice(3)).toEqual([
      "3 packages older than 30 days can be removed (checked 4)",
      "Run without --dry-run to remove them.",
      "",
    ]);
    expect(exitCode).toBe(0);

    expect(await readdirSorted(cache)).toEqual(before);
    expect(await readdirSorted(join(cache, "old-pkg"))).toEqual(["1.0.0@@@1"]);
    expect(await readdirSorted(join(cache, "@scope"))).toEqual(["old-scoped", "old-scoped@1.0.0@@@1"]);

    // Listing them did not count as using them.
    expect(await prune(String(dir), cache)).toEqual({
      stdout: "Removed 3 packages older than 30 days (15 bytes)\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("a package that an install read recently is kept, however long ago it was downloaded", async () => {
    using dir = tempDir("pm-cache-prune-atime", { "package.json": JSON.stringify({ name: "cache-prune-atime" }) });
    const cache = join(String(dir), "cache");
    seedPruneCache(cache);
    utimesSync(join(cache, "old-pkg@1.0.0@@@1"), daysAgo(2), daysAgo(400));

    expect(await prune(String(dir), cache)).toEqual({
      stdout: "Removed 2 packages older than 30 days (12 bytes)\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await readdirSorted(join(cache, "old-pkg"))).toEqual(["1.0.0@@@1"]);
    expect(await readdirSorted(join(cache, "old-pkg@1.0.0@@@1"))).toEqual(["index.js"]);
  });

  test("tarball entries and the entries of a registry that shares its host are packages", async () => {
    const stale = [
      // Named by the integrity in bun.lock, and by a hash of the path or URL as Bun 1.4 did.
      "@T@sha512-00112233445566778899aabbccddeeff@@@1",
      "@T@85f77fa09e18a07f@@@1",
      "pkg@1.0.0@@localhost__0123456789abcdef@@@1",
    ];
    const recent = ["@T@sha512-ffeeddccbbaa99887766554433221100@@@1", "pkg@2.0.0@@localhost__0123456789abcdef@@@1"];
    using dir = tempDir("pm-cache-prune-names", {
      "package.json": JSON.stringify({ name: "cache-prune-names" }),
      cache: Object.fromEntries([...stale, ...recent].map(entry => [entry, { "package.json": "{}" }])),
    });
    const cache = join(String(dir), "cache");
    for (const entry of stale) utimesSync(join(cache, entry), daysAgo(40), daysAgo(40));

    expect(await prune(String(dir), cache)).toEqual({
      stdout: "Removed 3 packages older than 30 days (6 bytes)\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await readdirSorted(cache)).toEqual(recent.toSorted());
  });

  test("--max-age selects the age threshold", async () => {
    using dir = tempDir("pm-cache-prune-age", { "package.json": JSON.stringify({ name: "cache-prune-age" }) });
    const cache = join(String(dir), "cache");
    seedPruneCache(cache);

    expect(await prune(String(dir), cache, "--max-age", "60")).toEqual({
      stdout: "Done! Checked 4 packages, none older than 60 days (nothing to prune)\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await prune(String(dir), cache, "--max-age", "0")).toEqual({
      stdout: "Removed 4 packages older than 0 days (18 bytes)\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await readdirSorted(cache)).toEqual(neverPruned);

    expect(await prune(String(dir), cache, "--max-age", "soon")).toEqual({
      stdout: "",
      stderr: "error: invalid --max-age value: soon, expected a number of days\n",
      exitCode: 1,
    });
  });

  test("runs outside a project and with no cache directory", async () => {
    using dir = tempDir("pm-cache-prune-no-project", { "cwd/.keep": "" });
    const cache = join(String(dir), "cache");
    seedPruneCache(cache);

    expect(await prune(join(String(dir), "cwd"), cache)).toEqual({
      stdout: "Removed 3 packages older than 30 days (15 bytes)\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await prune(join(String(dir), "cwd"), join(String(dir), "missing"))).toEqual({
      stdout: "Done! No cache directory (nothing to prune)\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await readdirSorted(String(dir))).toEqual(["cache", "cwd"]);
  });

  test("an empty BUN_INSTALL_CACHE_DIR is the next location, not the project", async () => {
    using side = tempDir("pm-cache-prune-empty-variable", sideFiles);
    using root = tempDir("pm-cache-prune-empty-variable-project", {
      ...projectFiles,
      "proj/looks-like@1.0.0@@@1/index.js": "mine",
    });
    const proj = join(String(root), "proj");
    const envCache = join(String(side), "bun-install", "install", "cache");
    utimesSync(join(proj, "looks-like@1.0.0@@@1"), daysAgo(40), daysAgo(40));
    utimesSync(join(envCache, "bar@0.0.2@@@1"), daysAgo(40), daysAgo(40));

    expect(await pmCache(["prune"], proj, cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: "" }))).toEqual({
      stdout: "Removed 1 package older than 30 days (2 bytes)\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await readdirSorted(proj)).toEqual([...projectEntries, "looks-like@1.0.0@@@1"].sort());
    expect(await readdirSorted(envCache)).toEqual(["0123456789abcdef.npm"]);
  });

  test.each([[[]], [["--dry-run"]]])("refuses the same directories as bun pm cache rm: %j", async args => {
    using side = tempDir("pm-cache-prune-refused", sideFiles);
    using root = tempDir("pm-cache-prune-refused-project", {
      ...projectFiles,
      "proj/looks-like@1.0.0@@@1/index.js": "mine",
    });
    const proj = join(String(root), "proj");
    utimesSync(join(proj, "looks-like@1.0.0@@@1"), daysAgo(40), daysAgo(40));

    expect(await pmCache(["prune", ...args], proj, cacheEnv(String(side), { BUN_INSTALL_CACHE_DIR: proj }))).toEqual({
      stdout: "",
      stderr: refused(proj, "the project directory").stderr.replace("refusing to clear", "refusing to prune"),
      exitCode: 1,
    });
    expect(await readdirSorted(join(proj, "looks-like@1.0.0@@@1"))).toEqual(["index.js"]);
  });
});

describe.concurrent.each(["rm", "prune"] as const)("the directory of bun pm cache %s", action => {
  const done =
    action === "rm" ? cleared : { stdout: "Removed 1 package older than 30 days (2 bytes)\n", stderr: "", exitCode: 0 };
  const left = action === "rm" ? [] : ["0123456789abcdef.npm"];
  const entries = readdirSorted;

  /** The cache that the environment names, and `mine` with the same entries next to the project. */
  function caches(name: string) {
    const side = tempDir(`${name}-side`, sideFiles);
    const root = tempDir(name, {
      ...projectFiles,
      "mine/bar@0.0.2@@@1/package.json": "{}",
      "mine/0123456789abcdef.npm": "manifest",
    });
    const envCache = join(String(side), "bun-install", "install", "cache");
    const mine = join(String(root), "mine");
    for (const cache of [envCache, mine]) utimesSync(join(cache, "bar@0.0.2@@@1"), daysAgo(40), daysAgo(40));
    return {
      envCache,
      mine,
      home: join(String(side), "home"),
      proj: join(String(root), "proj"),
      spawnEnv: cacheEnv(String(side)),
      [Symbol.dispose]() {
        side[Symbol.dispose]();
        root[Symbol.dispose]();
      },
    };
  }

  test("--cache-dir sets it", async () => {
    using box = caches(`pm-cache-${action}-flag`);
    expect(await pmCache([action, "--cache-dir", box.mine], box.proj, box.spawnEnv)).toEqual(done);
    expect(await entries(box.mine)).toEqual(left);
    expect(await entries(box.envCache)).toEqual(envCacheEntries);
  });

  test("~/.bunfig.toml sets it", async () => {
    using box = caches(`pm-cache-${action}-user-bunfig`);
    const spawnEnv = { ...box.spawnEnv, XDG_CONFIG_HOME: undefined };
    await writeFile(join(box.home, ".bunfig.toml"), `[install.cache]\ndir = ${JSON.stringify(box.mine)}\n`);
    expect(await pmCache([], box.proj, spawnEnv)).toEqual({ stdout: box.mine, stderr: "", exitCode: 0 });

    expect(await pmCache([action], box.proj, spawnEnv)).toEqual(done);
    expect(await entries(box.mine)).toEqual(left);
    expect(await entries(box.envCache)).toEqual(envCacheEntries);
  });

  // `cache` in .npmrc is also npm's cache directory, so it has npm's own files in it.
  test("~/.npmrc does not", async () => {
    using box = caches(`pm-cache-${action}-user-npmrc`);
    await writeFile(join(box.home, ".npmrc"), `cache=${box.mine}\n`);
    expect(await pmCache([], box.proj, box.spawnEnv)).toEqual({ stdout: box.mine, stderr: "", exitCode: 0 });

    expect(await pmCache([action], box.proj, box.spawnEnv)).toEqual(done);
    expect(await entries(box.mine)).toEqual(envCacheEntries);
    expect(await entries(box.envCache)).toEqual(left);
  });

  test("the project's bunfig.toml does not", async () => {
    using box = caches(`pm-cache-${action}-bunfig`);
    await writeFile(join(box.proj, "bunfig.toml"), `[install.cache]\ndir = ${JSON.stringify(box.mine)}\n`);
    expect(await pmCache([], box.proj, box.spawnEnv)).toEqual({ stdout: box.mine, stderr: "", exitCode: 0 });

    expect(await pmCache([action], box.proj, box.spawnEnv)).toEqual(done);
    expect(await entries(box.mine)).toEqual(envCacheEntries);
    expect(await entries(box.envCache)).toEqual(left);
  });
});

it("bun pm cache prune removes packages that bun install cached and doesn't touch the rest of the cache", async () => {
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
  await writeFile(join(package_dir, "bunfig.toml"), `[install]\nregistry = "${root_url}/"\n`);
  const spawnEnv = { ...env, BUN_INSTALL_CACHE_DIR: cache };

  async function install() {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });
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

  for (const entry of readdirSync(cache, { recursive: true, withFileTypes: true })) {
    if (!entry.isSymbolicLink()) utimesSync(join(entry.parentPath, entry.name), daysAgo(40), daysAgo(40));
  }

  const before = await readdirSorted(cache);
  expect(before).toContain("bar");
  expect(before).toContain("@scope");
  expect(before.some(name => name.startsWith("bar@0.0.2"))).toBeTrue();
  const scopedBefore = await readdirSorted(join(cache, "@scope"));
  expect(scopedBefore).toContain("bar");
  expect(scopedBefore.some(name => name.startsWith("bar@0.0.2"))).toBeTrue();

  const { stdout, stderr, exitCode } = await pmCache(["prune"], package_dir, spawnEnv);
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

// The cache directory setting (the first one set of $BUN_INSTALL_CACHE_DIR, --cache-dir,
// $BUN_INSTALL/install/cache, $XDG_CACHE_HOME/.bun/install/cache, $HOME/.bun/install/cache) is
// joined into a path buffer of MAX_PATH_BYTES: 4096 bytes on Linux, 1024 on macOS. A value that
// does not fit is unusable in the same way as a directory the OS refuses to create, and bun falls
// back to node_modules/.cache of the project like it does for those. On Windows the buffer holds
// more than an environment variable or argument can carry.
describe.concurrent.skipIf(isWindows)("cache directory setting longer than the path buffer", () => {
  // Longer than the buffer on every POSIX platform (the Linux one is the largest).
  const tooLong = "/" + Buffer.alloc(2 * 4096, "a").toString();

  const project = {
    "package.json": JSON.stringify({ name: "pm-cache-too-long", version: "1.0.0" }),
    // Bun looks for .npmrc and .bunfig.toml in $XDG_CONFIG_HOME before $HOME, so the oversized $HOME below is only ever
    // used as a cache directory candidate.
    "config/.npmrc": "",
  };

  // Every lower precedence setting points at a usable directory: the fallback must be
  // node_modules/.cache, not the next candidate.
  function cacheEnv(dir: string, setting: Record<string, string>): NodeJS.Dict<string> {
    const spawnEnv: NodeJS.Dict<string> = {
      ...env,
      HOME: join(dir, "home"),
      XDG_CONFIG_HOME: join(dir, "config"),
    };
    delete spawnEnv.BUN_INSTALL_CACHE_DIR;
    delete spawnEnv.BUN_INSTALL;
    delete spawnEnv.XDG_CACHE_HOME;
    return { ...spawnEnv, ...setting };
  }

  async function runPm(dir: string, args: string[], setting: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", ...args],
      cwd: dir,
      env: cacheEnv(dir, setting),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.each(["BUN_INSTALL_CACHE_DIR", "BUN_INSTALL", "XDG_CACHE_HOME", "HOME"])(
    "bun pm cache falls back to node_modules/.cache when $%s does not fit",
    async name => {
      using dir = tempDir("pm-cache-too-long", project);

      const { stdout, stderr, exitCode } = await runPm(String(dir), ["cache"], { [name]: tooLong });

      expect(stderr).toBe("");
      expect(stdout).toBe(join(String(dir), "node_modules", ".cache"));
      expect(exitCode).toBe(0);
    },
  );

  test("bun pm cache falls back to node_modules/.cache when --cache-dir does not fit", async () => {
    using dir = tempDir("pm-cache-too-long-flag", project);

    const { stdout, stderr, exitCode } = await runPm(String(dir), ["--cache-dir", tooLong, "cache"], {});

    expect(stderr).toBe("");
    expect(stdout).toBe(join(String(dir), "node_modules", ".cache"));
    expect(exitCode).toBe(0);
  });

  // A directory that fits the buffer but that the OS rejects (one name longer than NAME_MAX) has
  // always been handled this way; the oversized values above take the same route.
  test("bun pm cache falls back to node_modules/.cache when the OS rejects the directory", async () => {
    using dir = tempDir("pm-cache-os-rejects", project);
    const tooLongForTheOS = join(String(dir), Buffer.alloc(300, "a").toString());

    const { stdout, stderr, exitCode } = await runPm(String(dir), ["cache"], {
      BUN_INSTALL_CACHE_DIR: tooLongForTheOS,
    });

    expect(stderr).toBe("");
    expect(stdout).toBe(join(String(dir), "node_modules", ".cache"));
    expect(exitCode).toBe(0);
  });

  // The normalized directory has to fit in the buffer, not the value as written.
  test("bun pm cache uses a directory that only fits the path buffer once normalized", async () => {
    using dir = tempDir("pm-cache-long-normalized", project);
    const cacheDir = `${String(dir)}/${Buffer.alloc("x/../".length * 2000, "x/../").toString()}cache`;

    const { stdout, stderr, exitCode } = await runPm(String(dir), ["cache"], { BUN_INSTALL_CACHE_DIR: cacheDir });

    expect(stderr).toBe("");
    expect(stdout).toBe(join(String(dir), "cache"));
    expect(exitCode).toBe(0);
  });

  // `bun pm cache rm` has no fallback: it reports the directory it could not open.
  test("bun pm cache rm reports ENAMETOOLONG when $BUN_INSTALL_CACHE_DIR does not fit", async () => {
    using dir = tempDir("pm-cache-rm-too-long", project);

    const { stdout, stderr, exitCode } = await runPm(String(dir), ["cache", "rm"], { BUN_INSTALL_CACHE_DIR: tooLong });

    expect(stderr).toContain("ENAMETOOLONG getting cache directory");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
    expect(await exists(join(String(dir), "node_modules"))).toBeFalse();
  });

  test("bun install falls back to node_modules/.cache when $BUN_INSTALL_CACHE_DIR does not fit", async () => {
    using dir = tempDir("pm-cache-too-long-install", {
      ...project,
      "package.json": JSON.stringify({ name: "pm-cache-too-long", dependencies: { moo: "./moo" } }),
      "moo/package.json": JSON.stringify({ name: "moo", version: "0.1.0" }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: cacheEnv(String(dir), { BUN_INSTALL_CACHE_DIR: tooLong }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error");
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
    expect(await exists(join(String(dir), "node_modules", "moo", "package.json"))).toBeTrue();
    expect(await exists(join(String(dir), "node_modules", ".cache"))).toBeTrue();
  });
});

async function runInDir(dir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
}

test("bun pm untrusted and bun pm trust escape control characters in dependency scripts", async () => {
  // Both lines of the script are a shell comment after the echo, so only the echo runs once
  // the package is trusted. Printed raw, though, the first comment erases the listing line
  // (ESC[2K) and returns to column 1 (ESC[1G), and the newline lets the second one pose as
  // a further listing entry. `\r`, `\t`, DEL and the 8-bit CSI (U+009B) are the remaining
  // kinds of control character a terminal acts on.
  const script = 'echo "real command" #\x1b[2K\x1b[1G\r\x7f\u009b\n#\t» [postinstall]: node scripts/postinstall.js';
  const shown =
    'echo "real command" #\\x1b[2K\\x1b[1G\\r\\x7f\\u009b\\n#\\t» [postinstall]: node scripts/postinstall.js';

  using dir = tempDir("pm-untrusted-control-chars", {
    "package.json": JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "nice-pkg": "file:./nice-pkg",
      },
    }),
    "nice-pkg/package.json": JSON.stringify({
      name: "nice-pkg",
      version: "1.0.0",
      scripts: {
        postinstall: script,
      },
    }),
  });

  let [stdout, stderr, exitCode] = await runInDir(String(dir), "install");
  expect(stderr).not.toContain("error:");
  expect(stdout).toContain("Blocked 1 postinstall");
  expect(exitCode).toBe(0);

  [stdout, stderr, exitCode] = await runInDir(String(dir), "pm", "untrusted");
  expect(stderr).not.toContain("error:");
  expect(stdout).toContain(` » [postinstall]: ${shown}\n`);
  expect(stdout).not.toContain("\x1b");
  expect(stdout).not.toContain("\x7f");
  expect(stdout).not.toContain("\u009b");
  expect(exitCode).toBe(0);

  [stdout, stderr, exitCode] = await runInDir(String(dir), "pm", "trust", "nice-pkg");
  expect(stderr).not.toContain("error:");
  expect(stdout).toContain(` ✓ [postinstall]: ${shown}\n`);
  expect(stdout).toContain("1 script ran across 1 package");
  expect(stdout).not.toContain("\x1b");
  expect(stdout).not.toContain("\x7f");
  expect(stdout).not.toContain("\u009b");
  expect(exitCode).toBe(0);
});

test("bun pm trust --dry-run runs no scripts and writes nothing", async () => {
  using dir = tempDir("pm-trust-dry-run", {
    "package.json": JSON.stringify({
      name: "foo",
      dependencies: { scripted: "file:./scripted", other: "file:./other" },
    }),
    "scripted/package.json": JSON.stringify({
      name: "scripted",
      version: "1.0.0",
      scripts: { preinstall: "echo pre > preinstall.txt", postinstall: "echo post > postinstall.txt" },
    }),
    "other/package.json": JSON.stringify({
      name: "other",
      version: "1.0.0",
      scripts: { postinstall: "echo post > postinstall.txt" },
    }),
  });
  const files = () =>
    Promise.all([
      Bun.file(join(String(dir), "package.json")).text(),
      Bun.file(join(String(dir), "bun.lock")).text(),
      readdirSorted(join(String(dir), "node_modules", "scripted")),
    ]);

  let [stdout, stderr, exitCode] = await runInDir(String(dir), "install");
  expect(stderr).not.toContain("error:");
  expect(stdout).toContain("Blocked 3 postinstalls");
  expect(exitCode).toBe(0);
  const before = await files();
  expect(before[2]).toEqual(["package.json"]);

  [stdout, stderr, exitCode] = await runInDir(String(dir), "pm", "trust", "scripted", "--dry-run");
  expect(stderr).toMatch(/^bun pm trust v\S+ \(\w+\)\n$/);
  expect(stdout.replaceAll("\\", "/")).toBe(
    [
      "",
      "./node_modules/scripted @scripted",
      " » [preinstall]: echo pre > preinstall.txt",
      " » [postinstall]: echo post > postinstall.txt",
      "",
      "dry run: would run 2 scripts across 1 package",
      "dry run: would add to trustedDependencies:",
      " - scripted",
      "",
    ].join("\n"),
  );
  expect(exitCode).toBe(0);
  expect(await files()).toEqual(before);
});

// A blocked postinstall starts a chain of two hints: the install names `bun pm untrusted`, and that command names
// `bun pm trust`. For a global install both need `-g`, or the second hint acts on the project in the current directory.
test.concurrent.each([
  { scope: "project", add: "bun add", untrusted: "bun pm untrusted", trust: "bun pm trust" },
  { scope: "global", add: "bun add -g", untrusted: "bun pm -g untrusted", trust: "bun pm -g trust" },
])("bun pm untrusted names the trust command for the $scope install", async ({ scope, add, untrusted, trust }) => {
  using dir = tempDir("pm-untrusted-trust-hint", {
    "app/package.json": JSON.stringify({ name: "app" }),
    "scripted/package.json": JSON.stringify({
      name: "scripted",
      version: "1.0.0",
      scripts: { postinstall: `"${bunExe()}" -e "require('fs').writeFileSync('postinstall.txt', '')"` },
    }),
  });
  const root = String(dir);
  const app = join(root, "app");
  const bunInstall = join(root, "bun-install");
  const globalDir = join(bunInstall, "install", "global");
  const postinstallOutput = join(scope === "global" ? globalDir : app, "node_modules", "scripted", "postinstall.txt");

  // Runs a command line as the hints print it, with the bun under test in place of `bun`.
  const run = async (command: string, ...args: string[]) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...command.split(" ").slice(1), ...args],
      cwd: app,
      // Every global-dir variable is set so an inherited one can never point at the developer's real global folder.
      env: {
        ...env,
        BUN_INSTALL: bunInstall,
        BUN_INSTALL_GLOBAL_DIR: globalDir,
        BUN_INSTALL_BIN: join(bunInstall, "bin"),
        BUN_INSTALL_CACHE_DIR: join(root, ".bun-cache"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };
  const succeededWith = (stdout: string) => ({
    stdout: expect.stringContaining(stdout),
    stderr: expect.not.stringContaining("error:"),
    exitCode: 0,
  });

  expect(await run(add, join(root, "scripted"))).toEqual(
    succeededWith(`Blocked 1 postinstall. Run \`${untrusted}\` for details.`),
  );
  expect(await run(untrusted)).toEqual(
    succeededWith(`If you trust them and wish to run their scripts, use \`${trust}\`.`),
  );

  // The command the second hint names runs the script that the install blocked.
  expect(await exists(postinstallOutput)).toBeFalse();
  expect(await run(trust, "scripted")).toEqual(succeededWith("1 script ran across 1 package"));
  expect(await exists(postinstallOutput)).toBeTrue();
});

// The file: target becomes the resolution, so a dependent can put control characters in it (an
// alias containing them is rejected before anything is installed). Windows does not allow them in
// file names, so the package cannot be installed there in the first place.
test.skipIf(isWindows)("bun pm untrusted escapes control characters in the package path and resolution", async () => {
  using dir = tempDir("pm-untrusted-control-chars-path", {
    "package.json": JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "nice-pkg": "file:./real\rpkg",
      },
    }),
    "real\rpkg/package.json": JSON.stringify({
      name: "real-pkg",
      version: "1.0.0",
      scripts: {
        postinstall: "exit 0",
      },
    }),
  });

  let [stdout, stderr, exitCode] = await runInDir(String(dir), "install");
  expect(stderr).not.toContain("error:");
  expect(stdout).toContain("Blocked 1 postinstall");
  expect(exitCode).toBe(0);

  [stdout, stderr, exitCode] = await runInDir(String(dir), "pm", "untrusted");
  expect(stderr).not.toContain("error:");
  expect(stdout).toContain("./node_modules/nice-pkg @real\\rpkg\n » [postinstall]: exit 0\n");
  expect(stdout).not.toContain("\x1b");
  expect(stdout).not.toContain("\r");
  expect(exitCode).toBe(0);
});

// The global directory (`$BUN_INSTALL/install/global`, otherwise `.bun/install/global` under
// $XDG_CACHE_HOME or $HOME) and the global bin directory (`$BUN_INSTALL/bin`, otherwise `.bun/bin`
// under the same two) are each joined in a path buffer of MAX_PATH_BYTES: 4096 bytes on Linux, 1024
// on macOS. On Windows the buffer holds more than an environment variable can, so this is POSIX only.
describe.concurrent.skipIf(isWindows)("global directories longer than the path buffer", () => {
  const PATH_BUFFER_BYTES = isLinux ? 4096 : 1024;
  const LONG_VALUE = "/" + Buffer.alloc(8192, "a").toString();

  type GlobalDirectory = "global directory" | "global bin directory";
  type Variable = "BUN_INSTALL" | "XDG_CACHE_HOME" | "HOME";

  // A -g command opens the global directory (which has to contain a package.json) and then the
  // global bin directory; `bun pm bin -g` prints the latter. Every variable the two lookups read is
  // set, so that a case reaches exactly the arm it names: the directory not under test is named
  // outright ($BUN_INSTALL_GLOBAL_DIR and $BUN_INSTALL_BIN are opened as given, not joined), and
  // $XDG_CONFIG_HOME holds an .npmrc so that neither the bunfig nor the .npmrc lookup joins $HOME.
  async function runGlobal(
    args: string[],
    directory: GlobalDirectory,
    variable: Variable,
    value: string | ((dir: string) => string),
  ) {
    using dir = tempDir("pm-global-dir-too-long", {
      "global/package.json": JSON.stringify({ name: "global" }),
      "xdg-config/.npmrc": "",
    });
    const spawnEnv: NodeJS.Dict<string> = {
      ...env,
      HOME: String(dir),
      XDG_CONFIG_HOME: join(String(dir), "xdg-config"),
    };
    delete spawnEnv.BUN_INSTALL;
    delete spawnEnv.BUN_INSTALL_GLOBAL_DIR;
    delete spawnEnv.BUN_INSTALL_BIN;
    delete spawnEnv.XDG_CACHE_HOME;
    if (directory === "global directory") {
      spawnEnv.BUN_INSTALL_BIN = join(String(dir), "bin");
    } else {
      spawnEnv.BUN_INSTALL_GLOBAL_DIR = join(String(dir), "global");
    }
    spawnEnv[variable] = typeof value === "string" ? value : value(String(dir));

    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: spawnEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { dir: String(dir), stdout, stderr, exitCode };
  }

  function expectNameTooLong({ stdout, stderr, exitCode }: Awaited<ReturnType<typeof runGlobal>>) {
    expect(stderr).toContain("ENAMETOOLONG");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  }

  test.each<[GlobalDirectory, Variable]>([
    ["global directory", "BUN_INSTALL"],
    ["global directory", "XDG_CACHE_HOME"],
    ["global directory", "HOME"],
    ["global bin directory", "BUN_INSTALL"],
    ["global bin directory", "XDG_CACHE_HOME"],
    ["global bin directory", "HOME"],
  ])("bun pm bin -g: %s from $%s", async (directory, variable) => {
    expectNameTooLong(await runGlobal(["pm", "bin", "-g"], directory, variable, LONG_VALUE));
  });

  test("bun install -g: global directory from $BUN_INSTALL", async () => {
    expectNameTooLong(await runGlobal(["install", "-g"], "global directory", "BUN_INSTALL", LONG_VALUE));
  });

  // A joined path of exactly the buffer size is already one byte longer than the OS accepts; one
  // byte more and it does not fit the buffer either.
  test.each([
    ["exactly", 0],
    ["one byte above", 1],
  ])("global directory path %s the path buffer size", async (_, offset) => {
    const suffix = "/install/global";
    const value = "/" + Buffer.alloc(PATH_BUFFER_BYTES + offset - "/".length - suffix.length, "a").toString();
    expect(Buffer.byteLength(value + suffix)).toBe(PATH_BUFFER_BYTES + offset);

    expectNameTooLong(await runGlobal(["pm", "bin", "-g"], "global directory", "BUN_INSTALL", value));
  });

  // The normalized path has to fit in the buffer, not the value as written.
  test("a value that only fits the path buffer once normalized is used", async () => {
    const { dir, stdout, stderr, exitCode } = await runGlobal(
      ["pm", "bin", "-g"],
      "global bin directory",
      "BUN_INSTALL",
      // `${dir}/x/../x/../...` normalizes to `${dir}` (path.join would normalize it here already).
      dir => `${dir}/${Buffer.alloc(100_000, "x/../").toString()}`,
    );

    expect(stderr).toBe("");
    expect(stdout).toBe(join(dir, "bin") + "\n");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("the global bin directory and $PATH", () => {
  async function runGlobal(args: (dir: string) => string[], path: (bin: string) => string, extraEnv = {}) {
    using dir = tempDir("pm-global-bin-path", {
      "global/package.json": "{}",
      "my bin/.keep": "",
      "pkg/package.json": JSON.stringify({ name: "hint-pkg", version: "1.0.0", bin: { "hint-bin": "./bin.js" } }),
      "pkg/bin.js": "#!/usr/bin/env node\n",
    });
    const bin = join(String(dir), "my bin");
    const spawnEnv: NodeJS.Dict<string> = {
      ...env,
      BUN_INSTALL_BIN: bin,
      BUN_INSTALL_GLOBAL_DIR: join(String(dir), "global"),
      ...extraEnv,
    };
    spawnEnv.PATH = path(bin) + (isWindows ? ";" : ":") + process.env.PATH;

    await using proc = spawn({
      cmd: [bunExe(), ...args(String(dir))],
      cwd: String(dir),
      env: spawnEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { bin, stdout, stderr, exitCode };
  }

  const entries: [string, (bin: string) => string, boolean][] = [
    ["as it is", bin => bin, false],
    ["with a trailing slash", bin => bin + "/", false],
    ["not at all", bin => bin + "-other", true],
  ];
  if (isWindows) entries.push(["in another letter case", bin => bin.toUpperCase(), false]);

  test.each(entries)("bun pm bin -g: $PATH has it %s", async (_, path, warns) => {
    // The warning is only printed in colour.
    const { bin, stdout, stderr, exitCode } = await runGlobal(() => ["pm", "bin", "-g"], path, { FORCE_COLOR: "1" });

    expect(stdout).toContain(bin);
    expect(stderr.includes("not in $PATH")).toBe(warns);
    expect(exitCode).toBe(0);
  });

  // `\ ` inside double quotes, and `\\` for each `\` on Windows, named another folder.
  test("bun add -g prints the folder as the shell reads it", async () => {
    const { bin, stderr, exitCode } = await runGlobal(
      dir => ["add", "-g", join(dir, "pkg")],
      bin => bin + "-other",
      { SHELL: isWindows ? undefined : "/bin/bash" },
    );

    expect(stderr).toContain(
      `warn: To run "hint-bin", add the global bin folder to $PATH:\n\n` +
        (isWindows ? `${bin}\n` : `export PATH="${bin}:$PATH"\n`),
    );
    expect(exitCode).toBe(0);
  });
});

// A package.json that is readable but not writable (a read-only checkout, a file owned by
// another user) must only stop the commands that actually rewrite it.
describe.skipIf(isWindows)("read-only package.json", () => {
  // Nothing here may reach a registry.
  const offlineEnv = { ...env, npm_config_registry: "http://127.0.0.1:1/" };

  function run(cwd: string, unprivileged: ReturnType<typeof unprivilegedSpawnOptions>, ...args: string[]) {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: offlineEnv,
      stdout: "pipe",
      stderr: "pipe",
      ...unprivileged,
    });
    return Promise.all([stdout.text(), stderr.text(), exited]);
  }

  // An installed project whose package.json was made read-only afterwards. `dep` is a
  // local dependency whose postinstall was blocked, so there is something to trust; `other`
  // is a local package that is not a dependency yet, so there is something to add.
  async function installedProject() {
    const dir = tempDir("pm-read-only-package-json", {
      "package.json": JSON.stringify({ name: "read-only", version: "1.0.0", dependencies: { dep: "file:./dep" } }),
      "dep/package.json": JSON.stringify({
        name: "dep",
        version: "1.0.0",
        scripts: { postinstall: "echo ran > ran.txt" },
      }),
      "other/package.json": JSON.stringify({ name: "other", version: "1.0.0" }),
    });
    const unprivileged = unprivilegedSpawnOptions(String(dir));
    const project = {
      dir: String(dir),
      run: (...args: string[]) => run(String(dir), unprivileged, ...args),
      [Symbol.dispose]() {
        unprivileged[Symbol.dispose]();
        dir[Symbol.dispose]();
      },
    };
    try {
      const [, err, exitCode] = await project.run("install");
      expect(err).toContain("Saved lockfile");
      expect(exitCode).toBe(0);
      await chmod(join(project.dir, "package.json"), 0o444);
    } catch (e) {
      project[Symbol.dispose]();
      throw e;
    }
    return project;
  }

  test("commands that only read package.json work", async () => {
    using project = await installedProject();

    const results: { args: string[]; out: string; err: string; exitCode: number }[] = [];
    for (const args of [["pm", "bin"], ["pm", "ls"], ["pm", "pkg", "get", "name"], ["why", "dep"], ["outdated"]]) {
      const [out, err, exitCode] = await project.run(...args);
      results.push({ args, out, err, exitCode });
    }

    expect(results).toEqual([
      { args: ["pm", "bin"], out: join(project.dir, "node_modules", ".bin") + "\n", err: "", exitCode: 0 },
      { args: ["pm", "ls"], out: expect.stringContaining("dep@dep"), err: "", exitCode: 0 },
      { args: ["pm", "pkg", "get", "name"], out: '"read-only"\n', err: "", exitCode: 0 },
      { args: ["why", "dep"], out: expect.stringContaining("dep@dep"), err: "", exitCode: 0 },
      { args: ["outdated"], out: expect.stringMatching(/^bun outdated v/), err: "", exitCode: 0 },
    ]);
  });

  test("bun pm trust refuses before running any script", async () => {
    using project = await installedProject();
    const packageJson = join(project.dir, "package.json");
    const lockfile = join(project.dir, "bun.lock");
    const ranMarker = join(project.dir, "node_modules", "dep", "ran.txt");
    const lockfileBefore = await Bun.file(lockfile).text();

    {
      const [out, err, exitCode] = await project.run("pm", "trust", "dep");
      expect(err).toContain(`EACCES: Permission denied: could not open "${packageJson}" for writing`);
      expect(out).toBe("");
      expect(exitCode).toBe(1);
      expect(await exists(ranMarker)).toBeFalse();
      expect(await Bun.file(lockfile).text()).toBe(lockfileBefore);
    }

    // Once package.json is writable again the same command runs the script and records the trust.
    await chmod(packageJson, 0o644);
    {
      const [out, err, exitCode] = await project.run("pm", "trust", "dep");
      expect(err).not.toContain("error");
      expect(out).toContain("1 script ran across 1 package");
      expect(exitCode).toBe(0);
      expect(await exists(ranMarker)).toBeTrue();
      expect(await Bun.file(packageJson).json()).toMatchObject({ trustedDependencies: ["dep"] });
      expect(await Bun.file(lockfile).text()).toContain("trustedDependencies");
    }
  });

  test("commands that rewrite package.json still refuse up front", async () => {
    using project = await installedProject();

    const results: { args: string[]; out: string; err: string; exitCode: number }[] = [];
    for (const args of [["add", "./other"], ["remove", "dep"], ["update"]]) {
      const [out, err, exitCode] = await project.run(...args);
      results.push({ args, out, err, exitCode });
    }

    const refused = {
      out: "",
      err: expect.stringContaining(
        `EACCES: Permission denied while opening "${join(project.dir, "package.json")}"\nnote: package.json must be writable`,
      ),
      exitCode: 1,
    };
    expect(results).toEqual([
      { args: ["add", "./other"], ...refused },
      { args: ["remove", "dep"], ...refused },
      { args: ["update"], ...refused },
    ]);
  });

  // --dry-run and --no-save turn the same commands into readers of package.json.
  test("--dry-run and --no-save do not need a writable package.json", async () => {
    using project = await installedProject();
    const packageJson = join(project.dir, "package.json");
    const packageJsonBefore = await Bun.file(packageJson).text();

    const results: { args: string[]; err: string; exitCode: number }[] = [];
    for (const args of [
      ["add", "./other", "--dry-run"],
      ["remove", "dep", "--dry-run"],
      ["update", "--dry-run"],
      ["add", "./other", "--no-save"],
    ]) {
      const [, err, exitCode] = await project.run(...args);
      results.push({ args, err, exitCode });
    }

    expect(results).toEqual([
      { args: ["add", "./other", "--dry-run"], err: "", exitCode: 0 },
      { args: ["remove", "dep", "--dry-run"], err: "", exitCode: 0 },
      { args: ["update", "--dry-run"], err: "", exitCode: 0 },
      { args: ["add", "./other", "--no-save"], err: "", exitCode: 0 },
    ]);
    expect(await Bun.file(packageJson).text()).toBe(packageJsonBefore);
  });

  test("a read-only root package.json is still found from a workspace member", async () => {
    using dir = tempDir("pm-read-only-workspace-root", {
      "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      "packages/member/package.json": JSON.stringify({ name: "member", version: "1.0.0" }),
    });
    await chmod(join(String(dir), "package.json"), 0o444);
    using unprivileged = unprivilegedSpawnOptions(String(dir));

    const [out, err, exitCode] = await run(join(String(dir), "packages", "member"), unprivileged, "pm", "bin");

    expect(err).toBe("");
    expect(out).toBe(join(String(dir), "node_modules", ".bin") + "\n");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("without a package.json", () => {
  function fresh(name: string) {
    const dir = tempDir(name, {
      "cwd/.keep": "",
      "pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
    });
    const root = String(dir);
    const bunInstall = join(root, "bun-install");
    const spawnEnv: NodeJS.Dict<string> = {
      ...env,
      BUN_INSTALL: bunInstall,
      XDG_CACHE_HOME: join(root, "xdg-cache"),
      HOME: root,
      USERPROFILE: root,
    };
    for (const key of ["BUN_INSTALL_GLOBAL_DIR", "BUN_INSTALL_BIN", "BUN_INSTALL_CACHE_DIR"]) delete spawnEnv[key];
    return {
      root,
      bunInstall,
      globalDir: join(bunInstall, "install", "global"),
      async run(...args: string[]) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), ...args],
          cwd: join(root, "cwd"),
          stdout: "pipe",
          stderr: "pipe",
          env: spawnEnv,
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr, exitCode };
      },
      [Symbol.dispose]: () => dir[Symbol.dispose](),
    };
  }

  // https://github.com/oven-sh/bun/issues/7501
  test.each(["pm -g bin", "pm bin -g"])(
    "bun %s prints the global bin directory before any global install",
    async cmd => {
      using project = fresh("pm-bin-global-fresh");
      expect(await project.run(...cmd.split(" "))).toEqual({
        stdout: join(project.bunInstall, "bin") + "\n",
        stderr: "",
        exitCode: 0,
      });
      // A query does not start a project.
      expect(await readdirSorted(project.globalDir)).toEqual([]);
    },
  );

  // https://github.com/oven-sh/bun/issues/13019
  test.each([
    ["pm ls -g", " (0 installed)"],
    ["pm -g ls", " (0 installed)"],
    ["list -g", " (0 installed)"],
    ["pm ls -g --all", ""],
  ])("bun %s prints an empty listing before any global install", async (cmd, count) => {
    using project = fresh("pm-ls-global-fresh");
    expect(await project.run(...cmd.split(" "))).toEqual({
      stdout: `${project.globalDir} node_modules${count}\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(await readdirSorted(project.globalDir)).toEqual([]);
  });

  test("bun pm ls -g prints an empty listing after the last global package was removed", async () => {
    using project = fresh("pm-ls-global-removed");
    expect(await project.run("add", "-g", join(project.root, "pkg"))).toMatchObject({ exitCode: 0 });
    expect(await project.run("pm", "ls", "-g")).toEqual({
      stdout: `${project.globalDir} node_modules (1 installed)\n└── pkg@${join("..", "..", "..", "pkg")}\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(await project.run("remove", "-g", "pkg")).toMatchObject({ exitCode: 0 });
    expect(await readdirSorted(project.globalDir)).toEqual(["node_modules", "package.json"]);
    expect(await project.run("pm", "ls", "-g")).toEqual({
      stdout: `${project.globalDir} node_modules (0 installed)\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("bun pm ls -g says why a global lockfile does not load", async () => {
    using project = fresh("pm-ls-global-broken-lockfile");
    expect(await project.run("add", "-g", join(project.root, "pkg"))).toMatchObject({ exitCode: 0 });
    await Bun.write(join(project.globalDir, "bun.lock"), "this is not a lockfile");
    expect(await project.run("pm", "ls", "-g")).toEqual({
      stdout: "",
      stderr:
        "1 | this is not a lockfile\n    ^\nerror: Unexpected this\n    at bun.lock:1:1\n" +
        "error: failed to parse lockfile: ParserError\n",
      exitCode: 1,
    });
  });

  test("bun pm ls -g skips a global package that's missing on disk", async () => {
    using project = fresh("pm-ls-global-deleted");
    expect(await project.run("add", "-g", join(project.root, "pkg"))).toMatchObject({ exitCode: 0 });
    await rm(join(project.globalDir, "node_modules", "pkg"), { recursive: true });
    expect(await project.run("pm", "ls", "-g")).toEqual({
      stdout: `${project.globalDir} node_modules (0 installed)\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("commands that only need machine-wide or registry configuration run", async () => {
    using project = fresh("pm-no-project");
    const cache = join(project.bunInstall, "install", "cache");
    expect(await project.run("pm", "cache")).toEqual({ stdout: cache, stderr: "", exitCode: 0 });
    expect(await project.run("pm", "cache", "rm")).toMatchObject({
      stdout: expect.stringContaining("Cleared 'bun install' cache\n"),
      stderr: "",
      exitCode: 0,
    });
    expect(await project.run("pm", "default-trusted")).toMatchObject({
      stdout: expect.stringMatching(/^Default trusted dependencies \(\d+\):\n/),
      stderr: "",
      exitCode: 0,
    });
    expect(await project.run("pm")).toMatchObject({
      stdout: expect.stringContaining("Usage: bun pm [flags] [<command>]"),
      stderr: "",
      exitCode: 0,
    });
    for (const cmd of [["pm", "whoami"], ["whoami"]]) {
      expect(await project.run(...cmd)).toEqual({
        stdout: "",
        stderr: "error: missing authentication (run `bunx npm login`)\n",
        exitCode: 1,
      });
    }
    expect(await readdirSorted(join(project.root, "cwd"))).toEqual([".keep"]);
  });

  test.each(["pm bin", "pm ls", "pm hash", "pm -g hash", "pm untrusted", "pm pkg get name"])(
    "bun %s still needs one",
    async cmd => {
      using project = fresh("pm-needs-project");
      const dir = cmd.includes("-g") ? project.globalDir : join(project.root, "cwd");
      expect(await project.run(...cmd.split(" "))).toEqual({
        stdout: "",
        stderr: `error: No package.json was found for directory "${dir}"\nnote: Run "bun init" to initialize a project\n`,
        exitCode: 1,
      });
    },
  );
});

describe.concurrent("bun pm refuses a flag that only other subcommands take", () => {
  const json = "`bun pm diff`, `bun pm licenses`, `bun pm pkg`, `bun pm view`";
  test.each([
    ["pm why x --json", "--json", json],
    ["pm ls --json", "--json", json],
    ["list --all --json", "--json", json],
    ["pm untrusted --json", "--json", json],
    ["pm hash --json", "--json", json],
    ["pm bin --json", "--json", json],
    ["pm pack --dry-run --json", "--json", json],
    ["pm version patch --dry-run --json", "--json", json],
    ["pm default-trusted --json", "--json", json],
    ["pm hash --all", "--all", "`bun pm ls`, `bun pm trust`"],
    ["pm bin --depth=1", "--depth", "`bun pm ls`, `bun pm why`"],
    ["pm ls --top", "--top", "`bun pm why`"],
    ["pm ls -m x", "--message", "`bun pm version`"],
    ["pm why x -D", "--dev", "`bun pm licenses`"],
    ["pm cache --stat", "--stat", "`bun pm diff`"],
    ["pm pack --max-age=1", "--max-age", "`bun pm cache`"],
    ["pm pkg get name --filename=x", "--filename", "`bun pm pack`"],
  ])("bun %s", async (cmd, flag, commands) => {
    using dir = tempDir("bun-pm-flags", {
      "package.json": JSON.stringify({ name: "foo", version: "0.0.1" }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd.split(" ")],
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: `error: ${flag} is only supported by ${commands}\n`,
      exitCode: 1,
    });
  });
});

describe.concurrent("usage text keeps its indent", () => {
  async function run(...args: string[]) {
    using dir = tempDir("bun-pm-usage", {
      "package.json": JSON.stringify({ name: "foo", version: "0.0.1" }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("bun pm, bun pm --help and an unknown subcommand print one help text", async () => {
    const [bare, help, unknown] = await Promise.all([run("pm"), run("pm", "--help"), run("pm", "no-such-subcommand")]);
    expect(help.stdout).toBe(bare.stdout);
    expect(unknown.stdout).toBe(bare.stdout);

    const lines = bare.stdout.split("\n");
    expect(lines.slice(0, 7)).toEqual([
      "",
      "Usage: bun pm [flags] [<command>]",
      "",
      "  Run package manager utilities.",
      "",
      "Commands:",
      "",
    ]);
    expect(lines).toContain("  bun pm scan                 scan all packages in lockfile for security vulnerabilities");
    expect(lines).toContain("  ├ --dry-run                 do everything except for writing the tarball to disk");
    expect(lines).toContain(
      "  bun pm diff [a] [b]         show what changed between two versions of a package (or vs a folder/tarball)",
    );
    expect(lines).toContain("  └ --json                    one JSON document (files, patch text, notes, totals)");
    const ls = lines.indexOf("  bun pm ls                   list the tree of installed dependencies");
    expect(lines.slice(ls + 1, ls + 7)).toEqual([
      "  ├ names ...                 list every installed package with one of these names",
      "  ├ --all                     list the entire tree of installed dependencies",
      "  ├ --trusted                 list only trusted dependencies",
      "  ├ --prod                    omit devDependencies",
      "  └ -g                        list the tree of globally installed dependencies",
      "  bun pm why <pkg>            show dependency tree explaining why a package is installed",
    ]);
    expect(lines).toContain("  bun pm default-trusted      print the default trusted dependencies list");

    expect([bare.stderr, help.stderr]).toEqual(["", ""]);
    expect(unknown.stderr).toBe('\nerror: "no-such-subcommand" unknown command\n');
    expect([bare.exitCode, help.exitCode, unknown.exitCode]).toEqual([0, 0, 1]);
  });

  test.each(["why", "pm why"])("bun %s with no package", async cmd => {
    const { stdout, exitCode } = await run(...cmd.split(" "));
    expect(stdout.split("\n").slice(1)).toEqual([
      "Explain why a package is installed",
      "",
      "Arguments:",
      "  <package>     The package name or alias to explain (supports glob patterns like '@org/*')",
      "",
      "Options:",
      "  --top         Show only the top dependency tree instead of nested ones",
      "  --depth <NUM> Maximum depth of the dependency tree to display",
      "",
      "Examples:",
      "  $ bun why react",
      '  $ bun why "@types/*" --depth 2',
      '  $ bun why "*-lodash" --top',
      "",
    ]);
    expect(exitCode).toBe(1);
  });

  test("bun create next", async () => {
    expect(await run("create", "next")).toEqual({
      stdout: "",
      stderr: [
        "warn: No template create-next found.",
        "To create a project with the official Next.js scaffolding tool, run",
        "  bun create next-app [destination]",
        "",
      ].join("\n"),
      exitCode: 1,
    });
  });

  test("bun create react", async () => {
    expect(await run("create", "react")).toEqual({
      stdout: "",
      stderr: [
        'The "react" template has been deprecated.',
        'It is recommended to use "react-app" or "vite" instead.',
        "",
        "To create a project using Create React App, run",
        "",
        "  bun create react-app",
        "",
        "To create a React project using Vite, run",
        "",
        "  bun create vite",
        "",
        'Then select "React" from the list of frameworks.',
        "",
      ].join("\n"),
      exitCode: 1,
    });
  });
});
