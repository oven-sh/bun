import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { exists, mkdir, writeFile } from "fs/promises";
import { bunEnv, bunExe, bunEnv as env, readdirSorted, tmpdirSync } from "harness";
import { cpSync } from "node:fs";
import { join } from "path";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyBeforeAll,
  dummyRegistryForContext,
  setContextHandler,
  type TestContext,
} from "./dummy.registry";

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
  dummyBeforeAll();
});
afterAll(dummyAfterAll);

async function withContext(
  opts: { linker?: "hoisted" | "isolated" } | undefined,
  fn: (ctx: TestContext) => Promise<void>,
): Promise<void> {
  const ctx = await createTestContext(opts ? { linker: opts.linker! } : undefined);
  try {
    await fn(ctx);
  } finally {
    destroyTestContext(ctx);
  }
}

const defaultOpts = { linker: "hoisted" as const };

describe.concurrent("bun-pm", () => {
  it("should list top-level dependency", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            moo: "./moo",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "moo"));
      await writeFile(
        join(ctx.package_dir, "moo", "package.json"),
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
          cwd: ctx.package_dir,
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
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      urls.length = 0;
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "pm", "ls"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      expect(await stderr.text()).toBe("");
      expect(await stdout.text()).toBe(`${ctx.package_dir} node_modules (2)
└── moo@moo
`);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([]);
      expect(ctx.requested).toBe(2);
    });
  });

  it("should list all dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            moo: "./moo",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "moo"));
      await writeFile(
        join(ctx.package_dir, "moo", "package.json"),
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
          cwd: ctx.package_dir,
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
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      urls.length = 0;
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "pm", "ls", "--all"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      expect(await stderr.text()).toBe("");
      expect(await stdout.text()).toBe(`${ctx.package_dir} node_modules
├── bar@0.0.2
└── moo@moo
`);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([]);
      expect(ctx.requested).toBe(2);
    });
  });

  it("should list top-level aliased dependency", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "moo-1": "./moo",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "moo"));
      await writeFile(
        join(ctx.package_dir, "moo", "package.json"),
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
          cwd: ctx.package_dir,
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
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      urls.length = 0;
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "pm", "ls"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      expect(await stderr.text()).toBe("");
      expect(await stdout.text()).toBe(`${ctx.package_dir} node_modules (2)
└── moo-1@moo
`);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([]);
      expect(ctx.requested).toBe(2);
    });
  });

  it("should list aliased dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "moo-1": "./moo",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "moo"));
      await writeFile(
        join(ctx.package_dir, "moo", "package.json"),
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
          cwd: ctx.package_dir,
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
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      urls.length = 0;
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "pm", "ls", "--all"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      expect(await stderr.text()).toBe("");
      expect(await stdout.text()).toBe(`${ctx.package_dir} node_modules
├── bar-1@0.0.2
└── moo-1@moo
`);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([]);
      expect(ctx.requested).toBe(2);
    });
  });

  it("should remove all cache", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "moo-1": "./moo",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "moo"));
      await writeFile(
        join(ctx.package_dir, "moo", "package.json"),
        JSON.stringify({
          name: "moo",
          version: "0.1.0",
          dependencies: {
            "bar-1": "npm:bar",
          },
        }),
      );
      let cache_dir: string = join(ctx.package_dir, "node_modules", ".cache");
      {
        const { stderr, stdout, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
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
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(cache_dir)).toContain("bar");

      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "pm", "cache"],
        cwd: ctx.package_dir,
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
        cwd: ctx.package_dir,
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
  });
});

// Tests that don't use the concurrent context (e.g., snapshot tests)
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

describe.concurrent("bun-pm-additional", () => {
  test("bun whoami executes pm whoami", async () => {
    await withContext(defaultOpts, async ctx => {
      // Test that "bun whoami" doesn't show reservation message and instead executes pm whoami
      // First create a simple package.json
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-whoami",
          version: "1.0.0",
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "whoami"],
        cwd: ctx.package_dir,
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
  });

  test("bun pm whoami still works", async () => {
    await withContext(defaultOpts, async ctx => {
      // Test that "bun pm whoami" still works as expected
      // First create a simple package.json
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-pm-whoami",
          version: "1.0.0",
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "pm", "whoami"],
        cwd: ctx.package_dir,
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
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
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
          cwd: ctx.package_dir,
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
        cwd: ctx.package_dir,
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
      expect(stdoutText).toBe(expectedOutput(ctx.package_dir));
      expect(exitCode).toBe(0);
    });
  });

  test("bun list --all shows full dependency tree", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-list-all",
          version: "1.0.0",
          dependencies: {
            moo: "./moo",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "moo"));
      await writeFile(
        join(ctx.package_dir, "moo", "package.json"),
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
          cwd: ctx.package_dir,
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
        cwd: ctx.package_dir,
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
      expect(stdoutText).toBe(`${ctx.package_dir} node_modules
├── bar@0.0.2
└── moo@moo
`);
      expect(exitCode).toBe(0);
    });
  });
});
