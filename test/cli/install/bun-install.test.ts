import { file, listen, Socket, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, it, jest, setDefaultTimeout, test } from "bun:test";
import { readFileSync, readlinkSync, realpathSync, statSync } from "fs";
import { access, cp, exists, mkdir, readlink, rm, stat, writeFile } from "fs/promises";
import {
  bunEnv,
  bunExe,
  bunEnv as env,
  isWindows,
  joinP,
  normalizeBunSnapshot,
  readdirCacheSorted,
  readdirSorted,
  runBunInstall,
  tempDir,
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
import { constructStdCollision } from "./wyhash-std-collision.js";

expect.extend({
  toBeWorkspaceLink,
  toBeValidBin,
  toHaveBins,
  toHaveWorkspaceLink: function (package_dir: string, [link, real]: [string, string]) {
    const target = readlinkSync(join(package_dir, "node_modules", link));
    return toBeWorkspaceLink(target, isWindows ? join(package_dir, real) : join("..", real));
  },
  toHaveWorkspaceLink2: function (package_dir: string, [link, realPosix, realWin]: [string, string, string]) {
    const target = readlinkSync(join(package_dir, "node_modules", link));
    return toBeWorkspaceLink(target, isWindows ? join(package_dir, realWin) : join("..", realPosix));
  },
});

setDefaultTimeout(1000 * 60 * 5);

beforeAll(() => {
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

const gitEnv = {
  ...bunEnv,
  GIT_AUTHOR_NAME: "bun-test",
  GIT_AUTHOR_EMAIL: "bun-test@example.com",
  GIT_COMMITTER_NAME: "bun-test",
  GIT_COMMITTER_EMAIL: "bun-test@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
};

async function git(cwd: string, args: string[], stdin?: string): Promise<string> {
  await using proc = spawn({
    cmd: ["git", ...args],
    cwd,
    env: gitEnv,
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} exited with ${exitCode}: ${stderr}`);
  }
  return stdout.trim();
}

async function createDumbHttpGitRepo(dir: string, symlinks: Record<string, string>): Promise<string> {
  const work = join(dir, "work");
  await git(work, ["-c", "init.defaultBranch=main", "init", "--quiet"]);
  await git(work, ["add", "-A"]);
  for (const [path, target] of Object.entries(symlinks)) {
    const oid = await git(work, ["hash-object", "-w", "--no-filters", "--stdin"], target);
    await git(work, ["update-index", "--add", "--cacheinfo", `120000,${oid},${path}`]);
  }
  await git(work, ["-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "init"]);
  const sha = await git(work, ["rev-parse", "HEAD"]);
  await git(dir, ["clone", "--quiet", "--bare", "work", "repo.git"]);
  await git(join(dir, "repo.git"), ["update-server-info"]);
  return sha;
}

function serveDirectory(root: string) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const path = join(root, decodeURIComponent(new URL(req.url).pathname));
      if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
        return new Response(null, { status: 404 });
      }
      return new Response(file(path));
    },
  });
}

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
        Bun.TOML.stringify({
          install: {
            cache: false,
            registry: `http://${server.hostname}:${server.port}/`,
          },
        }),
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
    await using package_dir = tempDir("lol", {
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
    await using package_dir = tempDir("lol", {
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

  // The Rust port adds a same-origin guard in `NetworkTask::for_tarball` so a
  // malicious registry can't point `dist.tarball` at a third-party host and
  // harvest the scope's `Authorization` header. The guard must compare
  // (protocol, hostname, effective port) — not the raw `URL.origin` slice —
  // because some registries emit `dist.tarball` URLs with the scheme's
  // default port spelled out (`https://host:443/...`) while the `.npmrc`
  // registry URL has no port; the raw slices differ but the origin is the
  // same, and the tarball request must still carry the token.
  it("should send .npmrc _authToken on same-origin tarball download and withhold it cross-origin", async () => {
    const token = "secret-registry-token";
    const tgz = join(import.meta.dir, "registry", "packages", "no-deps", "no-deps-1.0.0.tgz");
    const integrity = "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==";

    const sameOriginAuth: (string | null)[] = [];
    const crossOriginAuth: (string | null)[] = [];

    // "attacker" server on a different port — registry credentials must NOT
    // reach this host even though the registry's own manifest points here.
    await using attacker = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        crossOriginAuth.push(req.headers.get("authorization"));
        return new Response(Bun.file(tgz));
      },
    });

    await using registry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/same-origin") {
          return Response.json({
            name: "same-origin",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "same-origin",
                version: "1.0.0",
                dist: {
                  integrity,
                  tarball: `http://127.0.0.1:${registry.port}/same-origin/-/same-origin-1.0.0.tgz`,
                },
              },
            },
          });
        }
        if (url.pathname === "/cross-origin") {
          return Response.json({
            name: "cross-origin",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "cross-origin",
                version: "1.0.0",
                dist: {
                  integrity,
                  tarball: `http://127.0.0.1:${attacker.port}/cross-origin/-/cross-origin-1.0.0.tgz`,
                },
              },
            },
          });
        }
        if (url.pathname.endsWith(".tgz")) {
          sameOriginAuth.push(req.headers.get("authorization"));
          return new Response(Bun.file(tgz));
        }
        return new Response("not found", { status: 404 });
      },
    });

    using dir = tempDir("tarball-auth-origin", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "same-origin": "1.0.0", "cross-origin": "1.0.0" },
      }),
      ".npmrc": [
        `registry=http://127.0.0.1:${registry.port}/`,
        `//127.0.0.1:${registry.port}/:_authToken=${token}`,
        ``,
      ].join("\n"),
    });

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stderr, sameOriginAuth, crossOriginAuth }).toEqual({
      stderr: expect.stringContaining("Saved lockfile"),
      // same-origin tarball request carries the token
      sameOriginAuth: [`Bearer ${token}`],
      // cross-origin tarball request must not leak the token
      crossOriginAuth: [null],
    });
    expect(stdout).toContain("2 packages installed");
    expect(exitCode).toBe(0);
  });

  // A tarball URL with credentials in it is downloaded the way npm downloads
  // it: the userinfo becomes `Authorization: Basic base64(user:pass)` and the
  // request goes to the URL without it (`NetworkTask::for_tarball`).
  describe.concurrent("credentials embedded in a tarball URL", () => {
    const tgz = join(import.meta.dir, "registry", "packages", "no-deps", "no-deps-1.0.0.tgz");
    const tarballPath = "/cdn/no-deps-1.0.0.tgz";
    const basic = (userPass: string) => `Basic ${Buffer.from(userPass).toString("base64")}`;
    const installed = {
      stdout: expect.stringContaining("1 package installed"),
      stderr: expect.stringContaining("Saved lockfile"),
      exitCode: 0,
    };

    type Received = { url: string; authorization: string | null };

    function recording(received: Received[], handler: (req: Request, server: { port: number }) => Response) {
      return (req: Request, server: { port: number }) => {
        received.push({ url: req.url, authorization: req.headers.get("authorization") });
        return handler(req, server);
      };
    }

    // Serves `tgz` to `.tgz` requests carrying exactly `authorization` and
    // answers 401 to the others. A request under `/redirect/` is first
    // redirected to `redirectTo`, or to the same file under `/cdn/`.
    function serveTarball(received: Received[], authorization: string | null, redirectTo?: string) {
      return Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: recording(received, (req, server) => {
          const { pathname } = new URL(req.url);
          if (pathname.startsWith("/redirect/")) {
            const name = pathname.slice("/redirect/".length);
            return Response.redirect(redirectTo ?? `http://127.0.0.1:${server.port}/cdn/${name}`, 302);
          }
          if (req.headers.get("authorization") !== authorization) {
            return new Response("unauthorized", { status: 401 });
          }
          return new Response(file(tgz));
        }),
      });
    }

    // `bun install` of a project whose only dependency `no-deps` is `dependency`.
    async function install(dependency: string, files: Record<string, string> = {}, args: string[] = []) {
      using dir = tempDir("tarball-url-credentials", {
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "no-deps": dependency } }),
        ...files,
      });
      await using proc = spawn({
        cmd: [bunExe(), "install", ...args],
        cwd: String(dir),
        env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    // Each row is the userinfo of the dependency URL and the `user:pass` the
    // header must encode. It is sent as written: like npm (checked with npm
    // 11), a missing password is sent as an empty one and percent-encoding is
    // left alone. npm would percent-encode the second colon of the last row
    // because it serializes the URL first.
    it.each([
      ["a username and a password", "carol:s3cret", "carol:s3cret", []],
      ["a username and a password, isolated linker", "carol:s3cret", "carol:s3cret", ["--linker", "isolated"]],
      ["a username only", "carol", "carol:", []],
      ["a password only", ":s3cret", ":s3cret", []],
      ["a percent-encoded password", "carol:s3%40cret", "carol:s3%40cret", []],
      ["a password containing a colon", "carol:s3:cret", "carol:s3:cret", []],
    ])("sends %s as Basic authorization", async (_, userinfo, userPass, args) => {
      const authorization = basic(userPass);
      const received: Received[] = [];
      await using server = serveTarball(received, authorization);

      const result = await install(`http://${userinfo}@127.0.0.1:${server.port}${tarballPath}`, {}, args);

      expect({ received, ...result }).toEqual({
        received: [{ url: `http://127.0.0.1:${server.port}${tarballPath}`, authorization }],
        ...installed,
      });
    });

    it("does not take the @ of a scoped package path for credentials", async () => {
      const received: Received[] = [];
      await using server = serveTarball(received, null);
      const scopedPath = "/@scope/no-deps/-/no-deps-1.0.0.tgz";

      const result = await install(`http://127.0.0.1:${server.port}${scopedPath}`);

      expect({ received, ...result }).toEqual({
        received: [{ url: `http://127.0.0.1:${server.port}${scopedPath}`, authorization: null }],
        ...installed,
      });
    });

    it("keeps the credentials across a redirect within the host", async () => {
      const received: Received[] = [];
      await using server = serveTarball(received, basic("carol:s3cret"));

      const result = await install(`http://carol:s3cret@127.0.0.1:${server.port}/redirect/no-deps-1.0.0.tgz`);

      expect({ received, ...result }).toEqual({
        received: [
          { url: `http://127.0.0.1:${server.port}/redirect/no-deps-1.0.0.tgz`, authorization: basic("carol:s3cret") },
          { url: `http://127.0.0.1:${server.port}${tarballPath}`, authorization: basic("carol:s3cret") },
        ],
        ...installed,
      });
    });

    it("drops the credentials on a redirect to another host", async () => {
      // The same machine, reached under a hostname other than the one the
      // credentials were written for. This host serves the tarball regardless.
      const otherHostReceived: Received[] = [];
      await using otherHost = Bun.serve({
        port: 0,
        fetch: recording(otherHostReceived, () => new Response(file(tgz))),
      });
      const received: Received[] = [];
      await using server = serveTarball(received, null, `http://localhost:${otherHost.port}${tarballPath}`);

      const result = await install(`http://carol:s3cret@127.0.0.1:${server.port}/redirect/no-deps-1.0.0.tgz`);

      expect({ received, otherHostReceived, ...result }).toEqual({
        received: [
          { url: `http://127.0.0.1:${server.port}/redirect/no-deps-1.0.0.tgz`, authorization: basic("carol:s3cret") },
        ],
        otherHostReceived: [{ url: `http://localhost:${otherHost.port}${tarballPath}`, authorization: null }],
        ...installed,
      });
    });

    it("reports a rejected download by the URL without the credentials", async () => {
      const received: Received[] = [];
      await using server = serveTarball(received, basic("carol:s3cret"));

      const result = await install(`http://carol:wrong@127.0.0.1:${server.port}${tarballPath}`);

      expect({ received, ...result }).toEqual({
        received: [{ url: `http://127.0.0.1:${server.port}${tarballPath}`, authorization: basic("carol:wrong") }],
        stdout: expect.stringContaining("bun install v1."),
        stderr: expect.stringContaining(`error: GET http://127.0.0.1:${server.port}${tarballPath} - 401`),
        exitCode: 1,
      });
    });

    // A registry whose manifest puts credentials into `dist.tarball`. As with
    // npm, the credentials configured for the registry take precedence; the
    // URL's are used when the registry has none.
    describe.concurrent("in the dist.tarball URL of a registry manifest", () => {
      const token = "registry-token";
      const distPath = "/no-deps/-/no-deps-1.0.0.tgz";

      function serveRegistry(received: Received[], tarballAuthorization: string | null) {
        return Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch: recording(received, (req, server) => {
            const { pathname } = new URL(req.url);
            if (pathname === "/no-deps") {
              return Response.json({
                name: "no-deps",
                "dist-tags": { latest: "1.0.0" },
                versions: {
                  "1.0.0": {
                    name: "no-deps",
                    version: "1.0.0",
                    dist: { tarball: `http://dist:d1st@127.0.0.1:${server.port}${distPath}` },
                  },
                },
              });
            }
            if (pathname === distPath && req.headers.get("authorization") === tarballAuthorization) {
              return new Response(file(tgz));
            }
            return new Response("unauthorized", { status: 401 });
          }),
        });
      }

      it("sends the registry's credentials when it has some", async () => {
        const received: Received[] = [];
        await using registry = serveRegistry(received, `Bearer ${token}`);

        const result = await install("1.0.0", {
          ".npmrc": `registry=http://127.0.0.1:${registry.port}/\n//127.0.0.1:${registry.port}/:_authToken=${token}\n`,
        });

        expect({ received, ...result }).toEqual({
          received: [
            { url: `http://127.0.0.1:${registry.port}/no-deps`, authorization: `Bearer ${token}` },
            { url: `http://127.0.0.1:${registry.port}${distPath}`, authorization: `Bearer ${token}` },
          ],
          ...installed,
        });
      });

      it("sends the URL's credentials when the registry has none", async () => {
        const received: Received[] = [];
        await using registry = serveRegistry(received, basic("dist:d1st"));

        const result = await install("1.0.0", { ".npmrc": `registry=http://127.0.0.1:${registry.port}/\n` });

        expect({ received, ...result }).toEqual({
          received: [
            { url: `http://127.0.0.1:${registry.port}/no-deps`, authorization: null },
            { url: `http://127.0.0.1:${registry.port}${distPath}`, authorization: basic("dist:d1st") },
          ],
          ...installed,
        });
      });
    });
  });

  it("--silent suppresses verbose output even when RUNNER_DEBUG is set", async () => {
    using dir = tempDir("install-silent-verbose", {
      "package.json": JSON.stringify({ name: "app", dependencies: {} }),
    });

    await using proc = spawn({
      cmd: [bunExe(), "install", "--silent"],
      cwd: String(dir),
      env: { ...env, RUNNER_DEBUG: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("fails cleanly for a git dependency specifier longer than the path buffer", async () => {
    const longPath = Buffer.alloc(isWindows ? 100_000 : 8192, "a").toString();
    using dir = tempDir("long-git-dep", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "long-git-dep": `git@127.0.0.1:${longPath}` },
      }),
    });

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...env, GIT_ASKPASS: "echo", GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "false" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("cloning repository for");
    expect(stderr).toContain("long-git-dep");
    expect(stdout).toContain("bun install v1.");
    expect(exitCode).toBe(1);
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

  it("records an 8-byte non-ASCII version range from a manifest", async () => {
    // 8 bytes whose last byte has the high bit set cannot be stored inline in
    // the lockfile's small-string encoding; it has to be copied like a longer
    // string. "1.0.0-é" is 6 ASCII bytes + 0xC3 0xA9.
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.2": { peerDependencies: { quux: "1.0.0-é" }, peerDependenciesMeta: { quux: { optional: true } } },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "0.0.2" } }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--save-text-lockfile"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const [, err] = await Promise.all([stdout.text(), stderr.text()]);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      const lock = await file(join(ctx.package_dir, "bun.lock")).text();
      expect(lock).toContain(`"peerDependencies": { "quux": "1.0.0-é" }`);
      expect(await exited).toBe(0);
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

  // https://github.com/oven-sh/bun/issues/33834
  it("should resolve nested npm: alias to its registry target, not a same-named alias", async () => {
    await withContext(defaultOpts, async ctx => {
      // root aliases "baz" -> bar@0.0.2, and bar depends on "baz-old": "npm:baz@>=0.0.1".
      // The nested alias must resolve to the real registry package baz, not back to bar.
      const urls: string[] = [];
      const manifests: Record<string, Record<string, object>> = {
        bar: { "0.0.2": { dependencies: { "baz-old": "npm:baz@>=0.0.1" } } },
        baz: { "0.0.3": { bin: { "baz-run": "index.js" } } },
      };
      setContextHandler(ctx, async request => {
        urls.push(request.url);
        const path = new URL(request.url).pathname.replace(`/${ctx.id}/`, "").replaceAll("%2f", "/");
        if (path.endsWith(".tgz")) {
          return new Response(file(join(import.meta.dir, path)));
        }
        const versions: Record<string, object> = {};
        let latest = "";
        for (const [version, fields] of Object.entries(manifests[path] ?? {})) {
          versions[version] = {
            name: path,
            version,
            dist: { tarball: `${ctx.registry_url}${path}-${version}.tgz` },
            ...fields,
          };
          latest = version;
        }
        return new Response(JSON.stringify({ name: path, versions, "dist-tags": { latest } }));
      });
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: "npm:bar@0.0.2",
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
      const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
      expect(err).toContain("Saved lockfile");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("+ baz@0.0.2"),
        "",
        "2 packages installed",
      ]);
      expect(exitCode).toBe(0);
      expect(urls.sort()).toEqual([
        `${ctx.registry_url}bar`,
        `${ctx.registry_url}bar-0.0.2.tgz`,
        `${ctx.registry_url}baz`,
        `${ctx.registry_url}baz-0.0.3.tgz`,
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz", "baz-old"]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      });
      expect(await file(join(ctx.package_dir, "node_modules", "baz-old", "package.json")).json()).toEqual({
        name: "baz",
        version: "0.0.3",
        bin: {
          "baz-run": "index.js",
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
      expect(await readdirCacheSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
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
      expect(await readdirCacheSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
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
      expect(await readdirCacheSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
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
      expect(await readdirCacheSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
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

  // The root package.json is read on two paths: against a bun.lock that already lists
  // dependencies, and when the lockfile has to be created. Both report it the same way.
  describe.concurrent("root package.json that cannot be read or parsed", () => {
    async function installWithBrokenRootPackageJson(
      withLockfile: boolean,
      breakPackageJson: (packageJsonPath: string) => Promise<void>,
    ) {
      using dir = tempDir("broken-root-package-json", {
        "package.json": JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { dep: "file:./dep" } }),
        "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      });
      if (withLockfile) {
        await using first = spawn({
          cmd: [bunExe(), "install", "--lockfile-only"],
          cwd: String(dir),
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [firstStdout, firstStderr, firstExitCode] = await Promise.all([
          first.stdout.text(),
          first.stderr.text(),
          first.exited,
        ]);
        expect(firstExitCode, `bun install --lockfile-only failed: ${firstStdout}${firstStderr}`).toBe(0);
        expect(await exists(join(String(dir), "bun.lock"))).toBe(true);
      }
      await breakPackageJson(join(String(dir), "package.json"));

      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toStartWith("bun install v1.");
      return { stderr: normalizeBunSnapshot(stderr, String(dir)), exitCode };
    }

    const unparseable = (packageJsonPath: string) => writeFile(packageJsonPath, "foo");
    const unreadable = async (packageJsonPath: string) => {
      await rm(packageJsonPath);
      await mkdir(packageJsonPath);
    };

    for (const [lockfile, withLockfile] of [
      ["with a bun.lock", true],
      ["without a bun.lock", false],
    ] as const) {
      it(`prints the parse error and the path ${lockfile}`, async () => {
        const { stderr, exitCode } = await installWithBrokenRootPackageJson(withLockfile, unparseable);
        expect(stderr).toBe(
          [
            "1 | foo",
            "    ^",
            "error: Unexpected foo",
            "    at <dir>/package.json:1:1",
            "ParserError: failed to parse '<dir>/package.json'",
          ].join("\n"),
        );
        expect(exitCode).toBe(1);
      });

      it(`prints the read error and the path ${lockfile}`, async () => {
        const { stderr, exitCode } = await installWithBrokenRootPackageJson(withLockfile, unreadable);
        expect(stderr).toBe("EISDIR: failed to read '<dir>/package.json'");
        expect(exitCode).toBe(1);
      });
    }
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
      expect((await readdirCacheSorted(join(ctx.package_dir, "node_modules", ".cache")))[0]).toBe(
        "9694c5fe9c41ad51.git",
      );
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
      expect((await readdirCacheSorted(join(ctx.package_dir, "node_modules", ".cache")))[0]).toBe(
        "87d55589eb4217d2.git",
      );
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
      expect(await readdirCacheSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
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

  it("does not keep a checked-in node_modules entry from a git dependency", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      using dir = tempDir("git-dep-node-modules", {
        "work/package.json": JSON.stringify({ name: "has-node-modules", version: "1.0.0" }),
        "outside/keep.txt": "keep",
      });
      const sha = await createDumbHttpGitRepo(String(dir), { node_modules: join(String(dir), "outside") });
      using server = serveDirectory(String(dir));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "has-node-modules": `git+http://localhost:${server.port}/repo.git`,
          },
        }),
      );
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).toContain("Saved lockfile");
      expect(out).toContain("1 package installed");
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache", `@G@${sha}`))).toEqual([
        ".bun-tag",
        "package.json",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "has-node-modules"))).toEqual([
        ".bun-tag",
        "package.json",
      ]);
      expect(await readdirSorted(join(String(dir), "outside"))).toEqual(["keep.txt"]);
      expect(urls).toBeEmpty();
      expect(exitCode).toBe(0);
    });
  });

  it("does not follow a symlinked .bun-tag when tagging a git dependency checkout", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      using dir = tempDir("git-dep-bun-tag", {
        "work/package.json": JSON.stringify({ name: "has-bun-tag", version: "1.0.0" }),
        "outside/target.txt": "original\n",
      });
      const target = join(String(dir), "outside", "target.txt");
      const sha = await createDumbHttpGitRepo(String(dir), { ".bun-tag": target });
      using server = serveDirectory(String(dir));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "has-bun-tag": `git+http://localhost:${server.port}/repo.git`,
          },
        }),
      );
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).toContain("Saved lockfile");
      expect(out).toContain("1 package installed");
      expect(readFileSync(target, "utf8")).toBe("original\n");
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache", `@G@${sha}`))).toEqual([
        ".bun-tag",
        "package.json",
      ]);
      expect(await file(join(ctx.package_dir, "node_modules", ".cache", `@G@${sha}`, ".bun-tag")).text()).toBe(sha);
      expect(await file(join(ctx.package_dir, "node_modules", "has-bun-tag", "package.json")).json()).toEqual({
        name: "has-bun-tag",
        version: "1.0.0",
      });
      expect(urls).toBeEmpty();
      expect(exitCode).toBe(0);
    });
  });

  it("replaces a .bun-tag directory checked into a git dependency with the tag", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      using dir = tempDir("git-dep-bun-tag-dir", {
        "work/package.json": JSON.stringify({ name: "has-bun-tag-dir", version: "1.0.0" }),
        "work/.bun-tag/nested.txt": "checked in\n",
      });
      const sha = await createDumbHttpGitRepo(String(dir), {});
      using server = serveDirectory(String(dir));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: { "has-bun-tag-dir": `git+http://localhost:${server.port}/repo.git` },
        }),
      );
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).toContain("Saved lockfile");
      expect(out).toContain("1 package installed");
      const cacheFolder = join(ctx.package_dir, "node_modules", ".cache", `@G@${sha}`);
      expect(await readdirSorted(cacheFolder)).toEqual([".bun-tag", "package.json"]);
      expect(await file(join(cacheFolder, ".bun-tag")).text()).toBe(sha);
      expect(urls).toBeEmpty();
      expect(exitCode).toBe(0);
    });
  });

  it("git checkout cache folders appear only once complete and are hit only when tagged", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      using dir = tempDir("git-dep-checkout-fails", {
        "work/package.json": JSON.stringify({ name: "checkout-fails", version: "1.0.0" }),
      });
      const sha = await createDumbHttpGitRepo(String(dir), {});
      const treeSha = await git(join(String(dir), "work"), ["rev-parse", "HEAD^{tree}"]);
      using server = serveDirectory(String(dir));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: { "checkout-fails": `git+http://localhost:${server.port}/repo.git` },
        }),
      );
      async function install() {
        await using proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env,
        });
        const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { out, err, exitCode };
      }
      const cache = join(ctx.package_dir, "node_modules", ".cache");

      expect(await install()).toMatchObject({ exitCode: 0 });
      expect(await readdirSorted(join(cache, `@G@${sha}`))).toEqual([".bun-tag", "package.json"]);
      const mirror = (await readdirCacheSorted(cache)).find(entry => entry.endsWith(".git"))!;

      // `git log` during resolution does not need the tree object, but `git checkout` cannot unpack without it.
      const treeObject = join(cache, mirror, "objects", treeSha.slice(0, 2), treeSha.slice(2));
      const treeBytes = await file(treeObject).bytes();
      await rm(treeObject);
      await rm(join(cache, `@G@${sha}`), { recursive: true });
      await rm(join(ctx.package_dir, "node_modules", "checkout-fails"), { recursive: true });
      const failed = await install();
      expect(failed.err).toContain('"git checkout" for "checkout-fails" failed');
      expect(failed.exitCode).not.toBe(0);
      expect(await readdirCacheSorted(cache)).toEqual([mirror]);

      await write(treeObject, treeBytes);
      expect(await install()).toMatchObject({ exitCode: 0 });
      expect(await readdirSorted(join(cache, `@G@${sha}`))).toEqual([".bun-tag", "package.json"]);

      // A folder at the cache name without `.bun-tag` (left by older versions) is not a cache hit.
      await rm(join(cache, `@G@${sha}`), { recursive: true });
      await mkdir(join(cache, `@G@${sha}`));
      await rm(join(ctx.package_dir, "node_modules", "checkout-fails"), { recursive: true });
      expect(await install()).toMatchObject({ exitCode: 0 });
      expect(await readdirSorted(join(cache, `@G@${sha}`))).toEqual([".bun-tag", "package.json"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "checkout-fails"))).toEqual([
        ".bun-tag",
        "package.json",
      ]);
      expect(urls).toBeEmpty();
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
        env: { ...env, "GIT_ASKPASS": "echo", "GIT_CONFIG_NOSYSTEM": "1" },
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
      expect(await readdirCacheSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
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

  for (const filename of ["x.tar", "X.TGZ"]) {
    it(`should handle tarball path ending in ${filename}`, async () => {
      await withContext(defaultOpts, async ctx => {
        const urls: string[] = [];
        setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
        const tgz = await file(join(import.meta.dir, "baz-0.0.3.tgz")).bytes();
        await write(join(ctx.package_dir, filename), filename.endsWith(".tar") ? Bun.gunzipSync(tgz) : tgz);
        await writeFile(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({
            name: "foo",
            version: "0.0.1",
            dependencies: {
              baz: `./${filename}`,
            },
          }),
        );
        await using proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env,
        });
        const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(err).toContain("Saved lockfile");
        expect(
          out
            .replace(/\s*\[[0-9\.]+m?s\]\s*$/, "")
            .split(/\r?\n/)
            .slice(1),
        ).toStrictEqual(["", `+ baz@./${filename}`, "", "1 package installed"]);
        expect(exitCode).toBe(0);
        expect(urls).toBeEmpty();
        expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toStrictEqual([".bin", ".cache", "baz"]);
        expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
        expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toStrictEqual([
          "index.js",
          "package.json",
        ]);
        expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toStrictEqual({
          name: "baz",
          version: "0.0.3",
          bin: {
            "baz-run": "index.js",
          },
        });
        await access(join(ctx.package_dir, "bun.lockb"));
      });
    });
  }

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

  // https://github.com/oven-sh/bun/issues/19088
  //
  // Workspace package.jsons are parsed without the root's duplicate check, so a name listed in
  // two dependency groups yields two dependency slots. The hoister has to collapse them into one
  // node_modules entry; the slot sorted first wins (dev, optional, prod, then peer), as it already
  // did for the root package. `expected` is the `packages` section of bun.lock, name -> resolution.
  it.each<{
    name: string;
    root?: Record<string, Record<string, string>>;
    pkgA: Record<string, Record<string, string>>;
    pkgB?: Record<string, Record<string, string>>;
    expected: Record<string, string>;
  }>([
    {
      name: "dependencies + devDependencies",
      pkgA: { dependencies: { baz: "0.0.5" }, devDependencies: { baz: "0.0.3" } },
      expected: { "baz": "baz@0.0.3", "pkg-a": "pkg-a@workspace:packages/pkg-a" },
    },
    {
      name: "dependencies + optionalDependencies",
      pkgA: { dependencies: { baz: "0.0.5" }, optionalDependencies: { baz: "0.0.3" } },
      expected: { "baz": "baz@0.0.3", "pkg-a": "pkg-a@workspace:packages/pkg-a" },
    },
    {
      // the root pin keeps both of pkg-a's slots out of the root folder, so they collide inside
      // pkg-a's own node_modules instead of a parent's
      name: "dependencies + optionalDependencies while the root pins a third version",
      root: { dependencies: { baz: "0.0.7" } },
      pkgA: { dependencies: { baz: "0.0.5" }, optionalDependencies: { baz: "0.0.3" } },
      expected: { "baz": "baz@0.0.7", "pkg-a": "pkg-a@workspace:packages/pkg-a", "pkg-a/baz": "baz@0.0.3" },
    },
    {
      // pkg-b makes the peer slot resolve to a different package than pkg-a's own dependencies slot
      name: "dependencies + peerDependencies while a sibling workspace pins the peer's version",
      pkgA: { dependencies: { baz: "0.0.5" }, peerDependencies: { baz: "0.0.3" } },
      pkgB: { dependencies: { baz: "0.0.3" } },
      expected: {
        "baz": "baz@0.0.5",
        "pkg-a": "pkg-a@workspace:packages/pkg-a",
        "pkg-b": "pkg-b@workspace:packages/pkg-b",
        "pkg-b/baz": "baz@0.0.3",
      },
    },
  ])("--frozen-lockfile passes after a workspace lists a name in $name", async ({ root, pkgA, pkgB, expected }) => {
    await withContext(defaultOpts, async ctx => {
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, [], {
          "0.0.3": { as: "0.0.3" },
          "0.0.5": { as: "0.0.5" },
          // a third version only has to resolve; there is no baz-0.0.7.tgz fixture
          "0.0.7": { as: "0.0.5" },
        }),
      );

      const files: Record<string, object> = {
        "bunfig.toml": { install: { cache: false, registry: ctx.registry_url, linker: "hoisted" } },
        "package.json": { name: "root", private: true, workspaces: ["packages/*"], ...root },
        "packages/pkg-a/package.json": { name: "pkg-a", version: "1.0.0", ...pkgA },
      };
      if (pkgB) files["packages/pkg-b/package.json"] = { name: "pkg-b", version: "1.0.0", ...pkgB };
      await Promise.all(
        Object.entries(files).map(([path, contents]) =>
          write(
            join(ctx.package_dir, path),
            path.endsWith(".toml") ? Bun.TOML.stringify(contents) : JSON.stringify(contents),
          ),
        ),
      );

      async function install(...args: string[]) {
        const proc = spawn({
          cmd: [bunExe(), "install", ...args],
          cwd: ctx.package_dir,
          stdout: "ignore",
          stdin: "ignore",
          stderr: "pipe",
          env,
        });
        const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect(err).not.toContain("error:");
        expect(exitCode).toBe(0);
        return await file(join(ctx.package_dir, "bun.lock")).text();
      }

      const lockfile = await install();
      const packages = Bun.JSONC.parse(lockfile).packages as Record<string, [string, ...unknown[]]>;
      expect(Object.fromEntries(Object.entries(packages).map(([name, [resolution]]) => [name, resolution]))).toEqual(
        expected,
      );

      expect(await install("--frozen-lockfile")).toBe(lockfile);
      expect(await install()).toBe(lockfile);
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
        Bun.TOML.stringify({
          install: {
            frozenLockfile: true,
            registry: ctx.registry_url,
          },
        }),
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
      // the lockfile matched, so nothing was resolved and no cache dir was created
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual(["bar"]);
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
    await using package_dir = tempDir("complicated-glob", {
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
    await using package_dir = tempDir("multi-glob", {
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
    await using package_dir = tempDir("absolute-glob", {
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
      // the lockfile matched, so nothing was resolved and no cache dir was created
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual(["bar", "baz"]);
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
            await writeFile(
              join(ctx.package_dir, "bunfig.toml"),
              Bun.TOML.stringify({ install: { cache: false, registry: regURL } }),
            );

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
              // "failed to resolve" is also printed when Bun refuses the manifest
              // URL it built, so make sure the registry URL itself was accepted.
              expect(err).not.toContain("is not on registry");
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

        await writeFile(
          join(ctx.package_dir, "bunfig.toml"),
          Bun.TOML.stringify({ install: { cache: false, registry: regURL } }),
        );

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

      await writeFile(
        join(ctx.package_dir, "bunfig.toml"),
        Bun.TOML.stringify({ install: { cache: false, registry: regURL } }),
      );

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

    // The manifest URL is built from the registry URL by the WHATWG parser,
    // which accepts every spelling below and rewrites it to the canonical form.
    // Everything else derived from the configured registry (the "is not on
    // registry" check on that manifest URL, the same-origin check that decides
    // whether a tarball request gets the Authorization header, the cache folder
    // name) has to read the same canonical form, otherwise the install fails
    // before or after the first request depending on the spelling.
    describe.concurrent("spellings the WHATWG parser rewrites", () => {
      const token = "registry-spelling-token";
      const tgz = join(import.meta.dir, "registry", "packages", "no-deps", "no-deps-1.0.0.tgz");

      // Serves `no-deps@1.0.0` under whatever directory the manifest is
      // requested from and records the path and Authorization header of every
      // request. `configure` returns either extra project files or extra
      // `bun install` arguments for the registry at `origin`.
      async function installNoDeps(configure: (origin: string) => Record<string, string> | string[]) {
        const requests: { path: string; authorization: string | null }[] = [];
        await using registry = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch(req, server) {
            const { pathname } = new URL(req.url);
            requests.push({ path: pathname, authorization: req.headers.get("authorization") });
            if (pathname.endsWith(".tgz")) {
              return new Response(file(tgz));
            }
            return Response.json({
              name: "no-deps",
              "dist-tags": { latest: "1.0.0" },
              versions: {
                "1.0.0": {
                  name: "no-deps",
                  version: "1.0.0",
                  dist: { tarball: `http://127.0.0.1:${server.port}${pathname}/-/no-deps-1.0.0.tgz` },
                },
              },
            });
          },
        });

        const origin = `http://127.0.0.1:${registry.port}`;
        const config = configure(origin);
        const [files, args] = Array.isArray(config) ? [{}, config] : [config, []];
        using dir = tempDir("registry-url-spelling", {
          "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
          ...files,
        });
        await using proc = spawn({
          cmd: [bunExe(), "install", ...args],
          cwd: String(dir),
          env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const cache = (await exists(join(String(dir), ".bun-cache")))
          ? await readdirSorted(join(String(dir), ".bun-cache"))
          : [];
        return { origin, cache, result: { requests, stdout, stderr, exitCode } };
      }

      // Both requests land in `directory` (the canonical form of the configured
      // path) and both carry the same Authorization header.
      function installedFrom(directory: string, authorization: string | null) {
        return {
          requests: [
            { path: `${directory}no-deps`, authorization },
            { path: `${directory}no-deps/-/no-deps-1.0.0.tgz`, authorization },
          ],
          stdout: expect.stringContaining("1 package installed"),
          stderr: expect.stringContaining("Saved lockfile"),
          exitCode: 0,
        };
      }

      const singleColon = (origin: string) => origin.replace("http://", "http:");

      it.each([
        ["the scheme followed by a single colon", (origin: string) => `${singleColon(origin)}/npm/`, "/npm/"],
        ["backslashes", (origin: string) => `${origin.replace("http://", "http:\\\\")}\\npm\\`, "/npm/"],
        ["a dot segment", (origin: string) => `${origin}/npm/unused/../`, "/npm/"],
        ["surrounding whitespace", (origin: string) => `  ${origin}/npm/  `, "/npm/"],
        ["an unencoded space in the path", (origin: string) => `${origin}/npm dir/`, "/npm%20dir/"],
        // Accepted before as well, but the tarball's same-origin check compared
        // the scheme case-sensitively and withheld the token from the tarball.
        ["an upper-case scheme", (origin: string) => `${origin.replace("http://", "HTTP://")}/npm/`, "/npm/"],
      ])("bunfig.toml registry with %s", async (_, spell, directory) => {
        const { result, cache } = await installNoDeps(origin => ({
          "bunfig.toml": Bun.TOML.stringify({ install: { registry: { url: spell(origin), token } } }),
        }));
        expect(result).toEqual(installedFrom(directory, `Bearer ${token}`));
        // The cache folder is named after the hostname read from the stored URL.
        expect(cache).toContain("no-deps@1.0.0@@127.0.0.1@@@1");
      });

      it(".npmrc registry= with the scheme followed by a single colon", async () => {
        const { result } = await installNoDeps(origin => ({ ".npmrc": `registry=${singleColon(origin)}/npm/\n` }));
        expect(result).toEqual(installedFrom("/npm/", null));
      });

      it("--registry with a dot segment", async () => {
        const { result } = await installNoDeps(origin => ["--registry", `${origin}/npm/unused/../`]);
        expect(result).toEqual(installedFrom("/npm/", null));
      });

      it("still refuses a name that joins to a URL outside the registry directory", async () => {
        const { result, origin } = await installNoDeps(origin => ({
          "bunfig.toml": Bun.TOML.stringify({ install: { registry: { url: `${singleColon(origin)}/npm/`, token } } }),
          "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "..": "1.0.0" } }),
        }));
        expect(result).toEqual({
          requests: [],
          stdout: expect.stringContaining("bun install v1."),
          // The error quotes the registry in the form the check compared against.
          stderr: expect.stringContaining(`manifest URL "${origin}/" is not on registry "${origin}/npm/"`),
          exitCode: 1,
        });
      });
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
          Bun.TOML.stringify({
            install: {
              cache: false,
              registry: ctx.registry_url,
              saveTextLockfile: true,
            },
          }),
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
        "lockfileVersion": 2,
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

it("rejects dependency aliases containing '..' path segments", async () => {
  await withContext(defaultOpts, async ctx => {
    const urls: string[] = [];
    setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.3": {} }));
    // The alias (the key in `dependencies`) becomes the folder name under
    // node_modules/. An alias containing ".." segments must not be able to
    // place the package outside the project directory. The name is unique per
    // run so a previous (vulnerable) run's escape artifact can't fail this one.
    const escapeName =
      "bun-install-alias-escape-target-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          [`../../${escapeName}`]: "npm:baz@0.0.3",
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
    const out = await stdout.text();
    // node_modules/../../<escapeName> resolves to a sibling of the project
    // directory; nothing may be materialized there.
    expect(await exists(join(ctx.package_dir, "..", escapeName))).toBe(false);
    // The alias is reported as invalid instead of being used as a path.
    expect(err).toContain("Invalid dependency name");
    expect(out).not.toContain("1 package installed");
    expect(await exited).toBe(1);
  });
});

it("does not extract a tarball for a dependency alias containing '..' path segments", async () => {
  await withContext(defaultOpts, async ctx => {
    const urls: string[] = [];
    setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

    // The dependency alias (the key in `dependencies`) is used to derive the
    // temporary extraction folder name. Point bun's temp dir at a deep
    // directory tree we control so that an alias with '..' segments would have
    // to land inside `zone` (above the temp dir) to be observed.
    using zoneDir = tempDir("install-alias-tmp-zone", {
      "a/b/c/.keep": "",
    });
    const zone = String(zoneDir);
    const bunTmp = join(zone, "a", "b", "c");

    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          "x/../../../..": `${ctx.registry_url}baz-0.0.3.tgz`,
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: { ...env, BUN_TMPDIR: bunTmp, TMPDIR: bunTmp },
    });
    const err = await stderr.text();
    const out = await stdout.text();
    const exitCode = await exited;

    // Nothing from the tarball may be written above bun's temp dir (zone/a/b/c).
    expect(await readdirSorted(zone)).toEqual(["a"]);
    expect(await readdirSorted(join(zone, "a"))).toEqual(["b"]);
    expect(await readdirSorted(join(zone, "a", "b"))).toEqual(["c"]);
    // The unsafe alias is reported as an error and nothing is installed.
    expect(err).toContain("Refusing to install package with invalid name");
    expect(out).not.toContain("1 package installed");
    expect(exitCode).not.toBe(0);
  });
});

it("does not install transitive file: dependencies that point outside their package", async () => {
  // A dependency declared by a non-workspace package (here: a folder dependency
  // of the project) uses a file: specifier pointing at an absolute path outside
  // of that package and outside the project. That directory must not be linked
  // into node_modules.
  using dir = tempDir("transitive-file-dep", {
    "secret/credentials.txt": "do-not-link-me",
    "project/package.json": JSON.stringify({
      name: "my-app",
      version: "1.0.0",
      dependencies: {
        "evil-folder-dep": "file:./evil-folder-dep",
      },
    }),
    "project/evil-folder-dep/index.js": "module.exports = 1;",
  });
  const projectDir = join(String(dir), "project");
  const secretDir = join(String(dir), "secret");

  await write(
    join(projectDir, "evil-folder-dep", "package.json"),
    JSON.stringify({
      name: "evil-folder-dep",
      version: "1.0.0",
      dependencies: {
        loot: "file:" + secretDir.replaceAll("\\", "/"),
      },
    }),
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: projectDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  const out = await stdout.text();
  const exitCode = await exited;

  // The directory outside the package must not appear under node_modules,
  // neither hoisted nor nested under the declaring package.
  expect(await exists(join(projectDir, "node_modules", "loot"))).toBe(false);
  expect(await exists(join(projectDir, "node_modules", "evil-folder-dep", "node_modules", "loot"))).toBe(false);
  // The dependency is reported as unresolvable instead of silently linking local files.
  expect(err).toContain("Could not find package.json");
  expect(out).not.toContain("2 packages installed");
  expect(exitCode).toBe(1);
});

it("does not install transitive file: dependencies with overlong folder targets", async () => {
  const overlongTarget = "file:./" + Buffer.alloc(120000, "a").toString();
  using dir = tempDir("transitive-file-dep-overlong", {
    "project/package.json": JSON.stringify({
      name: "my-app",
      version: "1.0.0",
      dependencies: {
        "evil-folder-dep": "file:./evil-folder-dep",
      },
    }),
    "project/evil-folder-dep/index.js": "module.exports = 1;",
    "project/evil-folder-dep/package.json": JSON.stringify({
      name: "evil-folder-dep",
      version: "1.0.0",
      dependencies: {
        loot: overlongTarget,
      },
    }),
  });
  const projectDir = join(String(dir), "project");

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: projectDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  const out = await stdout.text();
  const exitCode = await exited;

  expect(await exists(join(projectDir, "node_modules", "loot"))).toBe(false);
  expect(await exists(join(projectDir, "node_modules", "evil-folder-dep", "node_modules", "loot"))).toBe(false);
  expect(err).toContain("unsafe folder path");
  expect(out).not.toContain("2 packages installed");
  expect(exitCode).toBe(1);
});

for (const field of ["resolutions", "overrides"]) {
  it(`installs a file: dependency pointing outside the project when it came from root package.json "${field}"`, async () => {
    // `overrides` / `resolutions` can only be declared in the root package.json,
    // so a file: path written there is user-specified and should be trusted
    // even when it is applied to a transitive dependency in a nested tree.
    using dir = tempDir("override-file-dep", {
      "shared/package.json": JSON.stringify({
        name: "shared",
        version: "1.0.0",
      }),
      "shared/index.js": "module.exports = 'shared';",
      "project/package.json": JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        dependencies: {
          "pkg-a": "file:./pkg-a",
          "shared": "file:../shared",
        },
        [field]: {
          shared: "file:../shared",
        },
      }),
      "project/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: {
          shared: "1.0.0",
        },
      }),
      "project/pkg-a/index.js": "module.exports = require('shared');",
    });
    const projectDir = join(String(dir), "project");

    // Run install twice: the first pass exercises the resolve/enqueue path
    // (no lockfile yet), then node_modules is wiped so the second pass
    // exercises the install-from-lockfile path.
    for (let i = 0; i < 2; i++) {
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: projectDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

      expect(err).not.toContain("unsafe folder path");
      expect(err).not.toContain("refusing to install");
      expect(err).not.toContain("Could not find package.json");
      expect(err).not.toContain("failed to resolve");
      expect(exitCode).toBe(0);
      expect(out).toContain("shared");

      if (i === 0) {
        await rm(join(projectDir, "node_modules"), { recursive: true, force: true });
      }
    }

    expect(await exists(join(projectDir, "node_modules", "shared", "package.json"))).toBe(true);

    // pkg-a must be able to resolve `shared` at runtime.
    await using runProc = spawn({
      cmd: [bunExe(), "-e", "console.log(require('pkg-a'))"],
      cwd: projectDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [runOut, runErr, runExit] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);
    expect(runErr).toBe("");
    expect(runOut.trim()).toBe("shared");
    expect(runExit).toBe(0);
  });

  it(`installs a file: dependency pointing outside the project when it came from root package.json "${field}" (existing lockfile)`, async () => {
    // Same as above but starting from a lockfile that already contains the
    // nested folder resolution, so the package installer (not the enqueue
    // path) is what sees the escaping folder path.
    using dir = tempDir("override-file-dep-lock", {
      "shared/package.json": JSON.stringify({
        name: "shared",
        version: "1.0.0",
      }),
      "shared/index.js": "module.exports = 'shared';",
      "project/package.json": JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        dependencies: {
          "pkg-a": "file:./pkg-a",
          "shared": "file:../shared",
        },
        [field]: {
          shared: "file:../shared",
        },
      }),
      "project/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: {
          shared: "1.0.0",
        },
      }),
      "project/pkg-a/index.js": "module.exports = require('shared');",
      "project/bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: {
          "": {
            name: "my-app",
            dependencies: {
              "pkg-a": "file:./pkg-a",
              "shared": "file:../shared",
            },
          },
        },
        overrides: {
          shared: "file:../shared",
        },
        packages: {
          "pkg-a": ["pkg-a@file:pkg-a", { dependencies: { shared: "1.0.0" } }],
          "shared": ["shared@file:../shared", {}],
          "pkg-a/shared": ["shared@file:../shared", {}],
        },
      }),
    });
    const projectDir = join(String(dir), "project");

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: projectDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

    expect(err).not.toContain("unsafe folder path");
    expect(err).not.toContain("refusing to install");
    expect(err).not.toContain("Could not find package.json");
    expect(err).not.toContain("failed to resolve");
    expect(exitCode).toBe(0);
    expect(out).toContain("shared");
    expect(await exists(join(projectDir, "node_modules", "shared", "package.json"))).toBe(true);
  });

  it(`still rejects transitive file: dependencies that escape their package when a different name is in "${field}"`, async () => {
    // An override for a different name must not whitelist an unrelated
    // transitive file: dependency that points outside its package.
    using dir = tempDir("override-file-dep-unrelated", {
      "secret/credentials.txt": "do-not-link-me",
      "shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0" }),
      "project/package.json": JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        dependencies: {
          "evil-folder-dep": "file:./evil-folder-dep",
        },
        [field]: {
          shared: "file:../shared",
        },
      }),
      "project/evil-folder-dep/index.js": "module.exports = 1;",
      "project/evil-folder-dep/package.json": JSON.stringify({
        name: "evil-folder-dep",
        version: "1.0.0",
        dependencies: {
          loot: "file:../../secret",
        },
      }),
    });
    const projectDir = join(String(dir), "project");

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: projectDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

    expect(await exists(join(projectDir, "node_modules", "loot"))).toBe(false);
    expect(await exists(join(projectDir, "node_modules", "evil-folder-dep", "node_modules", "loot"))).toBe(false);
    expect(err).toContain("Could not find package.json");
    expect(out).not.toContain("2 packages installed");
    expect(exitCode).toBe(1);
  });

  const nestedRule = (value: string) =>
    field === "overrides" ? { "pkg-a": { shared: value } } : { "pkg-a/shared": value };

  it(`rejects a nested "${field}" rule pointing at a file: path outside the project`, async () => {
    using dir = tempDir("nested-override-file-dep-outside", {
      "shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0" }),
      "shared/index.js": "module.exports = 'shared';",
      "project/package.json": JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        dependencies: {
          "pkg-a": "file:./pkg-a",
        },
        [field]: nestedRule("file:../shared"),
      }),
      "project/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: {
          shared: "1.0.0",
        },
      }),
      "project/pkg-a/index.js": "module.exports = require('shared');",
    });
    const projectDir = join(String(dir), "project");

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: projectDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });
    const [err, out, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

    expect(normalizeBunSnapshot(err, projectDir)).toMatchInlineSnapshot(`
      "error: Could not find package.json for "file:../shared" dependency "shared"
      error: shared@1.0.0 failed to resolve"
    `);
    expect(out).not.toContain("packages installed");
    expect(await exists(join(projectDir, "node_modules", "shared"))).toBe(false);
    expect(await exists(join(projectDir, "node_modules", "pkg-a", "node_modules", "shared"))).toBe(false);
    expect(await exists(join(projectDir, "bun.lock"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  it(`installs a nested "${field}" rule pointing at a file: path inside the project`, async () => {
    using dir = tempDir("nested-override-file-dep-inside", {
      "package.json": JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        dependencies: {
          "pkg-a": "file:./pkg-a",
        },
        [field]: nestedRule("file:./vendor/shared"),
      }),
      "vendor/shared/package.json": JSON.stringify({ name: "shared", version: "2.0.0" }),
      "vendor/shared/index.js": "module.exports = 'vendored shared';",
      "pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: {
          shared: "1.0.0",
        },
      }),
      "pkg-a/index.js": "module.exports = require('shared');",
    });
    const projectDir = String(dir);

    for (const args of [["install"], ["install", "--frozen-lockfile"]]) {
      await rm(join(projectDir, "node_modules"), { recursive: true, force: true });

      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd: projectDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [err, out, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

      expect(err).not.toContain("error:");
      expect(out).toContain("2 packages installed");
      expect(exitCode).toBe(0);

      await using runProc = spawn({
        cmd: [bunExe(), "-e", "console.log(require('pkg-a'))"],
        cwd: projectDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [runOut, runErr, runExit] = await Promise.all([
        runProc.stdout.text(),
        runProc.stderr.text(),
        runProc.exited,
      ]);
      expect(runErr).toBe("");
      expect(runOut).toBe("vendored shared\n");
      expect(runExit).toBe(0);
    }

    expect(normalizeBunSnapshot(await file(join(projectDir, "bun.lock")).text(), projectDir)).toMatchInlineSnapshot(`
      "{
        "lockfileVersion": 3,
        "configVersion": 1,
        "workspaces": {
          "": {
            "name": "my-app",
            "dependencies": {
              "pkg-a": "file:./pkg-a",
            },
          },
        },
        "overrides": {
          "pkg-a": {
            "shared": "file:./vendor/shared",
          },
        },
        "packages": {
          "pkg-a": ["pkg-a@file:pkg-a", { "dependencies": { "shared": "1.0.0" } }],

          "pkg-a/shared": ["shared@file:./vendor/shared", {}],
        }
      }"
    `);
  });
}

it("installs the transitive file: dependency of a file: dependency", async () => {
  using dir = tempDir("transitive-file-dep", {
    "package.json": JSON.stringify({
      name: "my-app",
      version: "1.0.0",
      dependencies: {
        lib: "file:./vendor/lib",
      },
    }),
    "vendor/lib/package.json": JSON.stringify({
      name: "lib",
      version: "1.0.0",
      main: "index.js",
      dependencies: {
        nested: "file:../nested",
      },
    }),
    "vendor/lib/index.js": `module.exports = require("nested");`,
    "vendor/nested/package.json": JSON.stringify({
      name: "nested",
      version: "1.0.0",
      main: "index.js",
    }),
    "vendor/nested/index.js": `module.exports = "it worked";`,
  });

  // The first pass resolves from package.json; the second installs from the
  // lockfile the first pass wrote.
  for (const args of [["install"], ["install", "--frozen-lockfile"]]) {
    await rm(join(String(dir), "node_modules"), { recursive: true, force: true });

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

    expect(err).not.toContain("error:");
    expect(out).toContain("2 packages installed");
    expect(exitCode).toBe(0);

    // `lib/index.js` requires "nested", so this only passes when the
    // transitive file: dependency is materialized under node_modules.
    await using runProc = spawn({
      cmd: [bunExe(), "-e", `console.log(require("lib"))`],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [runOut, runErr, runExit] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);
    expect(runErr).not.toContain("error:");
    expect(runOut.trim()).toBe("it worked");
    expect(runExit).toBe(0);
  }
});

const fileDepCycleFixture = {
  "package.json": JSON.stringify({
    name: "my-app",
    version: "1.0.0",
    dependencies: {
      a: "file:./packages/a",
      b: "file:./packages/b",
    },
  }),
  "packages/a/package.json": JSON.stringify({
    name: "a",
    version: "1.0.0",
    dependencies: { b: "file:../b" },
  }),
  "packages/a/index.js": `module.exports = "a->" + require("b/name");`,
  "packages/a/name.js": `module.exports = "a";`,
  "packages/b/package.json": JSON.stringify({
    name: "b",
    version: "1.0.0",
    dependencies: { a: "file:../a" },
  }),
  "packages/b/index.js": `module.exports = "b->" + require("a/name");`,
  "packages/b/name.js": `module.exports = "b";`,
};

async function installFileDepCycle(projectDir: string): Promise<string> {
  const install = async (...args: string[]) => {
    await using proc = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd: projectDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });
    return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  };

  const [out, err, exitCode] = await install();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("error:");
  expect(out).toContain("packages installed");
  expect(exitCode).toBe(0);

  const lock = await file(join(projectDir, "bun.lock")).text();
  expect(await readdirSorted(join(projectDir, "node_modules"))).toStrictEqual(["a", "b"]);
  expect(await readdirSorted(join(projectDir, "node_modules", "a", "node_modules"))).toStrictEqual(["b"]);
  expect(await readdirSorted(join(projectDir, "node_modules", "b", "node_modules"))).toStrictEqual(["a"]);
  expect(await exists(join(projectDir, "node_modules", "a", "node_modules", "b", "node_modules"))).toBe(false);
  expect(await exists(join(projectDir, "node_modules", "b", "node_modules", "a", "node_modules"))).toBe(false);
  expect(await readdirSorted(join(projectDir, "packages", "a"))).toStrictEqual(["index.js", "name.js", "package.json"]);
  expect(await readdirSorted(join(projectDir, "packages", "b"))).toStrictEqual(["index.js", "name.js", "package.json"]);

  await using runProc = spawn({
    cmd: [bunExe(), "-e", `console.log(require("a"), require("b"))`],
    cwd: projectDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [runOut, runErr, runExit] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);
  expect(runErr).toBe("");
  expect(runOut).toBe("a->b b->a\n");
  expect(runExit).toBe(0);

  for (const args of [[], ["--frozen-lockfile"]]) {
    const [, err2, exitCode2] = await install(...args);
    expect(err2).not.toContain("Saved lockfile");
    expect(err2).not.toContain("error:");
    expect(exitCode2).toBe(0);
    expect(await file(join(projectDir, "bun.lock")).text()).toBe(lock);
  }

  return normalizeBunSnapshot(lock, projectDir);
}

it("installs file: dependencies that depend on each other", async () => {
  using dir = tempDir("file-dep-cycle", fileDepCycleFixture);
  expect(await installFileDepCycle(String(dir))).toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 1,
      "workspaces": {
        "": {
          "name": "my-app",
          "dependencies": {
            "a": "file:./packages/a",
            "b": "file:./packages/b",
          },
        },
      },
      "packages": {
        "a": ["a@file:packages/a", { "dependencies": { "b": "file:../b" } }],

        "b": ["b@file:packages/b", { "dependencies": { "a": "file:../a" } }],

        "a/b": ["b@file:packages/b", {}],

        "b/a": ["a@file:packages/a", {}],
      }
    }"
  `);
});

it("installs file: dependencies that depend on each other from a lockfile that only lists the root's copies", async () => {
  using dir = tempDir("file-dep-cycle-lock", {
    ...fileDepCycleFixture,
    "bun.lock": JSON.stringify({
      lockfileVersion: 1,
      workspaces: {
        "": {
          name: "my-app",
          dependencies: { a: "file:./packages/a", b: "file:./packages/b" },
        },
      },
      packages: {
        a: ["a@file:packages/a", { dependencies: { b: "file:../b" } }],
        b: ["b@file:packages/b", { dependencies: { a: "file:../a" } }],
      },
    }),
  });
  expect(await installFileDepCycle(String(dir))).toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 1,
      "configVersion": 0,
      "workspaces": {
        "": {
          "name": "my-app",
          "dependencies": {
            "a": "file:./packages/a",
            "b": "file:./packages/b",
          },
        },
      },
      "packages": {
        "a": ["a@file:packages/a", { "dependencies": { "b": "file:../b" } }],

        "b": ["b@file:packages/b", { "dependencies": { "a": "file:../a" } }],

        "a/b": ["b@file:packages/b", { "dependencies": { "a": "file:../a" } }],

        "b/a": ["a@file:packages/a", { "dependencies": { "b": "file:../b" } }],
      }
    }"
  `);
});

