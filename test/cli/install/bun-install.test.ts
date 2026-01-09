import { file, listen, Socket, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, it, jest, setDefaultTimeout, test } from "bun:test";
import { access, cp, exists, mkdir, readlink, rm, stat, writeFile } from "fs/promises";
import {
  bunEnv,
  bunExe,
  bunEnv as env,
  isWindows,
  joinP,
  readdirSorted,
  runBunInstall,
  tempDirWithFiles,
  textLockfile,
  toBeValidBin,
  toBeWorkspaceLink,
  toHaveBins,
} from "harness";
import { join, resolve, sep } from "path";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyBeforeAll,
  dummyRegistryForContext,
  setContextHandler,
  type TestContext,
} from "./dummy.registry.js";

expect.extend({
  toBeWorkspaceLink,
  toBeValidBin,
  toHaveBins,
  toHaveWorkspaceLink: async function (package_dir: string, [link, real]: [string, string]) {
    if (!isWindows) {
      return expect(await readlink(join(package_dir, "node_modules", link))).toBeWorkspaceLink(join("..", real));
    } else {
      return expect(await readlink(join(package_dir, "node_modules", link))).toBeWorkspaceLink(join(package_dir, real));
    }
  },
  toHaveWorkspaceLink2: async function (package_dir: string, [link, realPosix, realWin]: [string, string, string]) {
    if (!isWindows) {
      return expect(await readlink(join(package_dir, "node_modules", link))).toBeWorkspaceLink(join("..", realPosix));
    } else {
      // prettier-ignore
      return expect(await readlink(join(package_dir, "node_modules", link))).toBeWorkspaceLink(join(package_dir, realWin));
    }
  },
});

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
  dummyBeforeAll();
});

afterAll(dummyAfterAll);

// Helper function that sets up test context and ensures cleanup
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

// Default context options for most tests
const defaultOpts = { linker: "hoisted" as const };

