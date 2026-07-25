import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, test } from "bun:test";
import { exists, mkdir, writeFile } from "fs/promises";
import { bunEnv, bunExe, bunEnv as env, readdirSorted, tempDir, tmpdirSync } from "harness";
import { cpSync } from "node:fs";
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
  expect(await stdout.text()).toBe(`${package_dir} node_modules (2)
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
  expect(await stdout.text()).toBe(`${package_dir} node_modules (2)
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
  await writeFile(join(package_dir, "bunfig.toml"), `[install]\ncache = false\nregistry = "${root_url}/"\n`);
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
    expect(await stdout.text()).toBe(`${package_dir} node_modules (2)
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
    expect(await stdout.text()).toBe(`${package_dir} node_modules (2)
├── bar@0.0.2
└── moo@moo
`);
    expect(await exited).toBe(0);
  }
});

it("should list only trusted dependencies with --all --trusted", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(join(package_dir, "bunfig.toml"), `[install]\ncache = false\nregistry = "${root_url}/"\n`);
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
    `[install]\ncache = false\nregistry = "${root_url}/"\nlinker = "isolated"\n`,
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
  await writeFile(join(package_dir, "bunfig.toml"), `[install]\ncache = false\nregistry = "${root_url}/"\n`);
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
  expect(await stdout.text()).toBe(`${package_dir} node_modules (1)
`);
  expect(await exited).toBe(0);
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
    expectedOutput: (dir: string) => `${dir} node_modules (1)\n└── bar@0.0.2\n`,
    checkReservationMessage: true,
  },
  {
    name: "bun pm list works as alias for bun pm ls",
    cmd: ["pm", "list"],
    packageName: "test-pm-list",
    dependencies: { bar: "latest" },
    expectedOutput: (dir: string) => `${dir} node_modules (1)\n└── bar@0.0.2\n`,
    checkReservationMessage: false,
  },
  {
    name: "bun pm ls still works",
    cmd: ["pm", "ls"],
    packageName: "test-pm-ls",
    dependencies: { bar: "latest" },
    expectedOutput: (dir: string) => `${dir} node_modules (1)\n└── bar@0.0.2\n`,
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