it("fails when a transitive file: dependency's folder does not exist", async () => {
  using dir = tempDir("transitive-file-dep-missing", {
    "package.json": JSON.stringify({
      name: "my-app",
      version: "1.0.0",
      dependencies: {
        lib: "file:./vendor/lib",
      },
    }),
    "vendor/lib/package.json": JSON.stringify({
      name: "lib",
      version: "1.0.0",
      dependencies: {
        nested: "file:../nested",
      },
    }),
    "vendor/lib/index.js": `module.exports = require("nested");`,
  });

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

  // The printed folder path uses the platform separator on Windows.
  expect(err.replaceAll(sep, "/")).toContain('Could not find folder "file:vendor/nested" for dependency "nested"');
  expect(out).not.toContain("2 packages installed");
  expect(exitCode).toBe(1);
});

describe.concurrent("file: tarball declared by a file: folder dependency", () => {
  // `bar-0.0.2.tgz` is planted at the path the declaration means and
  // `baz-0.0.3.tgz` at the other candidate path, so reading the tarball
  // relative to the wrong directory installs `baz` instead of failing with ENOENT.
  const expected = readFileSync(join(import.meta.dir, "bar-0.0.2.tgz"));
  const decoy = readFileSync(join(import.meta.dir, "baz-0.0.3.tgz"));

  const fixture = (root: object, lib: object, tarballs: Record<string, Buffer>) => ({
    "package.json": JSON.stringify({
      name: "my-app",
      version: "1.0.0",
      dependencies: { lib: "file:./vendor/lib" },
      ...root,
    }),
    "vendor/lib/package.json": JSON.stringify({ name: "lib", version: "1.0.0", main: "index.js", ...lib }),
    "vendor/lib/index.js": `const pkg = require("tool/package.json"); module.exports = pkg.name + "@" + pkg.version;`,
    ...tarballs,
  });

  // The first install resolves `tool` from vendor/lib/package.json and reads
  // the tarball in the process. The second one starts from the lockfile with
  // an empty cache, so it has to read the tarball again from the path recorded
  // there; both have to pick the same file.
  async function installAndRequireLib(projectDir: string, linker: "hoisted" | "isolated") {
    const cacheDir = join(projectDir, ".bun-cache");
    const installed: string[] = [];

    for (const args of [["install"], ["install", "--frozen-lockfile"]]) {
      await Promise.all([
        rm(join(projectDir, "node_modules"), { recursive: true, force: true }),
        rm(cacheDir, { recursive: true, force: true }),
      ]);

      await using install = spawn({
        cmd: [bunExe(), ...args, `--linker=${linker}`],
        cwd: projectDir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...env, BUN_INSTALL_CACHE_DIR: cacheDir },
      });
      const [installErr, installOut, installExit] = await Promise.all([
        install.stderr.text(),
        install.stdout.text(),
        install.exited,
      ]);
      expect(installErr).not.toContain("error:");
      expect(installOut).toContain("2 packages installed");
      expect(installExit).toBe(0);

      await using run = spawn({
        cmd: [bunExe(), "-e", `console.log(require("lib"))`],
        cwd: projectDir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const [runErr, runOut, runExit] = await Promise.all([run.stderr.text(), run.stdout.text(), run.exited]);
      expect(runErr).toBe("");
      expect(runExit).toBe(0);
      installed.push(runOut.trim());
    }

    return { installed, lockfile: await file(join(projectDir, "bun.lock")).text() };
  }

  for (const linker of ["hoisted", "isolated"] as const) {
    it(`is read relative to the folder (${linker} linker)`, async () => {
      using dir = tempDir(
        "folder-dep-tarball",
        fixture(
          {},
          { dependencies: { tool: "file:./tool.tgz" } },
          { "vendor/lib/tool.tgz": expected, "tool.tgz": decoy },
        ),
      );

      const { installed, lockfile } = await installAndRequireLib(String(dir), linker);
      expect(installed).toEqual(["bar@0.0.2", "bar@0.0.2"]);
      // The lockfile records the path as declared; the name in front of it is
      // read from the tarball that was extracted.
      expect(lockfile).toContain('"lib": ["lib@file:vendor/lib", { "dependencies": { "tool": "file:./tool.tgz" } }]');
      expect(lockfile).toContain('"tool": ["bar@./tool.tgz", {}, "sha512-');
    });
  }

  it("is read relative to the project when a root override supplies the path", async () => {
    // `overrides` can only be written in the root package.json, so the path it
    // contains means the project directory even though the dependency it is
    // applied to is declared by vendor/lib/package.json.
    using dir = tempDir(
      "folder-dep-tarball-override",
      fixture(
        { overrides: { tool: "file:./tool.tgz" } },
        { dependencies: { tool: "^1.0.0" } },
        { "tool.tgz": expected, "vendor/lib/tool.tgz": decoy },
      ),
    );

    const { installed, lockfile } = await installAndRequireLib(String(dir), "hoisted");
    expect(installed).toEqual(["bar@0.0.2", "bar@0.0.2"]);
    expect(lockfile).toContain('"lib": ["lib@file:vendor/lib", { "dependencies": { "tool": "^1.0.0" } }]');
    expect(lockfile).toContain('"tool": ["bar@./tool.tgz", {}, "sha512-');
  });
});

it("does not extract a local file: tarball outside the temp dir for a dependency alias containing '..' path segments", async () => {
  // For `file:` tarball dependencies, the dependency alias (the key in
  // `dependencies`) is used to derive the temporary extraction folder name.
  // Point bun's temp dir and cache at directories we control so an alias with
  // '..' segments would have to land in one of the directories above the temp
  // dir (or next to the fixture directories) to be observed.
  using dir = tempDir("local-tarball-alias-segments", {
    "zone/a/b/c/d/.keep": "",
    "project/package.json": JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "../../../../../..": "file:./baz-0.0.3.tgz",
      },
    }),
    "project-ok/package.json": JSON.stringify({
      name: "bar",
      version: "0.0.1",
      dependencies: {
        "baz-local": "file:./baz-0.0.3.tgz",
      },
    }),
  });
  const root = String(dir);
  const zone = join(root, "zone");
  const bunTmp = join(zone, "a", "b", "c", "d");
  const testEnv = {
    ...env,
    BUN_TMPDIR: bunTmp,
    TMPDIR: bunTmp,
    BUN_INSTALL_CACHE_DIR: join(root, "cache"),
  };
  await cp(join(import.meta.dir, "baz-0.0.3.tgz"), join(root, "project", "baz-0.0.3.tgz"));
  await cp(join(import.meta.dir, "baz-0.0.3.tgz"), join(root, "project-ok", "baz-0.0.3.tgz"));

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(root, "project"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: testEnv,
  });
  const err = await stderr.text();
  const out = await stdout.text();
  const exitCode = await exited;

  // Nothing from the tarball may be written into the directories above bun's
  // temp dir (zone/a/b/c/d).
  expect(await readdirSorted(zone)).toEqual(["a"]);
  expect(await readdirSorted(join(zone, "a"))).toEqual(["b"]);
  expect(await readdirSorted(join(zone, "a", "b"))).toEqual(["c"]);
  expect(await readdirSorted(join(zone, "a", "b", "c"))).toEqual(["d"]);
  // The tarball's files (`index.js`, `package.json`) may not appear next to
  // the fixture directories either.
  expect(await exists(join(root, "package.json"))).toBe(false);
  expect(await exists(join(root, "index.js"))).toBe(false);
  // The unsafe alias is rejected as an install folder name and nothing is installed.
  expect(err).toContain('Invalid dependency name "../../../../../.."');
  expect(out).not.toContain("1 package installed");
  expect(exitCode).not.toBe(0);

  // A normal alias for the same local tarball still installs.
  const {
    stdout: stdoutOk,
    stderr: stderrOk,
    exited: exitedOk,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(root, "project-ok"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: testEnv,
  });
  const errOk = await stderrOk.text();
  const outOk = await stdoutOk.text();
  const exitCodeOk = await exitedOk;
  expect(await exists(join(root, "project-ok", "node_modules", "baz-local", "package.json"))).toBe(true);
  expect(errOk).not.toContain("error:");
  expect(outOk).toContain("1 package installed");
  expect(exitCodeOk).toBe(0);
});