describe.concurrent("bun-install", () => {
  for (let input of ["abcdef", "65537", "-1"]) {
    it(`bun install --network-concurrency=${input} fails`, async () => {
      await withContext(defaultOpts, async ctx => {
        const urls: string[] = [];
        setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
        await writeFile(
          join(ctx.package_dir, "package.json"),
          `
  {
    "name": "foo",
    "version": "0.0.1",
    "dependencies": {
      "bar": "^1"
    }
  }`,
        );
        const { stderr, exited } = spawn({
          cmd: [bunExe(), "install", "--network-concurrency", "abcdef"],
          cwd: ctx.package_dir,
          stdout: "inherit",
          stdin: "inherit",
          stderr: "pipe",
          env,
        });
        const err = await stderr.text();
        expect(err).toContain("Expected --network-concurrency to be a number between 0 and 65535");
        expect(await exited).toBe(1);
        expect(urls).toBeEmpty();
      });
    });
  }

  it("bun install --network-concurrency=5 doesnt go over 5 concurrent requests", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      let maxConcurrentRequests = 0;
      let concurrentRequestCounter = 0;
      let totalRequests = 0;
      setContextHandler(ctx, async function (request) {
        concurrentRequestCounter++;
        totalRequests++;
        try {
          await Bun.sleep(10);
          maxConcurrentRequests = Math.max(maxConcurrentRequests, concurrentRequestCounter);

          if (concurrentRequestCounter > 20) {
            throw new Error("Too many concurrent requests");
          }
        } finally {
          concurrentRequestCounter--;
        }

        return new Response("404", { status: 404 });
      });
      await writeFile(
        join(ctx.package_dir, "package.json"),
        `
  {
    "name": "foo",
    "version": "0.0.1",
    "dependencies": {
      "bar1": "^1",
      "bar2": "^1",
      "bar3": "^1",
      "bar4": "^1",
      "bar5": "^1",
      "bar6": "^1",
      "bar7": "^1",
      "bar8": "^1",
      "bar9": "^1",
      "bar10": "^1",
      "bar11": "^1",
      "bar12": "^1",
      "bar13": "^1",
      "bar14": "^1",
      "bar15": "^1",
      "bar16": "^1",
      "bar17": "^1",
      "bar18": "^1",
      "bar19": "^1",
      "bar20": "^1",
      "bar21": "^1",
      "bar22": "^1",
      "bar23": "^1",
      "bar24": "^1",
      "bar25": "^1",
      "bar26": "^1",
      "bar27": "^1",
      "bar28": "^1",
      "bar29": "^1",
      "bar30": "^1",
      "bar31": "^1",
      "bar32": "^1",
      "bar33": "^1",
      "bar34": "^1",
      "bar35": "^1",
      "bar36": "^1",
      "bar37": "^1",
      "bar38": "^1",
      "bar39": "^1",
      "bar40": "^1",
      "bar41": "^1",
      "bar42": "^1",
      "bar43": "^1",
      "bar44": "^1",
      "bar45": "^1",
      "bar46": "^1",
      "bar47": "^1",
      "bar48": "^1",
      "bar49": "^1",
      "bar50": "^1",
      "bar51": "^1",
    }
  }`,
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--network-concurrency", "5"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(await exited).toBe(1);
      expect(urls).toBeEmpty();
      expect(maxConcurrentRequests).toBeLessThanOrEqual(5);
      expect(totalRequests).toBe(51);

      expect(err).toContain("failed to resolve");
      expect(await stdout.text()).toEqual(expect.stringContaining("bun install v1."));
    });
  });

  it("should not error when package.json has comments and trailing commas", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        `
      {
        "name": "foo",
        "version": "0.0.1",
        "dependencies": {
          "bar": "^1",
        },
      }
  `,
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain('error: No version matching "^1" found for specifier "bar" (but package exists)');
      expect(await stdout.text()).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`]);
      expect(ctx.requested).toBe(1);
      try {
        await access(join(ctx.package_dir, "bun.lockb"));
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
    });
  });

  describe("chooses", () => {
    async function runTest(ctx: TestContext, latest: string, range: string, chosen = "0.0.5") {
      const exeName: string = {
        "0.0.5": "baz-exec",
        "0.0.3": "baz-run",
      }[chosen]!;
      if (!exeName) throw new Error("exeName not found");

      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.5": {
            bin: {
              "baz-exec": "index.js",
            },
          },

          "0.0.3": {
            bin: {
              "baz-run": "index.js",
            },
          },
          latest,
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: range,
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ baz@${chosen}`,
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-${chosen}.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins([exeName]);
      expect(join(ctx.package_dir, "node_modules", ".bin", exeName)).toBeValidBin(join("..", "baz", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: chosen,
        bin: {
          [exeName]: "index.js",
        },
      } as any);
      await access(join(ctx.package_dir, "bun.lockb"));
    }

    describe("highest matching version", () => {
      for (let latest of ["999.999.999", "0.0.4", "0.0.2"]) {
        for (let range of ["0.0.x", "~0.0.4", "~0.0.2"]) {
          it("when latest is " + latest + " and range is " + range, async () => {
            await withContext(defaultOpts, async ctx => {
              await runTest(ctx, latest, range);
            });
          });
        }
      }
    });

    describe('"latest" tag', () => {
      for (let latest of ["0.0.5", "0.0.3"]) {
        it(latest, async () => {
          await withContext(defaultOpts, async ctx => {
            await runTest(ctx, latest, "~0.0.3", latest);
          });
        });
      }
    });
  });

  it("should report connection errors", async () => {
    await withContext(defaultOpts, async ctx => {
      function end(socket: Socket) {
        socket.end();
      }
      const server = listen({
        socket: {
          data: function data(socket) {
            socket.end();
          },
          drain: function drain(socket) {
            socket.end();
          },
          open: function open(socket) {
            socket.end();
          },
        },
        hostname: "localhost",
        port: 0,
      });
      await writeFile(
        join(ctx.package_dir, "bunfig.toml"),
        `
  [install]
  cache = false
  registry = "http://${server.hostname}:${server.port}/"
  `,
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "0.0.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toMatch(/error: (ConnectionRefused|ConnectionClosed) downloading package manifest bar/gm);
      expect(await stdout.text()).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
      try {
        await access(join(ctx.package_dir, "bun.lockb"));
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
    });
  });

  it("should support --registry CLI flag", async () => {
    await withContext(defaultOpts, async ctx => {
      const connected = jest.fn();
      function end(socket: Socket) {
        connected();
        socket.end();
      }
      const server = listen({
        socket: {
          data: function data(socket) {
            end(socket);
          },
          drain: function drain(socket) {
            end(socket);
          },
          open: function open(socket) {
            end(socket);
          },
        },
        hostname: "localhost",
        port: 0,
      });
      await writeFile(
        join(ctx.package_dir, "bunfig.toml"),
        `
  [install]
  cache = false
  registry = "https://badssl.com:bad"
  `,
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "0.0.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--registry", `http://${server.hostname}:${server.port}/`],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toMatch(/error: (ConnectionRefused|ConnectionClosed) downloading package manifest bar/gm);
      expect(await stdout.text()).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
      try {
        await access(join(ctx.package_dir, "bun.lockb"));
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
      expect(connected).toHaveBeenCalled();
    });
  });

  it("should work when moving workspace packages", async () => {
    const package_dir = tempDirWithFiles("lol", {
      "package.json": JSON.stringify({
        "name": "my-workspace",
        private: "true",
        version: "0.0.1",
        "devDependencies": {
          "@repo/ui": "*",
          "@repo/eslint-config": "*",
          "@repo/typescript-config": "*",
        },
        workspaces: ["packages/*"],
      }),
      packages: {
        "eslint-config": {
          "package.json": JSON.stringify({
            name: "@repo/eslint-config",
            "version": "0.0.0",
            private: "true",
          }),
        },
        "typescript-config": {
          "package.json": JSON.stringify({
            "name": "@repo/typescript-config",
            "version": "0.0.0",
            private: "true",
          }),
        },
        "ui": {
          "package.json": JSON.stringify({
            name: "@repo/ui",
            version: "0.0.0",
            private: "true",
            devDependencies: {
              "@repo/eslint-config": "*",
              "@repo/typescript-config": "*",
            },
          }),
        },
      },
    });

    await Bun.$`${bunExe()} i`.env(bunEnv).cwd(package_dir);

    await Bun.$ /* sh */ `
  mkdir config

  # change workspaces from "packages/*" to "config/*"
  echo ${JSON.stringify({
    "name": "my-workspace",
    version: "0.0.1",
    workspaces: ["config/*"],
    "devDependencies": {
      "@repo/ui": "*",
      "@repo/eslint-config": "*",
      "@repo/typescript-config": "*",
    },
  })} > package.json

  mv packages/typescript-config config/
  mv packages/eslint-config config/
  mv packages/ui config/

  rm -rf packages
  rm -rf apps
  `
      .env(bunEnv)
      .cwd(package_dir);

    await Bun.$`${bunExe()} i`.env(bunEnv).cwd(package_dir);
  });

  it("should work when renaming a single workspace package", async () => {
    const package_dir = tempDirWithFiles("lol", {
      "package.json": JSON.stringify({
        "name": "my-workspace",
        private: "true",
        version: "0.0.1",
        "devDependencies": {
          "@repo/ui": "*",
          "@repo/eslint-config": "*",
          "@repo/typescript-config": "*",
        },
        workspaces: ["packages/*"],
      }),
      packages: {
        "eslint-config": {
          "package.json": JSON.stringify({
            name: "@repo/eslint-config",
            "version": "0.0.0",
            private: "true",
          }),
        },
        "typescript-config": {
          "package.json": JSON.stringify({
            "name": "@repo/typescript-config",
            "version": "0.0.0",
            private: "true",
          }),
        },
        "ui": {
          "package.json": JSON.stringify({
            name: "@repo/ui",
            version: "0.0.0",
            private: "true",
            devDependencies: {
              "@repo/eslint-config": "*",
              "@repo/typescript-config": "*",
            },
          }),
        },
      },
    });

    await Bun.$`${bunExe()} i`.env(bunEnv).cwd(package_dir);

    await Bun.$ /* sh */ `
  echo ${JSON.stringify({
    "name": "my-workspace",
    version: "0.0.1",
    workspaces: ["packages/*"],
    "devDependencies": {
      "@repo/ui": "*",
      "@repo/eslint-config-lol": "*",
      "@repo/typescript-config": "*",
    },
  })} > package.json

  echo ${JSON.stringify({
    name: "@repo/eslint-config-lol",
    "version": "0.0.0",
    private: "true",
  })} > packages/eslint-config/package.json

  echo ${JSON.stringify({
    name: "@repo/ui",
    version: "0.0.0",
    private: "true",
    devDependencies: {
      "@repo/eslint-config-lol": "*",
      "@repo/typescript-config": "*",
    },
  })} > packages/ui/package.json
  `
      .env(bunEnv)
      .cwd(package_dir);

    await Bun.$`${bunExe()} i`.env(bunEnv).cwd(package_dir);
  });

  it("should handle missing package", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, async request => {
        expect(request.method).toBe("GET");
        expect(request.headers.get("accept")).toBe(
          "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
        );
        expect(request.headers.get("npm-auth-type")).toBe(null);
        expect(await request.text()).toBeEmpty();
        urls.push(request.url);
        return new Response("bar", { status: 404 });
      });
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "foo"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err.split(/\r?\n/)).toContain(`error: GET ${ctx.registry_url}foo - 404`);
      expect(await stdout.text()).toEqual(expect.stringContaining("bun add v1."));
      expect(await exited).toBe(1);
      expect(urls.sort()).toEqual([`${ctx.registry_url}foo`]);
      expect(ctx.requested).toBe(1);
      try {
        await access(join(ctx.package_dir, "bun.lockb"));
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
    });
  });

  it("should handle @scoped authentication", async () => {
    await withContext(defaultOpts, async ctx => {
      let seen_token = false;
      const url = `${ctx.registry_url}@foo%2fbar`;
      const urls: string[] = [];
      setContextHandler(ctx, async request => {
        expect(request.method).toBe("GET");
        expect(request.headers.get("accept")).toBe(
          "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
        );
        if (request.url === url) {
          expect(request.headers.get("authorization")).toBe("Bearer bar");
          expect(request.headers.get("npm-auth-type")).toBe("legacy");
          seen_token = true;
        } else {
          expect(request.headers.get("npm-auth-type")).toBe(null);
        }
        expect(await request.text()).toBeEmpty();
        urls.push(request.url);
        return new Response("Feeling lucky?", { status: 422 });
      });
      // workaround against `writeFile(..., { flag: "a" })`
      await writeFile(
        join(ctx.package_dir, "bunfig.toml"),
        `${await file(join(ctx.package_dir, "bunfig.toml")).text()}
  [install.scopes]
  foo = { token = "bar" }
  `,
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "@foo/bar"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err.split(/\r?\n/)).toContain(`error: GET ${url} - 422`);
      expect(await stdout.text()).toEqual(expect.stringContaining("bun add v1."));
      expect(await exited).toBe(1);
      expect(urls.sort()).toEqual([url]);
      expect(seen_token).toBe(true);
      expect(ctx.requested).toBe(1);
      try {
        await access(join(ctx.package_dir, "bun.lockb"));
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
    });
  });

  it("should handle empty string in dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle workspaces", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          workspaces: ["bar", "packages/*"],
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "Bar",
          version: "0.0.2",
        }),
      );

      await mkdir(join(ctx.package_dir, "packages", "nominally-scoped"), { recursive: true });
      await writeFile(
        join(ctx.package_dir, "packages", "nominally-scoped", "package.json"),
        JSON.stringify({
          name: "@org/nominally-scoped",
          version: "0.1.4",
        }),
      );

      await mkdir(join(ctx.package_dir, "packages", "second-asterisk"), { recursive: true });
      await writeFile(
        join(ctx.package_dir, "packages", "second-asterisk", "package.json"),
        JSON.stringify({
          name: "AsteriskTheSecond",
          version: "0.1.4",
        }),
      );

      await mkdir(join(ctx.package_dir, "packages", "asterisk"), { recursive: true });
      await writeFile(
        join(ctx.package_dir, "packages", "asterisk", "package.json"),
        JSON.stringify({
          name: "Asterisk",
          version: "0.0.4",
        }),
      );

      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err1 = await new Response(stderr1).text();
      expect(err1).toContain("Saved lockfile");
      const out1 = await new Response(stdout1).text();
      expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "4 packages installed",
      ]);
      expect(await exited1).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".cache",
        "@org",
        "Asterisk",
        "AsteriskTheSecond",
        "Bar",
      ]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Asterisk", "packages/asterisk"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["AsteriskTheSecond", "packages/second-asterisk"]);
      // prettier-ignore
      expect(ctx.package_dir).toHaveWorkspaceLink2(["@org/nominally-scoped", "../packages/nominally-scoped", "packages/nominally-scoped"]);
      await access(join(ctx.package_dir, "bun.lockb"));

      // Perform `bun install` again but with lockfile from before
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err2 = await new Response(stderr2).text();
      expect(err2).not.toContain("Saved lockfile");
      const out2 = await new Response(stdout2).text();
      expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "4 packages installed",
      ]);
      expect(await exited2).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        "@org",
        "Asterisk",
        "AsteriskTheSecond",
        "Bar",
      ]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Asterisk", "packages/asterisk"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["AsteriskTheSecond", "packages/second-asterisk"]);
      // prettier-ignore
      expect(ctx.package_dir).toHaveWorkspaceLink2(["@org/nominally-scoped", "../packages/nominally-scoped", "packages/nominally-scoped"]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle `workspace:` specifier", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            Bar: "workspace:path/to/bar",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "path", "to", "bar"), { recursive: true });
      await writeFile(
        join(ctx.package_dir, "path", "to", "bar", "package.json"),
        JSON.stringify({
          name: "Bar",
          version: "0.0.2",
        }),
      );
      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err1 = await new Response(stderr1).text();
      expect(err1).toContain("Saved lockfile");
      const out1 = await new Response(stdout1).text();
      expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ Bar@workspace:path/to/bar`,
        "",
        "1 package installed",
      ]);
      expect(await exited1).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "path/to/bar"]);
      await access(join(ctx.package_dir, "bun.lockb"));
      // Perform `bun install` again but with lockfile from before
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err2 = await new Response(stderr2).text();
      expect(err2).not.toContain("Saved lockfile");
      const out2 = await new Response(stdout2).text();
      expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ Bar@workspace:path/to/bar`,
        "",
        "1 package installed",
      ]);
      expect(await exited2).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual(["Bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "path/to/bar"]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle workspaces with packages array", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          workspaces: { packages: ["bar"] },
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "Bar",
          version: "0.0.2",
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");

      const out = await stdout.text();

      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle inter-dependency between workspaces", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          workspaces: ["bar", "packages/baz"],
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "Bar",
          version: "0.0.2",
          dependencies: {
            Baz: "0.0.3",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "packages", "baz"), { recursive: true });
      await writeFile(
        join(ctx.package_dir, "packages", "baz", "package.json"),
        JSON.stringify({
          name: "Baz",
          version: "0.0.3",
          dependencies: {
            Bar: "0.0.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar", "Baz"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Baz", "packages/baz"]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle inter-dependency between workspaces (devDependencies)", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          workspaces: ["bar", "packages/baz"],
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "Bar",
          version: "0.0.2",
          devDependencies: {
            Baz: "0.0.3",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "packages", "baz"), { recursive: true });
      await writeFile(
        join(ctx.package_dir, "packages", "baz", "package.json"),
        JSON.stringify({
          name: "Baz",
          version: "0.0.3",
          devDependencies: {
            Bar: "0.0.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar", "Baz"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Baz", "packages/baz"]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle inter-dependency between workspaces (optionalDependencies)", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          workspaces: ["bar", "packages/baz"],
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "Bar",
          version: "0.0.2",
          optionalDependencies: {
            Baz: "0.0.3",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "packages", "baz"), { recursive: true });
      await writeFile(
        join(ctx.package_dir, "packages", "baz", "package.json"),
        JSON.stringify({
          name: "Baz",
          version: "0.0.3",
          optionalDependencies: {
            Bar: "0.0.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar", "Baz"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Baz", "packages/baz"]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle installing the same peerDependency with different versions", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          peerDependencies: {
            peer: "0.0.2",
          },
          dependencies: {
            boba: "0.0.2",
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      expect(ctx.requested).toBe(0);
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ boba@0.0.2",
        "+ peer@0.0.2",
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
    });
  });

  it("should handle installing the same peerDependency with the same version", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          peerDependencies: {
            peer: "0.0.1",
          },
          dependencies: {
            boba: "0.0.2",
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      expect(ctx.requested).toBe(0);
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ boba@0.0.2",
        "",
        "1 package installed",
      ]);

      expect(await exited).toBe(0);
    });
  });

  it("should handle life-cycle scripts within workspaces", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          scripts: {
            install: [bunExe(), "install.js"].join(" "),
          },
          workspaces: ["bar"],
        }),
      );
      await writeFile(
        join(ctx.package_dir, "install.js"),
        'await require("fs/promises").writeFile("foo.txt", "foo!");',
      );
      await mkdir(join(ctx.package_dir, "bar"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "Bar",
          version: "0.0.2",
          scripts: {
            preinstall: [bunExe(), "preinstall.js"].join(" "),
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "bar", "preinstall.js"),
        'await require("fs/promises").writeFile("bar.txt", "bar!");',
      );
      const { stdout, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(await file(join(ctx.package_dir, "foo.txt")).text()).toBe("foo!");
      expect(await file(join(ctx.package_dir, "bar", "bar.txt")).text()).toBe("bar!");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle life-cycle scripts during re-installation", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          scripts: {
            install: [bunExe(), "foo-install.js"].join(" "),
          },
          dependencies: {
            qux: "^0.0",
          },
          trustedDependencies: ["qux"],
          workspaces: ["bar"],
        }),
      );
      await writeFile(
        join(ctx.package_dir, "foo-install.js"),
        'await require("fs/promises").writeFile("foo.txt", "foo!");',
      );
      await mkdir(join(ctx.package_dir, "bar"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "Bar",
          version: "0.0.2",
          scripts: {
            preinstall: [bunExe(), "bar-preinstall.js"].join(" "),
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "bar", "bar-preinstall.js"),
        'await require("fs/promises").writeFile("bar.txt", "bar!");',
      );
      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err1 = await new Response(stderr1).text();
      expect(err1).toContain("Saved lockfile");
      const out1 = await new Response(stdout1).text();
      expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ qux@0.0.2",
        "",
        "2 packages installed",
      ]);
      expect(await exited1).toBe(0);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar", "qux"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(await file(join(ctx.package_dir, "foo.txt")).text()).toBe("foo!");
      expect(await file(join(ctx.package_dir, "bar", "bar.txt")).text()).toBe("bar!");
      await access(join(ctx.package_dir, "bun.lockb"));
      // Perform `bun install` again but with lockfile from before
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err2 = await new Response(stderr2).text();
      expect(err2).not.toContain("error:");
      expect(err2).not.toContain("Saved lockfile");
      const out2 = await new Response(stdout2).text();
      expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ qux@0.0.2",
        "",
        "2 packages installed",
      ]);
      expect(await exited2).toBe(0);
      expect(ctx.requested).toBe(3);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar", "qux"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(await file(join(ctx.package_dir, "foo.txt")).text()).toBe("foo!");
      expect(await file(join(ctx.package_dir, "bar", "bar.txt")).text()).toBe("bar!");
      await access(join(ctx.package_dir, "bun.lockb"));
      // Perform `bun install --production` with lockfile from before
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      const {
        stdout: stdout3,
        stderr: stderr3,
        exited: exited3,
      } = spawn({
        cmd: [bunExe(), "install", "--production"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err3 = await new Response(stderr3).text();
      expect(err3).not.toContain("error:");
      expect(err3).not.toContain("Saved lockfile");
      const out3 = await new Response(stdout3).text();
      expect(out3.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ qux@0.0.2",
        "",
        "2 packages installed",
      ]);
      expect(await exited3).toBe(0);
      expect(ctx.requested).toBe(4);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar", "qux"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(await file(join(ctx.package_dir, "foo.txt")).text()).toBe("foo!");
      expect(await file(join(ctx.package_dir, "bar", "bar.txt")).text()).toBe("bar!");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should use updated life-cycle scripts in root during re-installation", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          scripts: {
            install: [bunExe(), "foo-install.js"].join(" "),
          },
          workspaces: ["bar"],
        }),
      );
      await writeFile(
        join(ctx.package_dir, "foo-install.js"),
        'await require("fs/promises").writeFile("foo.txt", "foo!");',
      );
      await mkdir(join(ctx.package_dir, "bar"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "Bar",
          scripts: {
            preinstall: [bunExe(), "bar-preinstall.js"].join(" "),
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "bar", "bar-preinstall.js"),
        'await require("fs/promises").writeFile("bar.txt", "bar!");',
      );
      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
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
        "1 package installed",
      ]);
      expect(await exited1).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(await file(join(ctx.package_dir, "foo.txt")).text()).toBe("foo!");
      expect(await file(join(ctx.package_dir, "bar", "bar.txt")).text()).toBe("bar!");
      await access(join(ctx.package_dir, "bun.lockb"));

      // Perform `bun install` with outdated lockfile
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          scripts: {
            install: [bunExe(), "foo-install2.js"].join(" "),
            postinstall: [bunExe(), "foo-postinstall.js"].join(" "),
          },
          workspaces: ["bar"],
        }),
      );
      await writeFile(
        join(ctx.package_dir, "foo-install2.js"),
        'await require("fs/promises").writeFile("foo2.txt", "foo2!");',
      );
      await writeFile(
        join(ctx.package_dir, "foo-postinstall.js"),
        'await require("fs/promises").writeFile("foo-postinstall.txt", "foo!");',
      );
      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
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
        expect.stringContaining("bun install v1."),
        "",
        "1 package installed",
      ]);
      expect(await exited2).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(await file(join(ctx.package_dir, "foo2.txt")).text()).toBe("foo2!");
      expect(await file(join(ctx.package_dir, "bar", "bar.txt")).text()).toBe("bar!");
      expect(await file(join(ctx.package_dir, "foo-postinstall.txt")).text()).toBe("foo!");

      await access(join(ctx.package_dir, "bun.lockb"));
      // Perform `bun install --production` with lockfile from before
      const bun_lockb = await file(join(ctx.package_dir, "bun.lockb")).arrayBuffer();
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      const {
        stdout: stdout3,
        stderr: stderr3,
        exited: exited3,
      } = spawn({
        cmd: [bunExe(), "install", "--production"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err3 = await new Response(stderr3).text();
      expect(err3).not.toContain("error:");
      expect(err3).not.toContain("Saved lockfile");

      const out3 = await new Response(stdout3).text();
      expect(out3.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "1 package installed",
      ]);
      expect(await exited3).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(await file(join(ctx.package_dir, "bun.lockb")).arrayBuffer()).toEqual(bun_lockb);
      expect(await file(join(ctx.package_dir, "foo2.txt")).text()).toBe("foo2!");
      expect(await file(join(ctx.package_dir, "bar", "bar.txt")).text()).toBe("bar!");
      expect(await file(join(ctx.package_dir, "foo-postinstall.txt")).text()).toBe("foo!");
    });
  });

  it("should use updated life-cycle scripts in dependency during re-installation", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          scripts: {
            install: [bunExe(), "foo-install.js"].join(" "),
          },
          workspaces: ["bar"],
        }),
      );
      await writeFile(
        join(ctx.package_dir, "foo-install.js"),
        "await require('fs/promises').writeFile('foo.txt', 'foo!');",
      );
      await mkdir(join(ctx.package_dir, "bar"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "Bar",
          scripts: {
            preinstall: [bunExe(), "bar-preinstall.js"].join(" "),
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "bar", "bar-preinstall.js"),
        'await require("fs/promises").writeFile("bar.txt", "bar!");',
      );
      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
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
        "1 package installed",
      ]);
      expect(await exited1).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(await file(join(ctx.package_dir, "foo.txt")).text()).toBe("foo!");
      expect(await file(join(ctx.package_dir, "bar", "bar.txt")).text()).toBe("bar!");
      await access(join(ctx.package_dir, "bun.lockb"));
      // Perform `bun install` with outdated lockfile
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      await rm(join(ctx.package_dir, "foo.txt"));
      await rm(join(ctx.package_dir, "bar", "bar.txt"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "Bar",
          scripts: {
            preinstall: [bunExe(), "bar-preinstall.js"].join(" "),
            postinstall: [bunExe(), "bar-postinstall.js"].join(" "),
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "bar", "bar-preinstall.js"),
        'await require("fs/promises").writeFile("bar-preinstall.txt", "bar preinstall!");',
      );
      await writeFile(
        join(ctx.package_dir, "bar", "bar-postinstall.js"),
        'await require("fs/promises").writeFile("bar-postinstall.txt", "bar postinstall!");',
      );
      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
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
        expect.stringContaining("bun install v1."),
        "",
        "1 package installed",
      ]);
      expect(await exited2).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(await file(join(ctx.package_dir, "foo.txt")).text()).toBe("foo!");
      expect(await file(join(ctx.package_dir, "bar", "bar-preinstall.txt")).text()).toBe("bar preinstall!");
      expect(await file(join(ctx.package_dir, "bar", "bar-postinstall.txt")).text()).toBe("bar postinstall!");
      await access(join(ctx.package_dir, "bun.lockb"));

      // Perform `bun install --production` with lockfile from before
      const bun_lockb = await file(join(ctx.package_dir, "bun.lockb")).arrayBuffer();
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      await rm(join(ctx.package_dir, "foo.txt"));
      await rm(join(ctx.package_dir, "bar", "bar-preinstall.txt"));
      await rm(join(ctx.package_dir, "bar", "bar-postinstall.txt"));
      const {
        stdout: stdout3,
        stderr: stderr3,
        exited: exited3,
      } = spawn({
        cmd: [bunExe(), "install", "--production"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err3 = await new Response(stderr3).text();
      expect(err3).not.toContain("error:");
      expect(err3).not.toContain("Saved lockfile");
      const out3 = await new Response(stdout3).text();
      expect(out3.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "1 package installed",
      ]);
      expect(await exited3).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "Bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["Bar", "bar"]);
      expect(await file(join(ctx.package_dir, "bun.lockb")).arrayBuffer()).toEqual(bun_lockb);
      expect(await file(join(ctx.package_dir, "foo.txt")).text()).toBe("foo!");
      expect(await file(join(ctx.package_dir, "bar", "bar-preinstall.txt")).text()).toBe("bar preinstall!");
      expect(await file(join(ctx.package_dir, "bar", "bar-postinstall.txt")).text()).toBe("bar postinstall!");
    });
  });

  it("should ignore workspaces within workspaces", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          workspaces: ["bar"],
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "bar",
          version: "0.0.2",
          workspaces: ["baz"],
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(ctx.package_dir).toHaveWorkspaceLink(["bar", "bar"]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle ^0 in dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "^0",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle ^1 in dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "^1",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain('error: No version matching "^1" found for specifier "bar" (but package exists)');
      expect(await stdout.text()).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`]);
      expect(ctx.requested).toBe(1);
      try {
        await access(join(ctx.package_dir, "bun.lockb"));
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
    });
  });

  it("should handle ^0.0 in dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "^0.0",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle ^0.1 in dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "^0.1",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain('error: No version matching "^0.1" found for specifier "bar" (but package exists)');
      expect(await stdout.text()).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`]);
      expect(ctx.requested).toBe(1);
      try {
        await access(join(ctx.package_dir, "bun.lockb"));
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
    });
  });

  it("should handle ^0.0.0 in dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "^0.0.0",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain('error: No version matching "^0.0.0" found for specifier "bar" (but package exists)');
      expect(await stdout.text()).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`]);
      expect(ctx.requested).toBe(1);
      try {
        await access(join(ctx.package_dir, "bun.lockb"));
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
    });
  });

  it("should handle ^0.0.2 in dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "^0.0.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle matching workspaces from dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.2.0": { as: "0.2.0" },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          workspaces: ["packages/*"],
        }),
      );
      await mkdir(join(ctx.package_dir, "packages", "pkg1"), { recursive: true });
      await mkdir(join(ctx.package_dir, "packages", "pkg2"), { recursive: true });
      await writeFile(
        join(ctx.package_dir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          version: "0.2.0",
        }),
      );

      await writeFile(
        join(ctx.package_dir, "packages", "pkg2", "package.json"),
        JSON.stringify({
          name: "pkg2",
          version: "0.2.0",
          dependencies: {
            // moo has a dependency on pkg1 that matches 0.2.0
            moo: "0.2.0",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
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
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "3 packages installed",
      ]);
      expect(await exited).toBe(0);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should edit package json correctly with git dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      const package_json = JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {},
      });
      await writeFile(join(ctx.package_dir, "package.json"), package_json);
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "i", "dylan-conway/install-test2"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      var err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);
      expect(await file(join(ctx.package_dir, "package.json")).json()).toEqual({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          "install-test2": "dylan-conway/install-test2",
        },
      });
      await writeFile(join(ctx.package_dir, "package.json"), package_json);
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "i", "dylan-conway/install-test2#HEAD"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));
      err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);
      expect(await file(join(ctx.package_dir, "package.json")).json()).toEqual({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          "install-test2": "dylan-conway/install-test2#HEAD",
        },
      });
      await writeFile(join(ctx.package_dir, "package.json"), package_json);
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "i", "github:dylan-conway/install-test2"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));
      err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);
      expect(await file(join(ctx.package_dir, "package.json")).json()).toEqual({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          "install-test2": "github:dylan-conway/install-test2",
        },
      });
      await writeFile(join(ctx.package_dir, "package.json"), package_json);
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "i", "github:dylan-conway/install-test2#HEAD"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));
      err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);
      expect(await file(join(ctx.package_dir, "package.json")).json()).toEqual({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          "install-test2": "github:dylan-conway/install-test2#HEAD",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle ^0.0.2-rc in dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.2-rc": { as: "0.0.2" } }));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "^0.0.2-rc",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2-rc",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle ^0.0.2-alpha.3+b4d in dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.2-alpha.3": { as: "0.0.2" } }));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "^0.0.2-alpha.3+b4d",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2-alpha.3",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should choose the right version with prereleases", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.2-alpha.3": { as: "0.0.2" } }));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "^0.0.2-alpha.3+b4d",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2-alpha.3",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle ^0.0.2rc1 in dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.2rc1": { as: "0.0.2" } }));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "^0.0.2rc1",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2-rc1",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle caret range in dependencies when the registry has prereleased packages, issue#4398", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, { "6.3.0": { as: "0.0.2" }, "7.0.0-rc2": { as: "0.0.3" } }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "^6.3.0",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("+ bar@6.3.0"),
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should prefer latest-tagged dependency", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
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
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: "~0.0.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ baz@0.0.3",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should install latest with prereleases", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "1.0.0-0": { as: "0.0.3" },
          "1.0.0-8": { as: "0.0.5" },
          latest: "1.0.0-0",
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "baz"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      var err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      var out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\n/)).toEqual([
        expect.stringContaining("bun add v1."),
        "",
        "installed baz@1.0.0-0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(ctx.requested).toBe(2);
      await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });
      await rm(join(ctx.package_dir, "bun.lockb"), { recursive: true, force: true });
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: "latest",
          },
        }),
      );
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));
      err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ baz@1.0.0-0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });
      await rm(join(ctx.package_dir, "bun.lockb"), { recursive: true, force: true });
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: "^1.0.0-5",
          },
        }),
      );
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));
      err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ baz@1.0.0-8",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);

      await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });
      await rm(join(ctx.package_dir, "bun.lockb"), { recursive: true, force: true });
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: "^1.0.0-0",
          },
        }),
      );
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));
      err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ baz@1.0.0-0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle dependency aliasing", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": {
            bin: {
              "baz-run": "index.js",
            },
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            Bar: "npm:baz",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ Bar@0.0.3",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "Bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "Bar", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "Bar"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle dependency aliasing (versioned)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": {
            bin: {
              "baz-run": "index.js",
            },
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            Bar: "npm:baz@0.0.3",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ Bar@0.0.3",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "Bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "Bar", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "Bar"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle dependency aliasing (dist-tagged)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": {
            bin: {
              "baz-run": "index.js",
            },
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            Bar: "npm:baz@latest",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ Bar@0.0.3",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "Bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "Bar", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "Bar"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should not reinstall aliased dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": {
            bin: {
              "baz-run": "index.js",
            },
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            Bar: "npm:baz",
          },
        }),
      );
      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err1 = await new Response(stderr1).text();
      expect(err1).toContain("Saved lockfile");
      const out1 = await new Response(stdout1).text();
      expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ Bar@0.0.3",
        "",
        "1 package installed",
      ]);
      expect(await exited1).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "Bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "Bar", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "Bar"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
      // Performs `bun install` again, expects no-op
      urls.length = 0;
      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err2 = await new Response(stderr2).text();
      expect(err2).not.toContain("Saved lockfile");
      const out2 = await new Response(stdout2).text();
      expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited2).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "Bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "Bar", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "Bar"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle aliased & direct dependency references", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": {
            bin: {
              "baz-run": "index.js",
            },
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: "~0.0.2",
          },
          workspaces: ["bar"],
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "bar",
          version: "0.0.4",
          dependencies: {
            moo: "npm:baz",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ baz@0.0.3",
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "bar",
        "baz",
        "moo",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(join("..", "bar"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      expect(await readdirSorted(join(ctx.package_dir, "bar"))).toEqual(["package.json"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "moo"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "moo", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should not hoist if name collides with alias", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.2": {},
          "0.0.3": {
            bin: {
              "baz-run": "index.js",
            },
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "npm:baz",
          },
          workspaces: ["moo"],
        }),
      );
      await mkdir(join(ctx.package_dir, "moo"));
      await writeFile(
        join(ctx.package_dir, "moo", "package.json"),
        JSON.stringify({
          name: "moo",
          version: "0.0.4",
          dependencies: {
            bar: "0.0.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.3",
        "",
        "3 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([
        `${ctx.registry_url}bar`,
        `${ctx.registry_url}bar-0.0.2.tgz`,
        `${ctx.registry_url}baz`,
        `${ctx.registry_url}baz-0.0.3.tgz`,
      ]);
      expect(ctx.requested).toBe(4);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "bar", "moo"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "bar", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      expect(await readlink(join(ctx.package_dir, "node_modules", "moo"))).toBeWorkspaceLink(join("..", "moo"));
      expect(await readdirSorted(join(ctx.package_dir, "moo"))).toEqual(["node_modules", "package.json"]);
      expect(await readdirSorted(join(ctx.package_dir, "moo", "node_modules"))).toEqual(["bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "moo", "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "moo", "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should get npm alias with matching version", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": { as: "0.0.3" },
          "0.0.5": { as: "0.0.5" },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          workspaces: ["moo"],
          dependencies: {
            "boba": "npm:baz@0.0.5",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "moo"));
      await writeFile(
        join(ctx.package_dir, "moo", "package.json"),
        JSON.stringify({
          name: "moo",
          version: "0.0.2",
          dependencies: {
            boba: ">=0.0.3",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ boba@0.0.5",
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.5.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "boba", "moo"]);
      expect(await file(join(ctx.package_dir, "node_modules", "boba", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.5",
        bin: {
          "baz-exec": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should not apply overrides to package name of aliased package", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": { as: "0.0.3" },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.2.0",
          dependencies: {
            bar: "npm:baz@0.0.3",
          },
          overrides: {
            "baz": "0.0.5",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.3",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle unscoped alias on scoped dependency", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.1.0": {} }));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "@barn/moo": "latest",
            moo: "npm:@barn/moo",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ @barn/moo@0.1.0",
        "+ moo@0.1.0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}@barn%2fmoo`, `${ctx.registry_url}@barn/moo-0.1.0.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "@barn", "moo"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "@barn", "moo", "package.json")).json()).toEqual({
        name: "@barn/moo",
        version: "0.1.0",
        // not installed as these are absent from manifest above
        dependencies: {
          bar: "0.0.2",
          baz: "latest",
        },
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "moo"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "moo", "package.json")).json()).toEqual({
        name: "@barn/moo",
        version: "0.1.0",
        dependencies: {
          bar: "0.0.2",
          baz: "latest",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle scoped alias on unscoped dependency", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "@baz/bar": "npm:bar",
            bar: "latest",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ @baz/bar@0.0.2",
        "+ bar@0.0.2",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "@baz", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@baz"))).toEqual(["bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@baz", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "@baz", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle aliased dependency with existing lockfile", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.2": {},
          "0.0.3": {
            bin: {
              "baz-run": "index.js",
            },
          },
          "0.1.0": {
            dependencies: {
              bar: "0.0.2",
              baz: "latest",
            },
          },
          latest: "0.0.3",
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "moz": "npm:@barn/moo@0.1.0",
          },
        }),
      );
      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err1 = await new Response(stderr1).text();
      expect(err1).toContain("Saved lockfile");
      const out1 = await new Response(stdout1).text();
      expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ moz@0.1.0",
        "",
        "3 packages installed",
      ]);
      expect(await exited1).toBe(0);
      expect(urls.sort()).toEqual([
        `${ctx.registry_url}@barn%2fmoo`,
        `${ctx.registry_url}@barn/moo-0.1.0.tgz`,
        `${ctx.registry_url}bar`,
        `${ctx.registry_url}bar-0.0.2.tgz`,
        `${ctx.registry_url}baz`,
        `${ctx.registry_url}baz-0.0.3.tgz`,
      ]);
      expect(ctx.requested).toBe(6);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "bar",
        "baz",
        "moz",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "moz"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "moz", "package.json")).json()).toEqual({
        name: "@barn/moo",
        version: "0.1.0",
        dependencies: {
          bar: "0.0.2",
          baz: "latest",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
      // Perform `bun install` again but with lockfile from before
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      urls.length = 0;
      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err2 = await new Response(stderr2).text();
      expect(err2).not.toContain("Saved lockfile");
      const out2 = await new Response(stdout2).text();
      expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ moz@0.1.0",
        "",
        "3 packages installed",
      ]);
      expect(await exited2).toBe(0);
      expect(urls.sort()).toEqual([
        `${ctx.registry_url}@barn/moo-0.1.0.tgz`,
        `${ctx.registry_url}bar-0.0.2.tgz`,
        `${ctx.registry_url}baz-0.0.3.tgz`,
      ]);
      expect(ctx.requested).toBe(9);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "bar",
        "baz",
        "moz",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "moz"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "moz", "package.json")).json()).toEqual({
        name: "@barn/moo",
        version: "0.1.0",
        dependencies: {
          bar: "0.0.2",
          baz: "latest",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle GitHub URL in dependencies (user/repo)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            uglify: "mishoo/UglifyJS",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      let out = await stdout.text();
      out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
      out = out.replace(/(github:[^#]+)#[a-f0-9]+/, "$1");
      expect(out.split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ uglify@github:mishoo/UglifyJS",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "uglify"))).toEqual([
        ".bun-tag",
        ".gitattributes",
        ".github",
        ".gitignore",
        "CONTRIBUTING.md",
        "LICENSE",
        "README.md",
        "bin",
        "lib",
        "package.json",
        "test",
        "tools",
      ]);
      const package_json = await file(join(ctx.package_dir, "node_modules", "uglify", "package.json")).json();
      expect(package_json.name).toBe("uglify-js");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle GitHub URL in dependencies (user/repo#commit-id)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            uglify: "mishoo/UglifyJS#e219a9a",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ uglify@github:mishoo/UglifyJS#e219a9a",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
        "@GH@mishoo-UglifyJS-e219a9a@@@1",
        "uglify",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache", "uglify"))).toEqual([
        "mishoo-UglifyJS-e219a9a@@@1",
      ]);
      expect(
        resolve(
          await readlink(join(ctx.package_dir, "node_modules", ".cache", "uglify", "mishoo-UglifyJS-e219a9a@@@1")),
        ),
      ).toBe(join(ctx.package_dir, "node_modules", ".cache", "@GH@mishoo-UglifyJS-e219a9a@@@1"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "uglify"))).toEqual([
        ".bun-tag",
        ".gitattributes",
        ".github",
        ".gitignore",
        "CONTRIBUTING.md",
        "LICENSE",
        "README.md",
        "bin",
        "lib",
        "package.json",
        "test",
        "tools",
      ]);
      const package_json = await file(join(ctx.package_dir, "node_modules", "uglify", "package.json")).json();
      expect(package_json.name).toBe("uglify-js");
      expect(package_json.version).toBe("3.14.1");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle GitHub URL in dependencies (user/repo#tag)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            uglify: "mishoo/UglifyJS#v3.14.1",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ uglify@github:mishoo/UglifyJS#e219a9a",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
        "@GH@mishoo-UglifyJS-e219a9a@@@1",
        "uglify",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache", "uglify"))).toEqual([
        "mishoo-UglifyJS-e219a9a@@@1",
      ]);
      expect(
        resolve(
          await readlink(join(ctx.package_dir, "node_modules", ".cache", "uglify", "mishoo-UglifyJS-e219a9a@@@1")),
        ),
      ).toBe(join(ctx.package_dir, "node_modules", ".cache", "@GH@mishoo-UglifyJS-e219a9a@@@1"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "uglify"))).toEqual([
        ".bun-tag",
        ".gitattributes",
        ".github",
        ".gitignore",
        "CONTRIBUTING.md",
        "LICENSE",
        "README.md",
        "bin",
        "lib",
        "package.json",
        "test",
        "tools",
      ]);
      const package_json = await file(join(ctx.package_dir, "node_modules", "uglify", "package.json")).json();
      expect(package_json.name).toBe("uglify-js");
      expect(package_json.version).toBe("3.14.1");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  describe("should handle bitbucket git dependencies", () => {
    const deps = [
      "bitbucket:dylan-conway/public-install-test",
      "bitbucket.org:dylan-conway/public-install-test",
      "bitbucket.com:dylan-conway/public-install-test",
      "git@bitbucket.org:dylan-conway/public-install-test",
    ];

    for (const dep of deps) {
      it(`install ${dep}`, async () => {
        await withContext(defaultOpts, async ctx => {
          const urls: string[] = [];
          setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
          await writeFile(
            join(ctx.package_dir, "package.json"),
            JSON.stringify({
              name: "foo",
              version: "0.0.1",
              dependencies: {
                "public-install-test": dep,
              },
            }),
          );
          const { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "install"],
            cwd: ctx.package_dir,
            stdout: "pipe",
            stdin: "pipe",
            stderr: "pipe",
            env,
          });

          const err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          const out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun install v1."),
            "",
            `+ public-install-test@git+ssh://${dep}#79265e2d9754c60b60f97cc8d859fb6da073b5d2`,
            "",
            expect.stringContaining("installed"),
          ]);
          expect(await exited).toBe(0);
          await access(join(ctx.package_dir, "bun.lockb"));
        });
      });

      it(`add ${dep}`, async () => {
        await withContext(defaultOpts, async ctx => {
          const urls: string[] = [];
          setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
          await writeFile(
            join(ctx.package_dir, "package.json"),
            JSON.stringify({
              name: "foo",
              version: "0.0.1",
            }),
          );

          const { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "add", dep],
            cwd: ctx.package_dir,
            stdout: "pipe",
            stdin: "pipe",
            stderr: "pipe",
            env,
          });

          const err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          const out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun add v1."),
            "",
            `installed publicinstalltest@git+ssh://${dep}#79265e2d9754c60b60f97cc8d859fb6da073b5d2`,
            "",
            expect.stringContaining("installed"),
          ]);
          expect(await exited).toBe(0);
          await access(join(ctx.package_dir, "bun.lockb"));
        });
      });
    }
  });

  describe("should handle gitlab git dependencies", () => {
    const deps = ["gitlab:dylan-conway/public-install-test", "gitlab.com:dylan-conway/public-install-test"];

    for (const dep of deps) {
      it(`install ${dep}`, async () => {
        await withContext(defaultOpts, async ctx => {
          const urls: string[] = [];
          setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
          await writeFile(
            join(ctx.package_dir, "package.json"),
            JSON.stringify({
              name: "foo",
              version: "0.0.1",
              dependencies: {
                "public-install-test": dep,
              },
            }),
          );
          const { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "install"],
            cwd: ctx.package_dir,
            stdout: "pipe",
            stdin: "pipe",
            stderr: "pipe",
            env,
          });

          const err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          const out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun install v1."),
            "",
            `+ public-install-test@git+ssh://${dep}#93f3aa4ec9ca8a0bacc010776db48bfcd915c44c`,
            "",
            expect.stringContaining("installed"),
          ]);
          expect(await exited).toBe(0);
          await access(join(ctx.package_dir, "bun.lockb"));
        });
      });

      it(`add ${dep}`, async () => {
        await withContext(defaultOpts, async ctx => {
          const urls: string[] = [];
          setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
          await writeFile(
            join(ctx.package_dir, "package.json"),
            JSON.stringify({
              name: "foo",
              version: "0.0.1",
            }),
          );

          const { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "add", dep],
            cwd: ctx.package_dir,
            stdout: "pipe",
            stdin: "pipe",
            stderr: "pipe",
            env,
          });

          const err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          const out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun add v1."),
            "",
            `installed public-install-test@git+ssh://${dep}#93f3aa4ec9ca8a0bacc010776db48bfcd915c44c`,
            "",
            expect.stringContaining("installed"),
          ]);
          expect(await exited).toBe(0);
          await access(join(ctx.package_dir, "bun.lockb"));
        });
      });
    }
  });

  it("should handle GitHub URL in dependencies (github:user/repo#tag)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            uglify: "github:mishoo/UglifyJS#v3.14.1",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ uglify@github:mishoo/UglifyJS#e219a9a",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "uglifyjs")).toBeValidBin(
        join("..", "uglify", "bin", "uglifyjs"),
      );
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
        "@GH@mishoo-UglifyJS-e219a9a@@@1",
        "uglify",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache", "uglify"))).toEqual([
        "mishoo-UglifyJS-e219a9a@@@1",
      ]);
      expect(
        resolve(
          await readlink(join(ctx.package_dir, "node_modules", ".cache", "uglify", "mishoo-UglifyJS-e219a9a@@@1")),
        ),
      ).toBe(join(ctx.package_dir, "node_modules", ".cache", "@GH@mishoo-UglifyJS-e219a9a@@@1"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "uglify"))).toEqual([
        ".bun-tag",
        ".gitattributes",
        ".github",
        ".gitignore",
        "CONTRIBUTING.md",
        "LICENSE",
        "README.md",
        "bin",
        "lib",
        "package.json",
        "test",
        "tools",
      ]);
      const package_json = await file(join(ctx.package_dir, "node_modules", "uglify", "package.json")).json();
      expect(package_json.name).toBe("uglify-js");
      expect(package_json.version).toBe("3.14.1");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle GitHub URL in dependencies (https://github.com/user/repo.git)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            uglify: "https://github.com/mishoo/UglifyJS.git",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      let out = await stdout.text();
      out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
      out = out.replace(/(github:[^#]+)#[a-f0-9]+/, "$1");
      expect(out.split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ uglify@github:mishoo/UglifyJS",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "uglify"))).toEqual([
        ".bun-tag",
        ".gitattributes",
        ".github",
        ".gitignore",
        "CONTRIBUTING.md",
        "LICENSE",
        "README.md",
        "bin",
        "lib",
        "package.json",
        "test",
        "tools",
      ]);
      const package_json = await file(join(ctx.package_dir, "node_modules", "uglify", "package.json")).json();
      expect(package_json.name).toBe("uglify-js");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle GitHub URL in dependencies (git://github.com/user/repo.git#commit)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            uglify: "git://github.com/mishoo/UglifyJS.git#e219a9a",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ uglify@github:mishoo/UglifyJS#e219a9a",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "uglifyjs")).toBeValidBin(
        join("..", "uglify", "bin", "uglifyjs"),
      );
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
        "@GH@mishoo-UglifyJS-e219a9a@@@1",
        "uglify",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache", "uglify"))).toEqual([
        "mishoo-UglifyJS-e219a9a@@@1",
      ]);
      expect(
        resolve(
          await readlink(join(ctx.package_dir, "node_modules", ".cache", "uglify", "mishoo-UglifyJS-e219a9a@@@1")),
        ),
      ).toBe(join(ctx.package_dir, "node_modules", ".cache", "@GH@mishoo-UglifyJS-e219a9a@@@1"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "uglify"))).toEqual([
        ".bun-tag",
        ".gitattributes",
        ".github",
        ".gitignore",
        "CONTRIBUTING.md",
        "LICENSE",
        "README.md",
        "bin",
        "lib",
        "package.json",
        "test",
        "tools",
      ]);
      const package_json = await file(join(ctx.package_dir, "node_modules", "uglify", "package.json")).json();
      expect(package_json.name).toBe("uglify-js");
      expect(package_json.version).toBe("3.14.1");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle GitHub URL in dependencies (git+https://github.com/user/repo.git)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            uglify: "git+https://github.com/mishoo/UglifyJS.git",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      let out = await stdout.text();
      out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
      out = out.replace(/(github:[^#]+)#[a-f0-9]+/, "$1");
      expect(out.split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ uglify@github:mishoo/UglifyJS",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "uglify"))).toEqual([
        ".bun-tag",
        ".gitattributes",
        ".github",
        ".gitignore",
        "CONTRIBUTING.md",
        "LICENSE",
        "README.md",
        "bin",
        "lib",
        "package.json",
        "test",
        "tools",
      ]);
      const package_json = await file(join(ctx.package_dir, "node_modules", "uglify", "package.json")).json();
      expect(package_json.name).toBe("uglify-js");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle GitHub tarball URL in dependencies (https://github.com/user/repo/tarball/ref)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            when: "https://github.com/cujojs/when/tarball/1.0.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      let out = await stdout.text();
      out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
      out = out.replace(/(github:[^#]+)#[a-f0-9]+/, "$1");
      expect(out.split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ when@https://github.com/cujojs/when/tarball/1.0.2",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "when"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "when"))).toEqual([
        ".gitignore",
        ".gitmodules",
        "LICENSE.txt",
        "README.md",
        "apply.js",
        "cancelable.js",
        "delay.js",
        "package.json",
        "test",
        "timed.js",
        "timeout.js",
        "when.js",
      ]);
      const package_json = await file(join(ctx.package_dir, "node_modules", "when", "package.json")).json();
      expect(package_json.name).toBe("when");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle GitHub tarball URL in dependencies (https://github.com/user/repo/tarball/ref) with custom GITHUB_API_URL", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            when: "https://github.com/cujojs/when/tarball/1.0.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: {
          ...env,
          GITHUB_API_URL: "https://example.com/github/api",
        },
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      let out = await stdout.text();
      out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
      out = out.replace(/(github:[^#]+)#[a-f0-9]+/, "$1");
      expect(out.split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ when@https://github.com/cujojs/when/tarball/1.0.2",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "when"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "when"))).toEqual([
        ".gitignore",
        ".gitmodules",
        "LICENSE.txt",
        "README.md",
        "apply.js",
        "cancelable.js",
        "delay.js",
        "package.json",
        "test",
        "timed.js",
        "timeout.js",
        "when.js",
      ]);
      const package_json = await file(join(ctx.package_dir, "node_modules", "when", "package.json")).json();
      expect(package_json.name).toBe("when");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should treat non-GitHub http(s) URLs as tarballs (https://some.url/path?stuff)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "4.3.0": { as: "4.3.0" },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            "@vercel/turbopack-node":
              "https://gitpkg-fork.vercel.sh/vercel/turbo/crates/turbopack-node/js?turbopack-230922.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      let out = await stdout.text();
      out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
      out = out.replace(/(github:[^#]+)#[a-f0-9]+/, "$1");
      expect(out.split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ @vercel/turbopack-node@https://gitpkg-fork.vercel.sh/vercel/turbo/crates/turbopack-node/js?turbopack-230922.2",
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toHaveLength(2);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".cache",
        "@vercel",
        "loader-runner",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@vercel"))).toEqual(["turbopack-node"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@vercel", "turbopack-node"))).toEqual([
        "package.json",
        "src",
        "tsconfig.json",
      ]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle GitHub URL with existing lockfile", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "bunfig.toml"),
        `
  [install]
  cache = false
  saveTextLockfile = false
  `,
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "html-minifier": "kangax/html-minifier#v4.0.0",
          },
        }),
      );
      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install", "--linker=hoisted"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err1 = await new Response(stderr1).text();
      expect(err1).toContain("Saved lockfile");
      const out1 = await new Response(stdout1).text();
      expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ html-minifier@github:kangax/html-minifier#4beb325",
        "",
        "12 packages installed",
      ]);
      expect(await exited1).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "camel-case",
        "clean-css",
        "commander",
        "he",
        "html-minifier",
        "lower-case",
        "no-case",
        "param-case",
        "relateurl",
        "source-map",
        "uglify-js",
        "upper-case",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins([
        "he",
        "html-minifier",
        "uglifyjs",
      ]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "he")).toBeValidBin(join("..", "he", "bin", "he"));
      expect(join(ctx.package_dir, "node_modules", ".bin", "html-minifier")).toBeValidBin(
        join("..", "html-minifier", "cli.js"),
      );
      expect(join(ctx.package_dir, "node_modules", ".bin", "uglifyjs")).toBeValidBin(
        join("..", "uglify-js", "bin", "uglifyjs"),
      );
      await access(join(ctx.package_dir, "bun.lockb"));
      // Perform `bun install` again but with lockfile from before
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      urls.length = 0;
      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install", "--linker=hoisted"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err2 = await new Response(stderr2).text();
      expect(err2).not.toContain("Saved lockfile");
      const out2 = await new Response(stdout2).text();
      expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ html-minifier@github:kangax/html-minifier#4beb325",
        "",
        "12 packages installed",
      ]);
      expect(await exited2).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "camel-case",
        "clean-css",
        "commander",
        "he",
        "html-minifier",
        "lower-case",
        "no-case",
        "param-case",
        "relateurl",
        "source-map",
        "uglify-js",
        "upper-case",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins([
        "he",
        "html-minifier",
        "uglifyjs",
      ]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "he")).toBeValidBin(join("..", "he", "bin", "he"));
      expect(join(ctx.package_dir, "node_modules", ".bin", "html-minifier")).toBeValidBin(
        join("..", "html-minifier", "cli.js"),
      );
      expect(join(ctx.package_dir, "node_modules", ".bin", "uglifyjs")).toBeValidBin(
        join("..", "uglify-js", "bin", "uglifyjs"),
      );
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should consider peerDependencies during hoisting", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
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
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          peerDependencies: {
            baz: ">0.0.3",
          },
          workspaces: ["bar", "moo"],
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "bar",
          version: "0.0.2",
          dependencies: {
            baz: "0.0.3",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "moo"));
      await writeFile(
        join(ctx.package_dir, "moo", "package.json"),
        JSON.stringify({
          name: "moo",
          version: "0.0.4",
          dependencies: {
            baz: "0.0.5",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ baz@0.0.5",
        "",
        "4 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([
        `${ctx.registry_url}baz`,
        `${ctx.registry_url}baz-0.0.3.tgz`,
        `${ctx.registry_url}baz-0.0.5.tgz`,
      ]);
      expect(ctx.requested).toBe(3);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "bar",
        "baz",
        "moo",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-exec"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-exec")).toBeValidBin(join("..", "baz", "index.js"));
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(join("..", "bar"));
      expect(await readdirSorted(join(ctx.package_dir, "bar"))).toEqual(["node_modules", "package.json"]);
      expect(await readdirSorted(join(ctx.package_dir, "bar", "node_modules"))).toEqual([".bin", "baz"]);
      expect(join(ctx.package_dir, "bar", "node_modules", ".bin", "baz-run")).toBeValidBin(
        join("..", "baz", "index.js"),
      );
      expect(await readdirSorted(join(ctx.package_dir, "bar", "node_modules", "baz"))).toEqual([
        "index.js",
        "package.json",
      ]);
      expect(await file(join(ctx.package_dir, "bar", "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.5",
        bin: {
          "baz-exec": "index.js",
        },
      });
      expect(await readlink(join(ctx.package_dir, "node_modules", "moo"))).toBeWorkspaceLink(join("..", "moo"));
      expect(await readdirSorted(join(ctx.package_dir, "moo"))).toEqual(["package.json"]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should install peerDependencies when needed", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
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
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          peerDependencies: {
            baz: ">=0.0.3",
          },
          workspaces: ["bar", "moo"],
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "bar",
          version: "0.0.2",
          dependencies: {
            baz: "0.0.3",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "moo"));
      await writeFile(
        join(ctx.package_dir, "moo", "package.json"),
        JSON.stringify({
          name: "moo",
          version: "0.0.4",
          dependencies: {
            baz: "0.0.5",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ baz@0.0.5",
        "",
        "4 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([
        `${ctx.registry_url}baz`,
        `${ctx.registry_url}baz-0.0.3.tgz`,
        `${ctx.registry_url}baz-0.0.5.tgz`,
      ]);
      expect(ctx.requested).toBe(3);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "bar",
        "baz",
        "moo",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-exec"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-exec")).toBeValidBin(join("..", "baz", "index.js"));
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(join("..", "bar"));
      expect(await readdirSorted(join(ctx.package_dir, "bar"))).toEqual(["node_modules", "package.json"]);
      expect(join(ctx.package_dir, "bar", "node_modules", ".bin", "baz-run")).toBeValidBin(
        join("..", "baz", "index.js"),
      );
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.5",
        bin: {
          "baz-exec": "index.js",
        },
      });
      expect(await readlink(join(ctx.package_dir, "node_modules", "moo"))).toBeWorkspaceLink(join("..", "moo"));
      expect(await readdirSorted(join(ctx.package_dir, "moo"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "bar", "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should not regard peerDependencies declarations as duplicates", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: "*",
          },
          peerDependencies: {
            bar: "^0.0.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  test.serial("should report error on invalid format for package.json", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(join(ctx.package_dir, "package.json"), "foo");
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(
        err.replaceAll(joinP(ctx.package_dir + sep), "[dir]/").replaceAll(ctx.package_dir + sep, "[dir]/"),
      ).toMatchSnapshot();
      const out = await stdout.text();
      expect(out).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
    });
  });

  test.serial("should report error on invalid format for dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: [],
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err.replaceAll(joinP(ctx.package_dir + sep), "[dir]/")).toMatchSnapshot();
      const out = await stdout.text();
      expect(out).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
    });
  });

  it("should report error on invalid format for optionalDependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          optionalDependencies: "bar",
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      let err = await stderr.text();
      err = err.replaceAll(joinP(ctx.package_dir + sep), "[dir]/");
      err = err.substring(0, err.indexOf("\n", err.lastIndexOf("[dir]/package.json:"))).trim();
      expect(err.split("\n")).toEqual([
        `1 | {"name":"foo","version":"0.0.1","optionalDependencies":"bar"}`,
        `                                    ^`,
        `error: optionalDependencies expects a map of specifiers, e.g.`,
        `  "optionalDependencies": {`,
        `    <green>"bun"<r>: <green>"latest"<r>`,
        `  }`,
        `    at [dir]/package.json:1:33`,
      ]);
      const out = await stdout.text();
      expect(out).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
    });
  });

  test.serial("should report error on invalid format for workspaces", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          workspaces: {
            packages: { bar: true },
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err.replaceAll(joinP(ctx.package_dir + sep), "[dir]/")).toMatchSnapshot();
      const out = await stdout.text();
      expect(out).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
    });
  });

  it("should report error on duplicated workspace packages", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          workspaces: ["bar", "baz"],
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      await writeFile(
        join(ctx.package_dir, "bar", "package.json"),
        JSON.stringify({
          name: "moo",
          version: "0.0.2",
        }),
      );
      await mkdir(join(ctx.package_dir, "baz"));
      await writeFile(
        join(ctx.package_dir, "baz", "package.json"),
        JSON.stringify({
          name: "moo",
          version: "0.0.3",
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      let err = await stderr.text();
      err = err.replaceAll(ctx.package_dir, "[dir]");
      err = err.replaceAll(sep, "/");
      expect(err.trim().split("\n")).toEqual([
        `1 | {"name":"moo","version":"0.0.3"}`,
        `            ^`,
        `error: Workspace name "moo" already exists`,
        `    at [dir]/baz/package.json:1:9`,
        ``,
        `1 | {"name":"moo","version":"0.0.2"}`,
        `            ^`,
        `note: Package name is also declared here`,
        `   at [dir]/bar/package.json:1:9`,
      ]);
      const out = await stdout.text();
      expect(out).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
    });
  });

  it("should handle Git URL in dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            "uglify-js": "git+https://git@github.com/mishoo/UglifyJS.git",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      let out = await stdout.text();
      out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
      out = out.replace(/(\.git)#[a-f0-9]+/, "$1");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ uglify-js@git+https://git@github.com/mishoo/UglifyJS.git",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify-js"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "uglifyjs")).toBeValidBin(
        join("..", "uglify-js", "bin", "uglifyjs"),
      );
      expect((await readdirSorted(join(ctx.package_dir, "node_modules", ".cache")))[0]).toBe("9694c5fe9c41ad51.git");
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "uglify-js"))).toEqual([
        ".bun-tag",
        ".gitattributes",
        ".github",
        ".gitignore",
        "CONTRIBUTING.md",
        "LICENSE",
        "README.md",
        "bin",
        "lib",
        "package.json",
        "test",
        "tools",
      ]);
      const package_json = await file(join(ctx.package_dir, "node_modules", "uglify-js", "package.json")).json();
      expect(package_json.name).toBe("uglify-js");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle Git URL in dependencies (SCP-style)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            uglify: "github.com:mishoo/UglifyJS.git",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      let out = await stdout.text();
      out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
      out = out.replace(/(\.git)#[a-f0-9]+/, "$1");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ uglify@git+ssh://github.com:mishoo/UglifyJS.git",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "uglifyjs")).toBeValidBin(
        join("..", "uglify", "bin", "uglifyjs"),
      );
      expect((await readdirSorted(join(ctx.package_dir, "node_modules", ".cache")))[0]).toBe("87d55589eb4217d2.git");
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "uglify"))).toEqual([
        ".bun-tag",
        ".gitattributes",
        ".github",
        ".gitignore",
        "CONTRIBUTING.md",
        "LICENSE",
        "README.md",
        "bin",
        "lib",
        "package.json",
        "test",
        "tools",
      ]);
      const package_json = await file(join(ctx.package_dir, "node_modules", "uglify", "package.json")).json();
      expect(package_json.name).toBe("uglify-js");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle Git URL with committish in dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            uglify: "git+https://git@github.com/mishoo/UglifyJS.git#v3.14.1",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ uglify@git+https://git@github.com/mishoo/UglifyJS.git#e219a9a78a0d2251e4dcbd4bb9034207eb484fe8",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "uglifyjs")).toBeValidBin(
        join("..", "uglify", "bin", "uglifyjs"),
      );
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
        "9694c5fe9c41ad51.git",
        "@G@e219a9a78a0d2251e4dcbd4bb9034207eb484fe8",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "uglify"))).toEqual([
        ".bun-tag",
        ".gitattributes",
        ".github",
        ".gitignore",
        "CONTRIBUTING.md",
        "LICENSE",
        "README.md",
        "bin",
        "lib",
        "package.json",
        "test",
        "tools",
      ]);
      const package_json = await file(join(ctx.package_dir, "node_modules", "uglify", "package.json")).json();
      expect(package_json.name).toBe("uglify-js");
      expect(package_json.version).toBe("3.14.1");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should fail on invalid Git URL", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            uglify: "git+http://bun.sh/no_such_repo",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err.split(/\r?\n/)).toContain("error: InstallFailed cloning repository for uglify");
      const out = await stdout.text();
      expect(out).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      try {
        await access(join(ctx.package_dir, "bun.lockb"));
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
    });
  });

  it("should fail on ssh Git URL if invalid credentials", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            "private-install": "git+ssh://git@bitbucket.org/kaizenmedia/private-install-test.git",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env: { ...env, "GIT_ASKPASS": "echo" },
      });
      const err = await stderr.text();
      expect(err.split(/\r?\n/)).toContain('error: "git clone" for "private-install" failed');
      const out = await stdout.text();
      expect(out).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      try {
        await access(join(ctx.package_dir, "bun.lockb"));
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
    });
  });

  it("should fail on Git URL with invalid committish", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            uglify: "git+https://git@github.com/mishoo/UglifyJS.git#404-no_such_tag",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err.split(/\r?\n/)).toContain(
        'error: no commit matching "404-no_such_tag" found for "uglify" (but repository exists)',
      );
      const out = await stdout.text();
      expect(out).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      try {
        await access(join(ctx.package_dir, "bun.lockb"));
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
    });
  });

  it("should de-duplicate committish in Git URLs", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            "uglify-ver": "git+https://git@github.com/mishoo/UglifyJS.git#v3.14.1",
            "uglify-hash": "git+https://git@github.com/mishoo/UglifyJS.git#e219a9a",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ uglify-hash@git+https://git@github.com/mishoo/UglifyJS.git#e219a9a78a0d2251e4dcbd4bb9034207eb484fe8",
        "+ uglify-ver@git+https://git@github.com/mishoo/UglifyJS.git#e219a9a78a0d2251e4dcbd4bb9034207eb484fe8",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "uglify-hash",
        "uglify-ver",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "uglifyjs")).toBeValidBin(
        join("..", "uglify-hash", "bin", "uglifyjs"),
      );
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
        "9694c5fe9c41ad51.git",
        "@G@e219a9a78a0d2251e4dcbd4bb9034207eb484fe8",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "uglify-hash"))).toEqual([
        ".bun-tag",
        ".gitattributes",
        ".github",
        ".gitignore",
        "CONTRIBUTING.md",
        "LICENSE",
        "README.md",
        "bin",
        "lib",
        "package.json",
        "test",
        "tools",
      ]);
      const hash_json = await file(join(ctx.package_dir, "node_modules", "uglify-hash", "package.json")).json();
      expect(hash_json.name).toBe("uglify-js");
      expect(hash_json.version).toBe("3.14.1");
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "uglify-ver"))).toEqual([
        ".bun-tag",
        ".gitattributes",
        ".github",
        ".gitignore",
        "CONTRIBUTING.md",
        "LICENSE",
        "README.md",
        "bin",
        "lib",
        "package.json",
        "test",
        "tools",
      ]);
      const ver_json = await file(join(ctx.package_dir, "node_modules", "uglify-ver", "package.json")).json();
      expect(ver_json.name).toBe("uglify-js");
      expect(ver_json.version).toBe("3.14.1");
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle Git URL with existing lockfile", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "bunfig.toml"),
        `
  [install]
  cache = false
  saveTextLockfile = false
  `,
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "html-minifier": "git+https://git@github.com/kangax/html-minifier#v4.0.0",
          },
        }),
      );
      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install", "--linker=hoisted"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err1 = await new Response(stderr1).text();
      expect(err1).toContain("Saved lockfile");
      const out1 = await new Response(stdout1).text();
      expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ html-minifier@git+https://git@github.com/kangax/html-minifier#4beb325eb01154a40c0cbebff2e5737bbd7071ab",
        "",
        "12 packages installed",
      ]);
      expect(await exited1).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "camel-case",
        "clean-css",
        "commander",
        "he",
        "html-minifier",
        "lower-case",
        "no-case",
        "param-case",
        "relateurl",
        "source-map",
        "uglify-js",
        "upper-case",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins([
        "he",
        "html-minifier",
        "uglifyjs",
      ]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "he")).toBeValidBin(join("..", "he", "bin", "he"));
      expect(join(ctx.package_dir, "node_modules", ".bin", "html-minifier")).toBeValidBin(
        join("..", "html-minifier", "cli.js"),
      );
      expect(join(ctx.package_dir, "node_modules", ".bin", "uglifyjs")).toBeValidBin(
        join("..", "uglify-js", "bin", "uglifyjs"),
      );
      await access(join(ctx.package_dir, "bun.lockb"));
      // Perform `bun install` again but with lockfile from before
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      urls.length = 0;
      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install", "--linker=hoisted"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err2 = await new Response(stderr2).text();
      expect(err2).not.toContain("Saved lockfile");
      const out2 = await new Response(stdout2).text();
      expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ html-minifier@git+https://git@github.com/kangax/html-minifier#4beb325eb01154a40c0cbebff2e5737bbd7071ab",
        "",
        "12 packages installed",
      ]);
      expect(await exited2).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "camel-case",
        "clean-css",
        "commander",
        "he",
        "html-minifier",
        "lower-case",
        "no-case",
        "param-case",
        "relateurl",
        "source-map",
        "uglify-js",
        "upper-case",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins([
        "he",
        "html-minifier",
        "uglifyjs",
      ]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "he")).toBeValidBin(join("..", "he", "bin", "he"));
      expect(join(ctx.package_dir, "node_modules", ".bin", "html-minifier")).toBeValidBin(
        join("..", "html-minifier", "cli.js"),
      );
      expect(join(ctx.package_dir, "node_modules", ".bin", "uglifyjs")).toBeValidBin(
        join("..", "uglify-js", "bin", "uglifyjs"),
      );
      await access(join(ctx.package_dir, "bun.lockb"));
      // Perform `bun install` again but with cache & lockfile from before
      await Promise.all(
        [
          ".bin",
          "camel-case",
          "clean-css",
          "commander",
          "he",
          "html-minifier",
          "lower-case",
          "no-case",
          "param-case",
          "relateurl",
          "source-map",
          "uglify-js",
          "upper-case",
        ].map(async dir => await rm(join(ctx.package_dir, "node_modules", dir), { force: true, recursive: true })),
      );

      urls.length = 0;
      const {
        stdout: stdout3,
        stderr: stderr3,
        exited: exited3,
      } = spawn({
        cmd: [bunExe(), "install", "--linker=hoisted"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err3 = await new Response(stderr3).text();
      expect(err3).not.toContain("Saved lockfile");
      const out3 = await new Response(stdout3).text();
      expect(out3.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ html-minifier@git+https://git@github.com/kangax/html-minifier#4beb325eb01154a40c0cbebff2e5737bbd7071ab",
        "",
        "12 packages installed",
      ]);
      expect(await exited3).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "camel-case",
        "clean-css",
        "commander",
        "he",
        "html-minifier",
        "lower-case",
        "no-case",
        "param-case",
        "relateurl",
        "source-map",
        "uglify-js",
        "upper-case",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins([
        "he",
        "html-minifier",
        "uglifyjs",
      ]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "he")).toBeValidBin(join("..", "he", "bin", "he"));
      expect(join(ctx.package_dir, "node_modules", ".bin", "html-minifier")).toBeValidBin(
        join("..", "html-minifier", "cli.js"),
      );
      expect(join(ctx.package_dir, "node_modules", ".bin", "uglifyjs")).toBeValidBin(
        join("..", "uglify-js", "bin", "uglifyjs"),
      );
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should prefer optionalDependencies over dependencies of the same name", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": {},
          "0.0.5": {},
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: "0.0.5",
          },
          optionalDependencies: {
            baz: "0.0.3",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("+ baz@0.0.3"),
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "baz"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
    });
  });

  it("should prefer dependencies over peerDependencies of the same name", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": {},
          "0.0.5": {},
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: "0.0.5",
          },
          peerDependencies: {
            baz: "0.0.3",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ baz@0.0.5",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.5.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "baz"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.5",
        bin: {
          "baz-exec": "index.js",
        },
      });
    });
  });

  it("should handle tarball URL", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: `${ctx.registry_url}baz-0.0.3.tgz`,
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ baz@${ctx.registry_url}baz-0.0.3.tgz`,
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(ctx.requested).toBe(1);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle tarball path", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: join(import.meta.dir, "baz-0.0.3.tgz"),
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ baz@${join(import.meta.dir, "baz-0.0.3.tgz").replace(/\\/g, "/")}`,
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle tarball URL with aliasing", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: `${ctx.registry_url}baz-0.0.3.tgz`,
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ bar@${ctx.registry_url}baz-0.0.3.tgz`,
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(ctx.requested).toBe(1);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "bar", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle tarball path with aliasing", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            bar: join(import.meta.dir, "baz-0.0.3.tgz"),
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ bar@${join(import.meta.dir, "baz-0.0.3.tgz").replace(/\\/g, "/")}`,
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "bar", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should de-duplicate dependencies alongside tarball URL", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.2": {},
          "0.0.3": {
            bin: {
              "baz-run": "index.js",
            },
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "@barn/moo": `${ctx.registry_url}moo-0.1.0.tgz`,
            bar: "<=0.0.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ @barn/moo@${ctx.registry_url}moo-0.1.0.tgz`,
        expect.stringContaining("+ bar@0.0.2"),
        "",
        "3 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([
        `${ctx.registry_url}bar`,
        `${ctx.registry_url}bar-0.0.2.tgz`,
        `${ctx.registry_url}baz`,
        `${ctx.registry_url}baz-0.0.3.tgz`,
        `${ctx.registry_url}moo-0.1.0.tgz`,
      ]);
      expect(ctx.requested).toBe(5);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "@barn",
        "bar",
        "baz",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "@barn", "moo", "package.json")).json()).toEqual({
        name: "@barn/moo",
        version: "0.1.0",
        dependencies: {
          bar: "0.0.2",
          baz: "latest",
        },
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle tarball URL with existing lockfile", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.2": {},
          "0.0.3": {
            bin: {
              "baz-run": "index.js",
            },
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "@barn/moo": `${ctx.registry_url}moo-0.1.0.tgz`,
          },
        }),
      );
      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err1 = await new Response(stderr1).text();
      expect(err1).toContain("Saved lockfile");
      const out1 = await new Response(stdout1).text();
      expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ @barn/moo@${ctx.registry_url}moo-0.1.0.tgz`,
        "",
        "3 packages installed",
      ]);
      expect(await exited1).toBe(0);
      expect(urls.sort()).toEqual([
        `${ctx.registry_url}bar`,
        `${ctx.registry_url}bar-0.0.2.tgz`,
        `${ctx.registry_url}baz`,
        `${ctx.registry_url}baz-0.0.3.tgz`,
        `${ctx.registry_url}moo-0.1.0.tgz`,
      ]);
      expect(ctx.requested).toBe(5);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "@barn",
        "bar",
        "baz",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "@barn", "moo", "package.json")).json()).toEqual({
        name: "@barn/moo",
        version: "0.1.0",
        dependencies: {
          bar: "0.0.2",
          baz: "latest",
        },
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
      // Perform `bun install` again but with lockfile from before
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      urls.length = 0;
      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err2 = await new Response(stderr2).text();
      expect(err2).not.toContain("Saved lockfile");
      const out2 = await new Response(stdout2).text();
      expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ @barn/moo@${ctx.registry_url}moo-0.1.0.tgz`,
        "",
        "3 packages installed",
      ]);
      expect(await exited2).toBe(0);
      expect(urls.sort()).toEqual([
        `${ctx.registry_url}bar-0.0.2.tgz`,
        `${ctx.registry_url}baz-0.0.3.tgz`,
        `${ctx.registry_url}moo-0.1.0.tgz`,
      ]);
      expect(ctx.requested).toBe(8);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "@barn",
        "bar",
        "baz",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "@barn", "moo", "package.json")).json()).toEqual({
        name: "@barn/moo",
        version: "0.1.0",
        dependencies: {
          bar: "0.0.2",
          baz: "latest",
        },
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle tarball path with existing lockfile", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.2": {},
          "0.0.3": {
            bin: {
              "baz-run": "index.js",
            },
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "@barn/moo": join(import.meta.dir, "moo-0.1.0.tgz"),
          },
        }),
      );
      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err1 = await new Response(stderr1).text();
      expect(err1).toContain("Saved lockfile");
      const out1 = await new Response(stdout1).text();
      expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ @barn/moo@${join(import.meta.dir, "moo-0.1.0.tgz").replace(/\\/g, "/")}`,
        "",
        "3 packages installed",
      ]);
      expect(await exited1).toBe(0);
      expect(urls.sort()).toEqual([
        `${ctx.registry_url}bar`,
        `${ctx.registry_url}bar-0.0.2.tgz`,
        `${ctx.registry_url}baz`,
        `${ctx.registry_url}baz-0.0.3.tgz`,
      ]);
      expect(ctx.requested).toBe(4);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "@barn",
        "bar",
        "baz",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "@barn", "moo", "package.json")).json()).toEqual({
        name: "@barn/moo",
        version: "0.1.0",
        dependencies: {
          bar: "0.0.2",
          baz: "latest",
        },
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
      // Perform `bun install` again but with lockfile from before
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      urls.length = 0;
      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err2 = await new Response(stderr2).text();
      expect(err2).not.toContain("Saved lockfile");
      const out2 = await new Response(stdout2).text();
      expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ @barn/moo@${join(import.meta.dir, "moo-0.1.0.tgz").replace(/\\/g, "/")}`,
        "",
        "3 packages installed",
      ]);
      expect(await exited2).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar-0.0.2.tgz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(ctx.requested).toBe(6);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "@barn",
        "bar",
        "baz",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "@barn", "moo", "package.json")).json()).toEqual({
        name: "@barn/moo",
        version: "0.1.0",
        dependencies: {
          bar: "0.0.2",
          baz: "latest",
        },
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
        },
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle devDependencies from folder", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.1.0",
          dependencies: {
            moo: "file:./moo",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "moo"));
      const moo_package = JSON.stringify({
        name: "moo",
        version: "0.2.0",
        devDependencies: {
          bar: "^0.0.2",
        },
      });
      await writeFile(join(ctx.package_dir, "moo", "package.json"), moo_package);
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ moo@moo",
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar", "moo"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "moo"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "moo", "package.json")).text()).toEqual(moo_package);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should deduplicate devDependencies from folder", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.1.0",
          devDependencies: {
            bar: "^0.0.2",
            moo: "file:./moo",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "moo"));
      const moo_package = JSON.stringify({
        name: "moo",
        version: "0.2.0",
        devDependencies: {
          bar: "^0.0.2",
        },
      });
      await writeFile(join(ctx.package_dir, "moo", "package.json"), moo_package);
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2",
        "+ moo@moo",
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar", "moo"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "moo"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "moo", "package.json")).text()).toEqual(moo_package);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should install dependencies in root package of workspace", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.1.0",
          workspaces: ["moo"],
        }),
      );
      await mkdir(join(ctx.package_dir, "moo"));
      const moo_package = JSON.stringify({
        name: "moo",
        version: "0.2.0",
        dependencies: {
          bar: "^0.0.2",
        },
      });
      await writeFile(join(ctx.package_dir, "moo", "package.json"), moo_package);
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: join(ctx.package_dir, "moo"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2",
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar", "moo"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "moo"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "moo", "package.json")).text()).toEqual(moo_package);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should install dependencies in root package of workspace (*)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.1.0",
          workspaces: ["*"],
        }),
      );
      await mkdir(join(ctx.package_dir, "moo"));
      const moo_package = JSON.stringify({
        name: "moo",
        version: "0.2.0",
        dependencies: {
          bar: "^0.0.2",
        },
      });
      await writeFile(join(ctx.package_dir, "moo", "package.json"), moo_package);
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: join(ctx.package_dir, "moo"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2",
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar", "moo"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "moo"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "moo", "package.json")).text()).toEqual(moo_package);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should ignore invalid workspaces from parent directory", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      const foo_package = JSON.stringify({
        name: "foo",
        version: "0.1.0",
        workspaces: ["moz"],
      });
      await writeFile(join(ctx.package_dir, "package.json"), foo_package);
      await mkdir(join(ctx.package_dir, "moo"));
      await writeFile(
        join(ctx.package_dir, "moo", "bunfig.toml"),
        await file(join(ctx.package_dir, "bunfig.toml")).text(),
      );
      const moo_package = JSON.stringify({
        name: "moo",
        version: "0.2.0",
        dependencies: {
          bar: "^0.0.2",
        },
      });
      await writeFile(join(ctx.package_dir, "moo", "package.json"), moo_package);
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: join(ctx.package_dir, "moo"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(ctx.package_dir)).toEqual(["bunfig.toml", "moo", "package.json"]);
      expect(await file(join(ctx.package_dir, "package.json")).text()).toEqual(foo_package);
      expect(await readdirSorted(join(ctx.package_dir, "moo"))).toEqual([
        "bun.lockb",
        "bunfig.toml",
        "node_modules",
        "package.json",
      ]);
      expect(await file(join(ctx.package_dir, "moo", "package.json")).text()).toEqual(moo_package);
      expect(await readdirSorted(join(ctx.package_dir, "moo", "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "moo", "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "moo", "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
    });
  });

  it("should handle --cwd", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      const foo_package = JSON.stringify({
        name: "foo",
        version: "0.1.0",
      });
      await writeFile(join(ctx.package_dir, "package.json"), foo_package);
      await mkdir(join(ctx.package_dir, "moo"));
      await writeFile(
        join(ctx.package_dir, "moo", "bunfig.toml"),
        await file(join(ctx.package_dir, "bunfig.toml")).text(),
      );
      const moo_package = JSON.stringify({
        name: "moo",
        version: "0.2.0",
        dependencies: {
          bar: "^0.0.2",
        },
      });
      await writeFile(join(ctx.package_dir, "moo", "package.json"), moo_package);
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--cwd", "moo"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(ctx.package_dir)).toEqual(["bunfig.toml", "moo", "package.json"]);
      expect(await file(join(ctx.package_dir, "package.json")).text()).toEqual(foo_package);
      expect(await readdirSorted(join(ctx.package_dir, "moo"))).toEqual([
        "bun.lockb",
        "bunfig.toml",
        "node_modules",
        "package.json",
      ]);
      expect(await file(join(ctx.package_dir, "moo", "package.json")).text()).toEqual(moo_package);
      expect(await readdirSorted(join(ctx.package_dir, "moo", "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "moo", "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "moo", "node_modules", "bar", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
    });
  });

  it("should handle --frozen-lockfile", async () => {
    await withContext(defaultOpts, async ctx => {
      let urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, { "0.0.3": { as: "0.0.3" }, "0.0.5": { as: "0.0.5" } }),
      );

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { baz: "0.0.3" } }),
      );

      // save the lockfile once
      expect(
        await spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "ignore",
          stdin: "ignore",
          stderr: "ignore",
          env,
        }).exited,
      ).toBe(0);

      // change version of baz in package.json
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: { baz: "0.0.5" },
        }),
      );

      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--frozen-lockfile"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      const err = await stderr.text();
      expect(err).toContain("error: lockfile had changes, but lockfile is frozen");
      expect(await exited).toBe(1);
    });
  });

  it("should handle bun ci alias (to --frozen-lockfile)", async () => {
    await withContext(defaultOpts, async ctx => {
      let urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, { "0.0.3": { as: "0.0.3" }, "0.0.5": { as: "0.0.5" } }),
      );

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { baz: "0.0.3" } }),
      );

      // save the lockfile once
      expect(
        await spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "ignore",
          stdin: "ignore",
          stderr: "ignore",
          env,
        }).exited,
      ).toBe(0);

      // change version of baz in package.json
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: { baz: "0.0.5" },
        }),
      );

      const { stderr: stderr1, exited: exited1 } = spawn({
        cmd: [bunExe(), "ci"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      const err1 = await new Response(stderr1).text();
      expect(err1).toContain("error: lockfile had changes, but lockfile is frozen");
      expect(await exited1).toBe(1);

      // test that it works even if ci isn't first "arg"
      const { stderr: stderr2, exited: exited2 } = spawn({
        cmd: [bunExe(), "--save", "ci"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      const err2 = await new Response(stderr2).text();
      expect(err2).toContain("error: lockfile had changes, but lockfile is frozen");
      expect(await exited2).toBe(1);
    });
  });

  it("should handle frozenLockfile in config file", async () => {
    await withContext(defaultOpts, async ctx => {
      let urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, { "0.0.3": { as: "0.0.3" }, "0.0.5": { as: "0.0.5" } }),
      );

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { baz: "0.0.3" } }),
      );

      // save the lockfile once
      expect(
        await spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "ignore",
          stdin: "ignore",
          stderr: "ignore",
          env,
        }).exited,
      ).toBe(0);

      await writeFile(
        join(ctx.package_dir, "bunfig.toml"),
        `
  [install]
  frozenLockfile = true
  registry = "${ctx.registry_url}"
  `,
      );

      // change version of baz in package.json
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: { baz: "0.0.5" },
        }),
      );

      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      const err = await stderr.text();
      expect(err).toContain("error: lockfile had changes, but lockfile is frozen");
      expect(await exited).toBe(1);
    });
  });

  it("should perform bin-linking across multiple dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const foo_package = JSON.stringify({
        name: "foo",
        devDependencies: {
          "conditional-type-checks": "1.0.6",
          "prettier": "2.8.8",
          "tsd": "0.22.0",
          "typescript": "5.0.4",
        },
      });
      await writeFile(join(ctx.package_dir, "package.json"), foo_package);
      await cp(join(import.meta.dir, "bun.lockb.bin-linking"), join(ctx.package_dir, "bun.lockb"));
      await writeFile(
        join(ctx.package_dir, "bunfig.toml"),
        `
  [install]
  cache = false
  `,
      );
      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err1 = await new Response(stderr1).text();
      expect(err1).not.toContain("error:");
      const out1 = await new Response(stdout1).text();
      expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        `bun install ${Bun.version_with_sha}`,
        "",
        expect.stringContaining("+ conditional-type-checks@1.0.6"),
        expect.stringContaining("+ prettier@2.8.8"),
        expect.stringContaining("+ tsd@0.22.0"),
        expect.stringContaining("+ typescript@5.0.4"),
        "",
        "112 packages installed",
      ]);
      expect(await exited1).toBe(0);
      expect(await readdirSorted(ctx.package_dir)).toEqual([
        "bun.lockb",
        "bunfig.toml",
        "node_modules",
        "package.json",
      ]);
      expect(await file(join(ctx.package_dir, "package.json")).text()).toEqual(foo_package);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "@babel",
        "@nodelib",
        "@tsd",
        "@types",
        "ansi-escapes",
        "ansi-regex",
        "ansi-styles",
        "array-union",
        "arrify",
        "braces",
        "camelcase",
        "camelcase-keys",
        "chalk",
        "color-convert",
        "color-name",
        "conditional-type-checks",
        "decamelize",
        "decamelize-keys",
        "dir-glob",
        "emoji-regex",
        "error-ex",
        "eslint-formatter-pretty",
        "eslint-rule-docs",
        "fast-glob",
        "fastq",
        "fill-range",
        "find-up",
        "function-bind",
        "glob-parent",
        "globby",
        "hard-rejection",
        "has-flag",
        "hasown",
        "hosted-git-info",
        "ignore",
        "indent-string",
        "irregular-plurals",
        "is-arrayish",
        "is-core-module",
        "is-extglob",
        "is-fullwidth-code-point",
        "is-glob",
        "is-number",
        "is-plain-obj",
        "is-unicode-supported",
        "js-tokens",
        "json-parse-even-better-errors",
        "kind-of",
        "lines-and-columns",
        "locate-path",
        "log-symbols",
        "lru-cache",
        "map-obj",
        "meow",
        "merge2",
        "micromatch",
        "min-indent",
        "minimist-options",
        "normalize-package-data",
        "p-limit",
        "p-locate",
        "p-try",
        "parse-json",
        "path-exists",
        "path-parse",
        "path-type",
        "picocolors",
        "picomatch",
        "plur",
        "prettier",
        "queue-microtask",
        "quick-lru",
        "read-pkg",
        "read-pkg-up",
        "redent",
        "resolve",
        "reusify",
        "run-parallel",
        "semver",
        "slash",
        "spdx-correct",
        "spdx-exceptions",
        "spdx-expression-parse",
        "spdx-license-ids",
        "string-width",
        "strip-ansi",
        "strip-indent",
        "supports-color",
        "supports-hyperlinks",
        "supports-preserve-symlinks-flag",
        "to-regex-range",
        "trim-newlines",
        "tsd",
        "type-fest",
        "typescript",
        "validate-npm-package-license",
        "yallist",
        "yargs-parser",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins([
        "prettier",
        "resolve",
        "semver",
        "tsc",
        "tsd",
        "tsserver",
      ]);
      // Perform `bun install --production` with lockfile from before
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install", "--production"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err2 = await new Response(stderr2).text();
      expect(err2).not.toContain("Saved lockfile");
      expect(err2).not.toContain("error:");
      const out2 = await new Response(stdout2).text();
      expect(out2.replace(/\[[0-9\.]+m?s\]/, "[]").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "[] done",
        "",
      ]);
      expect(await exited2).toBe(0);
      expect(await readdirSorted(ctx.package_dir)).toEqual([
        "bun.lockb",
        "bunfig.toml",
        "node_modules",
        "package.json",
      ]);
      expect(await file(join(ctx.package_dir, "package.json")).text()).toEqual(foo_package);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toBeEmpty();
    });
  });

  it("should handle trustedDependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      function getScripts(name: string) {
        return {
          preinstall: `echo preinstall ${name}`,
          install: `echo install ${name}`,
          postinstall: `echo postinstall ${name}`,
          preprepare: `echo preprepare ${name}`,
          prepare: `echo prepare ${name}`,
          postprepare: `echo postprepare ${name}`,
        };
      }
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.1.0",
          dependencies: {
            bar: "file:./bar",
            moo: "file:./moo",
          },
          trustedDependencies: ["moo"],
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      const bar_package = JSON.stringify({
        name: "bar",
        version: "0.2.0",
        scripts: getScripts("bar"),
      });
      await writeFile(join(ctx.package_dir, "bar", "package.json"), bar_package);
      await mkdir(join(ctx.package_dir, "moo"));
      const moo_package = JSON.stringify({
        name: "moo",
        version: "0.3.0",
        scripts: getScripts("moo"),
      });
      await writeFile(join(ctx.package_dir, "moo", "package.json"), moo_package);
      const { stdout, stderr, exited } = spawn({
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
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@bar",
        "+ moo@moo",
        "",
        "2 packages installed",
        "",
        "Blocked 3 postinstalls. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar", "moo"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).text()).toEqual(bar_package);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "moo"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "moo", "package.json")).text()).toEqual(moo_package);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle `workspaces:*` and `workspace:*` gracefully", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["*"],
          dependencies: {
            bar: "workspace:*",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      const bar_package = JSON.stringify({
        name: "bar",
        version: "0.0.1",
      });
      await writeFile(join(ctx.package_dir, "bar", "package.json"), bar_package);
      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err1 = await new Response(stderr1).text();
      expect(err1).toContain("Saved lockfile");
      const out1 = await new Response(stdout1).text();
      expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@workspace:bar",
        "",
        "1 package installed",
      ]);
      expect(await exited1).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(join("..", "bar"));
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).text()).toEqual(bar_package);
      await access(join(ctx.package_dir, "bun.lockb"));
      // Perform `bun install` again but with lockfile from before
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err2 = await new Response(stderr2).text();
      const out2 = await new Response(stdout2).text();
      expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@workspace:bar",
        "",
        "1 package installed",
      ]);
      expect(await exited2).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(join("..", "bar"));
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).text()).toEqual(bar_package);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle `workspaces:bar` and `workspace:*` gracefully", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["bar"],
          dependencies: {
            bar: "workspace:*",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      const bar_package = JSON.stringify({
        name: "bar",
        version: "0.0.1",
      });
      await writeFile(join(ctx.package_dir, "bar", "package.json"), bar_package);
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@workspace:bar",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(join("..", "bar"));
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).text()).toEqual(bar_package);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle `workspaces:*` and `workspace:bar` gracefully", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["*"],
          dependencies: {
            bar: "workspace:bar",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      const bar_package = JSON.stringify({
        name: "bar",
        version: "0.0.1",
      });
      await writeFile(join(ctx.package_dir, "bar", "package.json"), bar_package);
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@workspace:bar",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(join("..", "bar"));
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).text()).toEqual(bar_package);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle `workspaces:bar` and `workspace:bar` gracefully", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["bar"],
          dependencies: {
            bar: "workspace:bar",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      const bar_package = JSON.stringify({
        name: "bar",
        version: "0.0.1",
      });
      await writeFile(join(ctx.package_dir, "bar", "package.json"), bar_package);
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@workspace:bar",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(join("..", "bar"));
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).text()).toEqual(bar_package);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle installing packages from inside a workspace with `*`", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "main",
          workspaces: ["packages/*"],
          private: true,
        }),
      );
      await mkdir(join(ctx.package_dir, "packages", "yolo"), { recursive: true });
      const yolo_package = JSON.stringify({
        name: "yolo",
        version: "0.0.1",
        dependencies: {
          swag: "workspace:*",
        },
      });
      await writeFile(join(ctx.package_dir, "packages", "yolo", "package.json"), yolo_package);
      await mkdir(join(ctx.package_dir, "packages", "swag"));
      const swag_package = JSON.stringify({
        name: "swag",
        version: "0.0.1",
      });
      await writeFile(join(ctx.package_dir, "packages", "swag", "package.json"), swag_package);
      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: join(ctx.package_dir, "packages", "yolo"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err1 = await new Response(stderr1).text();
      expect(err1).toContain("Saved lockfile");
      const out1 = await new Response(stdout1).text();
      expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ swag@workspace:packages/swag`,
        "",
        "2 packages installed",
      ]);
      expect(await exited1).toBe(0);
      expect(ctx.requested).toBe(0);
      await access(join(ctx.package_dir, "bun.lockb"));

      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install", "bar"],
        cwd: join(ctx.package_dir, "packages", "yolo"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err2 = await new Response(stderr2).text();
      expect(err2).toContain("Saved lockfile");
      const out2 = await new Response(stdout2).text();
      expect(out2).toContain("installed bar");
      expect(await exited2).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle installing packages from inside a workspace without prefix", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "main",
          workspaces: ["packages/*"],
          private: true,
        }),
      );
      await mkdir(join(ctx.package_dir, "packages", "p1"), { recursive: true });
      const p1_package = JSON.stringify({
        name: "p1",
        version: "0.0.1",
        dependencies: {
          p2: "0.1.0",
        },
      });
      await writeFile(join(ctx.package_dir, "packages", "p1", "package.json"), p1_package);

      await mkdir(join(ctx.package_dir, "packages", "p2"));
      const p2_package = JSON.stringify({
        name: "p2",
        version: "0.1.0",
      });
      await writeFile(join(ctx.package_dir, "packages", "p2", "package.json"), p2_package);

      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: join(ctx.package_dir, "packages", "p1"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err1 = await new Response(stderr1).text();
      expect(err1).toContain("Saved lockfile");
      const out1 = await new Response(stdout1).text();
      expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ p2@workspace:packages/p2`,
        "",
        "2 packages installed",
      ]);
      expect(await exited1).toBe(0);
      expect(ctx.requested).toBe(0);
      await access(join(ctx.package_dir, "bun.lockb"));

      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install", "bar"],
        cwd: join(ctx.package_dir, "packages", "p1"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err2 = await new Response(stderr2).text();
      expect(err2).toContain("Saved lockfile");
      const out2 = await new Response(stdout2).text();
      expect(out2).toContain("installed bar");
      expect(await exited2).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle installing workspaces with more complicated globs", async () => {
    const package_dir = tempDirWithFiles("complicated-glob", {
      "package.json": JSON.stringify({
        name: "package3",
        version: "0.0.1",
        workspaces: ["packages/**/*"],
      }),
      "packages": {
        "frontend": {
          "package.json": JSON.stringify({
            name: "frontend",
            version: "0.0.1",
            dependencies: {
              "types": "workspace:*",
              "components": "workspace:*",
            },
          }),
          "components": {
            "package.json": JSON.stringify({
              name: "components",
              version: "0.0.1",
              dependencies: {
                "types": "workspace:*",
              },
            }),
          },
        },
        "backend": {
          "package.json": JSON.stringify({
            name: "backend",
            version: "0.0.1",
            dependencies: {
              "types": "workspace:*",
            },
          }),
        },
        "types": {
          "package.json": JSON.stringify({
            name: "types",
            version: "0.0.1",
            dependencies: {},
          }),
        },
      },
    });

    const { stdout, stderr } = await Bun.$`${bunExe()} install`.env(env).cwd(package_dir).throws(true);
    const err1 = stderr.toString();
    expect(err1).toContain("Saved lockfile");
    expect(
      stdout
        .toString()
        .replace(/\s*\[[0-9\.]+m?s\]\s*$/, "")
        .split(/\r?\n/),
    ).toEqual([expect.stringContaining("bun install v1."), "", "Checked 7 installs across 5 packages (no changes)"]);
  });

  it("should handle installing workspaces with multiple glob patterns", async () => {
    const package_dir = tempDirWithFiles("multi-glob", {
      "package.json": JSON.stringify({
        name: "main",
        version: "0.0.1",
        workspaces: ["backend/**/*", "client/**/*", "types/**/*"],
      }),
      "backend": {
        "server": {
          "package.json": JSON.stringify({
            name: "server",
            version: "0.0.1",
            dependencies: {
              "types": "workspace:*",
              "db": "workspace:*",
            },
          }),
        },
        "db": {
          "package.json": JSON.stringify({
            name: "db",
            version: "0.0.1",
            dependencies: {
              "types": "workspace:*",
            },
          }),
        },
      },
      "client": {
        "clientlib": {
          "package.json": JSON.stringify({
            name: "clientlib",
            version: "0.0.1",
            dependencies: {
              "types": "workspace:*",
            },
          }),
        },
      },
      "types": {
        "types": {
          "package.json": JSON.stringify({
            name: "types",
            version: "0.0.1",
            dependencies: {},
          }),
        },
      },
    });

    console.log("TEMPDIR", package_dir);

    const { stdout, stderr } = await Bun.$`${bunExe()} install`.env(env).cwd(package_dir).throws(true);
    const err1 = stderr.toString();
    expect(err1).toContain("Saved lockfile");
    expect(
      stdout
        .toString()
        .replace(/\s*\[[0-9\.]+m?s\]\s*$/, "")
        .split(/\r?\n/),
    ).toEqual([expect.stringContaining("bun install v1."), "", "Checked 7 installs across 5 packages (no changes)"]);
  });

  it.todo("should handle installing workspaces with absolute glob patterns", async () => {
    const package_dir = tempDirWithFiles("absolute-glob", {
      "package.json": base =>
        JSON.stringify({
          name: "package3",
          version: "0.0.1",
          workspaces: [join(base, "packages/**/*")],
        }),
      "packages": {
        "frontend": {
          "package.json": JSON.stringify({
            name: "frontend",
            version: "0.0.1",
            dependencies: {
              "types": "workspace:*",
              "components": "workspace:*",
            },
          }),
          "components": {
            "package.json": JSON.stringify({
              name: "components",
              version: "0.0.1",
              dependencies: {
                "types": "workspace:*",
              },
            }),
          },
        },
        "backend": {
          "package.json": JSON.stringify({
            name: "backend",
            version: "0.0.1",
            dependencies: {
              "types": "workspace:*",
            },
          }),
        },
        "types": {
          "package.json": JSON.stringify({
            name: "types",
            version: "0.0.1",
            dependencies: {},
          }),
        },
      },
    });
    console.log("TEMP DIR", package_dir);

    const { stdout, stderr } = await Bun.$`${bunExe()} install`.env(env).cwd(package_dir).throws(true);
    const err1 = stderr.toString();
    expect(err1).toContain("Saved lockfile");
    expect(
      stdout
        .toString()
        .replace(/\s*\[[0-9\.]+m?s\]\s*$/, "")
        .split(/\r?\n/),
    ).toEqual([expect.stringContaining("bun install v1."), "", "4 packages installed"]);
  });

  it("should handle installing packages inside workspaces with difference versions", async () => {
    await withContext(defaultOpts, async ctx => {
      let package_jsons = [
        JSON.stringify({
          name: "main",
          workspaces: ["packages/*"],
          private: true,
        }),
        JSON.stringify({
          name: "main",
          private: true,
          workspaces: [
            "packages/package1",
            "packages/package2",
            "packages/package3",
            "packages/package4",
            "packages/package5",
          ],
        }),
      ];
      await mkdir(join(ctx.package_dir, "packages", "package1"), { recursive: true });
      await mkdir(join(ctx.package_dir, "packages", "package2"));
      await mkdir(join(ctx.package_dir, "packages", "package3"));
      await mkdir(join(ctx.package_dir, "packages", "package4"));
      await mkdir(join(ctx.package_dir, "packages", "package5"));
      {
        const package1 = JSON.stringify({
          name: "package1",
          version: "0.0.2",
        });
        await writeFile(join(ctx.package_dir, "packages", "package1", "package.json"), package1);
      }
      {
        const package2 = JSON.stringify({
          name: "package2",
          version: "0.0.1",
          dependencies: {
            package1: "workspace:*",
          },
        });
        await writeFile(join(ctx.package_dir, "packages", "package2", "package.json"), package2);
      }
      {
        const package3 = JSON.stringify({
          name: "package3",
          version: "0.0.1",
          dependencies: {
            package1: "workspace:^",
          },
        });
        await writeFile(join(ctx.package_dir, "packages", "package3", "package.json"), package3);
      }
      {
        const package4 = JSON.stringify({
          name: "package4",
          version: "0.0.1",
          dependencies: {
            package1: "workspace:../package1",
          },
        });
        await writeFile(join(ctx.package_dir, "packages", "package4", "package.json"), package4);
      }
      {
        const package5 = JSON.stringify({
          name: "package5",
          version: "0.0.1",
          dependencies: {
            package1: "workspace:0.0.2",
          },
        });
        await writeFile(join(ctx.package_dir, "packages", "package5", "package.json"), package5);
      }
      for (const package_json of package_jsons) {
        await writeFile(join(ctx.package_dir, "package.json"), package_json);

        {
          const package1 = JSON.stringify({
            name: "package1",
            version: "0.0.2",
          });
          await writeFile(join(ctx.package_dir, "packages", "package1", "package.json"), package1);
        }
        {
          const package2 = JSON.stringify({
            name: "package2",
            version: "0.0.1",
            dependencies: {
              package1: "workspace:*",
            },
          });
          await writeFile(join(ctx.package_dir, "packages", "package2", "package.json"), package2);
        }
        {
          const package3 = JSON.stringify({
            name: "package3",
            version: "0.0.1",
            dependencies: {
              package1: "workspace:^",
            },
          });
          await writeFile(join(ctx.package_dir, "packages", "package3", "package.json"), package3);
        }
        {
          const package4 = JSON.stringify({
            name: "package4",
            version: "0.0.1",
            dependencies: {
              package1: "workspace:../package1",
            },
          });
          await writeFile(join(ctx.package_dir, "packages", "package4", "package.json"), package4);
        }
        {
          const package5 = JSON.stringify({
            name: "package5",
            version: "0.0.1",
            dependencies: {
              package1: "workspace:0.0.2",
            },
          });
          await writeFile(join(ctx.package_dir, "packages", "package5", "package.json"), package5);
        }

        const {
          stdout: stdout1,
          stderr: stderr1,
          exited: exited1,
        } = spawn({
          cmd: [bunExe(), "install"],
          cwd: join(ctx.package_dir, "packages", "package2"),
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });
        const err1 = await new Response(stderr1).text();
        expect(err1).toContain("Saved lockfile");
        const out1 = await new Response(stdout1).text();
        expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          `+ package1@workspace:packages/package1`,
          "",
          "5 packages installed",
        ]);
        expect(await exited1).toBe(0);
        await access(join(ctx.package_dir, "bun.lockb"));

        var urls: string[] = [];
        setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

        const {
          stdout: stdout1_2,
          stderr: stderr1_2,
          exited: exited1_2,
        } = spawn({
          cmd: [bunExe(), "install", "bar"],
          cwd: join(ctx.package_dir, "packages", "package2"),
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });
        const err1_2 = await new Response(stderr1_2).text();
        expect(err1_2).toContain("Saved lockfile");
        const out1_2 = await new Response(stdout1_2).text();
        expect(out1_2).toContain("installed bar");
        expect(await exited1_2).toBe(0);
        expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
        await access(join(ctx.package_dir, "bun.lockb"));

        await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
        await rm(join(ctx.package_dir, "bun.lockb"), { force: true, recursive: true });

        const {
          stdout: stdout2,
          stderr: stderr2,
          exited: exited2,
        } = spawn({
          cmd: [bunExe(), "install"],
          cwd: join(ctx.package_dir, "packages", "package3"),
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });
        const err2 = await new Response(stderr2).text();
        expect(err2).toContain("Saved lockfile");
        const out2 = await new Response(stdout2).text();
        expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          `+ package1@workspace:packages/package1`,
          "",
          "6 packages installed",
        ]);
        expect(await exited2).toBe(0);

        const {
          stdout: stdout2_2,
          stderr: stderr2_2,
          exited: exited2_2,
        } = spawn({
          cmd: [bunExe(), "install", "bar"],
          cwd: join(ctx.package_dir, "packages", "package3"),
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });
        const err2_2 = await new Response(stderr2_2).text();
        expect(err2_2).toContain("Saved lockfile");
        const out2_2 = await new Response(stdout2_2).text();
        expect(out2_2).toContain("installed bar");
        expect(await exited2_2).toBe(0);
        await access(join(ctx.package_dir, "bun.lockb"));

        await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
        await rm(join(ctx.package_dir, "bun.lockb"), { force: true, recursive: true });

        const {
          stdout: stdout3,
          stderr: stderr3,
          exited: exited3,
        } = spawn({
          cmd: [bunExe(), "install"],
          cwd: join(ctx.package_dir, "packages", "package4"),
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });
        const err3 = await new Response(stderr3).text();
        expect(err3).toContain("Saved lockfile");
        const out3 = await new Response(stdout3).text();
        expect(out3.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          `+ package1@workspace:packages/package1`,
          "",
          "6 packages installed",
        ]);
        expect(await exited3).toBe(0);

        const {
          stdout: stdout3_2,
          stderr: stderr3_2,
          exited: exited3_2,
        } = spawn({
          cmd: [bunExe(), "install", "bar"],
          cwd: join(ctx.package_dir, "packages", "package4"),
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });
        const err3_2 = await new Response(stderr3_2).text();
        expect(err3_2).toContain("Saved lockfile");
        const out3_2 = await new Response(stdout3_2).text();
        expect(out3_2).toContain("installed bar");
        expect(await exited3_2).toBe(0);
        await access(join(ctx.package_dir, "bun.lockb"));

        await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
        await rm(join(ctx.package_dir, "bun.lockb"), { force: true, recursive: true });

        const {
          stdout: stdout4,
          stderr: stderr4,
          exited: exited4,
        } = spawn({
          cmd: [bunExe(), "install"],
          cwd: join(ctx.package_dir, "packages", "package5"),
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });
        const err4 = await new Response(stderr4).text();
        expect(err4).toContain("Saved lockfile");
        const out4 = await new Response(stdout4).text();
        expect(out4.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          `+ package1@workspace:packages/package1`,
          "",
          "6 packages installed",
        ]);
        expect(await exited4).toBe(0);

        const {
          stdout: stdout4_2,
          stderr: stderr4_2,
          exited: exited4_2,
        } = spawn({
          cmd: [bunExe(), "install", "bar"],
          cwd: join(ctx.package_dir, "packages", "package5"),
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });
        const err4_2 = await new Response(stderr4_2).text();
        expect(err4_2).toContain("Saved lockfile");
        const out4_2 = await new Response(stdout4_2).text();
        expect(out4_2).toContain("installed bar");
        expect(await exited4_2).toBe(0);
        await access(join(ctx.package_dir, "bun.lockb"));

        // from the root
        await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
        await rm(join(ctx.package_dir, "bun.lockb"), { force: true, recursive: true });

        const {
          stdout: stdout5,
          stderr: stderr5,
          exited: exited5,
        } = spawn({
          cmd: [bunExe(), "install"],
          cwd: join(ctx.package_dir),
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });
        const err5 = await new Response(stderr5).text();
        expect(err5).toContain("Saved lockfile");
        const out5 = await new Response(stdout5).text();
        expect(out5.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          "6 packages installed",
        ]);
        expect(await exited5).toBe(0);

        const {
          stdout: stdout5_2,
          stderr: stderr5_2,
          exited: exited5_2,
        } = spawn({
          cmd: [bunExe(), "install", "bar"],
          cwd: join(ctx.package_dir),
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });
        const err5_2 = await new Response(stderr5_2).text();
        expect(err5_2).toContain("Saved lockfile");
        const out5_2 = await new Response(stdout5_2).text();
        expect(out5_2).toContain("installed bar");
        expect(await exited5_2).toBe(0);
        await access(join(ctx.package_dir, "bun.lockb"));

        await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
        await rm(join(ctx.package_dir, "bun.lockb"), { force: true, recursive: true });
        await rm(join(ctx.package_dir, "package.json"));
      }
    });
  });

  it("should override npm dependency by matching workspace", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["*"],
          dependencies: {
            bar: "*",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      const bar_package = JSON.stringify({
        name: "bar",
        version: "0.0.1",
      });
      await writeFile(join(ctx.package_dir, "bar", "package.json"), bar_package);
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@workspace:bar",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(join("..", "bar"));
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).text()).toEqual(bar_package);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should not override npm dependency by workspace with mismatched version", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["*"],
          dependencies: {
            bar: "^0.0.2",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      const bar_package = JSON.stringify({
        name: "bar",
        version: "0.0.1",
      });
      await writeFile(join(ctx.package_dir, "bar", "package.json"), bar_package);
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
    });
  });

  it("should override @scoped npm dependency by matching workspace", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["packages/*"],
          dependencies: {
            "@bar/baz": "^0.1",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "packages", "bar-baz"), { recursive: true });
      const baz_package = JSON.stringify({
        name: "@bar/baz",
        version: "0.1.2",
      });
      await writeFile(join(ctx.package_dir, "packages", "bar-baz", "package.json"), baz_package);
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ @bar/baz@workspace:packages/bar-baz`,
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "@bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@bar"))).toEqual(["baz"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "@bar", "baz"))).toBeWorkspaceLink(
        join("..", "..", "packages", "bar-baz"),
      );
      expect(await file(join(ctx.package_dir, "node_modules", "@bar", "baz", "package.json")).text()).toEqual(
        baz_package,
      );
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should override aliased npm dependency by matching workspace", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["*"],
          dependencies: {
            bar: "npm:baz@<0.0.2",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "baz"));
      const baz_package = JSON.stringify({
        name: "baz",
        version: "0.0.1",
      });
      await writeFile(join(ctx.package_dir, "baz", "package.json"), baz_package);
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@workspace:baz",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar", "baz"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(join("..", "baz"));
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).text()).toEqual(baz_package);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should override child npm dependency by matching workspace", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["*"],
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      const bar_package = JSON.stringify({
        name: "bar",
        version: "0.0.1",
      });
      await writeFile(join(ctx.package_dir, "bar", "package.json"), bar_package);
      await mkdir(join(ctx.package_dir, "baz"));
      await writeFile(
        join(ctx.package_dir, "baz", "package.json"),
        JSON.stringify({
          name: "baz",
          version: "0.1.0",
          dependencies: {
            bar: "*",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar", "baz"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(join("..", "bar"));
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).text()).toEqual(bar_package);
      expect(await readlink(join(ctx.package_dir, "node_modules", "baz"))).toBeWorkspaceLink(join("..", "baz"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["package.json"]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should not override child npm dependency by workspace with mismatched version", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["*"],
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      const bar_package = JSON.stringify({
        name: "bar",
        version: "0.0.1",
      });
      await writeFile(join(ctx.package_dir, "bar", "package.json"), bar_package);
      await mkdir(join(ctx.package_dir, "baz"));
      await writeFile(
        join(ctx.package_dir, "baz", "package.json"),
        JSON.stringify({
          name: "baz",
          version: "0.1.0",
          dependencies: {
            bar: "^0.0.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "3 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar", "baz"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(join("..", "bar"));
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).text()).toEqual(bar_package);
      expect(await readlink(join(ctx.package_dir, "node_modules", "baz"))).toBeWorkspaceLink(join("..", "baz"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz", "node_modules"))).toEqual(["bar"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz", "node_modules", "bar"))).toEqual([
        "package.json",
      ]);
      expect(
        await file(join(ctx.package_dir, "node_modules", "baz", "node_modules", "bar", "package.json")).json(),
      ).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should override @scoped child npm dependency by matching workspace", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["packages/*"],
        }),
      );
      await mkdir(join(ctx.package_dir, "packages", "moo-bar"), { recursive: true });
      const bar_package = JSON.stringify({
        name: "@moo/bar",
        version: "1.2.3",
      });
      await writeFile(join(ctx.package_dir, "packages", "moo-bar", "package.json"), bar_package);
      await mkdir(join(ctx.package_dir, "packages", "moo-baz"), { recursive: true });
      await writeFile(
        join(ctx.package_dir, "packages", "moo-baz", "package.json"),
        JSON.stringify({
          name: "@moo/baz",
          dependencies: {
            "@moo/bar": "1.x",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "@moo"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@moo"))).toEqual(["bar", "baz"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "@moo", "bar"))).toBeWorkspaceLink(
        join("..", "..", "packages", "moo-bar"),
      );
      expect(await file(join(ctx.package_dir, "node_modules", "@moo", "bar", "package.json")).text()).toEqual(
        bar_package,
      );
      expect(await readlink(join(ctx.package_dir, "node_modules", "@moo", "baz"))).toBeWorkspaceLink(
        join("..", "..", "packages", "moo-baz"),
      );
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@moo", "baz"))).toEqual(["package.json"]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should override aliased child npm dependency by matching workspace", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["packages/*"],
        }),
      );
      await mkdir(join(ctx.package_dir, "packages", "bar"), { recursive: true });
      const bar_package = JSON.stringify({
        name: "@moo/bar",
        version: "0.0.1",
      });
      await writeFile(join(ctx.package_dir, "packages", "bar", "package.json"), bar_package);
      await mkdir(join(ctx.package_dir, "packages", "baz"), { recursive: true });
      await writeFile(
        join(ctx.package_dir, "packages", "baz", "package.json"),
        JSON.stringify({
          name: "baz",
          version: "0.1.0",
          dependencies: {
            bar: "npm:@moo/bar@*",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "@moo", "bar", "baz"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@moo"))).toEqual(["bar"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "@moo", "bar"))).toBeWorkspaceLink(
        join("..", "..", "packages", "bar"),
      );
      expect(await file(join(ctx.package_dir, "node_modules", "@moo", "bar", "package.json")).text()).toEqual(
        bar_package,
      );
      expect(await readlink(join(ctx.package_dir, "node_modules", "baz"))).toBeWorkspaceLink(
        join("..", "packages", "baz"),
      );
      expect(await readdirSorted(join(ctx.package_dir, "packages", "baz"))).toEqual(["package.json"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(
        join("..", "packages", "bar"),
      );
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle `workspace:` with semver range", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["bar", "baz"],
        }),
      );
      await mkdir(join(ctx.package_dir, "bar"));
      const bar_package = JSON.stringify({
        name: "bar",
        version: "0.0.1",
      });
      await writeFile(join(ctx.package_dir, "bar", "package.json"), bar_package);
      await mkdir(join(ctx.package_dir, "baz"));
      await writeFile(
        join(ctx.package_dir, "baz", "package.json"),
        JSON.stringify({
          name: "baz",
          version: "0.1.0",
          dependencies: {
            bar: "workspace:~0.0.1",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar", "baz"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(join("..", "bar"));
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).text()).toEqual(bar_package);
      expect(await readlink(join(ctx.package_dir, "node_modules", "baz"))).toBeWorkspaceLink(join("..", "baz"));
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["package.json"]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle `workspace:` with alias & @scope", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["packages/*"],
        }),
      );
      await mkdir(join(ctx.package_dir, "packages", "bar"), { recursive: true });
      const bar_package = JSON.stringify({
        name: "@moo/bar",
        version: "0.1.2",
      });
      await writeFile(join(ctx.package_dir, "packages", "bar", "package.json"), bar_package);
      await mkdir(join(ctx.package_dir, "packages", "baz"), { recursive: true });
      await writeFile(
        join(ctx.package_dir, "packages", "baz", "package.json"),
        JSON.stringify({
          name: "@moz/baz",
          dependencies: {
            "@moz/bar": "workspace:@moo/bar@>=0.1",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "@moo", "@moz"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@moo"))).toEqual(["bar"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "@moo", "bar"))).toBeWorkspaceLink(
        join("..", "..", "packages", "bar"),
      );
      expect(await file(join(ctx.package_dir, "node_modules", "@moo", "bar", "package.json")).text()).toEqual(
        bar_package,
      );
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@moz"))).toEqual(["bar", "baz"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "@moz", "baz"))).toBeWorkspaceLink(
        join("..", "..", "packages", "baz"),
      );
      expect(await readlink(join(ctx.package_dir, "node_modules", "@moz", "bar"))).toBeWorkspaceLink(
        join("..", "..", "packages", "bar"),
      );
      expect(await readdirSorted(join(ctx.package_dir, "packages", "baz"))).toEqual(["package.json"]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle `workspace:*` on both root & child", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["packages/*"],
          dependencies: {
            bar: "workspace:*",
          },
        }),
      );
      await mkdir(join(ctx.package_dir, "packages", "bar"), { recursive: true });
      const bar_package = JSON.stringify({
        name: "bar",
        version: "0.1.2",
      });
      await writeFile(join(ctx.package_dir, "packages", "bar", "package.json"), bar_package);
      await mkdir(join(ctx.package_dir, "packages", "baz"), { recursive: true });
      const baz_package = JSON.stringify({
        name: "baz",
        version: "1.2.3",
        devDependencies: {
          bar: "workspace:*",
        },
      });
      await writeFile(join(ctx.package_dir, "packages", "baz", "package.json"), baz_package);
      const {
        stdout: stdout1,
        stderr: stderr1,
        exited: exited1,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
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
        `+ bar@workspace:packages/bar`,
        "",
        "2 packages installed",
      ]);
      expect(await exited1).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar", "baz"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(
        join("..", "packages", "bar"),
      );
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).text()).toEqual(bar_package);
      expect(await readlink(join(ctx.package_dir, "node_modules", "baz"))).toBeWorkspaceLink(
        join("..", "packages", "baz"),
      );
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).text()).toEqual(baz_package);
      await access(join(ctx.package_dir, "bun.lockb"));
      // Perform `bun install` again but with lockfile from before
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      const {
        stdout: stdout2,
        stderr: stderr2,
        exited: exited2,
      } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err2 = await new Response(stderr2).text();
      expect(err2).not.toContain("error:");
      const out2 = await new Response(stdout2).text();
      expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ bar@workspace:packages/bar`,
        "",
        "2 packages installed",
      ]);
      expect(await exited2).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "bar", "baz"]);
      expect(await readlink(join(ctx.package_dir, "node_modules", "bar"))).toBeWorkspaceLink(
        join("..", "packages", "bar"),
      );
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).text()).toEqual(bar_package);
      expect(await readlink(join(ctx.package_dir, "node_modules", "baz"))).toBeWorkspaceLink(
        join("..", "packages", "baz"),
      );
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["package.json"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).text()).toEqual(baz_package);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should install peer dependencies from root package", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          peerDependencies: {
            bar: "0.0.2",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        env,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ bar@0.0.2",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);

      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should install correct version of peer dependency from root package", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": { as: "0.0.3" },
          "0.0.5": { as: "0.0.5" },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies: {
            baz: "0.0.3",
          },
          peerDependencies: {
            baz: "0.0.5",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        env,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("+ baz@0.0.3"),
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(ctx.requested).toBe(2);

      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  describe("Registry URLs", () => {
    // Some of the non failing URLs are invalid, but bun's URL parser ignores
    // the validation error and returns a valid serialized URL anyway.
    const registryURLs: [url: string, fails: boolean | -1][] = [
      ["asdfghjklqwertyuiop", true],
      ["                ", true],
      ["::::::::::::::::", true],
      ["https://ex ample.org/", true],
      ["example", true],
      ["https://example.com:demo", true],
      ["http://[www.example.com]/", true],
      ["c:a", true],
      ["https://registry.npmjs.org/", false],
      ["http://artifactory.xxx.yyy/artifactory/api/npm/my-npm/", false], // https://github.com/oven-sh/bun/issues/3899
      ["http://artifactory.xxx.yyy/artifactory/api/npm/my-npm", false], // https://github.com/oven-sh/bun/issues/5368
      // ["", true],
      ["https:example.org", false],
      ["https://////example.com///", false],
      ["https://example.com/https:example.org", false],
      ["https://example.com/[]?[]#[]", false],
      ["http://example/%?%#%", false],
      ["c:", true],
      ["c:/", -1],
      ["http://點看", false], // gets converted to punycode
      ["http://xn--c1yn36f/", false],
    ];

    for (const entry of registryURLs) {
      const regURL = entry[0];
      const fails = entry[1];

      it(
        `should ${fails ? "fail" : "handle"} joining registry and package URLs (${regURL})`,
        async () => {
          await withContext(defaultOpts, async ctx => {
            await writeFile(join(ctx.package_dir, "bunfig.toml"), `[install]\ncache = false\nregistry = "${regURL}"`);

            await writeFile(
              join(ctx.package_dir, "package.json"),
              JSON.stringify({
                name: "foo",
                version: "0.0.1",
                dependencies: {
                  notapackage: "0.0.2",
                },
              }),
            );

            const { stdout, stderr, exited } = spawn({
              cmd: [bunExe(), "install"],
              cwd: ctx.package_dir,
              stdout: "pipe",
              stdin: "pipe",
              stderr: "pipe",
              env,
            });
            expect(await stdout.text()).toEqual(expect.stringContaining("bun install v1."));

            const err = await stderr.text();

            if (fails === -1) {
              expect(err).toContain(`Registry URL must be http:// or https://`);
            } else if (fails) {
              expect(err).toContain(`Failed to join registry "${regURL}" and package "notapackage" URLs`);
            } else {
              expect(err).toContain("error: notapackage@0.0.2 failed to resolve");
            }
            // fails either way, since notapackage is, well, not a real package.
            expect(await exited).not.toBe(0);
          });
        },
        Infinity,
      );
    }

    it("shouldn't fail joining invalid registry and package URLs for optional dependencies", async () => {
      await withContext(defaultOpts, async ctx => {
        const regURL = "asdfghjklqwertyuiop";

        await writeFile(join(ctx.package_dir, "bunfig.toml"), `[install]\ncache = false\nregistry = "${regURL}"`);

        await writeFile(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({
            name: "foo",
            version: "0.0.1",
            optionalDependencies: {
              notapackage: "0.0.2",
            },
          }),
        );

        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });
        expect(await stdout.text()).not.toBeEmpty();

        const err = await stderr.text();

        expect(err).toContain(`Failed to join registry "${regURL}" and package "notapackage" URLs`);

        expect(await exited).toBe(0);
      });
    });

    // TODO: This test should fail if the param `warn_on_error` is true in
    // `(install.zig).NetworkTask.forManifest()`. Unfortunately, that
    // code never gets run for peer dependencies unless you do some package
    // manifest magic. I doubt it'd ever fail, but having a dedicated
    // test would be nice.
    test.todo("shouldn't fail joining invalid registry and package URLs for peer dependencies", async () => {
      const regURL = "asdfghjklqwertyuiop";

      await writeFile(join(ctx.package_dir, "bunfig.toml"), `[install]\ncache = false\nregistry = "${regURL}"`);

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          peerDependencies: {
            notapackage: "0.0.2",
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      expect(await stdout.text()).not.toBeEmpty();

      const err = await stderr.text();

      expect(err).toContain(`Failed to join registry "${regURL}" and package "notapackage" URLs`);
      expect(err).toContain("warn: InvalidURL");

      expect(await exited).toBe(0);
    });
  });

  it("should ensure read permissions of all extracted files", async () => {
    await withContext(defaultOpts, async ctx => {
      await Promise.all([
        cp(join(import.meta.dir, "pkg-only-owner-2.2.2.tgz"), join(ctx.package_dir, "pkg-only-owner-2.2.2.tgz")),
        writeFile(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({
            name: "foo",
            version: "0.0.1",
            dependencies: {
              "pkg-only-owner": "file:pkg-only-owner-2.2.2.tgz",
            },
          }),
        ),
      ]);

      await runBunInstall(env, ctx.package_dir);

      expect((await stat(join(ctx.package_dir, "node_modules", "pkg-only-owner", "package.json"))).mode & 0o444).toBe(
        0o444,
      );
      expect(
        (await stat(join(ctx.package_dir, "node_modules", "pkg-only-owner", "src", "index.js"))).mode & 0o444,
      ).toBe(0o444);
    });
  });

  it("should handle @scoped name that contains tilde, issue#7045", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "bunfig.toml"),
        `
  [install]
  cache = false
  `,
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "@~39/empty"],
        cwd: ctx.package_dir,
        stdin: null,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      expect(await stderr.text()).toContain("Saved lockfile");
      expect(await stdout.text()).toContain("installed @~39/empty@1.0.0");
      expect(await exited).toBe(0);
    });
  });

  test.serial("should handle modified git resolutions in bun.lock", async () => {
    await withContext(defaultOpts, async ctx => {
      // install-test-8 has a dependency but because it's not in the lockfile
      // it won't be included in the install.
      await Promise.all([
        write(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({
            name: "foo",
            version: "0.0.1",
            dependencies: {
              "jquery": "3.7.1",
            },
          }),
        ),
        write(
          join(ctx.package_dir, "bun.lock"),
          JSON.stringify({
            "lockfileVersion": 0,
            "configVersion": 1,
            "workspaces": {
              "": {
                "dependencies": {
                  "jquery": "3.7.1",
                },
              },
            },
            "packages": {
              "jquery": [
                "jquery@git+ssh://git@github.com/dylan-conway/install-test-8.git#3a1288830817d13da39e9231302261896f8721ea",
                {},
                "3a1288830817d13da39e9231302261896f8721ea",
              ],
            },
          }),
        ),
      ]);

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });

      const err = await stderr.text();
      const out = await stdout.text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("error:");

      expect(out).toContain("1 package installed");
      expect(await exited).toBe(0);

      expect(
        (await file(join(ctx.package_dir, "bun.lock")).text()).replaceAll(/localhost:\d+/g, "localhost:1234"),
      ).toMatchSnapshot();
    });
  });

  it("should read install.saveTextLockfile from bunfig.toml", async () => {
    await withContext(defaultOpts, async ctx => {
      await Promise.all([
        write(
          join(ctx.package_dir, "bunfig.toml"),
          `
  [install]
  cache = false
  registry = "${ctx.registry_url}"
  saveTextLockfile = true
  `,
        ),
        write(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({
            name: "foo",
            workspaces: ["packages/*"],
            dependencies: {
              "pkg-one": "workspace:*",
            },
          }),
        ),
        write(
          join(ctx.package_dir, "packages", "pkg1", "package.json"),
          JSON.stringify({
            name: "pkg-one",
            version: "1.0.0",
          }),
        ),
      ]);

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });

      const err = await stderr.text();
      expect(err).not.toContain("error:");
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out).toContain("Checked 3 installs across 2 packages (no changes)");

      expect(await exited).toBe(0);
      expect(await Bun.file(join(ctx.package_dir, "node_modules", "pkg-one", "package.json")).json()).toEqual({
        name: "pkg-one",
        version: "1.0.0",
      });
      expect(await exists(join(ctx.package_dir, "bun.lockb"))).toBeFalse();
      expect(await file(join(ctx.package_dir, "bun.lock")).text()).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 1,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "foo",
            "dependencies": {
              "pkg-one": "workspace:*",
            },
          },
          "packages/pkg1": {
            "name": "pkg-one",
            "version": "1.0.0",
          },
        },
        "packages": {
          "pkg-one": ["pkg-one@workspace:packages/pkg1"],
        }
      }
      "
    `);
    });
  });

  test("providing invalid url in lockfile does not crash", async () => {
    await withContext(defaultOpts, async ctx => {
      await Promise.all([
        write(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({
            dependencies: {
              "jquery": "3.7.1",
            },
          }),
        ),
        write(
          join(ctx.package_dir, "bun.lock"),
          textLockfile(0, {
            "workspaces": {
              "": {
                "dependencies": {
                  "jquery": "3.7.1",
                },
              },
            },
            "packages": {
              "jquery": [
                "jquery@3.7.1",
                "invalid-url",
                {},
                "sha512-+LGRog6RAsCJrrrg/IO6LGmpphNe5DiK30dGjCoxxeGv49B10/3XYGxPsAwrDlMFcFEvdAUavDT8r9k/hSyQqQ==",
              ],
            },
          }),
        ),
      ]);

      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stderr: "pipe",
        env,
      });

      const err = await stderr.text();
      expect(err).toContain(
        'error: Expected tarball URL to start with https:// or http://, got "invalid-url" while fetching package "jquery"',
      );
      expect(await exited).toBe(1);
    });
  });

  test("optional dependencies do not need to be resolvable in text lockfile", async () => {
    await withContext(defaultOpts, async ctx => {
      await Promise.all([
        write(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({
            optionalDependencies: {
              jquery: "3.7.1",
            },
          }),
        ),
        write(
          join(ctx.package_dir, "bun.lock"),
          textLockfile(0, {
            "workspaces": {
              "": {
                "optionalDependencies": {
                  "jquery": "3.7.1",
                },
              },
            },
            "packages": {},
          }),
        ),
      ]);

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });

      const err = await stderr.text();
      expect(err).not.toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out).not.toContain("1 package installed");

      expect(await exited).toBe(0);
    });
  });

  test("non-optional dependencies need to be resolvable in text lockfile", async () => {
    await withContext(defaultOpts, async ctx => {
      await Promise.all([
        write(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({
            dependencies: {
              jquery: "3.7.1",
            },
          }),
        ),
        write(
          join(ctx.package_dir, "bun.lock"),
          textLockfile(0, {
            workspaces: {
              "": {
                dependencies: {
                  "jquery": "3.7.1",
                },
              },
            },
            packages: {},
          }),
        ),
      ]);

      const { stdout, stderr, exited } = spawn({
        // --production to fail early
        cmd: [bunExe(), "install", "--production"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });

      const err = await stderr.text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).toContain("error: Failed to resolve root prod dependency 'jquery'");
      const out = await stdout.text();
      expect(out).not.toContain("1 package installed");

      expect(await exited).toBe(1);
    });
  });
});