it("does not create a cache index entry outside the cache directory for a dependency alias of '..'", async () => {
  // For git/github/tarball dependencies the dependency alias (the key in
  // `dependencies`) is used as the folder name for the per-package cache
  // index (`<cache>/<alias>/<resolved-folder>` symlinks). The alias must be a
  // single safe path segment; an alias of exactly ".." must not cause index
  // entries to be created in the parent of the cache directory.
  using dir = tempDir("cache-index-alias-dotdot", {
    "cache-holder/cache/.keep": "",
    "project/package.json": JSON.stringify({
      name: "cache-index-alias-app",
      version: "1.0.0",
      dependencies: {
        "..": "file:./baz-a-0.0.3.tgz",
      },
    }),
    "project-ok/package.json": JSON.stringify({
      name: "cache-index-alias-ok-app",
      version: "1.0.0",
      dependencies: {
        "baz-ok": "file:./baz-b-0.0.3.tgz",
      },
    }),
  });
  const root = String(dir);
  const cacheHolder = join(root, "cache-holder");
  const cacheDir = join(cacheHolder, "cache");
  const testEnv = { ...env, BUN_INSTALL_CACHE_DIR: cacheDir };
  await cp(join(import.meta.dir, "baz-0.0.3.tgz"), join(root, "project", "baz-a-0.0.3.tgz"));
  await cp(join(import.meta.dir, "baz-0.0.3.tgz"), join(root, "project-ok", "baz-b-0.0.3.tgz"));

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(root, "project"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: testEnv,
  });
  const err = await stderr.text();
  await stdout.text();
  const exitCode = await exited;

  // The parent of the cache directory must contain only the cache directory
  // itself — no per-alias index entries (e.g. "@T@<hash>..." symlinks) may be
  // planted next to it.
  expect(await readdirSorted(cacheHolder)).toEqual(["cache"]);
  // The unsafe alias is rejected as an install folder name.
  expect(err).toContain('Invalid dependency name ".."');
  expect(exitCode).not.toBe(0);

  // A normal single-segment alias still gets its cache index entry, inside the
  // cache directory, and installs fine.
  const {
    stdout: stdoutOk,
    stderr: stderrOk,
    exited: exitedOk,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(root, "project-ok"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: testEnv,
  });
  const errOk = await stderrOk.text();
  const outOk = await stdoutOk.text();
  const exitCodeOk = await exitedOk;

  expect(await exists(join(cacheDir, "baz-ok"))).toBe(true);
  expect(await exists(join(root, "project-ok", "node_modules", "baz-ok", "package.json"))).toBe(true);
  // The cache parent still only contains the cache directory after a normal install.
  expect(await readdirSorted(cacheHolder)).toEqual(["cache"]);
  expect(errOk).not.toContain("error:");
  expect(outOk).toContain("1 package installed");
  expect(exitCodeOk).toBe(0);
});

// Two distinct local `file:` dependencies whose absolute package.json paths
// collide under the seed-0 std.Wyhash that keys the folder-resolution dedupe
// map must each resolve to their own package, not share one identity.
// https://github.com/oven-sh/bun/issues/32741
it.skipIf(isWindows)("file: deps with colliding abs-path hashes resolve to distinct packages", async () => {
  using dir = tempDir("folder-resolution-collision", {
    "package.json": JSON.stringify({ name: "victim", version: "0.0.0" }),
  });
  // Use the canonical path so the folder resolver hashes the same bytes we
  // construct the collision from (macOS /tmp -> /private/var symlink, etc.).
  const victimDir = realpathSync(String(dir));
  const prefix = `${victimDir}/`;
  const suffix = "/package.json";

  const collision = constructStdCollision({ seed: 0n, prefixStr: prefix, suffixStr: suffix });
  const name1 = collision.str1.slice(prefix.length, collision.str1.length - suffix.length);
  const name2 = collision.str2.slice(prefix.length, collision.str2.length - suffix.length);

  // Confirm the collision holds against the exact hash the resolver uses before
  // relying on it (Bun.hash.wyhash == bun.hash seed 0 == FolderResolution key).
  const abs1 = `${victimDir}/${name1}/package.json`;
  const abs2 = `${victimDir}/${name2}/package.json`;
  expect(name1).not.toBe(name2);
  expect(name1.includes("/")).toBe(false);
  expect(name2.includes("/")).toBe(false);
  expect(Bun.hash.wyhash(abs1, 0n)).toBe(Bun.hash.wyhash(abs2, 0n));

  await write(join(victimDir, name1, "package.json"), JSON.stringify({ name: "pkg-alpha", version: "1.0.0" }));
  await write(join(victimDir, name1, "index.js"), "module.exports = 'ALPHA';");
  await write(join(victimDir, name2, "package.json"), JSON.stringify({ name: "pkg-beta", version: "2.0.0" }));
  await write(join(victimDir, name2, "index.js"), "module.exports = 'BETA';");
  await write(
    join(victimDir, "package.json"),
    JSON.stringify({
      name: "victim",
      version: "0.0.0",
      dependencies: { alphadep: `file:./${name1}`, betadep: `file:./${name2}` },
    }),
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: victimDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  // Each alias must carry its own package's identity despite the hash collision.
  const alpha = await file(join(victimDir, "node_modules", "alphadep", "package.json")).json();
  const beta = await file(join(victimDir, "node_modules", "betadep", "package.json")).json();
  expect({ alpha: alpha.name, beta: beta.name }).toEqual({ alpha: "pkg-alpha", beta: "pkg-beta" });
});

it("reports an invalid URL for a manifest tarball URL containing a newline", async () => {
  await withContext(defaultOpts, async ctx => {
    const tarballRequests: string[] = [];
    setContextHandler(ctx, async request => {
      const url = new URL(request.url);
      if (url.pathname.includes(".tgz")) {
        tarballRequests.push(request.url);
        return new Response("Not Found", { status: 404 });
      }
      return new Response(
        JSON.stringify({
          name: "baz",
          versions: {
            "0.0.2": {
              name: "baz",
              version: "0.0.2",
              dist: {
                tarball: `${ctx.registry_url}baz\n-0.0.2.tgz`,
              },
            },
          },
          "dist-tags": {
            latest: "0.0.2",
          },
        }),
      );
    });
    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          baz: "0.0.2",
        },
      }),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.package_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(err).toContain("InvalidURL downloading tarball");
    expect(tarballRequests).toEqual([]);
    expect(out).not.toContain("1 package installed");
    expect(exitCode).not.toBe(0);
  });
});

it("reports an invalid URL for a manifest tarball URL containing a space", async () => {
  await withContext(defaultOpts, async ctx => {
    setContextHandler(ctx, async request => {
      const url = new URL(request.url);
      if (url.pathname.includes(".tgz")) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(
        JSON.stringify({
          name: "baz",
          versions: {
            "0.0.2": {
              name: "baz",
              version: "0.0.2",
              dist: {
                tarball: `${ctx.registry_url}baz -0.0.2.tgz`,
              },
            },
          },
          "dist-tags": {
            latest: "0.0.2",
          },
        }),
      );
    });
    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          baz: "0.0.2",
        },
      }),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.package_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(err).toContain("InvalidURL downloading tarball");
    expect(out).not.toContain("1 package installed");
    expect(exitCode).not.toBe(0);
  });
});

it.each([
  ["tab", "\t"],
  ["vertical tab", "\x0b"],
])("reports an invalid URL for a manifest tarball URL containing a %s", async (_name, char) => {
  await withContext(defaultOpts, async ctx => {
    const tarballRequests: string[] = [];
    setContextHandler(ctx, async request => {
      const url = new URL(request.url);
      if (url.pathname.includes(".tgz")) {
        tarballRequests.push(request.url);
        return new Response("Not Found", { status: 404 });
      }
      return new Response(
        JSON.stringify({
          name: "baz",
          versions: {
            "0.0.2": {
              name: "baz",
              version: "0.0.2",
              dist: {
                tarball: `${ctx.registry_url}baz${char}-0.0.2.tgz`,
              },
            },
          },
          "dist-tags": {
            latest: "0.0.2",
          },
        }),
      );
    });
    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          baz: "0.0.2",
        },
      }),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.package_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(err).toContain("InvalidURL downloading tarball");
    expect(tarballRequests).toEqual([]);
    expect(out).not.toContain("1 package installed");
    expect(exitCode).not.toBe(0);
  });
});
