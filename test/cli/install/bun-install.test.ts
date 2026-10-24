import { file, listen, Socket, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, it, jest, setDefaultTimeout, test } from "bun:test";
import { once } from "events";
import { readFileSync, readlinkSync, realpathSync, statSync } from "fs";
import { access, cp, exists, mkdir, readlink, rename, rm, stat, writeFile } from "fs/promises";
import {
  bunEnv,
  bunExe,
  bunEnv as env,
  githubTarball,
  hostedGitRepository,
  isAndroid,
  isLinux,
  isWindows,
  joinP,
  MAX_PATH_BYTES,
  normalizeBunSnapshot,
  readdirSorted,
  runBunInstall,
  substDrive,
  tempDir,
  textLockfile,
  tls,
  toBeValidBin,
  toBeWorkspaceLink,
  toHaveBins,
} from "harness";
import { connect, createServer, type AddressInfo, type Socket as NetSocket } from "net";
import { basename, join, relative, resolve, sep } from "path";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyBeforeAll,
  dummyRegistryForContext,
  root_url,
  setContextHandler,
  setGithubRepository,
  setUglifyJsRepository,
  type TestContext,
} from "./dummy.registry.js";
import { constructStdCollision } from "./wyhash-std-collision.js";
import { wyhash11 } from "./wyhash11.js";

expect.extend({
  toBeWorkspaceLink,
  toBeValidBin,
  toHaveBins,
  toHaveWorkspaceLink: function (package_dir: any, [link, real]: [string, string]) {
    const target = readlinkSync(join(package_dir, "node_modules", link));
    return toBeWorkspaceLink(target, isWindows ? join(package_dir, real) : join("..", real));
  },
  toHaveWorkspaceLink2: function (package_dir: any, [link, realPosix, realWin]: [string, string, string]) {
    const target = readlinkSync(join(package_dir, "node_modules", link));
    return toBeWorkspaceLink(target, isWindows ? join(package_dir, realWin) : join("..", realPosix));
  },
});

declare module "bun:test" {
  interface Matchers<T> {
    toHaveWorkspaceLink(expected: [link: string, real: string]): void;
    toHaveWorkspaceLink2(expected: [link: string, realPosix: string, realWin: string]): void;
  }
}

setDefaultTimeout(1000 * 60 * 5);

beforeAll(async () => {
  dummyBeforeAll();
  // The `owner/repo#ref` dependencies in this file are downloaded from GITHUB_API_URL. The tests that install
  // them run with `githubEnv()`, so the dummy registry serves these stand-ins for the real repositories.
  await Promise.all([
    setUglifyJsRepository(),
    setGithubRepository("dylan-conway", "install-test2", "5ed489c", ["", "HEAD"], {
      "index.js": "",
      "package.json": JSON.stringify({ name: "install-test2", version: "0.2.0", main: "index.js" }),
    }),
    // The real html-minifier depends on seven registry packages. This one depends on `baz`, which the dummy
    // registry can serve, and which has a bin like `he` and `uglify-js` do.
    setGithubRepository("kangax", "html-minifier", "4beb325", ["v4.0.0"], {
      "cli.js": "#!/usr/bin/env node\n",
      "package.json": JSON.stringify({
        name: "html-minifier",
        version: "4.0.0",
        bin: { "html-minifier": "./cli.js" },
        main: "src/htmlminifier.js",
        dependencies: { baz: "^0.0.3" },
      }),
      "src/htmlminifier.js": "",
    }),
  ]);
});

afterAll(dummyAfterAll);

function githubEnv() {
  return { ...env, GITHUB_API_URL: root_url };
}

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

// BUN_CONFIG_MAX_HTTP_REQUESTS is documented as another way to set the request
// limit, so it must not leak in from the outer environment while measuring it.
const networkConcurrencyEnv = { ...env, BUN_CONFIG_MAX_HTTP_REQUESTS: undefined };

// Runs `bun install` with one dependency more than `limit`, against a registry
// that holds every manifest request open, and asserts that bun has exactly
// `limit` requests in flight: the extra dependency has to wait for a slot.
async function expectInstallInFlightLimit(ctx: TestContext, limit: number) {
  const dependencies: Record<string, string> = {};
  for (let i = 0; i < limit + 1; i++) dependencies[`dep-${i}`] = "^1";
  await writeFile(
    join(ctx.package_dir, "package.json"),
    JSON.stringify({ name: "foo", version: "0.0.1", dependencies }),
  );

  let inFlight = 0;
  let maxInFlight = 0;
  const limitReached = Promise.withResolvers<void>();
  const limitExceeded = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  setContextHandler(ctx, async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    if (inFlight >= limit) limitReached.resolve();
    if (inFlight > limit) limitExceeded.resolve();
    await release.promise;
    inFlight--;
    return new Response("404", { status: 404 });
  });

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: ctx.package_dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: networkConcurrencyEnv,
  });
  try {
    // A real limit below `limit` parks bun (and this wait) with fewer requests
    // in flight and no further signal, so the wait is bounded (generously: this
    // is a debug build under CI load) and the assertions below report what was
    // reached. proc.exited covers bun giving up early.
    await Promise.race([limitReached.promise, proc.exited, Bun.sleep(30_000)]);
    // bun sends everything its limit allows in one burst, so a request beyond
    // the limit arrives right behind the others. That it never arrives can only
    // be observed by giving it a moment to show up.
    await Promise.race([limitExceeded.promise, Bun.sleep(500)]);
  } finally {
    release.resolve();
  }
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(maxInFlight).toBe(limit);
  expect(ctx.requested).toBe(limit + 1);
  expect(stderr).toContain("failed to resolve");
  expect(stdout).toContain("bun install v1.");
  expect(exitCode).toBe(1);
}

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

async function createDumbHttpGitRepo(
  dir: string,
  symlinks: Record<string, string>,
  tags: string[] = [],
): Promise<string> {
  const work = join(dir, "work");
  await git(work, ["-c", "init.defaultBranch=main", "init", "--quiet"]);
  await git(work, ["add", "-A"]);
  for (const [path, target] of Object.entries(symlinks)) {
    const oid = await git(work, ["hash-object", "-w", "--no-filters", "--stdin"], target);
    await git(work, ["update-index", "--add", "--cacheinfo", `120000,${oid},${path}`]);
  }
  await git(work, ["-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "init"]);
  for (const tag of tags) {
    await git(work, ["tag", tag]);
  }
  const sha = await git(work, ["rev-parse", "HEAD"]);
  await git(dir, ["clone", "--quiet", "--bare", "work", "repo.git"]);
  await git(join(dir, "repo.git"), ["update-server-info"]);
  return sha;
}

/**
 * The bare clone of a git dependency is kept in the cache under a name derived from its clone task id, whose top bits
 * make the name start with 8 or 9, so it always sorts before the `@G@<sha>` checkout folders listed next to it.
 */
const gitMirrorFolder = expect.stringMatching(/^[89][0-9a-f]{15}\.git$/);

/**
 * A package in a git repository served over dumb HTTP, standing in for a real hosted repository: its single commit is
 * tagged `v1.0.0`, and it has a bin plus whatever else `package_json` adds. Cloning a real repository for the cases
 * using this took 4-12s per case on CI (five cases cloned the same 20MB repository concurrently); this takes well
 * under a second.
 */
async function serveTaggedGitPackage(package_json: Record<string, unknown> = {}) {
  const dir = tempDir("git-dep-tagged", {
    "work/package.json": JSON.stringify({
      name: "tagged",
      version: "1.0.0",
      bin: { tagged: "bin/tagged.js" },
      ...package_json,
    }),
    "work/bin/tagged.js": "#!/usr/bin/env node\nconsole.log('tagged');\n",
  });
  const sha = await createDumbHttpGitRepo(String(dir), {}, ["v1.0.0"]);
  const server = serveDirectory(String(dir));
  return {
    /** The dependency specifier for the repository, without a committish. */
    url: `git+http://localhost:${server.port}/repo.git`,
    sha,
    /** What a checkout of it contains. */
    files: [".bun-tag", "bin", "package.json"],
    [Symbol.dispose]() {
      server.stop(true);
      dir[Symbol.dispose]();
    },
  };
}

/**
 * An HTTP proxy that records every request (plain requests and CONNECT tunnels alike) and refuses all of them with a
 * 404. Spawning an install with the returned `env` routes its traffic, and git's, through the proxy, so a case whose
 * point is an unreachable or made-up host still builds and sends its request but never resolves the host name: a
 * single-label host name such as `example` takes ~45s per `bun install` to fail on the Debian CI images (and ~14s on
 * Windows), where the resolver walks the search domains for it, against a few milliseconds here.
 */
function refusingProxy() {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      requests.push(`${request.method} ${request.url}`);
      return new Response(null, { status: 404 });
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  return {
    requests,
    env: { ...env, http_proxy: url, HTTP_PROXY: url, https_proxy: url, HTTPS_PROXY: url, no_proxy: "", NO_PROXY: "" },
    [Symbol.dispose]: () => server.stop(true),
  };
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

/**
 * Serves URL dependencies (`https://github.com/<user>/<repo>/tarball/<ref>`, `https://some.url/path?stuff`) without
 * the network. `bun install` downloads such URLs as-is (there is no `GITHUB_API_URL` equivalent to point at a test
 * server), so the returned `env` sets `https_proxy` to a CONNECT proxy that opens every tunnel to one local TLS server
 * instead of the host it was asked for. The specifiers keep the real hosts bun classifies them by, and the server
 * sees them: `request.url` is the dependency URL. `targets` holds the `host:port` of every tunnel and `urls` every URL
 * requested. A URL registered with tarball bytes is answered with them, one registered with a `Response` (e.g. a
 * redirect) with that response, anything else with a 404. The context's registry is plain http and bypasses the proxy,
 * so its `urls`/`requested` are unaffected.
 */
async function urlTarballProxy(ctx: TestContext, urls: string[], responses: Record<string, Uint8Array | Response>) {
  const origin = Bun.serve({
    port: 0,
    tls,
    fetch(request) {
      urls.push(request.url);
      const registered = responses[request.url];
      if (!registered) return new Response(`nothing registered for ${request.url}`, { status: 404 });
      return registered instanceof Response ? registered.clone() : new Response(registered);
    },
  });

  const targets: string[] = [];
  const sockets = new Set<NetSocket>();
  const proxy = createServer(client => {
    sockets.add(client);
    client.on("error", () => {});
    client.on("close", () => sockets.delete(client));
    let head = "";
    client.on("data", function onData(chunk: Buffer) {
      head += chunk.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      client.off("data", onData);
      // `pipe()` below resumes the socket once the upstream is connected.
      client.pause();
      targets.push(head.split(" ")[1]);
      const upstream = connect(origin.port!, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        client.pipe(upstream);
        upstream.pipe(client);
      });
      sockets.add(upstream);
      upstream.on("error", () => client.destroy());
      upstream.on("close", () => sockets.delete(upstream));
      client.on("close", () => upstream.destroy());
    });
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");

  const proxy_url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  const registry_host = new URL(ctx.registry_url).hostname;
  return {
    targets,
    env: {
      ...env,
      https_proxy: proxy_url,
      HTTPS_PROXY: proxy_url,
      no_proxy: registry_host,
      NO_PROXY: registry_host,
      // The local server's certificate is not for github.com.
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    },
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      proxy.close();
      await Promise.all([once(proxy, "close"), origin.stop(true)]);
    },
  };
}

describe.concurrent("bun-install", () => {
  it("bun install --help states the --network-concurrency default that bun install actually uses", async () => {
    await using help = spawn({
      cmd: [bunExe(), "install", "--help"],
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [helpStdout, helpStderr, helpExitCode] = await Promise.all([
      help.stdout.text(),
      help.stderr.text(),
      help.exited,
    ]);
    const helpLine = (helpStdout + helpStderr).split(/\r?\n/).find(line => line.includes("--network-concurrency"));
    const documentedDefault = /Maximum number of concurrent network requests \(default (\d+)\)$/.exec(helpLine ?? "");
    expect(documentedDefault).not.toBeNull();
    expect(helpExitCode).toBe(0);

    await withContext(defaultOpts, ctx => expectInstallInFlightLimit(ctx, Number(documentedDefault![1])));
  });

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
          cmd: [bunExe(), "install", "--network-concurrency", input],
          cwd: ctx.package_dir,
          stdout: "inherit",
          stdin: "inherit",
          stderr: "pipe",
          env,
        });
        const err = await stderr.text();
        expect(err).toContain(`Expected --network-concurrency to be a number between 0 and 65535: ${input}`);
        expect(await exited).toBe(1);
        expect(urls).toBeEmpty();
      });
    });
  }

  it.each([
    { label: "--network-concurrency=5", cap: 5, args: ["--network-concurrency", "5"], extraEnv: {} },
    { label: "BUN_CONFIG_MAX_HTTP_REQUESTS=5", cap: 5, args: [], extraEnv: { BUN_CONFIG_MAX_HTTP_REQUESTS: "5" } },
    {
      label: "--network-concurrency=2 overriding BUN_CONFIG_MAX_HTTP_REQUESTS=50",
      cap: 2,
      args: ["--network-concurrency", "2"],
      extraEnv: { BUN_CONFIG_MAX_HTTP_REQUESTS: "50" },
    },
  ])("bun install with $label doesnt go over $cap concurrent requests", async ({ cap, args, extraEnv }) => {
    await withContext(defaultOpts, async ctx => {
      let maxConcurrentRequests = 0;
      let concurrentRequests = 0;
      setContextHandler(ctx, async function () {
        concurrentRequests++;
        maxConcurrentRequests = Math.max(maxConcurrentRequests, concurrentRequests);
        try {
          // Simulated registry latency: requests have to overlap for the stub to
          // observe how many the client keeps in flight at once.
          await Bun.sleep(10);
        } finally {
          concurrentRequests--;
        }
        return new Response("404", { status: 404 });
      });

      const dependencies: Record<string, string> = {};
      for (let i = 1; i <= 51; i++) {
        dependencies[`bar${i}`] = "^1";
      }
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({ name: "foo", version: "0.0.1", dependencies }),
      );

      await using proc = spawn({
        cmd: [bunExe(), "install", ...args],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...env, ...extraEnv },
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(maxConcurrentRequests).toBeLessThanOrEqual(cap);
      expect({ totalRequests: ctx.requested, stdout, stderr, exitCode }).toEqual({
        totalRequests: 51,
        stdout: expect.stringContaining("bun install v1."),
        stderr: expect.stringContaining("failed to resolve"),
        exitCode: 1,
      });
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

  it.each([
    ["an empty name", { "": "" }, 'empty dependency name (in "dependencies")'],
    ["an empty name with a dist-tag", { "": "latest" }, 'empty dependency name (in "dependencies")'],
    ["an empty name with a range", { "": "^1" }, 'empty dependency name (in "dependencies")'],
    ["an npm alias with no name", { "x": "npm:@1.0.0" }, 'invalid package name "@1.0.0" in dependency "npm:@1.0.0"'],
    [
      "an npm alias with no name and a dist-tag",
      { "x": "npm:@latest" },
      'invalid package name "@latest" in dependency "npm:@latest"',
    ],
    ["an npm alias with an empty version", { "x": "npm:@" }, 'invalid package name "@" in dependency "npm:@"'],
    ["a bare npm alias", { "x": "npm:" }, 'invalid package name "" in dependency "npm:"'],
    [
      "an npm alias scope with no name",
      { "x": "npm:@scope/@1" },
      'invalid package name "@scope/" in dependency "npm:@scope/@1"',
    ],
    [
      "an npm alias scope with no name and a dist-tag",
      { "x": "npm:@scope@latest" },
      'invalid package name "@scope" in dependency "npm:@scope@latest"',
    ],
  ])("rejects %s without a registry request", async (_, dependencies, message) => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({ name: "foo", version: "0.0.1", dependencies }),
      );
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [err, out, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
      expect(err).toContain(message);
      expect(out).toEqual(expect.stringContaining("bun install v1."));
      expect(urls).toEqual([]);
      expect(ctx.requested).toBe(0);
      expect(exitCode).toBe(1);
    });
  });

  it.each(["npm:baz", "npm:baz@", "npm:baz@latest", "npm:baz@0.0.3", "npm:baz@~0.0.2", "npm:baz@v0.0.3"])(
    "still follows the alias %s",
    async alias => {
      await withContext(defaultOpts, async ctx => {
        const urls: string[] = [];
        setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.3": {} }));
        await writeFile(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { x: alias } }),
        );
        await using proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env,
        });
        const [err, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
        expect(err).not.toContain("error:");
        expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
        expect(await file(join(ctx.package_dir, "node_modules", "x", "package.json")).json()).toMatchObject({
          name: "baz",
          version: "0.0.3",
        });
        expect(exitCode).toBe(0);
      });
    },
  );

  // A word that can name a package does, as in npm.
  it.each(["x", "v8", "1", "1.x", "0.0.x"])("still reads npm:%s as the name of another package", async name => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.3": {} }));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { baz: `npm:${name}` } }),
      );
      await using proc = spawn({
        cmd: [bunExe(), "install", "--lockfile-only"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [err, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
      expect(err).not.toContain("error:");
      expect(urls).toEqual([`${ctx.registry_url}${name}`]);
      expect(exitCode).toBe(0);
    });
  });

  it.each([
    "npm:^0.0.3",
    "npm:~0.0.2",
    "npm:*",
    "npm:>=0.0.2 <1",
    "npm:0.0.2 || 0.0.3",
    "npm:0.0.3",
    "npm:v0.0.3",
    "npm:=0.0.3",
  ])("reads %s as a range of the dependency's own name", async range => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.3": {} }));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { baz: range } }),
      );
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [err, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
      expect(err).not.toContain("error:");
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
        name: "baz",
        version: "0.0.3",
      });
      expect(exitCode).toBe(0);
    });
  });

  it.each(["npm:@1.0.0", "npm:", "x@npm:@scope/@1"])("bun add %s is refused without a registry request", async spec => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      const packageJson = JSON.stringify({ name: "foo", version: "0.0.1" });
      await writeFile(join(ctx.package_dir, "package.json"), packageJson);
      await using proc = spawn({
        cmd: [bunExe(), "add", spec],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [err, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
      expect(err).toContain(`error: unrecognised dependency format: ${spec}`);
      expect(urls).toEqual([]);
      expect(await file(join(ctx.package_dir, "package.json")).text()).toBe(packageJson);
      expect(exitCode).toBe(1);
    });
  });

  // If another package's manifest has such a dependency, it isn't this project's error. The dependency is skipped,
  // `--verbose` prints the package's name, and the registry isn't asked for `/` or `/@1.0.0`.
  describe.each(["hoisted", "isolated"])("a package's dependency with an empty package name, %s linker", linker => {
    async function install(ctx: TestContext, ...args: string[]) {
      await using proc = spawn({
        cmd: [bunExe(), "install", ...args],
        cwd: ctx.package_dir,
        stdout: "ignore",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      return { err, warnings: err.split(/\r?\n/).filter(line => line.startsWith("warn:")), exitCode };
    }

    const groups = ["dependencies", "optionalDependencies", "peerDependencies"];
    const nameless: Record<string, string>[] = [{ x: "npm:@1.0.0" }, { x: "npm:" }, { "": "1.0.0" }];

    it.each(groups.flatMap(group => nameless.map(declared => [group, JSON.stringify(declared), declared] as const)))(
      "a registry package's %s %s",
      async (group, _, declared) => {
        await withContext(defaultOpts, async ctx => {
          const urls: string[] = [];
          setContextHandler(ctx, heldRegistry(ctx, urls, { holder: { "1.0.0": { [group]: declared } } }));
          await writeProject(ctx, { "package.json": { name: "foo", dependencies: { holder: "1.0.0" } } }, { linker });

          const fresh = await install(ctx, "--verbose");
          expect(fresh.err).not.toContain("error:");
          expect(fresh.warnings).toEqual([
            `warn: skipping unnamed dependency of holder@1.0.0 ("${Object.values(declared)[0]}" in "${group}")`,
          ]);
          expect(urls.sort()).toEqual(["holder", "holder-1.0.0.tgz"]);
          expect(fresh.exitCode).toBe(0);

          // bun.lock does not hold the edge, so it loads again, also when the edge was a required one.
          const lock = Bun.JSONC.parse(await file(join(ctx.package_dir, "bun.lock")).text());
          expect(Object.keys(lock.packages)).toEqual(["holder"]);
          expect(Object.keys(lock.packages.holder[2])).not.toContain(group);
          await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });
          urls.length = 0;
          expect(await install(ctx, "--frozen-lockfile")).toMatchObject({ warnings: [], exitCode: 0 });
          expect(urls).toEqual(["holder-1.0.0.tgz"]);
          expect(await exists(join(ctx.package_dir, "node_modules", "holder", "package.json"))).toBeTrue();
        });
      },
    );

    it("a tarball's dependencies", async () => {
      await withContext(defaultOpts, async ctx => {
        const urls: string[] = [];
        setContextHandler(ctx, heldRegistry(ctx, urls, {}));
        const manifest = { name: "packed", version: "1.0.0", dependencies: { x: "npm:@1.0.0", "": "1.0.0" } };
        await Promise.all([
          writeProject(
            ctx,
            { "package.json": { name: "foo", dependencies: { packed: "file:./packed.tgz" } } },
            { linker },
          ),
          write(
            join(ctx.package_dir, "packed.tgz"),
            await new Bun.Archive({ "package/package.json": JSON.stringify(manifest) }, { compress: "gzip" }).bytes(),
          ),
        ]);

        const { err, warnings, exitCode } = await install(ctx);
        expect(err).not.toContain("error:");
        expect(warnings.sort()).toEqual([
          'warn: skipping unnamed dependency ("1.0.0" in "dependencies")',
          'warn: skipping unnamed dependency ("npm:@1.0.0" in "dependencies")',
        ]);
        expect(urls).toEqual([]);
        expect(await exists(join(ctx.package_dir, "node_modules", "packed", "package.json"))).toBeTrue();
        expect(exitCode).toBe(0);
      });
    });

    it("a row of an older bun.lock", async () => {
      await withContext(defaultOpts, async ctx => {
        const urls: string[] = [];
        setContextHandler(ctx, heldRegistry(ctx, urls, { holder: { "1.0.0": {} } }));
        await writeProject(
          ctx,
          {
            "package.json": { name: "foo", dependencies: { holder: "1.0.0" } },
            "bun.lock": {
              lockfileVersion: 1,
              workspaces: { "": { name: "foo", dependencies: { holder: "1.0.0" } } },
              packages: {
                holder: [
                  "holder@1.0.0",
                  `${ctx.registry_url}holder-1.0.0.tgz`,
                  { optionalDependencies: { x: "npm:@1.0.0" } },
                  "",
                ],
              },
            },
          },
          { linker },
        );

        const { err, exitCode } = await install(ctx);
        expect(err).not.toContain("error:");
        expect(urls).toEqual(["holder-1.0.0.tgz"]);
        expect(await exists(join(ctx.package_dir, "node_modules", "holder", "package.json"))).toBeTrue();
        expect(exitCode).toBe(0);
      });
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

  describe.each([
    // The proxy would refuse the retry too.
    { status: "407 Proxy Authentication Required", code: 407, connects: 1 },
    // Its upstream may be back by the retry: 1 attempt + 5 retries.
    { status: "502 Bad Gateway", code: 502, connects: 6 },
  ])("a proxy that answers CONNECT with $code", ({ status, code, connects }) => {
    it(`is reported with its status after ${connects} attempt(s)`, async () => {
      await withContext(defaultOpts, async ctx => {
        const seen: string[] = [];
        const proxy = listen<{ head: string }>({
          socket: {
            open(socket) {
              socket.data = { head: "" };
            },
            data(socket, data) {
              socket.data.head += data.toString();
              const end = socket.data.head.indexOf("\r\n\r\n");
              if (end === -1) return;
              seen.push(socket.data.head.slice(0, socket.data.head.indexOf("\r\n")));
              socket.end(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\n\r\n`);
            },
          },
          hostname: "127.0.0.1",
          port: 0,
        });
        try {
          await writeFile(
            join(ctx.package_dir, "bunfig.toml"),
            Bun.TOML.stringify({ install: { cache: false, registry: "https://registry.invalid/" } }),
          );
          await writeFile(
            join(ctx.package_dir, "package.json"),
            JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "0.0.2" } }),
          );
          await using proc = spawn({
            cmd: [bunExe(), "install"],
            cwd: ctx.package_dir,
            stdout: "pipe",
            stderr: "pipe",
            env: {
              ...env,
              HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
              https_proxy: undefined,
              NO_PROXY: undefined,
              no_proxy: undefined,
            },
          });
          const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(err).toContain(`error: ProxyConnectFailed (${code}) downloading package manifest bar`);
          expect(seen).toEqual(Array(connects).fill("CONNECT registry.invalid:443 HTTP/1.1"));
          expect(exitCode).toBe(1);
        } finally {
          proxy.stop(true);
        }
      });
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

  // The two tests below install the same workspace twice, changing it in between. The second install used to fail to
  // find the workspace packages because the paths recorded in the lockfile were kept instead of the freshly parsed
  // ones (https://github.com/oven-sh/bun/issues/10833). Every dependency is a workspace, so no registry is involved.
  const repoRoot = {
    name: "my-workspace",
    private: true,
    version: "0.0.1",
    devDependencies: { "@repo/ui": "*", "@repo/eslint-config": "*", "@repo/typescript-config": "*" },
    workspaces: ["packages/*"],
  };
  const repoUi = {
    name: "@repo/ui",
    version: "0.0.0",
    private: true,
    devDependencies: { "@repo/eslint-config": "*", "@repo/typescript-config": "*" },
  };
  const repoWorkspace = {
    "package.json": JSON.stringify(repoRoot),
    "packages/eslint-config/package.json": JSON.stringify({
      name: "@repo/eslint-config",
      version: "0.0.0",
      private: true,
    }),
    "packages/typescript-config/package.json": JSON.stringify({
      name: "@repo/typescript-config",
      version: "0.0.0",
      private: true,
    }),
    "packages/ui/package.json": JSON.stringify(repoUi),
  };

  async function installRepoWorkspace(package_dir: string) {
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(out).toContain("bun install v1.");
    expect(exitCode).toBe(0);
    return file(join(package_dir, "bun.lock")).text();
  }

  // Returns where the links in node_modules/@repo point, relative to the project, for any kind of link (relative
  // symlinks here, junctions or symlinks on Windows depending on the linker).
  async function repoLinks(package_dir: string) {
    const root = realpathSync(package_dir);
    const links: Record<string, string> = {};
    for (const name of await readdirSorted(join(package_dir, "node_modules", "@repo"))) {
      const target = realpathSync(join(package_dir, "node_modules", "@repo", name));
      links[`@repo/${name}`] = relative(root, target).replaceAll(sep, "/");
    }
    return links;
  }

  it("should work when moving workspace packages", async () => {
    using dir = tempDir("workspace-move", repoWorkspace);
    const package_dir = String(dir);

    expect(await installRepoWorkspace(package_dir)).toContain('"@repo/ui@workspace:packages/ui"');
    expect(await repoLinks(package_dir)).toEqual({
      "@repo/eslint-config": "packages/eslint-config",
      "@repo/typescript-config": "packages/typescript-config",
      "@repo/ui": "packages/ui",
    });

    // Move every package to config/ and point the workspaces glob there.
    await rename(join(package_dir, "packages"), join(package_dir, "config"));
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ ...repoRoot, workspaces: ["config/*"] }));

    const lockfile = await installRepoWorkspace(package_dir);
    for (const name of ["eslint-config", "typescript-config", "ui"]) {
      expect(lockfile).toContain(`"@repo/${name}@workspace:config/${name}"`);
    }
    expect(lockfile).not.toContain("packages/");
    expect(await repoLinks(package_dir)).toEqual({
      "@repo/eslint-config": "config/eslint-config",
      "@repo/typescript-config": "config/typescript-config",
      "@repo/ui": "config/ui",
    });
  });

  it("should work when renaming a single workspace package", async () => {
    using dir = tempDir("workspace-rename", repoWorkspace);
    const package_dir = String(dir);

    expect(await installRepoWorkspace(package_dir)).toContain('"@repo/eslint-config@workspace:packages/eslint-config"');
    expect(await repoLinks(package_dir)).toEqual({
      "@repo/eslint-config": "packages/eslint-config",
      "@repo/typescript-config": "packages/typescript-config",
      "@repo/ui": "packages/ui",
    });

    // Rename @repo/eslint-config to @repo/eslint-config-lol in place, in the package itself and in both dependents.
    await Promise.all([
      writeFile(
        join(package_dir, "package.json"),
        JSON.stringify({
          ...repoRoot,
          devDependencies: { "@repo/ui": "*", "@repo/eslint-config-lol": "*", "@repo/typescript-config": "*" },
        }),
      ),
      writeFile(
        join(package_dir, "packages", "eslint-config", "package.json"),
        JSON.stringify({ name: "@repo/eslint-config-lol", version: "0.0.0", private: true }),
      ),
      writeFile(
        join(package_dir, "packages", "ui", "package.json"),
        JSON.stringify({
          ...repoUi,
          devDependencies: { "@repo/eslint-config-lol": "*", "@repo/typescript-config": "*" },
        }),
      ),
    ]);

    const lockfile = await installRepoWorkspace(package_dir);
    expect(lockfile).toContain('"@repo/eslint-config-lol@workspace:packages/eslint-config"');
    expect(lockfile).not.toContain('"@repo/eslint-config@workspace:');
    // Uses toMatchObject because the link for the old name is currently left behind, which isn't what this test is
    // about.
    expect(await repoLinks(package_dir)).toMatchObject({
      "@repo/eslint-config-lol": "packages/eslint-config",
      "@repo/typescript-config": "packages/typescript-config",
      "@repo/ui": "packages/ui",
    });
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

  // Registries such as Nexus and Artifactory answer manifest and tarball
  // requests on http with a redirect to the same host on https
  // (https://github.com/oven-sh/bun/issues/15516). bun keeps the token across
  // that redirect when the port stays the same (or goes from 80 to 443). Any
  // other change of port, scheme or hostname drops it.
  describe("registry token across redirects", () => {
    const token = "secret-registry-token";
    const tgz = join(import.meta.dir, "registry", "packages", "no-deps", "no-deps-1.0.0.tgz");
    const integrity = "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==";
    const manifestPath = "/no-deps";
    const tarballPath = "/no-deps/-/no-deps-1.0.0.tgz";

    // Serves both schemes on one port. A connection that starts with a TLS handshake record (0x16) is piped to
    // `httpsPort`, and any other connection to `httpPort`.
    async function serveBothSchemes(httpPort: number, httpsPort: number) {
      const server = createServer(client => {
        client.on("error", () => {});
        client.once("data", (first: Buffer) => {
          const upstream = connect(first[0] === 0x16 ? httpsPort : httpPort, "127.0.0.1");
          upstream.on("error", () => client.destroy());
          client.on("error", () => upstream.destroy());
          upstream.write(first);
          client.pipe(upstream).pipe(client);
        });
      });
      const listening = Promise.withResolvers<void>();
      server.on("error", listening.reject);
      server.listen(0, "127.0.0.1", listening.resolve);
      await listening.promise;
      return {
        port: (server.address() as AddressInfo).port,
        [Symbol.dispose]() {
          server.close();
        },
      };
    }

    // The registry lives on `registry`://127.0.0.1; `target` is the scheme and
    // hostname it redirects to. The port differs too, unless `samePort` puts
    // both servers behind one port. https servers use the harness certificate,
    // which the install trusts via --cafile.
    it.each([
      {
        name: "keeps the token when the redirect upgrades http to https on the same port",
        registry: "http",
        target: "https://127.0.0.1",
        samePort: true,
        authorization: `Bearer ${token}`,
      },
      {
        name: "drops the token when the redirect upgrades http to https on another port",
        registry: "http",
        target: "https://127.0.0.1",
        authorization: null,
      },
      {
        name: "drops the token when only the port changes",
        registry: "http",
        target: "http://127.0.0.1",
        authorization: null,
      },
      {
        name: "drops the token when only the port changes (https registry)",
        registry: "https",
        target: "https://127.0.0.1",
        authorization: null,
      },
      {
        name: "drops the token when the redirect downgrades https to http",
        registry: "https",
        target: "http://127.0.0.1",
        authorization: null,
      },
      {
        name: "drops the token when the redirect downgrades https to http on the same port",
        registry: "https",
        target: "http://127.0.0.1",
        samePort: true,
        authorization: null,
      },
      {
        // The same machine, but a different hostname than the registry's.
        name: "drops the token when the hostname changes",
        registry: "http",
        target: "http://localhost",
        authorization: null,
      },
    ])("$name", async ({ registry: registryScheme, target, samePort, authorization }) => {
      // `target` serves the manifest and the tarball unconditionally and
      // records the Authorization header each hop arrived with.
      const received: { pathname: string; authorization: string | null }[] = [];
      await using targetServer = Bun.serve({
        port: 0,
        ...(target.startsWith("https:") ? tls : {}),
        fetch(req) {
          const { pathname } = new URL(req.url);
          received.push({ pathname, authorization: req.headers.get("authorization") });
          if (pathname === manifestPath) {
            // `dist.tarball` points at the registry origin so the tarball
            // request carries the token in the first place (see the test
            // above); the registry then redirects it as well.
            return Response.json({
              name: "no-deps",
              "dist-tags": { latest: "1.0.0" },
              versions: {
                "1.0.0": {
                  name: "no-deps",
                  version: "1.0.0",
                  dist: { integrity, tarball: `${registryScheme}://127.0.0.1:${registryPort}${tarballPath}` },
                },
              },
            });
          }
          if (pathname === tarballPath) return new Response(file(tgz));
          return new Response("not found", { status: 404 });
        },
      });
      // The registry requires the token and answers every request with a
      // redirect to the same path on `target`.
      await using registry = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        ...(registryScheme === "https" ? tls : {}),
        fetch(req) {
          if (req.headers.get("authorization") !== `Bearer ${token}`) {
            return new Response("unauthorized", { status: 401 });
          }
          return Response.redirect(`${target}:${targetPort}${new URL(req.url).pathname}`, 302);
        },
      });
      const [httpServer, httpsServer] = registryScheme === "http" ? [registry, targetServer] : [targetServer, registry];
      using bothSchemes = samePort ? await serveBothSchemes(httpServer.port!, httpsServer.port!) : undefined;
      const registryPort = bothSchemes?.port ?? registry.port;
      const targetPort = bothSchemes?.port ?? targetServer.port;

      using dir = tempDir("token-across-redirects", {
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
        ".npmrc": [
          `registry=${registryScheme}://127.0.0.1:${registryPort}/`,
          `//127.0.0.1:${registryPort}/:_authToken=${token}`,
          ``,
        ].join("\n"),
        "cafile": tls.cert,
      });
      await using proc = spawn({
        cmd: [bunExe(), "install", "--cafile", "cafile"],
        cwd: String(dir),
        env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stderr, received }).toEqual({
        stderr: expect.stringContaining("Saved lockfile"),
        received: [
          { pathname: manifestPath, authorization },
          { pathname: tarballPath, authorization },
        ],
      });
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);
    });

    // The commands that send one request at a time follow the same rule.
    describe.each([
      { name: "on the same port keeps the token", samePort: true, authorization: `Bearer ${token}` },
      { name: "on another port drops the token", samePort: false, authorization: null },
    ])("an upgrade from http to https $name", ({ samePort, authorization }) => {
      it.each([
        [["info", "no-deps"], manifestPath],
        [["pm", "view", "no-deps"], manifestPath],
        [["pm", "whoami"], "/-/whoami"],
        [["pm", "diff", "no-deps"], manifestPath],
        [["audit"], "/-/npm/v1/security/advisories/bulk"],
        [["publish"], "/app"],
      ])("%j", async (cmd, requested) => {
        const received: { pathname: string; authorization: string | null }[] = [];
        await using targetServer = Bun.serve({
          port: 0,
          ...tls,
          fetch(req) {
            const { pathname } = new URL(req.url);
            received.push({ pathname, authorization: req.headers.get("authorization") });
            if (pathname === tarballPath) return new Response(file(tgz));
            if (pathname === "/-/whoami") return Response.json({ username: "me" });
            if (pathname !== manifestPath) return Response.json({});
            return Response.json({
              name: "no-deps",
              "dist-tags": { latest: "1.0.0" },
              versions: {
                "1.0.0": {
                  name: "no-deps",
                  version: "1.0.0",
                  dist: { integrity, tarball: `http://127.0.0.1:${registryPort}${tarballPath}` },
                },
              },
            });
          },
        });
        await using registry = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch: req => Response.redirect(`https://127.0.0.1:${targetPort}${new URL(req.url).pathname}`, 308),
        });
        using bothSchemes = samePort ? await serveBothSchemes(registry.port!, targetServer.port!) : undefined;
        const registryPort = bothSchemes?.port ?? registry.port;
        const targetPort = bothSchemes?.port ?? targetServer.port;

        using dir = tempDir("token-across-redirects", {
          "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
          "bun.lock": JSON.stringify({
            lockfileVersion: 1,
            workspaces: { "": { name: "app", dependencies: { "no-deps": "1.0.0" } } },
            packages: { "no-deps": ["no-deps@1.0.0", "", {}, integrity] },
          }),
          ".npmrc": [
            `registry=http://127.0.0.1:${registryPort}/`,
            `//127.0.0.1:${registryPort}/:_authToken=${token}`,
            ``,
          ].join("\n"),
          "cafile": tls.cert,
        });
        await using proc = spawn({
          cmd: [bunExe(), ...cmd, "--cafile", "cafile"],
          cwd: String(dir),
          env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);

        expect(stderr).not.toContain("error:");
        expect(received[0]).toEqual({ pathname: requested, authorization });
        expect(exitCode).toBe(0);
      });
    });
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

    function recording(received: Received[], handler: (req: Request, server: { port?: number }) => Response) {
      return (req: Request, server: { port?: number }) => {
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
    // header must encode. The userinfo is percent-encoded like the rest of the
    // URL (`p@ss` can only be written as `p%40ss`), so it is decoded the way
    // curl and node's `http.get` decode it: the username is split off at the
    // colon written in the URL, every `%XX` is decoded, a `%` that no two hex
    // digits follow stays, and a missing password is sent as an empty one.
    // npm 11 sends the userinfo undecoded, which makes such passwords
    // impossible to use with it; it would also percent-encode the second
    // colon of the last row because it serializes the URL first.
    it.each([
      ["a username and a password", "carol:s3cret", "carol:s3cret", []],
      ["a username and a password, isolated linker", "carol:s3cret", "carol:s3cret", ["--linker", "isolated"]],
      ["a username only", "carol", "carol:", []],
      ["a password only", ":s3cret", ":s3cret", []],
      ["a percent-encoded password", "carol:s3%40cret", "carol:s3@cret", []],
      ["a percent-encoded username and password", "us%25er:p%40ss%3Aw", "us%er:p@ss:w", []],
      ["lowercase hex digits", "carol:s3%2fcret", "carol:s3/cret", []],
      ["a percent sign that no hex digits follow", "carol:50%off%2F2", "carol:50%off/2", []],
      ["a trailing percent sign", "carol:s3cret%", "carol:s3cret%", []],
      ["a percent-encoded colon in the username", "car%3Aol", "car:ol:", []],
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

    it("sends the credentials to the host in front of a backslash, not the one behind it", async () => {
      // `new URL("http://u:p@first\\x@second/pkg.tgz")` reads the host as `first` and the
      // credentials as `u:p`, because a `\` ends the authority of an http URL. npm reads it the
      // same way. The path of the request is not compared: Windows turns the `\` into a `/`.
      const firstReceived: Received[] = [];
      const secondReceived: Received[] = [];
      await using first = serveTarball(firstReceived, basic("u:p"));
      await using second = serveTarball(secondReceived, null);

      const result = await install(
        String.raw`http://u:p@127.0.0.1:${first.port}\x@127.0.0.1:${second.port}${tarballPath}`,
      );

      expect({
        first: firstReceived.map(({ url, authorization }) => ({ host: new URL(url).host, authorization })),
        secondReceived,
        ...result,
      }).toEqual({
        first: [{ host: `127.0.0.1:${first.port}`, authorization: basic("u:p") }],
        secondReceived: [],
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

  // `registry = "https://user:pass@host/"` written literally is split into
  // credentials while bunfig.toml is parsed. A `registry = "$ENV_VAR"` value is
  // only expanded later, in `Scope::from_api`, so the credentials inside the
  // variable's URL have to be split out there.
  describe("credentials embedded in a registry URL taken from an env var", () => {
    const tgz = join(import.meta.dir, "registry", "packages", "no-deps", "no-deps-1.0.0.tgz");
    const integrity = "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==";
    const basic = `Basic ${Buffer.from("alice:s3cret").toString("base64")}`;

    async function installWith(opts: {
      bunfig: (registryOrigin: string) => string;
      env?: (registryOrigin: string) => Record<string, string>;
      files?: (registryOrigin: string) => Record<string, string>;
      dependency?: string;
    }) {
      const requests: { path: string; authorization: string | null }[] = [];
      await using registry = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          const { pathname } = new URL(req.url);
          requests.push({ path: pathname, authorization: req.headers.get("authorization") });
          if (pathname.endsWith(".tgz")) {
            return new Response(Bun.file(tgz));
          }
          const name = decodeURIComponent(pathname.slice(1));
          if (name !== "no-deps" && name !== "@myorg/pkg") {
            return new Response("not found", { status: 404 });
          }
          return Response.json({
            name,
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name,
                version: "1.0.0",
                dist: { integrity, tarball: `http://127.0.0.1:${registry.port}/${name}/-/pkg-1.0.0.tgz` },
              },
            },
          });
        },
      });
      const origin = `127.0.0.1:${registry.port}`;
      const dependency = opts.dependency ?? "no-deps";

      using dir = tempDir("registry-url-credentials", {
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { [dependency]: "1.0.0" } }),
        "bunfig.toml": opts.bunfig(origin),
        ...opts.files?.(origin),
      });

      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"), ...opts.env?.(origin) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { requests, stdout, stderr, exitCode };
    }

    const basicAuthForms: [name: string, opts: Parameters<typeof installWith>[0]][] = [
      [
        "install.registry = $ENV_VAR",
        {
          bunfig: () => `[install]\nregistry = "$MY_REG"\n`,
          env: origin => ({ MY_REG: `http://alice:s3cret@${origin}/` }),
        },
      ],
      [
        "install.registry = $ENV_VAR, set in the project's .env",
        {
          bunfig: () => `[install]\nregistry = "$MY_REG"\n`,
          files: origin => ({ ".env": `MY_REG=http://alice:s3cret@${origin}/\n` }),
        },
      ],
      [
        "install.registry = { url = $ENV_VAR }",
        {
          bunfig: () => `[install]\nregistry = { url = "$MY_REG" }\n`,
          env: origin => ({ MY_REG: `http://alice:s3cret@${origin}/` }),
        },
      ],
      [
        "install.scopes entry = $ENV_VAR",
        {
          bunfig: () => `[install.scopes]\n"@myorg" = "$MY_REG"\n`,
          env: origin => ({ MY_REG: `http://alice:s3cret@${origin}/` }),
          dependency: "@myorg/pkg",
        },
      ],
    ];

    for (const [name, opts] of basicAuthForms) {
      it(`sends user:pass@ from the URL as Basic auth (${name})`, async () => {
        const { requests, stdout, stderr, exitCode } = await installWith(opts);
        const manifestPath = opts.dependency === "@myorg/pkg" ? "/@myorg%2fpkg" : "/no-deps";
        const tarballPath = `/${opts.dependency ?? "no-deps"}/-/pkg-1.0.0.tgz`;
        expect({ requests, stderr }).toEqual({
          requests: [
            { path: manifestPath, authorization: basic },
            { path: tarballPath, authorization: basic },
          ],
          stderr: expect.not.stringContaining("s3cret"),
        });
        expect(stdout).toContain("1 package installed");
        expect(exitCode).toBe(0);
      });
    }

    it("sends :token@ from the URL as a Bearer token", async () => {
      const { requests, stdout, stderr, exitCode } = await installWith({
        bunfig: () => `[install]\nregistry = "$MY_REG"\n`,
        env: origin => ({ MY_REG: `http://:tok-from-env@${origin}/` }),
      });
      expect({ requests, stderr }).toEqual({
        requests: [
          { path: "/no-deps", authorization: "Bearer tok-from-env" },
          { path: "/no-deps/-/pkg-1.0.0.tgz", authorization: "Bearer tok-from-env" },
        ],
        stderr: expect.not.stringContaining("tok-from-env"),
      });
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);
    });

    it("does not print the credentials with the request URL", async () => {
      const { requests, stderr, exitCode } = await installWith({
        bunfig: () => `[install]\nregistry = "$MY_REG"\n`,
        env: origin => ({ MY_REG: `http://alice:s3cret@${origin}/` }),
        dependency: "not-on-this-registry",
      });
      expect({ requests, stderr }).toEqual({
        requests: [{ path: "/not-on-this-registry", authorization: basic }],
        stderr: expect.stringMatching(/error: GET http:\/\/127\.0\.0\.1:\d+\/+not-on-this-registry - 404/),
      });
      expect(stderr).not.toContain("s3cret");
      expect(exitCode).toBe(1);
    });

    // Either kind of configured credential has to win: `from_api` sends a token
    // in preference to a username/password pair, so a token taken from the URL
    // would otherwise displace an explicitly configured pair.
    const explicitWins: [name: string, bunfig: string, urlUserinfo: string, expected: string][] = [
      [
        "configured token vs user:pass@ in the URL",
        `[install]\nregistry = { url = "$MY_REG", token = "configured-token" }\n`,
        "alice:s3cret",
        "Bearer configured-token",
      ],
      [
        "configured username/password vs :token@ in the URL",
        `[install]\nregistry = { url = "$MY_REG", username = "configured-user", password = "configured-pass" }\n`,
        ":s3cret",
        `Basic ${Buffer.from("configured-user:configured-pass").toString("base64")}`,
      ],
    ];

    for (const [name, bunfig, urlUserinfo, expected] of explicitWins) {
      it(`credentials configured explicitly override the ones inside the URL (${name})`, async () => {
        const { requests, stderr, exitCode } = await installWith({
          bunfig: () => bunfig,
          env: origin => ({ MY_REG: `http://${urlUserinfo}@${origin}/` }),
          dependency: "not-on-this-registry",
        });
        expect({ requests, stderr }).toEqual({
          requests: [{ path: "/not-on-this-registry", authorization: expected }],
          stderr: expect.stringMatching(/error: GET http:\/\/127\.0\.0\.1:\d+\/+not-on-this-registry - 404/),
        });
        expect(stderr).not.toContain("s3cret");
        expect(exitCode).toBe(1);
      });
    }
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

  it("--verbose escapes control characters in the tarball URL and response headers it traces", async () => {
    // U+009B is the one-byte form of ESC [ (CSI), so "\u009b31m" written to a terminal as-is turns the
    // rest of the line red. Header values are byte strings: the two Latin-1 characters below go out as
    // the bytes C2 9B, the UTF-8 encoding of U+009B.
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        return new Response("not found", { status: 404, headers: { "x-evil": "a\u00c2\u009b31mb" } });
      },
    });

    const origin = `http://127.0.0.1:${server.port}`;
    using dir = tempDir("install-verbose-escape", {
      "package.json": Buffer.concat([
        Buffer.from(`{"name":"app","dependencies":{"csi":"${origin}/csi-\u009b31m.tgz","latin1":"${origin}/latin1-`),
        // A Latin-1 encoded package.json: a lone 0x9B (the 8-bit CSI) and a stray continuation byte,
        // neither of which is valid UTF-8.
        Buffer.from([0x82, 0x41, 0x9b, 0x41]),
        Buffer.from(`.tgz"}}`),
      ]),
    });

    await using proc = spawn({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderrBytes, exitCode] = await Promise.all([proc.stderr.bytes(), proc.exited]);
    const stderr = new TextDecoder().decode(stderrBytes);

    const requestedUrls = stderr.split(/\r?\n/).flatMap(line => {
      const match = /^\s*>?\s*HTTP\/1\.1 GET (.*)$/.exec(line);
      return match ? [match[1]] : [];
    });
    // A URL is requested, and traced, as `new URL()` serialises it. One that is not valid UTF-8 is requested as
    // written, and the trace shows U+FFFD for each of those bytes.
    expect(requestedUrls.sort()).toEqual([`${origin}/csi-%C2%9B31m.tgz`, `${origin}/latin1-�A�A.tgz`]);
    expect(stderr.split(/\r?\n/).filter(line => line.startsWith("< x-evil:"))).toEqual([
      "< x-evil: a\\u009b31mb",
      "< x-evil: a\\u009b31mb",
    ]);
    // The lenient decode above also shows U+FFFD for the raw Latin-1 bytes themselves, so check
    // separately that they were not copied to stderr as-is.
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(stderrBytes)).not.toThrow();
    expect(exitCode).toBe(1);
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

  // When node_modules already exists, the hoisted installer first checks what is installed at
  // node_modules/<alias> by appending "/package.json" (or "/.bun-tag" for git dependencies) to
  // the alias inside the path buffer holding it. The alias may be up to one byte short of the
  // buffer (4096 bytes on Linux, 1024 on macOS), so aliases a few bytes short of it used to crash
  // the install right there. A name over 255 bytes no longer gets that far: it is refused when it is read.
  // On Windows the buffer is far larger than any path the OS accepts.
  describe.concurrent.skipIf(isWindows)("dependency alias that fills the path buffer", () => {
    const alias = Buffer.alloc((isLinux ? 4096 : 1024) - 6, "a").toString();

    async function installIntoExistingNodeModules(cwd: string) {
      await using proc = spawn({
        // hardlink (the Linux default) creates node_modules/<alias> itself on every platform, so
        // the failure is reported the same way on macOS, whose default backend is clonefile.
        cmd: [bunExe(), "install", "--linker", "hoisted", "--backend", "hardlink"],
        cwd,
        env: { ...env, BUN_INSTALL_CACHE_DIR: join(cwd, ".cache") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(`error: invalid dependency name "${alias}"`);
      expect(stdout).not.toContain("installed");
      expect(exitCode).toBe(1);
    }

    it("is refused for a file: dependency", async () => {
      using dir = tempDir("long-alias-file-dep", {
        "package.json": JSON.stringify({ name: "app", dependencies: { [alias]: "file:./pkg" } }),
        "pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
        "node_modules": {},
      });

      await installIntoExistingNodeModules(String(dir));
    });

    it("is refused for a git dependency", async () => {
      using dir = tempDir("long-alias-git-dep", {
        "work/package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
        "app/node_modules": {},
      });
      await createDumbHttpGitRepo(String(dir), {});
      using server = serveDirectory(String(dir));
      const app = join(String(dir), "app");
      await writeFile(
        join(app, "package.json"),
        JSON.stringify({ name: "app", dependencies: { [alias]: `git+http://localhost:${server.port}/repo.git` } }),
      );

      await installIntoExistingNodeModules(app);
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
        env: githubEnv(),
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
        env: githubEnv(),
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
        env: githubEnv(),
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
        env: githubEnv(),
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

  it("should skip bin entries whose value is not a string in a registry manifest", async () => {
    // npm (normalize-package-bin) drops an entry whose value is not a string and keeps the rest.
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": {
            bin: {
              "baz-run": "index.js",
              "baz-bad": 5,
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
          dependencies: {
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
        "+ baz@0.0.3",
        "",
        "1 package installed",
      ]);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["baz-exec", "baz-run"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-exec")).toBeValidBin(join("..", "baz", "index.js"));
      expect(await exited).toBe(0);
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

  // Serves the versions in `registry` for each name, with one fixture tarball per name, so the manifest decides the
  // version. Every request is recorded in `urls`.
  function aliasRegistry(ctx: TestContext, urls: string[], registry: Record<string, string[]>) {
    return async (request: Request) => {
      urls.push(request.url);
      const path = new URL(request.url).pathname.replace(`/${ctx.id}/`, "");
      if (path.endsWith(".tgz")) {
        return new Response(file(join(import.meta.dir, path.startsWith("baz-") ? "baz-0.0.3.tgz" : "boba-0.0.2.tgz")));
      }
      if (!(path in registry)) return new Response(null, { status: 404 });
      const versions: Record<string, object> = {};
      for (const version of registry[path]) {
        versions[version] = { name: path, version, dist: { tarball: `${ctx.registry_url}${path}-${version}.tgz` } };
      }
      return new Response(JSON.stringify({ name: path, versions, "dist-tags": { latest: registry[path].at(-1) } }));
    };
  }

  // The root's "boba" is an `npm:` alias of baz, and the workspace moo depends on plain "boba". moo uses the alias's
  // package when its range overlaps the alias's range and holds a bound of it, and asks the registry for the package
  // named boba otherwise. `nested` is what bun.lock then has for "moo/boba". A peer only has to hold a bound, and the
  // hoister binds an `unmetPeer` to the root's "boba" anyway.
  it.each<{ alias: string; moo: object; baz: string[]; boba: string[]; nested?: string; unmetPeer?: true }>([
    // moo's range holds the exclusive upper bound of the alias's range, and the ranges do not overlap
    {
      alias: "~0.0.3",
      moo: { dependencies: { boba: ">=0.1.0" } },
      baz: ["0.0.3", "0.0.5"],
      boba: ["0.1.0"],
      nested: "0.1.0",
    },
    {
      alias: "^1.0.0",
      moo: { dependencies: { boba: "^2.0.0" } },
      baz: ["1.0.0", "1.5.0"],
      boba: ["2.0.0"],
      nested: "2.0.0",
    },
    { alias: "1.x", moo: { dependencies: { boba: "2.x" } }, baz: ["1.0.0", "1.5.0"], boba: ["2.0.0"], nested: "2.0.0" },
    // an exact version has no upper comparator, and the unset one reads as 0.0.0
    {
      alias: "0.0.5",
      moo: { dependencies: { boba: "<0.0.4" } },
      baz: ["0.0.3", "0.0.5"],
      boba: ["0.0.2"],
      nested: "0.0.2",
    },
    // the ranges overlap, and moo's range holds no bound of the alias's range
    {
      alias: "^1.0.0",
      moo: { dependencies: { boba: "^1.2.0" } },
      baz: ["1.0.0", "1.5.0"],
      boba: ["1.3.0"],
      nested: "1.3.0",
    },
    { alias: "*", moo: { dependencies: { boba: "1.3.0" } }, baz: ["1.0.0", "1.5.0"], boba: ["1.3.0"], nested: "1.3.0" },
    // the ranges overlap, and moo's range holds the exclusive upper bound only
    { alias: "~0.0.3", moo: { dependencies: { boba: ">=0.0.4" } }, baz: ["0.0.3", "0.0.5"], boba: ["0.0.5"] },
    // `*` takes a prerelease here, as it does for npm
    { alias: "~1.0.0-0", moo: { dependencies: { boba: "*" } }, baz: ["1.0.0-0"], boba: ["1.3.0"] },
    {
      alias: "0.0.0-experimental.1",
      moo: { dependencies: { boba: "*" } },
      baz: ["0.0.0-experimental.1"],
      boba: ["1.3.0"],
    },
    { alias: "^1.0.0", moo: { peerDependencies: { boba: "^1.0.0" } }, baz: ["1.0.0", "1.5.0"], boba: ["1.3.0"] },
    { alias: "^1.0.0", moo: { peerDependencies: { boba: "^2.0.0" } }, baz: ["1.0.0", "1.5.0"], boba: ["2.0.0"] },
    {
      alias: "^1.0.0",
      moo: { peerDependencies: { boba: "^3.0.0" } },
      baz: ["1.0.0", "1.5.0"],
      boba: ["3.0.0"],
      unmetPeer: true,
    },
  ])("npm alias next to a workspace's dependency of the same name %j", async row => {
    const { alias, moo, baz, boba, nested, unmetPeer } = row;
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, aliasRegistry(ctx, urls, { baz, boba }));
      await Promise.all([
        write(
          join(ctx.package_dir, "bunfig.toml"),
          `[install]\ncache = false\nregistry = "${ctx.registry_url}"\nlinker = "hoisted"\n`,
        ),
        write(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({ name: "foo", workspaces: ["moo"], dependencies: { boba: `npm:baz@${alias}` } }),
        ),
        write(join(ctx.package_dir, "moo", "package.json"), JSON.stringify({ name: "moo", ...moo })),
      ]);
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [err, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
      expect(err).toContain("Saved lockfile");
      const manifests = urls.filter(url => !url.endsWith(".tgz")).sort();
      expect(manifests).toEqual((nested || unmetPeer ? ["baz", "boba"] : ["baz"]).map(name => ctx.registry_url + name));
      const { packages } = Bun.JSONC.parse(await file(join(ctx.package_dir, "bun.lock")).text()) as {
        packages: Record<string, [string, ...unknown[]]>;
      };
      expect(Object.fromEntries(Object.entries(packages).map(([key, [resolution]]) => [key, resolution]))).toEqual({
        "boba": `baz@${baz.at(-1)}`,
        "moo": "moo@workspace:moo",
        ...(nested ? { "moo/boba": `boba@${nested}` } : {}),
      });
      expect(exitCode).toBe(0);
    });
  });

  // A range that passes the bounds check still has to accept the version that the alias resolved to. A plain "boba"
  // that doesn't accept it gets the registry package named boba. `requests` is what Bun requested from the registry,
  // and `packages` is the `packages` section of bun.lock as name -> resolution.
  it.each<{
    name: string;
    files: Record<string, object>;
    registry: Record<string, string[]>;
    requests: string[];
    packages: Record<string, string>;
  }>([
    {
      name: "is not used by an overlapping range that excludes the version it resolved to",
      files: {
        "package.json": { name: "foo", workspaces: ["moo"], dependencies: { boba: "npm:baz@^1.0.0" } },
        "moo/package.json": { name: "moo", dependencies: { boba: "1.0.0" } },
      },
      registry: { baz: ["1.0.0", "1.5.0"], boba: ["1.0.0"] },
      requests: ["baz", "baz-1.5.0.tgz", "boba", "boba-1.0.0.tgz"],
      packages: { "boba": "baz@1.5.0", "moo": "moo@workspace:moo", "moo/boba": "boba@1.0.0" },
    },
    {
      name: "is not used by an overlapping range that starts above the version it resolved to",
      files: {
        "package.json": { name: "foo", workspaces: ["moo"], dependencies: { boba: "npm:baz@^1.0.0" } },
        "moo/package.json": { name: "moo", dependencies: { boba: "^1.2.0 || 1.0.0" } },
      },
      registry: { baz: ["1.0.0", "1.1.0"], boba: ["1.3.0"] },
      requests: ["baz", "baz-1.1.0.tgz", "boba", "boba-1.3.0.tgz"],
      packages: { "boba": "baz@1.1.0", "moo": "moo@workspace:moo", "moo/boba": "boba@1.3.0" },
    },
    {
      // aaa's dependency is resolved before zzz's alias, so nothing has appended baz@1.5.0 yet
      name: "in a later workspace is not used by an earlier workspace's range that excludes its version",
      files: {
        "package.json": { name: "foo", workspaces: ["aaa", "zzz"] },
        "aaa/package.json": { name: "aaa", dependencies: { boba: "1.0.0" } },
        "zzz/package.json": { name: "zzz", dependencies: { boba: "npm:baz@^1.0.0" } },
      },
      registry: { baz: ["1.0.0", "1.5.0"], boba: ["1.0.0"] },
      requests: ["baz", "baz-1.5.0.tgz", "boba", "boba-1.0.0.tgz"],
      packages: {
        "aaa": "aaa@workspace:aaa",
        "boba": "boba@1.0.0",
        "zzz": "zzz@workspace:zzz",
        "zzz/boba": "baz@1.5.0",
      },
    },
    {
      // the registry has no boba, and the optional dependency is skipped
      name: "in a later workspace is not used by an optional dependency that excludes its version",
      files: {
        "package.json": { name: "foo", workspaces: ["aaa", "zzz"] },
        "aaa/package.json": { name: "aaa", optionalDependencies: { boba: "1.0.0" } },
        "zzz/package.json": { name: "zzz", dependencies: { boba: "npm:baz@^1.0.0" } },
      },
      registry: { baz: ["1.0.0", "1.5.0"] },
      requests: ["baz", "baz-1.5.0.tgz", "boba"],
      packages: { "aaa": "aaa@workspace:aaa", "boba": "baz@1.5.0", "zzz": "zzz@workspace:zzz" },
    },
    {
      name: "is still used by a peer range that excludes the version it resolved to",
      files: {
        "package.json": { name: "foo", workspaces: ["moo"], dependencies: { boba: "npm:baz@^1.0.0" } },
        "moo/package.json": { name: "moo", peerDependencies: { boba: "1.0.0" } },
      },
      registry: { baz: ["1.0.0", "1.5.0"], boba: ["1.0.0"] },
      requests: ["baz", "baz-1.5.0.tgz"],
      packages: { "boba": "baz@1.5.0", "moo": "moo@workspace:moo" },
    },
    {
      name: "of a workspace package is used by a range that admits the workspace's version",
      files: {
        "package.json": { name: "foo", workspaces: ["baz", "moo"], dependencies: { boba: "npm:baz@^1.0.0" } },
        "baz/package.json": { name: "baz", version: "1.5.0" },
        "moo/package.json": { name: "moo", dependencies: { boba: ">=1.0.0" } },
      },
      registry: { boba: ["1.3.0"] },
      requests: [],
      packages: { "baz": "baz@workspace:baz", "boba": "baz@workspace:baz", "moo": "moo@workspace:moo" },
    },
    {
      name: "of a workspace package without a version is used by *",
      files: {
        "package.json": { name: "foo", workspaces: ["baz", "moo"], dependencies: { boba: "npm:baz@*" } },
        "baz/package.json": { name: "baz" },
        "moo/package.json": { name: "moo", dependencies: { boba: "*" } },
      },
      registry: { boba: ["1.3.0"] },
      requests: [],
      packages: { "baz": "baz@workspace:baz", "boba": "baz@workspace:baz", "moo": "moo@workspace:moo" },
    },
    {
      // only `*` links a workspace that has no version
      name: "of a workspace package without a version is not used by a range",
      files: {
        "package.json": { name: "foo", workspaces: ["baz", "moo"], dependencies: { boba: "npm:baz@*" } },
        "baz/package.json": { name: "baz" },
        "moo/package.json": { name: "moo", dependencies: { boba: "<2.0.0" } },
      },
      registry: { boba: ["1.3.0"] },
      requests: ["boba", "boba-1.3.0.tgz"],
      packages: {
        "baz": "baz@workspace:baz",
        "boba": "baz@workspace:baz",
        "moo": "moo@workspace:moo",
        "moo/boba": "boba@1.3.0",
      },
    },
    {
      name: "of a workspace package is not used by an overlapping range that excludes the workspace's version",
      files: {
        "package.json": { name: "foo", workspaces: ["baz", "moo"], dependencies: { boba: "npm:baz@^1.0.0" } },
        "baz/package.json": { name: "baz", version: "1.5.0" },
        "moo/package.json": { name: "moo", dependencies: { boba: "1.0.0" } },
      },
      registry: { boba: ["1.0.0"] },
      requests: ["boba", "boba-1.0.0.tgz"],
      packages: {
        "baz": "baz@workspace:baz",
        "boba": "baz@workspace:baz",
        "moo": "moo@workspace:moo",
        "moo/boba": "boba@1.0.0",
      },
    },
    {
      // the registry has no baz, and the optional alias is skipped
      name: "that is not in the registry is not waited for by a range it does not overlap",
      files: {
        "package.json": { name: "foo", workspaces: ["moo"], optionalDependencies: { boba: "npm:baz@^1.0.0" } },
        "moo/package.json": { name: "moo", dependencies: { boba: "^2.0.0" } },
      },
      registry: { boba: ["2.0.0"] },
      requests: ["baz", "boba", "boba-2.0.0.tgz"],
      packages: { "boba": "boba@2.0.0", "moo": "moo@workspace:moo" },
    },
    {
      // the optional alias is skipped
      name: "without a matching version leaves its range to the registry package",
      files: {
        "package.json": { name: "foo", workspaces: ["moo"], optionalDependencies: { boba: "npm:baz@^1.0.0" } },
        "moo/package.json": { name: "moo", dependencies: { boba: "^1.0.0" } },
      },
      registry: { baz: ["0.0.3"], boba: ["1.3.0"] },
      requests: ["baz", "boba", "boba-1.3.0.tgz"],
      packages: { "boba": "boba@1.3.0", "moo": "moo@workspace:moo" },
    },
    {
      // A peer stays with the alias, and Bun reports it as unmet.
      name: "without a matching version still takes a peer of its name",
      files: {
        "package.json": { name: "foo", workspaces: ["moo"], optionalDependencies: { boba: "npm:baz@^1.0.0" } },
        "moo/package.json": { name: "moo", peerDependencies: { boba: "^1.0.0" } },
      },
      registry: { baz: ["0.0.3"], boba: ["1.3.0"] },
      requests: ["baz"],
      packages: { "moo": "moo@workspace:moo" },
    },
  ])("npm alias $name", async ({ files, registry, requests, packages }) => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, aliasRegistry(ctx, urls, registry));
      await Promise.all([
        write(
          join(ctx.package_dir, "bunfig.toml"),
          Bun.TOML.stringify({ install: { cache: false, registry: ctx.registry_url, linker: "hoisted" } }),
        ),
        ...Object.entries(files).map(([path, contents]) =>
          write(join(ctx.package_dir, path), JSON.stringify(contents)),
        ),
      ]);
      const install = async (...args: string[]) => {
        await using proc = spawn({
          cmd: [bunExe(), ...(args.length ? args : ["install"])],
          cwd: ctx.package_dir,
          stdout: "ignore",
          stdin: "ignore",
          stderr: "pipe",
          env,
        });
        const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect(err).not.toContain("error:");
        return { exitCode, lockfile: await file(join(ctx.package_dir, "bun.lock")).text() };
      };
      const { exitCode, lockfile } = await install();
      expect(urls.sort()).toEqual(requests.map(path => `${ctx.registry_url}${path}`));
      const locked = (lockfile: string) =>
        Object.fromEntries(
          Object.entries((Bun.JSONC.parse(lockfile) as { packages: Record<string, [string]> }).packages).map(
            ([key, [resolution]]) => [key, resolution],
          ),
        );
      expect(locked(lockfile)).toEqual(packages);
      expect(exitCode).toBe(0);
      expect(await install("install", "--frozen-lockfile")).toEqual({ exitCode: 0, lockfile });
      // resolves every row again, next to the packages that bun.lock has
      expect(locked((await install("update", "-r")).lockfile)).toEqual(packages);
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

  // "kept" is an `npm:` alias that another manifest declares: a dependency of the project, or a
  // workspace. The root package's own "kept" names the registry package of that name and does
  // not follow that alias. Every registry package gets the same fixture tarball, so `packages`
  // (the section of bun.lock, name -> resolution) tells which package a folder holds. A packument
  // listed in `hold` is answered when the request named by its value arrives, which fixes the
  // order in which bun reads the packuments.
  const holder = { "1.0.0": { dependencies: { kept: "npm:short@1.0.0" } } };
  const kept = { "1.0.0": {} };
  const short = { "1.0.0": {} };

  function heldRegistry(
    ctx: TestContext,
    urls: string[],
    registry: Record<string, Record<string, object>>,
    hold: Record<string, string> = {},
  ) {
    const arrivals = new Map<string, PromiseWithResolvers<void>>();
    const arrival = (path: string) => {
      let entry = arrivals.get(path);
      if (!entry) arrivals.set(path, (entry = Promise.withResolvers<void>()));
      return entry;
    };
    return async (request: Request) => {
      const path = new URL(request.url).pathname.replace(`/${ctx.id}/`, "");
      urls.push(path);
      arrival(path).resolve();
      if (path.endsWith(".tgz")) {
        return new Response(file(join(import.meta.dir, "baz-0.0.3.tgz")));
      }
      if (!(path in registry)) return new Response(null, { status: 404 });
      if (path in hold) await arrival(hold[path]).promise;
      const versions: Record<string, object> = {};
      for (const [version, fields] of Object.entries(registry[path])) {
        versions[version] = {
          name: path,
          version,
          dist: { tarball: `${ctx.registry_url}${path}-${version}.tgz` },
          ...fields,
        };
      }
      return new Response(
        JSON.stringify({ name: path, versions, "dist-tags": { latest: Object.keys(versions).at(-1) } }),
      );
    };
  }

  async function writeProject(ctx: TestContext, files: Record<string, object>, install: object = {}) {
    await Promise.all(
      Object.entries({
        "bunfig.toml": { install: { cache: false, registry: ctx.registry_url, linker: "hoisted", ...install } },
        ...files,
      }).map(([path, contents]) =>
        write(
          join(ctx.package_dir, path),
          path.endsWith(".toml") ? Bun.TOML.stringify(contents) : JSON.stringify(contents),
        ),
      ),
    );
  }

  // Runs `bun install` and returns the `packages` section of the bun.lock it saves.
  async function installAndReadLock(ctx: TestContext, ...args: string[]) {
    return (await installAndReadLockAndWarnings(ctx, ...args)).packages;
  }

  async function installAndReadLockAndWarnings(ctx: TestContext, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd: ctx.package_dir,
      stdout: "ignore",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });
    const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(exitCode).toBe(0);
    const locked = Bun.JSONC.parse(await file(join(ctx.package_dir, "bun.lock")).text()).packages as Record<
      string,
      [string, ...unknown[]]
    >;
    return {
      packages: Object.fromEntries(Object.entries(locked).map(([name, [resolution]]) => [name, resolution])),
      warnings: err
        .split(/\r?\n/)
        .filter(line => line.startsWith("warn:"))
        .sort(),
    };
  }

  it.each<{
    name: string;
    files: Record<string, object>;
    registry: Record<string, Record<string, object>>;
    hold?: Record<string, string>;
    packages: Record<string, string>;
    requests: string[];
  }>([
    {
      name: "of a dependency, when bun reads the alias first",
      files: { "package.json": { name: "foo", dependencies: { holder: "1.0.0", kept: "^1.0.0" } } },
      registry: { holder, kept, short },
      hold: { kept: "short" },
      packages: { "holder": "holder@1.0.0", "kept": "kept@1.0.0", "holder/kept": "short@1.0.0" },
      requests: ["holder", "holder-1.0.0.tgz", "kept", "kept-1.0.0.tgz", "short", "short-1.0.0.tgz"],
    },
    {
      name: "of a dependency, when bun reads the alias last",
      files: { "package.json": { name: "foo", dependencies: { holder: "1.0.0", kept: "^1.0.0" } } },
      registry: { holder, kept, short },
      hold: { holder: "kept" },
      packages: { "holder": "holder@1.0.0", "kept": "kept@1.0.0", "holder/kept": "short@1.0.0" },
      requests: ["holder", "holder-1.0.0.tgz", "kept", "kept-1.0.0.tgz", "short", "short-1.0.0.tgz"],
    },
    {
      // the alias lists versions that the root could ask for, and its package has none of them
      name: "of a dependency, for a version that the root pins and overrides",
      files: {
        "package.json": {
          name: "foo",
          dependencies: { holder: "1.0.0", kept: "1.1.0" },
          overrides: { kept: "1.1.0" },
        },
      },
      registry: {
        holder: { "1.0.0": { dependencies: { kept: "npm:payload@0.0.1 || 1.0.0 || 1.1.0 || 2.0.0" } } },
        kept: { "1.0.0": {}, "1.1.0": {}, "2.0.0": {} },
        payload: { "0.0.1": {} },
      },
      hold: { kept: "payload" },
      packages: { "holder": "holder@1.0.0", "kept": "kept@1.1.0", "holder/kept": "payload@0.0.1" },
      requests: ["holder", "holder-1.0.0.tgz", "kept", "kept-1.1.0.tgz", "payload", "payload-0.0.1.tgz"],
    },
    {
      name: "of a dependency, for a peer dependency of the root",
      files: {
        "package.json": { name: "foo", dependencies: { holder: "1.0.0" }, peerDependencies: { kept: "^1.0.0" } },
      },
      registry: { holder, kept, short },
      packages: { "holder": "holder@1.0.0", "kept": "kept@1.0.0", "holder/kept": "short@1.0.0" },
      requests: ["holder", "holder-1.0.0.tgz", "kept", "kept-1.0.0.tgz", "short", "short-1.0.0.tgz"],
    },
    {
      // bun reads the dependencies of `absent` to lock them, and installs none of them
      name: "of a dependency that is not installed on this platform",
      files: {
        "package.json": { name: "foo", dependencies: { kept: "^2.0.0" }, optionalDependencies: { absent: "1.0.0" } },
      },
      registry: {
        absent: { "1.0.0": { os: ["aix"], dependencies: { kept: "npm:short@2.0.0" } } },
        kept: { "1.0.0": {}, "2.0.0": {} },
        short: { "2.0.0": {} },
      },
      hold: { kept: "short" },
      packages: { "absent": "absent@1.0.0", "kept": "kept@2.0.0", "absent/kept": "short@2.0.0" },
      requests: ["absent", "kept", "kept-2.0.0.tgz", "short"],
    },
    {
      name: "of a file: dependency",
      files: {
        "package.json": { name: "foo", dependencies: { holder: "file:./holder", kept: "^1.0.0" } },
        "holder/package.json": { name: "holder", version: "1.0.0", dependencies: { kept: "npm:short@1.0.0" } },
      },
      registry: { kept, short },
      packages: { "holder": "holder@file:holder", "kept": "kept@1.0.0", "holder/kept": "short@1.0.0" },
      requests: ["kept", "kept-1.0.0.tgz", "short", "short-1.0.0.tgz"],
    },
    {
      name: "of a workspace",
      files: {
        "package.json": { name: "foo", workspaces: ["moo"], dependencies: { kept: "^1.0.0" } },
        "moo/package.json": { name: "moo", dependencies: { kept: "npm:short@1.0.0" } },
      },
      registry: { kept, short },
      packages: { "kept": "kept@1.0.0", "moo": "moo@workspace:moo", "moo/kept": "short@1.0.0" },
      requests: ["kept", "kept-1.0.0.tgz", "short", "short-1.0.0.tgz"],
    },
  ])(
    "the root package's own dependency does not follow the npm: alias $name",
    async ({ files, registry, hold, packages, requests }) => {
      await withContext(defaultOpts, async ctx => {
        const urls: string[] = [];
        setContextHandler(ctx, heldRegistry(ctx, urls, registry, hold));
        await writeProject(ctx, files);
        expect({ packages: await installAndReadLock(ctx), requests: urls.sort() }).toEqual({ packages, requests });
      });
    },
  );

  it.each(["bun.lockb", "bun.lock"])(
    "the root package's own dependency does not follow the npm: alias of a %s row",
    async lockfile => {
      await withContext(defaultOpts, async ctx => {
        setContextHandler(ctx, heldRegistry(ctx, [], { holder, kept, short }));
        // The lockfile keeps the dependency rows of `holder`, and bun reads them back on the next install.
        const binary = { saveTextLockfile: lockfile === "bun.lock" };
        await writeProject(ctx, { "package.json": { name: "foo", dependencies: { holder: "1.0.0" } } }, binary);
        await using first = spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "ignore",
          stdin: "ignore",
          stderr: "pipe",
          env,
        });
        const [err, exitCode] = await Promise.all([first.stderr.text(), first.exited]);
        expect(err).not.toContain("error:");
        expect(exitCode).toBe(0);
        await access(join(ctx.package_dir, lockfile));

        await writeProject(
          ctx,
          { "package.json": { name: "foo", dependencies: { holder: "1.0.0", kept: "^1.0.0" } } },
          binary,
        );
        expect(await installAndReadLock(ctx, "--save-text-lockfile")).toEqual({
          "holder": "holder@1.0.0",
          "kept": "kept@1.0.0",
          "holder/kept": "short@1.0.0",
        });
      });
    },
  );

  it.each<{ name: string; manifest: object }>([
    {
      name: "in another dependency group",
      manifest: { devDependencies: { kept: "npm:short@1.0.0" }, peerDependencies: { kept: "^1.0.0" } },
    },
    {
      name: "through a catalog",
      manifest: {
        workspaces: { packages: [], catalog: { kept: "npm:short@1.0.0" } },
        devDependencies: { kept: "catalog:" },
        peerDependencies: { kept: "^1.0.0" },
      },
    },
  ])("the root package's own dependency follows the npm: alias that the root declares $name", async ({ manifest }) => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      // the registry has no "kept", and bun does not ask for it
      setContextHandler(ctx, heldRegistry(ctx, urls, { short }));
      await writeProject(ctx, { "package.json": { name: "foo", ...manifest } });
      expect({ packages: await installAndReadLock(ctx), requests: urls.sort() }).toEqual({
        packages: { "kept": "short@1.0.0" },
        requests: ["short", "short-1.0.0.tgz"],
      });
    });
  });

  // `provider` installs `plugin` and, under the name of its peer, another package.
  describe("a peer whose name is an npm: alias of the package that depends on it", () => {
    const provider = { "1.0.0": { dependencies: { kept: "npm:short@1.0.0", plugin: "1.0.0" } } };
    const plugin = { "1.0.0": { peerDependencies: { kept: "^1.0.0" } } };

    it.each<{ name: string; registry: Record<string, Record<string, object>> }>([
      { name: "has the name", registry: { kept } },
      {
        name: "has the name for a package that cannot be completed",
        registry: { kept: { "1.0.0": { dependencies: { gone: "1.0.0" } } } },
      },
      { name: "does not have the name", registry: {} },
    ])("takes the alias when the registry $name", async ({ registry }) => {
      await withContext(defaultOpts, async ctx => {
        const urls: string[] = [];
        setContextHandler(ctx, heldRegistry(ctx, urls, { provider, plugin, short, ...registry }));
        await writeProject(ctx, { "package.json": { name: "foo", dependencies: { provider: "1.0.0" } } });
        expect({ packages: await installAndReadLock(ctx), requests: urls.sort() }).toEqual({
          packages: { "kept": "short@1.0.0", "plugin": "plugin@1.0.0", "provider": "provider@1.0.0" },
          requests: ["plugin", "plugin-1.0.0.tgz", "provider", "provider-1.0.0.tgz", "short", "short-1.0.0.tgz"],
        });
      });
    });

    it("asks the registry when something else depends on it too", async () => {
      await withContext(defaultOpts, async ctx => {
        const urls: string[] = [];
        setContextHandler(ctx, heldRegistry(ctx, urls, { provider, plugin, short, kept }));
        await writeProject(ctx, {
          "package.json": { name: "foo", dependencies: { provider: "1.0.0", plugin: "1.0.0" } },
        });
        await installAndReadLock(ctx);
        expect(urls).toContain("kept");
      });
    });
  });

  it.each<{ range: string; published: string[]; resolved: string | null }>([
    { range: "1.0.0 || ^2.0.0", published: ["1.0.0", "2.5.0"], resolved: "2.5.0" },
    { range: "1.0.0 || ^2.0.0", published: ["2.5.0"], resolved: "2.5.0" },
    { range: "1.0.0 || ^2.0.0", published: ["1.0.0", "3.0.0"], resolved: "1.0.0" },
    { range: "1.0.0 || 2.5.0", published: ["1.0.0", "2.5.0", "3.0.0"], resolved: "2.5.0" },
    { range: "=2.5.0 <2", published: ["1.0.0", "2.5.0"], resolved: null },
    { range: "1.0.0 >=2", published: ["1.0.0", "2.5.0"], resolved: null },
    { range: "1.0.0 <2", published: ["1.0.0", "1.5.0"], resolved: "1.0.0" },
    { range: "1.0.0", published: ["1.0.0", "2.5.0"], resolved: "1.0.0" },
  ])("an exact version that starts a range is not the whole range: %j", async ({ range, published, resolved }) => {
    await withContext(defaultOpts, async ctx => {
      setContextHandler(
        ctx,
        heldRegistry(ctx, [], { kept: Object.fromEntries(published.map(version => [version, {}])) }),
      );
      await writeProject(ctx, { "package.json": { name: "foo", dependencies: { kept: range } } });
      if (resolved !== null) {
        expect(await installAndReadLock(ctx)).toEqual({ kept: `kept@${resolved}` });
        return;
      }
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "ignore",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(err).toContain(`error: No version matching "${range}" found for specifier "kept" (but package exists)`);
      expect(exitCode).toBe(1);
    });
  });

  // Each `hold` is one order in which the packuments arrive.
  describe.each<{
    name: string;
    files: Record<string, object>;
    registry: Record<string, Record<string, object>>;
    holds: Record<string, string>[];
    packages: Record<string, string>;
    warnings?: RegExp[];
  }>([
    {
      name: "a range that admits a lower version another package pins",
      files: { "package.json": { name: "foo", dependencies: { wide: "1.0.0", narrow: "1.0.0" } } },
      registry: {
        wide: { "1.0.0": { dependencies: { kept: "1.x" } } },
        narrow: { "1.0.0": { dependencies: { kept: "~1.0.0" } } },
        kept: { "1.0.0": {}, "1.1.0": {} },
      },
      holds: [{ wide: "kept" }, { narrow: "kept" }],
      packages: { "kept": "kept@1.0.0", "narrow": "narrow@1.0.0", "wide": "wide@1.0.0" },
    },
    {
      name: "a range that admits a patched version",
      files: {
        "package.json": {
          name: "foo",
          dependencies: { wide: "1.0.0", narrow: "1.0.0" },
          patchedDependencies: { "kept@1.1.0": "kept.patch" },
        },
        "kept.patch": {},
      },
      registry: {
        wide: { "1.0.0": { dependencies: { kept: "1.x" } } },
        narrow: { "1.0.0": { dependencies: { kept: "~1.0.0" } } },
        kept: { "1.0.0": {}, "1.1.0": {}, "1.2.0": {} },
      },
      holds: [{ wide: "kept" }, { narrow: "kept" }],
      packages: {
        "kept": "kept@1.0.0",
        "narrow": "narrow@1.0.0",
        "wide": "wide@1.0.0",
        "wide/kept": "kept@1.1.0",
      },
    },
    {
      name: "an optional range next to a pin, under a peer of the root",
      files: {
        "package.json": { name: "foo", workspaces: ["moo"], peerDependencies: { kept: "^1.0.0" } },
        "moo/package.json": { name: "moo", dependencies: { narrow: "1.0.0" }, devDependencies: { wide: "1.0.0" } },
      },
      registry: {
        wide: { "1.0.0": { optionalDependencies: { kept: "1.x" } } },
        narrow: { "1.0.0": { dependencies: { kept: "1.0.0" } } },
        kept: { "1.0.0": {}, "1.1.0": {} },
      },
      holds: [{ wide: "kept" }, { narrow: "kept" }],
      packages: {
        "kept": "kept@1.1.0",
        "moo": "moo@workspace:moo",
        "narrow": "narrow@1.0.0",
        "wide": "wide@1.0.0",
        "narrow/kept": "kept@1.0.0",
      },
    },
    {
      // `narrow` is resolved before `wide`, so `wide` shares kept@1.0.0 and never picks kept@2.1.0.
      name: "a range that admits a version that cannot be completed, after a pin",
      files: { "package.json": { name: "foo", dependencies: { wide: "1.0.0", narrow: "1.0.0" } } },
      registry: {
        wide: { "1.0.0": { dependencies: { kept: ">=1.0.0" } } },
        narrow: { "1.0.0": { dependencies: { kept: "1.0.0" } } },
        kept: { "1.0.0": {}, "2.1.0": { dependencies: { gone: "^3.0.0", short: "^2.0.0" } } },
        short,
      },
      holds: [{ wide: "kept" }, { narrow: "gone" }],
      packages: { "kept": "kept@1.0.0", "narrow": "narrow@1.0.0", "wide": "wide@1.0.0" },
    },
    {
      // `early` is resolved before `narrow`, so it picks kept@2.1.0 first. Nothing needs that version
      // once `early` shares kept@1.0.0.
      name: "a version that cannot be completed and that nothing needs in the end",
      files: { "package.json": { name: "foo", dependencies: { early: "1.0.0", narrow: "1.0.0" } } },
      registry: {
        early: { "1.0.0": { dependencies: { kept: ">=1.0.0" } } },
        narrow: { "1.0.0": { dependencies: { kept: "1.0.0" } } },
        kept: { "1.0.0": {}, "2.1.0": { dependencies: { gone: "^3.0.0", short: "^2.0.0" } } },
        short,
      },
      holds: [{ early: "kept" }, { narrow: "gone" }],
      packages: { "early": "early@1.0.0", "kept": "kept@1.0.0", "narrow": "narrow@1.0.0" },
      // The registry's response is still printed, because with a different response `early` might have kept its
      // version.
      warnings: [/^warn: GET .*\/gone - 404$/, /^warn: No version matching "\^2\.0\.0" found for specifier "short"/],
    },
    {
      name: "a version that nothing needs in the end and that has an optional dependency the registry does not have",
      files: { "package.json": { name: "foo", dependencies: { early: "1.0.0", narrow: "1.0.0" } } },
      registry: {
        early: { "1.0.0": { dependencies: { kept: ">=1.0.0" } } },
        narrow: { "1.0.0": { dependencies: { kept: "1.0.0" } } },
        kept: { "1.0.0": {}, "2.1.0": { optionalDependencies: { gone: "^3.0.0" } } },
      },
      holds: [{ early: "kept" }, { narrow: "gone" }],
      packages: { "early": "early@1.0.0", "kept": "kept@1.0.0", "narrow": "narrow@1.0.0" },
      warnings: [/^warn: GET .*\/gone - 404$/],
    },
    {
      // The alias is for `holder`'s own row.
      name: "a dependency with the name of another package's npm: alias",
      files: { "package.json": { name: "foo", dependencies: { holder: "1.0.0", wide: "1.0.0" } } },
      registry: { holder, kept, short, wide: { "1.0.0": { dependencies: { kept: "^1.0.0" } } } },
      holds: [{ wide: "short" }, { holder: "kept" }],
      packages: {
        "holder": "holder@1.0.0",
        "kept": "short@1.0.0",
        "wide": "wide@1.0.0",
        "wide/kept": "kept@1.0.0",
      },
    },
  ])("a fresh install resolves $name the same", ({ files, registry, holds, packages, warnings = [] }) => {
    it.each(holds)("when the manifests arrive in the order %j", async hold => {
      await withContext(defaultOpts, async ctx => {
        setContextHandler(ctx, heldRegistry(ctx, [], registry, hold));
        await writeProject(ctx, files);
        expect(await installAndReadLockAndWarnings(ctx, "--lockfile-only")).toEqual({
          packages,
          warnings: warnings.map(warning => expect.stringMatching(warning)),
        });
      });
    });
  });

  it("does not download the version that a range would pick if it can share one that's already installed", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      const registry = {
        wide: { "1.0.0": { dependencies: { kept: "1.x" } } },
        narrow: { "1.0.0": { dependencies: { kept: "~1.0.0" } } },
        kept: { "1.0.0": {}, "1.1.0": {} },
      };
      // `narrow` has asked for kept@1.0.0 by the time bun reads `wide`.
      setContextHandler(ctx, heldRegistry(ctx, urls, registry, { wide: "kept" }));
      await writeProject(ctx, { "package.json": { name: "foo", dependencies: { wide: "1.0.0", narrow: "1.0.0" } } });
      expect({
        packages: await installAndReadLock(ctx),
        tarballs: urls.filter(url => url.endsWith(".tgz")).sort(),
      }).toEqual({
        packages: { "kept": "kept@1.0.0", "narrow": "narrow@1.0.0", "wide": "wide@1.0.0" },
        tarballs: ["kept-1.0.0.tgz", "narrow-1.0.0.tgz", "wide-1.0.0.tgz"],
      });
    });
  });

  it("--lockfile-only does not download a patched package whose manifest is in the cache", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, heldRegistry(ctx, urls, { kept }));
      await writeProject(
        ctx,
        {
          "package.json": {
            name: "foo",
            dependencies: { kept: "1.0.0" },
            patchedDependencies: { "kept@1.0.0": "kept.patch" },
          },
          "kept.patch": {},
        },
        { cache: { dir: join(ctx.package_dir, ".cache") } },
      );
      await installAndReadLock(ctx, "--lockfile-only");
      await rm(join(ctx.package_dir, "bun.lock"));
      // This time `kept` is resolved before the patch file has been hashed.
      expect({ packages: await installAndReadLock(ctx, "--lockfile-only"), requests: urls }).toEqual({
        packages: { "kept": "kept@1.0.0" },
        requests: ["kept"],
      });
    });
  });

  it("requests the peers of a package that a peer installed while another peer waits for its manifest", async () => {
    await withContext(defaultOpts, async ctx => {
      const registry = {
        first: { "1.0.0": { peerDependencies: { near: "1.0.0" } } },
        second: { "1.0.0": { peerDependencies: { slow: "1.0.0" } } },
        near: { "1.0.0": { peerDependencies: { far: "1.0.0" } } },
        far: { "1.0.0": {} },
        slow: { "1.0.0": {} },
      };
      setContextHandler(ctx, heldRegistry(ctx, [], registry, { slow: "far" }));
      await writeProject(ctx, {
        "package.json": { name: "foo", dependencies: { first: "1.0.0", second: "1.0.0" } },
      });
      expect(await installAndReadLock(ctx, "--lockfile-only")).toEqual({
        "far": "far@1.0.0",
        "first": "first@1.0.0",
        "near": "near@1.0.0",
        "second": "second@1.0.0",
        "slow": "slow@1.0.0",
      });
    });
  });

  it("requests the peers that wait for the next round while a dependency waits for its manifest", async () => {
    await withContext(defaultOpts, async ctx => {
      const registry = {
        first: { "1.0.0": { peerDependencies: { near: "1.0.0" } } },
        second: { "1.0.0": { peerDependencies: { other: "1.0.0" } } },
        near: { "1.0.0": { peerDependencies: { far: "1.0.0" } } },
        other: { "1.0.0": { dependencies: { slow: "1.0.0" } } },
        far: { "1.0.0": {} },
        slow: { "1.0.0": {} },
      };
      setContextHandler(ctx, heldRegistry(ctx, [], registry, { slow: "far" }));
      await writeProject(ctx, {
        "package.json": { name: "foo", dependencies: { first: "1.0.0", second: "1.0.0" } },
      });
      expect(await installAndReadLock(ctx, "--lockfile-only")).toEqual({
        "far": "far@1.0.0",
        "first": "first@1.0.0",
        "near": "near@1.0.0",
        "other": "other@1.0.0",
        "second": "second@1.0.0",
        "slow": "slow@1.0.0",
      });
    });
  });

  it("requests the manifests of dependencies with an empty version immediately", async () => {
    await withContext(defaultOpts, async ctx => {
      setContextHandler(ctx, heldRegistry(ctx, [], { holder: kept, kept, short }, { holder: "short" }));
      await writeProject(ctx, {
        "package.json": { name: "foo", dependencies: { holder: "", kept: "", short: "" } },
      });
      expect(await installAndReadLock(ctx, "--lockfile-only")).toEqual({
        "holder": "holder@1.0.0",
        "kept": "kept@1.0.0",
        "short": "short@1.0.0",
      });
    });
  });

  it("reports a registry URL that cannot be used once, when two dependencies ask for the same package", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeProject(
        ctx,
        {
          "package.json": { name: "foo", workspaces: ["moo"], dependencies: { kept: "1.0.0" } },
          "moo/package.json": { name: "moo", dependencies: { kept: "1.0.0" } },
        },
        { registry: "htp://127.0.0.1:1/" },
      );
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "ignore",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(err.split(/\r?\n/).filter(line => line.includes("Registry URL must be"))).toEqual([
        "error: Registry URL must be http:// or https://",
      ]);
      expect(exitCode).toBe(1);
    });
  });

  // While it lasts, the install fails and saves nothing, so the next one is whole.
  it.each<{ name: string; failing: RegExp; status?: number; error: RegExp }>([
    {
      name: "whose tarball answers 503",
      failing: /\/short-[^/]+\.tgz$/,
      status: 503,
      error: /\/short-1\.0\.0\.tgz - 503$/,
    },
    { name: "whose manifest answers 503", failing: /\/short$/, status: 503, error: /\/short - 503$/ },
    { name: "that the registry does not have", failing: /\/short$/, status: 404, error: /\/short - 404$/ },
    {
      name: "that has no matching version",
      failing: /\/short$/,
      error: /^error: No version matching "\^1\.0\.0" found/,
    },
  ])("an optional dependency stays in the lockfile when it needs a package $name", async row => {
    await withContext(defaultOpts, async ctx => {
      const registry: Record<string, Record<string, object>> = {
        holder: { "1.0.0": { optionalDependencies: { kept: "^1.0.0" } } },
        kept: { "1.0.0": { dependencies: { short: "^1.0.0" } } },
        short: { "1.0.0": {} },
      };
      const answer = heldRegistry(ctx, [], registry);
      const behind = heldRegistry(ctx, [], { short: { "0.0.1": {} } });
      let faulty = true;
      setContextHandler(ctx, request => {
        if (!faulty || !row.failing.test(request.url)) return answer(request);
        return row.status ? new Response(null, { status: row.status }) : behind(request);
      });
      await writeProject(ctx, { "package.json": { name: "foo", dependencies: { holder: "1.0.0" } } });
      const lockfile = () =>
        file(join(ctx.package_dir, "bun.lock"))
          .text()
          .catch(() => null);
      const runWhileFaulty = async (command: string) => {
        faulty = true;
        await using proc = spawn({
          cmd: [bunExe(), command],
          cwd: ctx.package_dir,
          stdout: "ignore",
          stdin: "ignore",
          stderr: "pipe",
          env: { ...env, BUN_CONFIG_HTTP_RETRY_COUNT: "0" },
        });
        const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        faulty = false;
        return {
          errors: err.split(/\r?\n/).filter(line => line.startsWith("error:")),
          lockfile: await lockfile(),
          exitCode,
        };
      };

      expect(await runWhileFaulty("install")).toEqual({
        errors: expect.arrayContaining([expect.stringMatching(row.error)]),
        lockfile: null,
        exitCode: 1,
      });
      expect(await installAndReadLock(ctx)).toEqual({
        "holder": "holder@1.0.0",
        "kept": "kept@1.0.0",
        "short": "short@1.0.0",
      });

      const saved = await lockfile();
      registry.kept["1.1.0"] = { dependencies: { short: "^2.0.0" } };
      registry.short["2.0.0"] = {};
      expect(await runWhileFaulty("update")).toEqual({
        errors: expect.arrayContaining([expect.stringContaining("short")]),
        lockfile: saved,
        exitCode: 1,
      });
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "holder", "kept", "short"]);
    });
  });

  it("an optional dependency that the registry does not have is left out when it is also a peer of a package", async () => {
    await withContext(defaultOpts, async ctx => {
      setContextHandler(ctx, heldRegistry(ctx, [], { holder: { "1.0.0": { peerDependencies: { gone: "^1.0.0" } } } }));
      await writeProject(ctx, {
        "package.json": { name: "foo", dependencies: { holder: "1.0.0" }, optionalDependencies: { gone: "^1.0.0" } },
      });
      expect(await installAndReadLock(ctx)).toEqual({ "holder": "holder@1.0.0" });
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
        env: githubEnv(),
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
        env: githubEnv(),
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
        env: githubEnv(),
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

    let repo: Awaited<ReturnType<typeof hostedGitRepository>>;
    beforeAll(async () => {
      repo = await hostedGitRepository(
        [
          "https://bitbucket.org/dylan-conway/public-install-test",
          "https://bitbucket.com/dylan-conway/public-install-test",
          "https://git@bitbucket.org/dylan-conway/public-install-test",
        ],
        { "package.json": JSON.stringify({ name: "publicinstalltest", version: "1.0.0" }) },
      );
    });
    afterAll(() => repo[Symbol.dispose]());

    for (const dep of deps) {
      // The lockfile names the host of the shorthand.
      const locked = dep.replace(/^bitbucket:/, "git@bitbucket.org/");

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
            env: repo.env,
          });

          const err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          const out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun install v1."),
            "",
            `+ public-install-test@git+ssh://${locked}#${repo.sha}`,
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
            env: repo.env,
          });

          const err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          const out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun add v1."),
            "",
            `installed publicinstalltest@git+ssh://${locked}#${repo.sha}`,
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

    let repo: Awaited<ReturnType<typeof hostedGitRepository>>;
    beforeAll(async () => {
      repo = await hostedGitRepository(["https://gitlab.com/dylan-conway/public-install-test"], {
        "package.json": JSON.stringify({ name: "public-install-test", version: "1.0.0" }),
      });
    });
    afterAll(() => repo[Symbol.dispose]());

    for (const dep of deps) {
      // The lockfile names the host of the shorthand.
      const locked = dep.replace(/^gitlab:/, "git@gitlab.com/");

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
            env: repo.env,
          });

          const err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          const out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun install v1."),
            "",
            `+ public-install-test@git+ssh://${locked}#${repo.sha}`,
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
            env: repo.env,
          });

          const err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          const out = await stdout.text();
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun add v1."),
            "",
            `installed public-install-test@git+ssh://${locked}#${repo.sha}`,
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
        env: githubEnv(),
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
        env: githubEnv(),
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
        env: githubEnv(),
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
        env: githubEnv(),
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

  // github.com answers /tarball/ URLs with a redirect to codeload.github.com, whose tarballs have a single
  // `<user>-<repo>-<short commit>` root directory. Both variants below serve this one tarball.
  const when_tarball = githubTarball("cujojs-when-1a2b3c4", {
    ".gitignore": "",
    ".gitmodules": "",
    "LICENSE.txt": "",
    "README.md": "",
    "apply.js": "",
    "cancelable.js": "",
    "delay.js": "",
    "package.json": JSON.stringify({ name: "when", version: "1.0.2" }),
    "test/when-test.js": "",
    "timed.js": "",
    "timeout.js": "",
    "when.js": "",
  });

  // The second variant also sets GITHUB_API_URL: it only applies to `github:` dependencies, so the tarball URL
  // must still be fetched verbatim (a request to it would show up in `proxied_urls` and `proxy.targets`).
  for (const with_github_api_url of [false, true]) {
    it(
      "should handle GitHub tarball URL in dependencies (https://github.com/user/repo/tarball/ref)" +
        (with_github_api_url ? " with custom GITHUB_API_URL" : ""),
      async () => {
        await withContext(defaultOpts, async ctx => {
          const urls: string[] = [];
          setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
          const tarball_url = "https://github.com/cujojs/when/tarball/1.0.2";
          const codeload_url = "https://codeload.github.com/cujojs/when/legacy.tar.gz/refs/tags/1.0.2";
          const proxied_urls: string[] = [];
          await using proxy = await urlTarballProxy(ctx, proxied_urls, {
            [tarball_url]: new Response(null, { status: 302, headers: { Location: codeload_url } }),
            [codeload_url]: await when_tarball,
          });
          await writeFile(
            join(ctx.package_dir, "package.json"),
            JSON.stringify({
              name: "Foo",
              version: "0.0.1",
              dependencies: {
                when: tarball_url,
              },
            }),
          );
          const { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "install"],
            cwd: ctx.package_dir,
            stdout: "pipe",
            stdin: "pipe",
            stderr: "pipe",
            env: with_github_api_url ? { ...proxy.env, GITHUB_API_URL: "https://example.com/github/api" } : proxy.env,
          });
          const err = await stderr.text();
          expect(err).toContain("Saved lockfile");
          let out = await stdout.text();
          out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
          out = out.replace(/(github:[^#]+)#[a-f0-9]+/, "$1");
          expect(out.split(/\r?\n/)).toEqual([
            expect.stringContaining("bun install v1."),
            "",
            `+ when@${tarball_url}`,
            "",
            "1 package installed",
          ]);
          expect(await exited).toBe(0);
          expect(proxied_urls).toEqual([tarball_url, codeload_url]);
          expect(proxy.targets).toEqual(["github.com:443", "codeload.github.com:443"]);
          expect(urls.sort()).toBeEmpty();
          expect(ctx.requested).toBe(0);
          expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "when"]);
          expect(await readdirSorted(join(ctx.package_dir, "node_modules", "when"))).toEqual([
            ".bun-tag",
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
      },
    );
  }

  it("should treat non-GitHub http(s) URLs as tarballs (https://some.url/path?stuff)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "4.3.0": { as: "4.3.0" },
        }),
      );
      const tarball_url = "https://gitpkg-fork.vercel.sh/vercel/turbo/crates/turbopack-node/js?turbopack-230922.2";
      const proxied_urls: string[] = [];
      await using proxy = await urlTarballProxy(ctx, proxied_urls, {
        [tarball_url]: await new Bun.Archive(
          {
            "package/package.json": JSON.stringify({
              name: "@vercel/turbopack-node",
              version: "0.0.0",
              dependencies: { "loader-runner": "^4.3.0" },
            }),
            "package/src/index.ts": "",
            "package/tsconfig.json": "{}",
          },
          { compress: "gzip" },
        ).bytes(),
      });
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            "@vercel/turbopack-node": tarball_url,
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: proxy.env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      let out = await stdout.text();
      out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
      out = out.replace(/(github:[^#]+)#[a-f0-9]+/, "$1");
      expect(out.split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ @vercel/turbopack-node@${tarball_url}`,
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      expect(proxied_urls).toEqual([tarball_url]);
      expect(proxy.targets).toEqual(["gitpkg-fork.vercel.sh:443"]);
      expect(urls.sort()).toEqual([`${ctx.registry_url}loader-runner`, `${ctx.registry_url}loader-runner-4.3.0.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".cache",
        "@vercel",
        "loader-runner",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@vercel"))).toEqual(["turbopack-node"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@vercel", "turbopack-node"))).toEqual([
        ".bun-tag",
        "package.json",
        "src",
        "tsconfig.json",
      ]);
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  // Tarball URLs reach the URL parser as written, without WHATWG normalization.
  // `user@` with a port used to be read as the hostname `user@127.0.0.1`
  // (#16181, the second repro of #7416; sending the credentials as Basic auth,
  // the rest of #7416, is a separate feature). Userinfo is delimited by the last
  // `@` before the path, so an unencoded `@` inside it stays userinfo.
  it.each(["user@", "user:pw@", "user@pass@", "user:p@ss@"])(
    "connects to the host of http://%s127.0.0.1:<port>/pkg.tgz",
    async userinfo => {
      const requests: string[] = [];
      using server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(req) {
          requests.push(`${req.method} ${new URL(req.url).pathname}`);
          return new Response(null, { status: 404 });
        },
      });
      const tarballUrl = `http://${userinfo}127.0.0.1:${server.port}/pkg.tgz`;
      using dir = tempDir("tarball-userinfo", {
        "package.json": JSON.stringify({ name: "foo", dependencies: { pkg: tarballUrl } }),
      });
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: {
          ...env,
          BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
          http_proxy: undefined,
          HTTP_PROXY: undefined,
          https_proxy: undefined,
          HTTPS_PROXY: undefined,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ requests, stdout, stderr, exitCode }).toEqual({
        requests: ["GET /pkg.tgz"],
        stdout: expect.stringContaining("bun install v1."),
        // The server's 404 is what fails the install; before, the request never left the machine.
        // The userinfo travels as an Authorization header, so the reported URL is the bare one.
        stderr: expect.stringContaining(`error: GET http://127.0.0.1:${server.port}/pkg.tgz - 404`),
        exitCode: 1,
      });
    },
  );

  it("should handle GitHub URL with existing lockfile", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.3": { bin: { "baz-run": "index.js" } } }));
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
        env: githubEnv(),
      });
      const err1 = await new Response(stderr1).text();
      expect(err1).toContain("Saved lockfile");
      const out1 = await new Response(stdout1).text();
      expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ html-minifier@github:kangax/html-minifier#4beb325",
        "",
        "2 packages installed",
      ]);
      expect(await exited1).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(ctx.requested).toBe(2);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "baz",
        "html-minifier",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins([
        "baz-run",
        "html-minifier",
      ]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
      expect(join(ctx.package_dir, "node_modules", ".bin", "html-minifier")).toBeValidBin(
        join("..", "html-minifier", "cli.js"),
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
        env: githubEnv(),
      });
      const err2 = await new Response(stderr2).text();
      expect(err2).not.toContain("Saved lockfile");
      const out2 = await new Response(stdout2).text();
      expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ html-minifier@github:kangax/html-minifier#4beb325",
        "",
        "2 packages installed",
      ]);
      expect(await exited2).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}baz-0.0.3.tgz`]);
      expect(ctx.requested).toBe(3);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "baz",
        "html-minifier",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins([
        "baz-run",
        "html-minifier",
      ]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
      expect(join(ctx.package_dir, "node_modules", ".bin", "html-minifier")).toBeValidBin(
        join("..", "html-minifier", "cli.js"),
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

  it("should report error on invalid format for package.json", async () => {
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
      const normalized = err
        .replaceAll(joinP(ctx.package_dir + sep), "[dir]/")
        .replaceAll(ctx.package_dir + sep, "[dir]/");
      expect(normalized).toMatchInlineSnapshot(`
        "1 | foo
            ^
        error: Unexpected foo
            at [dir]/package.json:1:1
        ParserError: failed to parse '[dir]/package.json'
        "
      `);
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
      command: string[] = ["install"],
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
        cmd: [bunExe(), ...command],
        cwd: String(dir),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toStartWith(`bun ${command[0]} v1.`);
      return {
        stderr: normalizeBunSnapshot(stderr, String(dir)),
        exitCode,
        lockfileKept: await exists(join(String(dir), "bun.lock")),
      };
    }

    const unparseable = (packageJsonPath: string) => writeFile(packageJsonPath, "foo");
    const unreadable = async (packageJsonPath: string) => {
      await rm(packageJsonPath);
      await mkdir(packageJsonPath);
    };
    // This is what a writer that died between truncating and writing leaves behind.
    const empty = (packageJsonPath: string) => writeFile(packageJsonPath, "");
    const fileIsEmpty = (path: string) =>
      [
        `error: failed to parse '<dir>/${path}': file is empty`,
        "note: restore package.json, or write {} to start without dependencies",
      ].join("\n");

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

      // An empty file parses as `{}`: "no dependencies", so the command would delete the lockfile.
      for (const command of [["install"], ["update"], ["update", "dep"], ["remove", "dep"]]) {
        if (!withLockfile && command[0] === "install") continue;
        it(`bun ${command.join(" ")} rejects an empty file and keeps the lockfile ${lockfile}`, async () => {
          expect(await installWithBrokenRootPackageJson(withLockfile, empty, command)).toEqual({
            stderr: fileIsEmpty("package.json"),
            exitCode: 1,
            lockfileKept: withLockfile,
          });
        });
      }
    }

    // `touch package.json && bun install`
    it("bun install reads an empty file as {} without a bun.lock", async () => {
      expect(await installWithBrokenRootPackageJson(false, empty)).toEqual({
        stderr: "No packages! Deleted empty lockfile",
        exitCode: 0,
        lockfileKept: false,
      });
    });

    it("bun add fills an empty file", async () => {
      expect(await installWithBrokenRootPackageJson(true, empty, ["add", "./dep"])).toMatchObject({
        stderr: "Saved lockfile",
        exitCode: 0,
        lockfileKept: true,
      });
    });

    // A member without a name is skipped. An empty file is not a member that chose to have none.
    it("rejects an empty workspace member manifest and keeps the lockfile", async () => {
      using dir = tempDir("empty-workspace-member", {
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "packages/foo/package.json": JSON.stringify({ name: "foo", dependencies: { dep: "file:../../dep" } }),
        "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      });
      const install = async (...args: string[]) => {
        await using proc = spawn({ cmd: [bunExe(), "install", ...args], cwd: String(dir), env, stderr: "pipe" });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        return { stderr: normalizeBunSnapshot(stderr, String(dir)), exitCode };
      };
      expect(await install("--lockfile-only")).toEqual({ stderr: "Saved lockfile", exitCode: 0 });
      const lockfileBefore = await file(join(String(dir), "bun.lock")).text();
      expect(lockfileBefore).toContain('"dep"');

      await writeFile(join(String(dir), "packages", "foo", "package.json"), "");
      expect(await install()).toEqual({ stderr: fileIsEmpty("packages/foo/package.json"), exitCode: 1 });
      expect(await file(join(String(dir), "bun.lock")).text()).toBe(lockfileBefore);
    });
  });

  // The depth that counts as "too deep" depends on the build's stack frames, so each test tries the depths around it.
  describe.concurrent("package.json nested deeper than the stack has room for", () => {
    const depths = [250, 500, 1000, 2000, 4000, 8000, 9000, 10_000, 11_000, 12_000, 16_000, 32_000, 48_000, 64_000];
    const nested = {
      objects: (depth: number) => `${Buffer.alloc(depth * 5, '{"a":')}1${Buffer.alloc(depth, "}")}`,
      arrays: (depth: number) => `${Buffer.alloc(depth, "[")}1${Buffer.alloc(depth, "]")}`,
    };
    const places = [
      ["the root", {}, "package.json", "StackOverflow: failed to parse '"],
      [
        "a workspace member",
        { "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }) },
        "packages/member/package.json",
        'error: StackOverflow reading package.json for workspace package "packages/member"',
      ],
    ] as const;

    for (const kind of ["objects", "arrays"] as const) {
      for (const [place, otherFiles, path, failure] of places) {
        it(`${kind} in ${place}: installed up to a depth, reported from there on`, async () => {
          // One at a time, because a debug build uses 250 MB per process.
          const outcomes: string[] = [];
          for (const depth of depths) {
            using dir = tempDir("deep-package-json", {
              ...otherFiles,
              [path]: `{"name":"deep","unused":${nested[kind](depth)}}`,
            });
            await using proc = spawn({
              cmd: [bunExe(), "install"],
              cwd: String(dir),
              env,
              stdout: "pipe",
              stderr: "pipe",
            });
            const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
            const reported =
              stderr.includes("error: JSON document is too deeply nested") &&
              stderr.replaceAll("\\", "/").includes(failure);
            outcomes.push(
              exitCode === 0
                ? "installed"
                : exitCode === 1 && reported
                  ? "reported"
                  : `depth ${depth}: exit ${exitCode}\n${stderr.slice(-600)}`,
            );
          }

          const reportedFrom = outcomes.indexOf("reported");
          expect(outcomes).toEqual(depths.map((_, i) => (i < reportedFrom ? "installed" : "reported")));
        });
      }
    }
  });

  it("should report error on invalid format for dependencies", async () => {
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
      expect(err.replaceAll(joinP(ctx.package_dir + sep), "[dir]/")).toMatchInlineSnapshot(`
        "1 | {"name":"foo","version":"0.0.1","dependencies":[]}
                                            ^
        error: dependencies expects a map of specifiers, e.g.
          "dependencies": {
            <green>"bun"<r>: <green>"latest"<r>
          }
            at [dir]/package.json:1:33
        "
      `);
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

  it("should report error on invalid format for workspaces", async () => {
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
      expect(err.replaceAll(joinP(ctx.package_dir + sep), "[dir]/")).toMatchInlineSnapshot(`
        "1 | {"name":"foo","version":"0.0.1","workspaces":{"packages":{"bar":true}}}
                                                                     ^
        error: "workspaces.packages" expects an array of strings, e.g.
          "workspaces": {
            "packages": [
              "path/to/package"
            ]
          }
            at [dir]/package.json:1:58
        "
      `);
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

  // The two cases below keep the URL forms of a repository on GitHub, dylan-conway/install-test2: a one-commit
  // repository holding an index.js and a package.json with no dependencies. `clone_url` is what bun has to ask git for.
  function installTest2Repository(clone_url: string) {
    return hostedGitRepository([clone_url], {
      "index.js": "",
      "package.json": JSON.stringify({ name: "install-test2", version: "0.2.0", main: "index.js" }),
    });
  }

  // `printed` is how bun echoes the specifier back. No committish was given, so the commit that is checked out is
  // HEAD (`sha`): it is reported in the summary and has to be the one tagged in the checkout and in the cache.
  async function expectInstallTest2Installed(ctx: TestContext, out: string, printed: string, sha: string) {
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun install v1."),
      "",
      `+ install-test2@${printed}#${sha}`,
      "",
      "1 package installed",
    ]);
    expect(ctx.requested).toBe(0);
    expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "install-test2"]);
    expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
      gitMirrorFolder,
      `@G@${sha}`,
    ]);
    expect(await readdirSorted(join(ctx.package_dir, "node_modules", "install-test2"))).toEqual([
      ".bun-tag",
      "index.js",
      "package.json",
    ]);
    expect(await file(join(ctx.package_dir, "node_modules", "install-test2", ".bun-tag")).text()).toBe(sha);
    expect(await file(join(ctx.package_dir, "node_modules", "install-test2", "package.json")).json()).toEqual({
      name: "install-test2",
      version: "0.2.0",
      main: "index.js",
    });
    await access(join(ctx.package_dir, "bun.lockb"));
  }

  it("should handle Git URL in dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      using repo = await installTest2Repository("https://git@github.com/dylan-conway/install-test2.git");
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            "install-test2": "git+https://git@github.com/dylan-conway/install-test2.git",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: repo.env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(await exited).toBe(0);
      expect(urls).toBeEmpty();
      await expectInstallTest2Installed(
        ctx,
        out,
        "git+https://git@github.com/dylan-conway/install-test2.git",
        repo.sha,
      );
    });
  });

  it("should handle Git URL in dependencies (SCP-style)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      using repo = await installTest2Repository("https://github.com/dylan-conway/install-test2.git");
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "install-test2": "github.com:dylan-conway/install-test2.git",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: repo.env,
      });
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(await exited).toBe(0);
      expect(urls).toBeEmpty();
      await expectInstallTest2Installed(ctx, out, "git+ssh://github.com:dylan-conway/install-test2.git", repo.sha);
    });
  });

  it("should handle Git URL with committish in dependencies", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      using repo = await serveTaggedGitPackage();
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            uglify: `${repo.url}#v1.0.0`,
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
      // The tag is resolved to the commit it points at.
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ uglify@${repo.url}#${repo.sha}`,
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toBeEmpty();
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["tagged"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "tagged")).toBeValidBin(
        join("..", "uglify", "bin", "tagged.js"),
      );
      // The cache holds the bare clone (named after a hash of the URL) and the checkout of the resolved commit.
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
        gitMirrorFolder,
        `@G@${repo.sha}`,
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "uglify"))).toEqual(repo.files);
      expect(await file(join(ctx.package_dir, "node_modules", "uglify", ".bun-tag")).text()).toBe(repo.sha);
      expect(await file(join(ctx.package_dir, "node_modules", "uglify", "package.json")).json()).toMatchObject({
        name: "tagged",
        version: "1.0.0",
      });
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
      const mirror = (await readdirSorted(cache)).find(entry => entry.endsWith(".git"))!;

      // `git log` during resolution does not need the tree object, but the checkout cannot list it without it.
      const treeObject = join(cache, mirror, "objects", treeSha.slice(0, 2), treeSha.slice(2));
      const treeBytes = await file(treeObject).bytes();
      await rm(treeObject);
      await rm(join(cache, `@G@${sha}`), { recursive: true });
      await rm(join(ctx.package_dir, "node_modules", "checkout-fails"), { recursive: true });
      const failed = await install();
      expect(failed.err).toContain('"git ls-tree" for "checkout-fails" failed');
      expect(failed.exitCode).not.toBe(0);
      expect(await readdirSorted(cache)).toEqual([mirror]);

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
      using proxy = refusingProxy();
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: proxy.env,
      });
      const err = await stderr.text();
      expect(err.split(/\r?\n/)).toContain("error: InstallFailed cloning repository for uglify");
      const out = await stdout.text();
      expect(out).toEqual(expect.stringContaining("bun install v1."));
      expect(await exited).toBe(1);
      // The clone was attempted against the URL as written (this is git's ref discovery request) and given up on
      // after it was refused.
      expect(proxy.requests).toEqual(["GET http://bun.sh/no_such_repo/info/refs?service=git-upload-pack"]);
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
      using repo = await serveTaggedGitPackage();
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            uglify: `${repo.url}#404-no_such_tag`,
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
      expect(await exists(join(ctx.package_dir, "node_modules", "uglify"))).toBeFalse();
      expect(await exists(join(ctx.package_dir, "bun.lockb"))).toBeFalse();
    });
  });

  it("should de-duplicate committish in Git URLs", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      using repo = await serveTaggedGitPackage();
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "Foo",
          version: "0.0.1",
          dependencies: {
            "uglify-ver": `${repo.url}#v1.0.0`,
            "uglify-hash": `${repo.url}#${repo.sha.slice(0, 7)}`,
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
      // The tag and the abbreviated hash name the same commit, so they are one package installed under two names.
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        `+ uglify-hash@${repo.url}#${repo.sha}`,
        `+ uglify-ver@${repo.url}#${repo.sha}`,
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
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["tagged"]);
      expect(join(ctx.package_dir, "node_modules", ".bin", "tagged")).toBeValidBin(
        join("..", "uglify-hash", "bin", "tagged.js"),
      );
      // One bare clone and one checkout serve both names.
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
        gitMirrorFolder,
        `@G@${repo.sha}`,
      ]);
      for (const name of ["uglify-hash", "uglify-ver"]) {
        expect(await readdirSorted(join(ctx.package_dir, "node_modules", name))).toEqual(repo.files);
        expect(await file(join(ctx.package_dir, "node_modules", name, ".bun-tag")).text()).toBe(repo.sha);
        expect(await file(join(ctx.package_dir, "node_modules", name, "package.json")).json()).toMatchObject({
          name: "tagged",
          version: "1.0.0",
        });
      }
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });

  it("should handle Git URL with existing lockfile", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      // A git dependency that itself depends on a registry package, so that re-installs exercise both.
      using repo = await serveTaggedGitPackage({ dependencies: { bar: "0.0.2" } });
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            tagged: `${repo.url}#v1.0.0`,
          },
        }),
      );

      async function install() {
        urls.length = 0;
        await using proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env,
        });
        const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          `+ tagged@${repo.url}#${repo.sha}`,
          "",
          "2 packages installed",
        ]);
        expect(exitCode).toBe(0);
        expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".bin", ".cache", "bar", "tagged"]);
        expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins(["tagged"]);
        expect(join(ctx.package_dir, "node_modules", ".bin", "tagged")).toBeValidBin(
          join("..", "tagged", "bin", "tagged.js"),
        );
        // With the cache disabled in bunfig, the git mirror and checkout as well as the registry package live in
        // node_modules/.cache, which is what the third install below re-links from.
        expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".cache"))).toEqual([
          gitMirrorFolder,
          `@G@${repo.sha}`,
          "bar",
          expect.stringMatching(/^bar@0\.0\.2@@localhost__[0-9a-f]{16}@@@1$/),
        ]);
        expect(await readdirSorted(join(ctx.package_dir, "node_modules", "tagged"))).toEqual(repo.files);
        expect(await file(join(ctx.package_dir, "node_modules", "tagged", ".bun-tag")).text()).toBe(repo.sha);
        expect(await file(join(ctx.package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
          name: "bar",
          version: "0.0.2",
        });
        await access(join(ctx.package_dir, "bun.lockb"));
        return err;
      }

      // First install: the tag is resolved, bar is resolved against the registry, and a lockfile is written.
      expect(await install()).toContain("Saved lockfile");
      expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(2);
      const lockfile = await file(join(ctx.package_dir, "bun.lockb")).bytes();

      // Again without node_modules (which holds the cache too): everything is re-fetched, but nothing is
      // re-resolved, so bar's manifest is not requested and the lockfile is not rewritten.
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      expect(await install()).not.toContain("Saved lockfile");
      expect(urls).toEqual([`${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(ctx.requested).toBe(3);
      expect(await file(join(ctx.package_dir, "bun.lockb")).bytes()).toEqual(lockfile);

      // Again with the cache kept: the packages are re-linked from it without any request.
      for (const entry of [".bin", "bar", "tagged"]) {
        await rm(join(ctx.package_dir, "node_modules", entry), { force: true, recursive: true });
      }
      expect(await install()).not.toContain("Saved lockfile");
      expect(urls).toBeEmpty();
      expect(ctx.requested).toBe(3);
      expect(await file(join(ctx.package_dir, "bun.lockb")).bytes()).toEqual(lockfile);
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
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual([
        ".bun-tag",
        "index.js",
        "package.json",
      ]);
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
          ".bun-tag",
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
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual([
        ".bun-tag",
        "index.js",
        "package.json",
      ]);
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
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual([
        ".bun-tag",
        "index.js",
        "package.json",
      ]);
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
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "bar"))).toEqual([
        ".bun-tag",
        "index.js",
        "package.json",
      ]);
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

  describe("leading whitespace in the version literal", () => {
    // Leading whitespace is ignored when a version literal is classified, so each of these has to
    // install what the literal without the whitespace installs. The second install re-parses the
    // literal stored in the lockfile (bun.lockb unless told otherwise) and has to agree with the first.
    async function installTwice(
      ctx: TestContext,
      installed: { name: string; version: string },
      lockfile: "bun.lockb" | "bun.lock" = "bun.lockb",
    ) {
      const firstInstall = lockfile === "bun.lock" ? ["--save-text-lockfile"] : [];
      for (const args of [firstInstall, ["--frozen-lockfile"]]) {
        await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });
        await using proc = spawn({
          cmd: [bunExe(), "install", ...args],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env,
        });
        const [err, out, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
        expect(err).not.toContain("error:");
        expect(out).toContain("1 package installed");
        expect(exitCode).toBe(0);
        expect(await file(join(ctx.package_dir, "node_modules", installed.name, "package.json")).json()).toMatchObject(
          installed,
        );
      }
      await access(join(ctx.package_dir, lockfile));
    }

    for (const version of [" latest", "\tlatest"]) {
      it(`installs the dist-tag ${JSON.stringify(version)}`, async () => {
        await withContext(defaultOpts, async ctx => {
          const urls: string[] = [];
          setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
          await writeFile(
            join(ctx.package_dir, "package.json"),
            JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: version } }),
          );

          await installTwice(ctx, { name: "bar", version: "0.0.2" });
          expect(urls.slice(0, 2)).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
        });
      });
    }

    it("keeps the literal as written in bun.lock", async () => {
      await withContext(defaultOpts, async ctx => {
        setContextHandler(ctx, dummyRegistryForContext(ctx, []));
        await writeFile(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: " latest" } }),
        );

        await installTwice(ctx, { name: "bar", version: "0.0.2" }, "bun.lock");
        expect(await file(join(ctx.package_dir, "bun.lock")).text()).toContain('"bar": " latest"');
      });
    });

    it('installs the folder " ./pkg"', async () => {
      await withContext(defaultOpts, async ctx => {
        await mkdir(join(ctx.package_dir, "pkg"));
        await Promise.all([
          writeFile(
            join(ctx.package_dir, "package.json"),
            JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { pkg: " ./pkg" } }),
          ),
          writeFile(join(ctx.package_dir, "pkg", "package.json"), JSON.stringify({ name: "pkg", version: "1.0.0" })),
        ]);

        await installTwice(ctx, { name: "pkg", version: "1.0.0" });
        expect(ctx.requested).toBe(0);
      });
    });

    // " file:./x.tgz" resolves on the first install either way; it is here for the second one, which
    // re-parses the literal stored in bun.lockb with the tag the first install gave it.
    for (const version of [" ./baz-0.0.3.tgz", " file:./baz-0.0.3.tgz"]) {
      it(`installs the local tarball ${JSON.stringify(version)}`, async () => {
        await withContext(defaultOpts, async ctx => {
          await Promise.all([
            writeFile(
              join(ctx.package_dir, "package.json"),
              JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { baz: version } }),
            ),
            cp(join(import.meta.dir, "baz-0.0.3.tgz"), join(ctx.package_dir, "baz-0.0.3.tgz")),
          ]);

          await installTwice(ctx, { name: "baz", version: "0.0.3" });
          expect(ctx.requested).toBe(0);
        });
      });
    }
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
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn", "moo"))).toEqual([
        ".bun-tag",
        "package.json",
      ]);
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
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn", "moo"))).toEqual([
        ".bun-tag",
        "package.json",
      ]);
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
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn", "moo"))).toEqual([
        ".bun-tag",
        "package.json",
      ]);
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

  it("should handle tarball URL of a package without a name with existing lockfile", async () => {
    await withContext(defaultOpts, async ctx => {
      const tarball = await new Bun.Archive(
        { "package/package.json": JSON.stringify({ version: "0.1.0" }) },
        { compress: "gzip" },
      ).bytes();
      const urls: string[] = [];
      setContextHandler(ctx, request => {
        urls.push(request.url);
        return new Response(tarball);
      });
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: { "no-name": `${ctx.registry_url}no-name-0.1.0.tgz` },
        }),
      );
      const install = async () => {
        await using proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "ignore",
          stderr: "pipe",
          env,
        });
        const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        return { logged: err.split(/\r?\n/).filter(line => /^(error|warn): /.test(line)), exitCode };
      };

      expect(await install()).toEqual({ logged: [], exitCode: 0 });
      await access(join(ctx.package_dir, "bun.lockb"));
      // The cache is in node_modules. The second install extracts the tarball again, and the lockfile
      // has no name for the package.
      await rm(join(ctx.package_dir, "node_modules"), { force: true, recursive: true });
      expect(await install()).toEqual({ logged: [], exitCode: 0 });
      expect(urls).toEqual([`${ctx.registry_url}no-name-0.1.0.tgz`, `${ctx.registry_url}no-name-0.1.0.tgz`]);
      expect(await file(join(ctx.package_dir, "node_modules", "no-name", "package.json")).json()).toEqual({
        version: "0.1.0",
      });
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
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn", "moo"))).toEqual([
        ".bun-tag",
        "package.json",
      ]);
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
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@barn", "moo"))).toEqual([
        ".bun-tag",
        "package.json",
      ]);
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

  // https://github.com/oven-sh/bun/issues/29273
  //
  // `C:` is the current directory of drive C, it is not the root `C:\`. `bun install` removed the
  // separator from a cwd of `C:\`, and the project directory it then opened did not exist.
  describe.skipIf(!isWindows)("project in the root of a drive", () => {
    async function run(cwd: string, ...args: string[]) {
      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    const bar = { name: "bar", version: "0.0.2" };

    it.each(["hoisted", "isolated"] as const)("bun install with the %s linker", async linker => {
      await withContext({ linker }, async ctx => {
        setContextHandler(ctx, dummyRegistryForContext(ctx, []));
        await writeFile(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({
            name: "foo",
            version: "0.0.1",
            dependencies: { bar: "^0" },
            scripts: { postinstall: "echo INIT_CWD=$INIT_CWD" },
          }),
        );
        using drive = substDrive(ctx.package_dir);

        const { stdout, stderr, exitCode } = await run(drive.root, "install");
        expect(stderr).toContain("Saved lockfile");
        expect(stdout).toContain("+ bar@0.0.2");
        expect(stdout.split(/\r?\n/)).toContain(`INIT_CWD=${drive.root}`);
        expect(await file(join(drive.root, "node_modules", "bar", "package.json")).json()).toEqual(bar);
        expect(exitCode).toBe(0);
      });
    });

    it("bun install from a directory below a package.json in the root", async () => {
      await withContext(defaultOpts, async ctx => {
        setContextHandler(ctx, dummyRegistryForContext(ctx, []));
        await writeFile(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "^0" } }),
        );
        await mkdir(join(ctx.package_dir, "moo", "src"), { recursive: true });
        using drive = substDrive(ctx.package_dir);

        const { stdout, stderr, exitCode } = await run(join(drive.root, "moo", "src"), "install");
        expect(stderr).toContain("Saved lockfile");
        expect(stdout).toContain("+ bar@0.0.2");
        expect(await file(join(drive.root, "node_modules", "bar", "package.json")).json()).toEqual(bar);
        expect(await readdirSorted(join(drive.root, "moo"))).toEqual(["src"]);
        expect(exitCode).toBe(0);
      });
    });

    it("bun add and bun remove", async () => {
      await withContext(defaultOpts, async ctx => {
        setContextHandler(ctx, dummyRegistryForContext(ctx, []));
        await writeFile(join(ctx.package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));
        using drive = substDrive(ctx.package_dir);

        const added = await run(drive.root, "add", "bar");
        expect(added.stderr).toContain("Saved lockfile");
        expect(added.stdout).toContain("installed bar@0.0.2");
        expect(await file(join(drive.root, "package.json")).json()).toEqual({
          name: "foo",
          version: "0.0.1",
          dependencies: { bar: "^0.0.2" },
        });
        expect(await file(join(drive.root, "node_modules", "bar", "package.json")).json()).toEqual(bar);
        expect(added.exitCode).toBe(0);

        const removed = await run(drive.root, "remove", "bar");
        expect(removed.stderr).toContain("package.json has no dependencies! Deleted empty lockfile");
        expect(await file(join(drive.root, "package.json")).json()).toEqual({ name: "foo", version: "0.0.1" });
        expect(removed.exitCode).toBe(0);
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
      const packages = (Bun.JSONC.parse(lockfile) as any).packages as Record<string, [string, ...unknown[]]>;
      expect(Object.fromEntries(Object.entries(packages).map(([name, [resolution]]) => [name, resolution]))).toEqual(
        expected,
      );

      expect(await install("--frozen-lockfile")).toBe(lockfile);
      expect(await install()).toBe(lockfile);
    });
  });

  // Shared by the frozen lockfile tests below: installs baz@0.0.3, then bumps package.json to baz@0.0.5 so that the
  // next install would have to change the lockfile. Returns what a frozen install has to leave alone.
  async function installBazThenBumpIt(ctx: TestContext) {
    const urls: string[] = [];
    setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.3": { as: "0.0.3" }, "0.0.5": { as: "0.0.5" } }));
    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { baz: "0.0.3" } }),
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
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun install v1."),
      "",
      "+ baz@0.0.3 (v0.0.5 available)",
      "",
      "1 package installed",
    ]);
    expect(exitCode).toBe(0);
    expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
    urls.length = 0;

    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { baz: "0.0.5" } }),
    );
    return { urls, lockfile: await file(join(ctx.package_dir, "bun.lockb")).bytes() };
  }

  // Runs `args` in a project prepared by installBazThenBumpIt: the install has to be refused after resolving against
  // the registry, and the lockfile and the installed package have to be left as they were.
  async function expectFrozenInstallRefused(
    ctx: TestContext,
    { urls, lockfile }: Awaited<ReturnType<typeof installBazThenBumpIt>>,
    args: string[],
  ) {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd: ctx.package_dir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain("error: lockfile had changes, but lockfile is frozen");
    expect(err).not.toContain("Saved lockfile");
    expect(out).toContain("bun install v1.");
    expect(out).not.toContain("installed");
    expect(exitCode).toBe(1);
    expect(urls).toContain(`${ctx.registry_url}baz`);
    urls.length = 0;
    expect(await file(join(ctx.package_dir, "bun.lockb")).bytes()).toEqual(lockfile);
    expect(await file(join(ctx.package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
      name: "baz",
      version: "0.0.3",
    });
  }

  it("should handle --frozen-lockfile", async () => {
    await withContext(defaultOpts, async ctx => {
      const prepared = await installBazThenBumpIt(ctx);
      await expectFrozenInstallRefused(ctx, prepared, ["install", "--frozen-lockfile"]);
    });
  });

  it("should handle bun ci alias (to --frozen-lockfile)", async () => {
    await withContext(defaultOpts, async ctx => {
      const prepared = await installBazThenBumpIt(ctx);
      await expectFrozenInstallRefused(ctx, prepared, ["ci"]);
      // test that it works even if ci isn't first "arg"
      await expectFrozenInstallRefused(ctx, prepared, ["--save", "ci"]);
    });
  });

  it("should handle frozenLockfile in config file", async () => {
    await withContext(defaultOpts, async ctx => {
      const prepared = await installBazThenBumpIt(ctx);
      await writeFile(
        join(ctx.package_dir, "bunfig.toml"),
        Bun.TOML.stringify({
          install: {
            frozenLockfile: true,
            registry: ctx.registry_url,
          },
        }),
      );
      await expectFrozenInstallRefused(ctx, prepared, ["install"]);
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
      // The lockfile pins the integrity of 112 real packages, so no stand-in registry can serve them. This case is
      // about what happens after the download: every package is already in the cache (`cache = false` keeps it in
      // node_modules/.cache) as a package.json plus the files the lockfile's bins point at.
      await using printed = spawn({
        cmd: [bunExe(), "bun.lockb"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "inherit",
        env,
      });
      const bin_files: Record<string, string[]> = {
        prettier: ["bin-prettier.js"],
        resolve: ["bin/resolve"],
        semver: ["bin/semver", "bin/semver.js"],
        tsd: ["dist/cli.js"],
        typescript: ["bin/tsc", "bin/tsserver"],
      };
      const locked = [...(await printed.stdout.text()).matchAll(/^"?(@?[^@"\n]+)@.*:\r?\n  version "([^"]+)"/gm)];
      expect(locked).toHaveLength(112);
      await Promise.all(
        locked.flatMap(([, name, version]) => {
          const cached = join(ctx.package_dir, "node_modules", ".cache", `${name}@${version}@@@1`);
          return [
            write(join(cached, "package.json"), JSON.stringify({ name, version })),
            ...(bin_files[name] ?? []).map(path => write(join(cached, path), "#!/usr/bin/env node\n")),
          ];
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

    const { stdout, stderr } = await Bun.$`${bunExe()} install`.env(env).cwd(package_dir).quiet().throws(true);
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

    const { stdout, stderr } = await Bun.$`${bunExe()} install`.env(env).cwd(package_dir).quiet().throws(true);
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
      "package.json": ({ root }) =>
        JSON.stringify({
          name: "package3",
          version: "0.0.1",
          workspaces: [join(root, "packages/**/*")],
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
    const { stdout, stderr } = await Bun.$`${bunExe()} install`.env(env).cwd(package_dir).quiet().throws(true);
    const err1 = stderr.toString();
    expect(err1).toContain("Saved lockfile");
    expect(
      stdout
        .toString()
        .replace(/\s*\[[0-9\.]+m?s\]\s*$/, "")
        .split(/\r?\n/),
    ).toEqual([expect.stringContaining("bun install v1."), "", "4 packages installed"]);
  });

  describe("should handle installing packages inside workspaces with difference versions", () => {
    // package2 to package5 each depend on package1 through a different workspace specifier.
    const packages: Record<string, { name: string; version: string; dependencies?: Record<string, string> }> = {
      package1: { name: "package1", version: "0.0.2" },
      package2: { name: "package2", version: "0.0.1", dependencies: { package1: "workspace:*" } },
      package3: { name: "package3", version: "0.0.1", dependencies: { package1: "workspace:^" } },
      package4: { name: "package4", version: "0.0.1", dependencies: { package1: "workspace:../package1" } },
      package5: { name: "package5", version: "0.0.1", dependencies: { package1: "workspace:0.0.2" } },
    };
    const roots = {
      "a glob": { name: "main", private: true, workspaces: ["packages/*"] },
      "a list": { name: "main", private: true, workspaces: Object.keys(packages).map(name => `packages/${name}`) },
    };

    for (const [workspaces, root] of Object.entries(roots)) {
      for (const from of ["package2", "package3", "package4", "package5", "the root"]) {
        it(`installs from ${from} when workspaces is ${workspaces}`, async () => {
          await withContext(defaultOpts, async ctx => {
            await write(join(ctx.package_dir, "package.json"), JSON.stringify(root));
            for (const [name, package_json] of Object.entries(packages)) {
              await write(join(ctx.package_dir, "packages", name, "package.json"), JSON.stringify(package_json));
            }
            const cwd = from === "the root" ? ctx.package_dir : join(ctx.package_dir, "packages", from);

            {
              await using proc = spawn({
                cmd: [bunExe(), "install"],
                cwd,
                stdout: "pipe",
                stdin: "ignore",
                stderr: "pipe",
                env,
              });
              const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
              expect(err).toContain("Saved lockfile");
              expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
                expect.stringContaining("bun install v1."),
                "",
                ...(from === "the root" ? [] : ["+ package1@workspace:packages/package1", ""]),
                "5 packages installed",
              ]);
              expect(exitCode).toBe(0);
              expect(ctx.requested).toBe(0);
            }

            const urls: string[] = [];
            setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
            {
              await using proc = spawn({
                cmd: [bunExe(), "install", "bar"],
                cwd,
                stdout: "pipe",
                stdin: "ignore",
                stderr: "pipe",
                env,
              });
              const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
              expect(err).toContain("Saved lockfile");
              expect(out).toContain("installed bar@0.0.2");
              expect(exitCode).toBe(0);
            }
            expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);

            // bar is added to the package the command ran in and nowhere else, and is hoisted next to the workspaces.
            for (const [name, package_json] of Object.entries(packages)) {
              expect(await file(join(ctx.package_dir, "packages", name, "package.json")).json()).toEqual(
                from === name
                  ? { ...package_json, dependencies: { bar: "^0.0.2", ...package_json.dependencies } }
                  : package_json,
              );
            }
            expect(await file(join(ctx.package_dir, "package.json")).json()).toEqual(
              from === "the root" ? { ...root, dependencies: { bar: "^0.0.2" } } : root,
            );
            expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
              ".cache",
              "bar",
              ...Object.keys(packages),
            ]);
            await access(join(ctx.package_dir, "bun.lockb"));
          });
        });
      }
    }
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

            // Only the join is under test; the request it produces must not reach a resolver (see refusingProxy).
            using proxy = refusingProxy();
            const { stdout, stderr, exited } = spawn({
              cmd: [bunExe(), "install"],
              cwd: ctx.package_dir,
              stdout: "pipe",
              stdin: "pipe",
              stderr: "pipe",
              env: proxy.env,
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
        expect(cache).toContainEqual(expect.stringMatching(/^no-deps@1\.0\.0@@127\.0\.0\.1__[0-9a-f]{16}@@@1$/));
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
        const { result } = await installNoDeps(origin => ({
          "bunfig.toml": Bun.TOML.stringify({ install: { registry: { url: `${singleColon(origin)}/npm/`, token } } }),
          "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "..": "1.0.0" } }),
        }));
        expect(result).toEqual({
          requests: [],
          stdout: expect.stringContaining("bun install v1."),
          // Rejected as a name before any URL is built from it.
          stderr: expect.stringContaining(`error: invalid dependency name ".."`),
          exitCode: 1,
        });
      });
    });
  });

  // A host can have several registries: a repository path on Nexus or Artifactory, two Verdaccio ports.
  // Each may serve its own bytes for the same name@version, so each has its own entries in the cache.
  describe("registries that share a hostname", () => {
    /** Serves no-deps@1.0.0 under each directory. Its index.js exports the directory. */
    async function serveRegistries(...directories: string[]) {
      const tarballs = new Map<string, { bytes: Uint8Array; integrity: string }>();
      for (const directory of directories) {
        const bytes = await new Bun.Archive(
          {
            "package/package.json": JSON.stringify({ name: "no-deps", version: "1.0.0" }),
            "package/index.js": `module.exports = ${JSON.stringify(directory)};\n`,
          },
          { compress: "gzip" },
        ).bytes();
        const integrity = "sha512-" + new Bun.CryptoHasher("sha512").update(bytes).digest("base64");
        tarballs.set(directory, { bytes, integrity });
      }
      const requests: string[] = [];
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req, server) {
          const { pathname } = new URL(req.url);
          requests.push(pathname);
          const directory = directories.find(directory => pathname.startsWith(directory))!;
          const { bytes, integrity } = tarballs.get(directory)!;
          if (pathname.endsWith(".tgz")) return new Response(bytes);
          const tarball = `http://127.0.0.1:${server.port}${directory}no-deps/-/no-deps-1.0.0.tgz`;
          return Response.json({
            name: "no-deps",
            "dist-tags": { latest: "1.0.0" },
            versions: { "1.0.0": { name: "no-deps", version: "1.0.0", dist: { tarball, integrity } } },
          });
        },
      });
      return { server, requests, integrity: (directory: string) => tarballs.get(directory)!.integrity };
    }

    const project = (registry: string) => ({
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "1.0.0" } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry } }),
    });

    /** Installs the project with the cache they all share. Returns what it got and what bun.lock says it is. */
    async function install(root: string, name: string, ...args: string[]) {
      await using proc = spawn({
        cmd: [bunExe(), "install", ...args],
        cwd: join(root, name),
        env: { ...env, BUN_INSTALL_CACHE_DIR: join(root, "cache") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      return {
        installed: await file(join(root, name, "node_modules", "no-deps", "index.js")).text(),
        locked: (Bun.JSONC.parse(await file(join(root, name, "bun.lock")).text()) as any).packages["no-deps"].at(-1),
      };
    }
    const entries = async (root: string) =>
      (await readdirSorted(join(root, "cache"))).filter(name => name.startsWith("no-deps@"));
    const entry = expect.stringMatching(/^no-deps@1\.0\.0@@127\.0\.0\.1__[0-9a-f]{16}@@@1$/);

    it("tells two paths apart", async () => {
      const { server, requests, integrity } = await serveRegistries("/public/", "/private/");
      await using _ = server;
      using dir = tempDir("registries-two-paths", {
        a: project(`${server.url}public/`),
        b: project(`${server.url}private/`),
      });
      const root = String(dir);

      expect(await install(root, "a")).toEqual({
        installed: 'module.exports = "/public/";\n',
        locked: integrity("/public/"),
      });
      const b = { installed: 'module.exports = "/private/";\n', locked: integrity("/private/") };
      expect(await install(root, "b")).toEqual(b);
      expect(await entries(root)).toEqual([entry, entry]);

      // From b's own entry, without asking for the tarball again.
      await rm(join(root, "b", "node_modules"), { recursive: true });
      expect(await install(root, "b", "--frozen-lockfile")).toEqual(b);
      expect(requests.filter(path => path.endsWith(".tgz"))).toEqual([
        "/public/no-deps/-/no-deps-1.0.0.tgz",
        "/private/no-deps/-/no-deps-1.0.0.tgz",
      ]);
    });

    it("tells two ports apart", async () => {
      const first = await serveRegistries("/");
      const second = await serveRegistries("/");
      await using _first = first.server;
      await using _second = second.server;
      using dir = tempDir("registries-two-ports", {
        a: project(first.server.url.href),
        b: project(second.server.url.href),
      });
      const root = String(dir);

      await install(root, "a");
      await install(root, "b");
      expect(second.requests).toContain("/no-deps/-/no-deps-1.0.0.tgz");
      expect(await entries(root)).toEqual([entry, entry]);
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
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "@~39/bar"],
        cwd: ctx.package_dir,
        stdin: null,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      expect(await stderr.text()).toContain("Saved lockfile");
      expect(await stdout.text()).toContain("installed @~39/bar@0.0.2");
      expect(await exited).toBe(0);
      // The issue was that the tilde made the name look like something other than a registry package. It has to be
      // looked up on the registry under its full scoped name and land under its scope in node_modules.
      expect(urls.sort()).toEqual([`${ctx.registry_url}@~39%2fbar`, `${ctx.registry_url}@~39/bar-0.0.2.tgz`]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "@~39", "bar"))).toEqual(["package.json"]);
      expect((await file(join(ctx.package_dir, "package.json")).json()).dependencies).toEqual({ "@~39/bar": "^0.0.2" });
    });
  });

  it("should handle modified git resolutions in bun.lock", async () => {
    await withContext(defaultOpts, async ctx => {
      using repo = await hostedGitRepository(["https://github.com/dylan-conway/install-test-8.git"], {
        "package.json": JSON.stringify({
          name: "install-test-eight",
          version: "2.2.2",
          dependencies: { jquery: "3.7.1" },
        }),
      });
      // install-test-8 has a dependency but because it's not in the lockfile
      // it won't be included in the install.
      const lockfile = JSON.stringify({
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
          "jquery": [`jquery@git+ssh://git@github.com/dylan-conway/install-test-8.git#${repo.sha}`, {}, repo.sha],
        },
      });
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
        write(join(ctx.package_dir, "bun.lock"), lockfile),
      ]);

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
        env: repo.env,
      });

      const err = await stderr.text();
      const out = await stdout.text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("error:");

      expect(out).toContain("1 package installed");
      expect(await exited).toBe(0);

      // The git resolution from the lockfile wins over the registry version in package.json: nothing is fetched
      // from the registry, the repository's own dependency is not installed, and the lockfile is left untouched.
      expect(ctx.requested).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "jquery"]);
      expect(await file(join(ctx.package_dir, "node_modules", "jquery", "package.json")).json()).toEqual({
        name: "install-test-eight",
        version: "2.2.2",
        dependencies: { jquery: "3.7.1" },
      });
      expect(await file(join(ctx.package_dir, "bun.lock")).text()).toBe(lockfile);
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

// The tests below are outside the describe.concurrent group above. A plain top-level `it` here runs by itself after
// every other test in the file has finished, so keep them `it.concurrent`: those overlap with the group and each other.
// (Names that would not fit on the declaration line are hoisted into constants: prettier only keeps over-long test
// calls on one line for plain it/test, and would otherwise re-indent the whole body.)

it.concurrent("rejects dependency aliases containing '..' path segments", async () => {
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
    expect(err).toContain("invalid dependency name");
    expect(out).not.toContain("1 package installed");
    expect(await exited).toBe(1);
  });
});

// Serves `bar` as a registry package whose manifest declares `dependencies`,
// and every other name as a package with no dependencies.
function registryWhereBarDependsOn(ctx: TestContext, urls: string[], dependencies: Record<string, string>) {
  const bar = dummyRegistryForContext(ctx, urls, { "0.0.2": { dependencies } });
  const others = dummyRegistryForContext(ctx, urls, { "0.0.3": {} });
  return (request: Request) => (new URL(request.url).pathname.endsWith("/bar") ? bar(request) : others(request));
}

// The key of a dependency becomes a path under node_modules, and a registry
// package chooses the keys of its own dependencies. A key that names an entry
// the installer owns would unpack the target there: `.bin` is on the PATH of
// every lifecycle script, so is the `.bin` of a nested `node_modules`, and a
// bare `@scope` is the directory the project's own `@scope/*` packages live in.
const namesTheInstallerOwns = [
  ".bin",
  "@barn/.bin",
  "node_modules",
  "Node_Modules",
  "@barn/node_modules",
  "@barn",
  "@/baz",
  "@barn/baz/extra",
];
describe.concurrent.each(namesTheInstallerOwns)("a dependency named %p", key => {
  it.each([
    ["a registry package", "hoisted"],
    ["a registry package", "isolated"],
    ["the project", "hoisted"],
    ["the project", "isolated"],
  ])("declared by %s is refused before anything is installed (%s linker)", async (declarer, linker) => {
    await withContext({ linker: linker as "hoisted" | "isolated" }, async ctx => {
      const urls: string[] = [];
      const target = { [key]: "npm:baz@0.0.3" };
      const fromRegistry = declarer === "a registry package";
      setContextHandler(ctx, registryWhereBarDependsOn(ctx, urls, fromRegistry ? target : {}));
      await Promise.all([
        writeFile(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({
            name: "foo",
            version: "0.0.1",
            // `bar` is a normal package that must install when nothing is refused
            dependencies: fromRegistry ? { bar: "0.0.2" } : { ...target, bar: "0.0.2" },
            scripts: { postinstall: [bunExe(), "foo-postinstall.js"].join(" ") },
          }),
        ),
        writeFile(
          join(ctx.package_dir, "foo-postinstall.js"),
          'require("fs").writeFileSync("foo-postinstall.txt", "ran");',
        ),
      ]);

      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({
        errors: err.split(/\r?\n/).filter(line => line.startsWith("error:")),
        // nothing is unpacked at the reserved path
        unpacked: await exists(join(ctx.package_dir, "node_modules", key, "package.json")),
        // The install stops before the linker, so the valid package next to the refused one isn't installed either.
        otherInstalled: await exists(join(ctx.package_dir, "node_modules", "bar", "package.json")),
        // and no lifecycle script runs
        postinstall: await exists(join(ctx.package_dir, "foo-postinstall.txt")),
        installed: out.includes("installed"),
        exitCode,
      }).toEqual({
        errors: [`error: invalid dependency name "${key}"`, `error: ${key}@npm:baz@0.0.3 failed to resolve`],
        unpacked: false,
        otherInstalled: false,
        postinstall: false,
        installed: false,
        exitCode: 1,
      });
    });
  });

  // The resolver never sees a dependency that bun.lock already has, so the tree builder has to refuse it.
  it.each(["hoisted", "isolated"])("in a bun.lock an older bun wrote is refused (%s linker)", async linker => {
    using dir = tempDir("lockfile-holds-refused-name", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { [key]: "file:./payload", good: "file:./good" },
      }),
      "payload/package.json": JSON.stringify({ name: "payload", version: "1.0.0" }),
      "good/package.json": JSON.stringify({ name: "good", version: "1.0.0" }),
      "bun.lock": JSON.stringify({
        lockfileVersion: 2,
        configVersion: 1,
        workspaces: { "": { name: "app", dependencies: { [key]: "file:./payload", good: "file:./good" } } },
        packages: { [key]: ["payload@file:payload", {}], good: ["good@file:good", {}] },
      }),
    });

    await using proc = spawn({
      cmd: [bunExe(), "install", `--linker=${linker}`],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({
      errors: [...new Set(err.split(/\r?\n/).filter(line => line.startsWith("error:")))],
      nodeModules: await exists(join(String(dir), "node_modules")),
      installed: out.includes("installed"),
      exitCode,
    }).toEqual({
      errors: [`error: invalid dependency name "${key}"`],
      nodeModules: false,
      installed: false,
      exitCode: 1,
    });
  });
});

it.concurrent("installs after package.json drops a name that bun.lock still has", async () => {
  // bun.lock as an older bun wrote it, when the key `@src` was accepted. The
  // project has since renamed that dependency. The stale name is in the file
  // that is loaded, not in the graph that is installed.
  using dir = tempDir("stale-lockfile-name", {
    "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "src-alias": "file:./src" } }),
    "src/package.json": JSON.stringify({ name: "src", version: "1.0.0" }),
    "bun.lock": `{
  "lockfileVersion": 2,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "app",
      "dependencies": {
        "@src": "file:./src",
      },
    },
  },
  "packages": {
    "@src": ["src@file:src", {}],
  }
}
`,
  });

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({
    errors: err.split(/\r?\n/).filter(line => line.startsWith("error:")),
    linked: await exists(join(String(dir), "node_modules", "src-alias", "package.json")),
    // the lockfile is written again, without the name
    lockfileHoldsStaleName: (await file(join(String(dir), "bun.lock")).text()).includes('"@src"'),
    exitCode,
  }).toEqual({ errors: [], linked: true, lockfileHoldsStaleName: false, exitCode: 0 });
});

it.concurrent("refuses a registry package whose own name is reserved by the installer", async () => {
  await withContext(defaultOpts, async ctx => {
    const urls: string[] = [];
    // The alias is fine. The name that the registry serves is the one that would become the cache folder.
    setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.3": {} }));
    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { helper: "npm:.bin@0.0.3" } }),
    );

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.package_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(err).toContain('error: invalid dependency name ".bin"');
    expect(out).not.toContain("installed");
    expect(urls).toEqual([]);
    expect(exitCode).toBe(1);
  });
});

it.concurrent("still installs an alias that isn't reserved by the installer", async () => {
  await withContext(defaultOpts, async ctx => {
    const urls: string[] = [];
    setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.3": {} }));
    // npm refuses a leading underscore and a leading hyphen too. Neither names
    // a directory the installer uses, so these keep working.
    const aliases = ["_baz", "-baz", "baz.js", "@barn/baz"];
    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: Object.fromEntries(aliases.map(alias => [alias, "npm:baz@0.0.3"])),
      }),
    );

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.package_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(err).not.toContain("error:");
    // One package, under four names.
    expect(out).toContain("1 package installed");
    expect(
      await Promise.all(aliases.map(alias => exists(join(ctx.package_dir, "node_modules", alias, "package.json")))),
    ).toEqual([true, true, true, true]);
    expect(exitCode).toBe(0);
  });
});

it.concurrent("still links a bin whose name starts with a period", async () => {
  await withContext(defaultOpts, async ctx => {
    const urls: string[] = [];
    // A bin name is not a node_modules entry. npm links this one, and so does bun.
    setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.3": { bin: { ".baz-run": "index.js" } } }));
    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { baz: "0.0.3" } }),
    );

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.package_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(err).not.toContain("error:");
    expect(out).toContain("1 package installed");
    expect(await readdirSorted(join(ctx.package_dir, "node_modules", ".bin"))).toHaveBins([".baz-run"]);
    expect(join(ctx.package_dir, "node_modules", ".bin", ".baz-run")).toBeValidBin(join("..", "baz", "index.js"));
    expect(exitCode).toBe(0);
  });
});

it.concurrent("does not extract a tarball for a dependency alias containing '..' path segments", async () => {
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
    // The unsafe alias is reported as an error before the tarball is even
    // requested, and nothing is installed.
    expect(err).toContain('invalid dependency name "x/../../../.."');
    expect(urls).toEqual([]);
    expect(out).not.toContain("1 package installed");
    expect(exitCode).not.toBe(0);
  });
});

describe.concurrent("dependency names containing terminal control characters", () => {
  // OSC 52 (write to the clipboard) followed by CSI 2J (clear the screen). A
  // registry serves it as an ordinary JSON string (`"ev\u001b]52;..."`), so it
  // reaches bun like any other dependency name.
  const controlName = "ev\x1b]52;c;aGkK\x07\x1b[2Jil";
  // Bun prints it with the control characters escaped.
  const escapedName = String.raw`ev\x1b]52;c;aGkK\x07\x1b[2Jil`;
  // Forces the progress line, which echoes the name of every manifest being
  // fetched, even though stderr is a pipe here.
  const progressEnv = { ...env, BUN_INSTALL_PROGRESS: "1" };

  /**
   * The dummy registry, which has a manifest for every name asked of it, plus:
   * the control-character package really is installable (its tarball is
   * bar's) and `bar@0.0.2` declares `barDeps`.
   */
  function registry(ctx: TestContext, urls: string[], barDeps: object = {}) {
    const dummy = dummyRegistryForContext(ctx, urls);
    return async (req: Request) => {
      const name = decodeURIComponent(new URL(req.url).pathname.slice(`/${ctx.id}/`.length));
      if (name.endsWith(".tgz") && name.includes(controlName)) {
        urls.push(req.url);
        return new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")));
      }
      const res = await dummy(req);
      if (name !== "bar") return res;
      const manifest = await res.json();
      Object.assign(manifest.versions["0.0.2"], barDeps);
      return Response.json(manifest);
    };
  }

  function assertNameNeverLeaked(out: string, err: string, urls: string[]) {
    expect(out).not.toContain(controlName);
    expect(err).not.toContain(controlName);
    expect(err).not.toContain("\x1b]52;");
    expect(urls.filter(url => url.includes("%1B") || url.includes("\x1b"))).toEqual([]);
  }

  /** Entries of node_modules other than the cache this registry setup (`cache = false`) puts there. */
  async function installed(ctx: TestContext) {
    const entries = await readdirSorted(join(ctx.package_dir, "node_modules")).catch(() => []);
    return entries.filter(entry => entry !== ".cache");
  }

  // A dependency whose key repeats its specifier is how `bun add <specifier>`
  // records a dependency it has not named yet, so such a key is exempt from the
  // folder name rules, but not from this one: git tasks put it on the progress
  // line as-is.
  const gitSpecifier = `git+https://127.0.0.1:9/${controlName}.git`;
  const escapedGitSpecifier = `git+https://127.0.0.1:9/${escapedName}.git`;
  const manifestCases: [string, object, string][] = [
    ["a dependency name", { dependencies: { [controlName]: "0.0.2" } }, escapedName],
    ["an unnamed git dependency", { dependencies: { [gitSpecifier]: gitSpecifier } }, escapedGitSpecifier],
  ];
  for (const [description, barDeps, expectedName] of manifestCases) {
    it(`rejects ${description} declared by a package manifest before requesting or printing it`, async () => {
      await withContext(defaultOpts, async ctx => {
        const urls: string[] = [];
        setContextHandler(ctx, registry(ctx, urls, barDeps));
        await writeFile(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "0.0.2" } }),
        );

        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env: progressEnv,
        });
        const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);

        expect(err).toContain(`error: invalid dependency name "${expectedName}"`);
        assertNameNeverLeaked(out, err, urls);
        expect(urls).toContain(`${ctx.registry_url}bar`);
        expect(await installed(ctx)).toEqual([]);
        expect(exitCode).toBe(1);
      });
    });
  }

  it("keeps the unnamed form for specifiers without control characters", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, registry(ctx, urls));
      await writeFile(join(ctx.package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));

      // Until the tarball is resolved, this dependency's alias is the specifier, which is full of characters that a
      // folder name can't contain.
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "add", `${ctx.registry_url}bar-0.0.2.tgz`],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);

      expect(err).not.toContain("invalid dependency name");
      expect(out).toContain("installed bar@");
      expect(await installed(ctx)).toEqual(["bar"]);
      expect(exitCode).toBe(0);
    });
  });

  it("only warns when the name is declared as an optional dependency", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, registry(ctx, urls, { optionalDependencies: { [controlName]: "0.0.2" } }));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "0.0.2" } }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
        env: progressEnv,
      });
      const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);

      expect(err).toContain(`warn: invalid dependency name "${escapedName}"`);
      assertNameNeverLeaked(out, err, urls);
      expect(await installed(ctx)).toEqual(["bar"]);
      expect(out).toContain("1 package installed");
      expect(exitCode).toBe(0);
    });
  });

  // No file system takes a directory name over 255 bytes, and one over 4096 does not fit a path buffer.
  it.each([256, 4100])(
    "rejects a name of %d bytes declared by a package manifest before requesting it",
    async length => {
      await withContext(defaultOpts, async ctx => {
        const longName = Buffer.alloc(length, "a").toString();
        const urls: string[] = [];
        setContextHandler(ctx, registry(ctx, urls, { dependencies: { [longName]: "0.0.2" } }));
        await writeFile(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "0.0.2" } }),
        );

        await using proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

        expect(err).toContain(`error: invalid dependency name "${longName}"`);
        expect(urls.filter(url => url.includes(longName))).toEqual([]);
        expect(await installed(ctx)).toEqual([]);
        expect(exitCode).toBe(1);
      });
    },
  );

  // [description, root dependencies, how the unresolved dependency is summarized]
  const aliasCases: [string, Record<string, string>, string][] = [
    ["as the alias of a dependency", { [controlName]: "npm:bar@0.0.2" }, `${escapedName}@npm:bar@0.0.2`],
    [
      "as the target of an npm: alias",
      { "safe-alias": `npm:${controlName}@0.0.2` },
      `safe-alias@npm:${escapedName}@0.0.2`,
    ],
  ];
  for (const [description, dependencies, summary] of aliasCases) {
    it(`rejects a name used ${description}`, async () => {
      await withContext(defaultOpts, async ctx => {
        const urls: string[] = [];
        setContextHandler(ctx, registry(ctx, urls));
        await writeFile(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({ name: "foo", version: "0.0.1", dependencies }),
        );

        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);

        expect(err).toContain(`error: invalid dependency name "${escapedName}"`);
        expect(err).toContain(`error: ${summary} failed to resolve`);
        assertNameNeverLeaked(out, err, urls);
        expect(await installed(ctx)).toEqual([]);
        expect(exitCode).toBe(1);
      });
    });
  }

  it("rejects a package name found in bun.lock instead of installing or listing it", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, registry(ctx, urls));
      await Promise.all([
        writeFile(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { [controlName]: "0.0.2" } }),
        ),
        writeFile(
          join(ctx.package_dir, "bun.lock"),
          textLockfile(1, {
            workspaces: { "": { name: "foo", dependencies: { [controlName]: "0.0.2" } } },
            packages: { [controlName]: [`${controlName}@0.0.2`, `${ctx.registry_url}bar-0.0.2.tgz`, {}, ""] },
          }),
        ),
      ]);

      // `bun pm ls` prints straight from the lockfile, so it runs first, before
      // `bun install` gets a chance to touch it.
      const commands: [string[], string][] = [
        [["pm", "ls", "--all"], "failed to parse lockfile: InvalidLockfile"],
        [["install"], "invalid package name"],
      ];
      for (const [args, expectedError] of commands) {
        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), ...args],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);

        expect(err).toContain(expectedError);
        assertNameNeverLeaked(out, err, urls);
        expect(exitCode).toBe(1);
      }
      // Ignoring the rejected lockfile must not make `bun install` fall back to
      // resolving the same name from package.json either.
      expect(urls).toEqual([]);
      expect(await installed(ctx)).toEqual([]);
    });
  });
});

it.concurrent(
  "does not install a registry package's transitive file: dependency that points outside its package",
  async () => {
    // A dependency declared by a registry package uses a file: specifier
    // pointing at an absolute path outside of that package and outside the
    // project. Registry content is not written by the user, so that directory
    // must not be resolved or linked into node_modules. (file: dependencies
    // declared by the project's own local file: packages are user authored and
    // are allowed to point outside the project; see the tests below.)
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      using dir = tempDir("registry-transitive-file-dep", {
        "secret/credentials.txt": "do-not-link-me",
      });
      const secretDir = join(String(dir), "secret");
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": {
            dependencies: {
              loot: "file:" + secretDir.replaceAll("\\", "/"),
            },
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "my-app",
          version: "1.0.0",
          dependencies: {
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
      const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

      // The directory outside the package must not appear under node_modules,
      // neither hoisted nor nested under the declaring package.
      expect(await exists(join(ctx.package_dir, "node_modules", "loot"))).toBe(false);
      expect(await exists(join(ctx.package_dir, "node_modules", "baz", "node_modules", "loot"))).toBe(false);
      // The dependency is reported as unresolvable instead of silently linking local files.
      expect(err).toContain("package.json not found");
      expect(out).not.toContain("2 packages installed");
      expect(exitCode).toBe(1);
    });
  },
);

it.concurrent(
  "refuses to install an escaping file: dependency that a registry package's own folder declares in the lockfile",
  async () => {
    // Bun's resolver records no dependencies for a folder that a registry package
    // ships, but a lockfile written elsewhere (a migration) can. Trust for a
    // folder parent is anchored at the root or a workspace, so the installer still
    // refuses the escaping path.
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      using dir = tempDir("registry-folder-declares-file-dep", {
        "secret/package.json": JSON.stringify({ name: "loot", version: "1.0.0" }),
        "secret/credentials.txt": "do-not-link-me",
      });
      const secretDir = join(String(dir), "secret").replaceAll("\\", "/");
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": {
            dependencies: {
              inner: "file:./inner",
            },
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "my-app",
          version: "1.0.0",
          dependencies: {
            baz: "0.0.3",
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "bun.lock"),
        JSON.stringify({
          lockfileVersion: 1,
          workspaces: {
            "": {
              name: "my-app",
              dependencies: {
                baz: "0.0.3",
              },
            },
          },
          packages: {
            "baz": ["baz@0.0.3", `${ctx.registry_url}baz-0.0.3.tgz`, { dependencies: { inner: "file:./inner" } }, ""],
            "baz/inner": ["inner@file:node_modules/baz/inner", { dependencies: { loot: "file:" + secretDir } }],
            "baz/inner/loot": ["loot@file:" + secretDir, {}],
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

      expect(err).toContain("refusing to install dependency loot with unsafe folder path");
      expect(await exists(join(ctx.package_dir, "node_modules", "loot"))).toBe(false);
      expect(
        await exists(join(ctx.package_dir, "node_modules", "baz", "node_modules", "inner", "node_modules", "loot")),
      ).toBe(false);
      expect(out).not.toContain("3 packages installed");
      expect(exitCode).toBe(1);
    });
  },
);

describe.concurrent('a registry package\'s file: dependency that hides ".." behind a NUL', () => {
  // The OS ends a path at a NUL. For a check that only splits on separators,
  // "..\0not-a-parent" is one ordinary component, but the directory that gets
  // opened is "..".
  const target = "..\u0000not-a-parent";

  it("is refused by the resolver", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, { "0.0.3": { dependencies: { loot: "file:" + target } } }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({ name: "my-app", version: "1.0.0", dependencies: { baz: "0.0.3" } }),
      );

      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(err).toContain("package.json not found");
      expect(await exists(join(ctx.package_dir, "node_modules", "baz", "node_modules", "loot"))).toBe(false);
      expect(exitCode).toBe(1);
    });
  });

  it("is refused by the hoisted installer when the lockfile carries it", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.3": {} }));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({ name: "my-app", version: "1.0.0", dependencies: { baz: "0.0.3" } }),
      );
      await writeFile(
        join(ctx.package_dir, "bun.lock"),
        JSON.stringify({
          lockfileVersion: 1,
          workspaces: { "": { name: "my-app", dependencies: { baz: "0.0.3" } } },
          packages: {
            "baz": ["baz@0.0.3", `${ctx.registry_url}baz-0.0.3.tgz`, { dependencies: { loot: "file:" + target } }, ""],
            "baz/loot": ["loot@file:" + target, {}],
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
      const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(err).toContain("refusing to install dependency loot with unsafe folder path");
      expect(await exists(join(ctx.package_dir, "node_modules", "baz", "node_modules", "loot"))).toBe(false);
      expect(exitCode).toBe(1);
    });
  });
});

describe.concurrent("isolated linker: file: dependencies that point outside the project", () => {
  // The isolated linker opens a local package's folder path relative to the project, so the
  // project is one level below the temp directory and "../<name>" is a sibling
  // that the test owns.
  const bunfig = (ctx: TestContext) =>
    Bun.TOML.stringify({ install: { cache: false, registry: ctx.registry_url, linker: "isolated" } });

  async function install(projectDir: string, ...flags: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", ...flags],
      cwd: projectDir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });
    const [err, out, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    return { err, out, exitCode };
  }

  // The first install resolves (enqueue path), the second one starts from the
  // saved lockfile with an empty node_modules (installer path).
  async function installTwice(projectDir: string) {
    for (let i = 0; i < 2; i++) {
      if (i === 1) {
        await rm(join(projectDir, "node_modules"), { recursive: true, force: true });
      }
      const { err, exitCode } = await install(projectDir);
      expect(err).not.toContain("error:");
      expect(exitCode).toBe(0);
    }
  }

  // The resolver does not record these dependencies, but a lockfile from an
  // older bun (or a migrated or edited one) can carry the rows. Registry content
  // is not written by the user, so the installer must refuse the path that
  // leaves the project, the way the hoisted linker does.
  const refusedRows: Record<string, (tarball: string, secretDir: string) => object> = {
    "a registry package declares with a relative path": tarball => ({
      "baz": ["baz@0.0.3", tarball, { dependencies: { loot: "file:../secret" } }, ""],
      "baz/loot": ["loot@file:../secret", {}],
    }),
    "a registry package declares with an absolute path": (tarball, secretDir) => ({
      "baz": ["baz@0.0.3", tarball, { dependencies: { loot: "file:" + secretDir } }, ""],
      "baz/loot": ["loot@file:" + secretDir, {}],
    }),
    // The OS ends a path at a NUL, so this row opens "..".
    'a registry package declares with ".." hidden behind a NUL': tarball => ({
      "baz": ["baz@0.0.3", tarball, { dependencies: { loot: "file:..\u0000not-a-parent" } }, ""],
      "baz/loot": ["loot@file:..\u0000not-a-parent", {}],
    }),
    // Trust for a folder parent is anchored at the root or a workspace.
    "the folder of a registry package declares": tarball => ({
      "baz": ["baz@0.0.3", tarball, { dependencies: { inner: "file:vendor/inner" } }, ""],
      "baz/inner": ["inner@file:vendor/inner", { dependencies: { loot: "file:../secret" } }],
      "baz/inner/loot": ["loot@file:../secret", {}],
    }),
  };

  for (const [title, packages] of Object.entries(refusedRows)) {
    it(`refuses one that ${title} in the lockfile`, async () => {
      await withContext(undefined, async ctx => {
        const urls: string[] = [];
        setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.3": {} }));
        using dir = tempDir("isolated-registry-file-dep-lockfile", {
          "secret/package.json": JSON.stringify({ name: "loot", version: "1.0.0" }),
          "secret/credentials.txt": "do-not-link-me",
          "project/bunfig.toml": bunfig(ctx),
          "project/package.json": JSON.stringify({
            name: "my-app",
            version: "1.0.0",
            dependencies: { baz: "0.0.3" },
          }),
          "project/vendor/inner/package.json": JSON.stringify({ name: "inner", version: "1.0.0" }),
        });
        const projectDir = join(String(dir), "project");
        await write(
          join(projectDir, "bun.lock"),
          JSON.stringify({
            lockfileVersion: 1,
            workspaces: { "": { name: "my-app", dependencies: { baz: "0.0.3" } } },
            packages: packages(`${ctx.registry_url}baz-0.0.3.tgz`, join(String(dir), "secret").replaceAll("\\", "/")),
          }),
        );

        const { err, exitCode } = await install(projectDir);

        expect(err).toContain("refusing to install dependency loot with unsafe folder path");
        // Nothing in the store comes from the outside directory.
        const store = await readdirSorted(join(projectDir, "node_modules", ".bun"));
        expect(store.filter(name => name.startsWith("loot@"))).toEqual([]);
        expect(exitCode).toBe(1);
      });
    });
  }

  it("links one that the root declares when a registry package peer-depends on it", async () => {
    // `baz` is visited before `shared`, so the first dependency that reaches the
    // folder package is the peer dependency of a registry package. The folder is
    // still the one the root package.json names.
    await withContext(undefined, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": {
            peerDependencies: { shared: "*" },
            peerDependenciesMeta: { shared: { optional: true } },
          },
        }),
      );
      using dir = tempDir("isolated-root-file-dep-peer", {
        "shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0" }),
        "shared/index.js": "module.exports = 'shared';",
        "project/bunfig.toml": bunfig(ctx),
        "project/package.json": JSON.stringify({
          name: "my-app",
          version: "1.0.0",
          dependencies: { baz: "0.0.3", shared: "file:../shared" },
        }),
      });
      const projectDir = join(String(dir), "project");

      await installTwice(projectDir);

      const store = join(projectDir, "node_modules", ".bun");
      const bazEntry = (await readdirSorted(store)).find(name => name.startsWith("baz@"))!;
      expect(
        await Promise.all([
          file(join(projectDir, "node_modules", "shared", "index.js")).text(),
          file(join(store, bazEntry, "node_modules", "shared", "index.js")).text(),
        ]),
      ).toEqual(["module.exports = 'shared';", "module.exports = 'shared';"]);
    });
  });

  // These flags leave the root's own dependency on the folder out of the
  // install. The peer dependency of the registry package still reaches it, and
  // the path is still the one the root package.json names.
  for (const flags of [["--production"], ["--omit", "dev"], ["--frozen-lockfile", "--production"], ["--filter", "b"]]) {
    it(`links one that the root declares when ${flags.join(" ")} leaves only a registry package's peer dependency on it`, async () => {
      await withContext(undefined, async ctx => {
        const urls: string[] = [];
        setContextHandler(
          ctx,
          dummyRegistryForContext(ctx, urls, {
            "0.0.3": {
              peerDependencies: { shared: "*" },
              peerDependenciesMeta: { shared: { optional: true } },
            },
          }),
        );
        using dir = tempDir("isolated-root-file-dep-flags", {
          "shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0" }),
          "shared/index.js": "module.exports = 'shared';",
          "project/bunfig.toml": bunfig(ctx),
          ...(flags[0] === "--filter"
            ? {
                "project/package.json": JSON.stringify({
                  name: "my-app",
                  version: "1.0.0",
                  workspaces: ["packages/*"],
                  dependencies: { shared: "file:../shared" },
                }),
                "project/packages/b/package.json": JSON.stringify({
                  name: "b",
                  version: "1.0.0",
                  dependencies: { baz: "0.0.3" },
                }),
              }
            : {
                "project/package.json": JSON.stringify({
                  name: "my-app",
                  version: "1.0.0",
                  dependencies: { baz: "0.0.3" },
                  devDependencies: { shared: "file:../shared" },
                }),
              }),
        });
        const projectDir = join(String(dir), "project");

        // A full install writes the lockfile.
        const full = await install(projectDir);
        expect(full.err).not.toContain("error:");
        expect(full.exitCode).toBe(0);
        await Promise.all([
          rm(join(projectDir, "node_modules"), { recursive: true, force: true }),
          rm(join(projectDir, "packages", "b", "node_modules"), { recursive: true, force: true }),
        ]);

        const { err, exitCode } = await install(projectDir, ...flags);

        expect(err).not.toContain("error:");
        const store = join(projectDir, "node_modules", ".bun");
        const bazEntry = (await readdirSorted(store)).find(name => name.startsWith("baz@"))!;
        expect(await file(join(store, bazEntry, "node_modules", "shared", "index.js")).text()).toBe(
          "module.exports = 'shared';",
        );
        expect(exitCode).toBe(0);
      });
    });
  }

  it("links the ones that a local file: package declares", async () => {
    using dir = tempDir("isolated-local-file-dep-outside", {
      "packages/plugin/package.json": JSON.stringify({
        name: "plugin",
        version: "1.0.0",
        dependencies: { "shared-lib": "../shared-lib" },
        devDependencies: { "shared-dev-lib": "file:../shared-dev-lib" },
      }),
      "packages/plugin/index.js": `module.exports = [require("shared-lib/package.json").name, require("shared-dev-lib/package.json").name];`,
      "packages/shared-lib/package.json": JSON.stringify({ name: "shared-lib", version: "1.0.0" }),
      "packages/shared-dev-lib/package.json": JSON.stringify({ name: "shared-dev-lib", version: "1.0.0" }),
      "project/bunfig.toml": Bun.TOML.stringify({ install: { cache: false, linker: "isolated" } }),
      "project/package.json": JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        dependencies: { plugin: "file:../packages/plugin" },
      }),
    });
    const projectDir = join(String(dir), "project");

    await installTwice(projectDir);

    await using run = spawn({
      cmd: [bunExe(), "-e", `console.log(JSON.stringify(require("plugin")))`],
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [runErr, runOut, runExit] = await Promise.all([run.stderr.text(), run.stdout.text(), run.exited]);
    expect(runErr).toBe("");
    expect(runOut.trim()).toBe(`["shared-lib","shared-dev-lib"]`);
    expect(runExit).toBe(0);
  });

  for (const field of ["resolutions", "overrides"]) {
    it(`links one that root "${field}" applies to a registry package's dependency`, async () => {
      await withContext(undefined, async ctx => {
        const urls: string[] = [];
        setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.3": { dependencies: { shared: "1.0.0" } } }));
        using dir = tempDir(`isolated-${field}-registry-file-dep`, {
          "shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0" }),
          "shared/index.js": "module.exports = 'shared';",
          "project/bunfig.toml": bunfig(ctx),
          "project/package.json": JSON.stringify({
            name: "my-app",
            version: "1.0.0",
            dependencies: { baz: "0.0.3" },
            [field]: { shared: "file:../shared" },
          }),
        });
        const projectDir = join(String(dir), "project");

        await installTwice(projectDir);

        // No registry request was made for `shared`, and `baz` gets the folder.
        expect(urls.filter(url => url.includes("shared"))).toEqual([]);
        expect(
          await file(
            join(projectDir, "node_modules", ".bun", "baz@0.0.3", "node_modules", "shared", "index.js"),
          ).text(),
        ).toBe("module.exports = 'shared';");
      });
    });

    it(`links one that a nested root "${field}" rule gives to a local file: package's dependency`, async () => {
      // The only dependency that resolves to the folder is `"shared": "1.0.0"` of
      // `pkg-a`. The trust checks consult only plain rules, so the trust comes
      // from the package that declares the dependency, not from its version.
      using dir = tempDir(`isolated-nested-${field}-local-file-dep`, {
        "shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0" }),
        "shared/index.js": "module.exports = 'shared';",
        "project/bunfig.toml": Bun.TOML.stringify({ install: { cache: false, linker: "isolated" } }),
        "project/package.json": JSON.stringify({
          name: "my-app",
          version: "1.0.0",
          dependencies: { "pkg-a": "file:./pkg-a" },
          [field]:
            field === "overrides" ? { "pkg-a": { shared: "file:../shared" } } : { "pkg-a/shared": "file:../shared" },
        }),
        "project/pkg-a/package.json": JSON.stringify({
          name: "pkg-a",
          version: "1.0.0",
          dependencies: { shared: "1.0.0" },
        }),
        "project/pkg-a/index.js": "module.exports = require('shared');",
      });
      const projectDir = join(String(dir), "project");

      await installTwice(projectDir);

      await using run = spawn({
        cmd: [bunExe(), "-e", `console.log(require("pkg-a"))`],
        cwd: projectDir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const [runErr, runOut, runExit] = await Promise.all([run.stderr.text(), run.stdout.text(), run.exited]);
      expect(runErr).toBe("");
      expect(runOut).toBe("shared\n");
      expect(runExit).toBe(0);
    });
  }
});

it.concurrent(
  "installs transitive file: dependencies of a local file: package that point outside the project",
  async () => {
    // A file: package referenced by the root package.json lives outside the
    // project and declares its own relative folder dependencies that also land
    // outside the project. The declaring package is local (not from a registry),
    // so its file: paths are user authored and must not be rejected by the
    // escape check that constrains registry packages.
    using dir = tempDir("local-file-dep-outside", {
      "packages/plugin/package.json": JSON.stringify({
        name: "plugin",
        version: "1.0.0",
        dependencies: {
          "shared-lib": "../shared-lib",
        },
        devDependencies: {
          "shared-dev-lib": "file:../shared-dev-lib",
        },
      }),
      "packages/plugin/index.js": "module.exports = 'plugin';",
      "packages/shared-lib/package.json": JSON.stringify({ name: "shared-lib", version: "1.0.0" }),
      "packages/shared-dev-lib/package.json": JSON.stringify({ name: "shared-dev-lib", version: "1.0.0" }),
      "project/package.json": JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        dependencies: {
          plugin: "file:../packages/plugin",
        },
      }),
    });
    const projectDir = join(String(dir), "project");

    // 1) `bun install` with no lockfile and 2) `bun update` exercise the
    // resolve/enqueue path; 3) `bun install` with the saved lockfile and an
    // empty node_modules exercises the package installer path.
    for (const [i, cmd] of ["install", "update", "install"].entries()) {
      if (i === 2) {
        await rm(join(projectDir, "node_modules"), { recursive: true, force: true });
      }
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), cmd],
        cwd: projectDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

      expect(err).not.toContain("package.json not found");
      expect(err).not.toContain("failed to resolve");
      expect(err).not.toContain("unsafe folder path");
      expect(err).not.toContain("refusing to install");
      // The update finds the three folders as the install left them.
      expect(out).toContain(i === 1 ? "(no changes)" : "plugin");
      expect(exitCode).toBe(0);
    }

    // Both transitive folder dependencies resolve, relative to the project root.
    // On Windows the stored folder path uses backslashes (JSON-escaped in the
    // lockfile); normalize them before asserting.
    const lock = (await file(join(projectDir, "bun.lock")).text()).replaceAll("\\\\", "/");
    expect(lock).toContain('"plugin/shared-lib"');
    expect(lock).toContain("shared-lib@file:../packages/shared-lib");
    expect(lock).toContain('"plugin/shared-dev-lib"');
    expect(await exists(join(projectDir, "node_modules", "plugin", "package.json"))).toBe(true);
    // And both are linked under the declaring package.
    expect(await exists(join(projectDir, "node_modules", "plugin", "node_modules", "shared-lib", "package.json"))).toBe(
      true,
    );
    expect(
      await exists(join(projectDir, "node_modules", "plugin", "node_modules", "shared-dev-lib", "package.json")),
    ).toBe(true);
  },
);

describe.concurrent("a dependency whose own package.json has an invalid name", () => {
  // The name inside a tarball, folder or git dependency's package.json is written
  // to bun.lock as `name@resolution`, and the bun.lock parser rejects names that
  // are not safe install folder names. Saving such a name used to succeed and
  // leave behind a lockfile that every later `bun install` ignored. The dependent
  // names the folder in node_modules, so bun.lock gets the name that a package without one gets.
  async function install(root: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd: join(root, "project"),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(root, "cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err, exitCode };
  }

  async function expectInstalledAs(root: string, linker: string, nameAndResolution: string) {
    const first = await install(root, "--linker", linker);
    expect(first.err).not.toContain("error:");
    expect(first.out).toContain("1 package installed");
    expect(first.exitCode).toBe(0);
    const lockfile = await file(join(root, "project", "bun.lock")).text();
    expect(lockfile).toContain(`"dep": ["${nameAndResolution}`);

    await rm(join(root, "project", "node_modules"), { recursive: true });
    const second = await install(root, "--linker", linker, "--frozen-lockfile");
    expect(second.err).not.toContain("Ignoring lockfile");
    expect(second.err).not.toContain("error:");
    expect(await exists(join(root, "project", "node_modules", "dep", "package.json"))).toBe(true);
    expect(await file(join(root, "project", "bun.lock")).text()).toBe(lockfile);
    expect(second.exitCode).toBe(0);
  }

  describe.each(["hoisted", "isolated"])("%s", linker => {
    // The bun.lock parser splits `name@resolution` at the first "@" after an optional scope, so a
    // name with any other "@" in it cannot be stored either, even though it is a safe folder name.
    const names = ["Project: X", "a:b", "a\\b", "a\0b", "lib/..", "a@b", "@scope/a@b"];

    it.each(names)("installs a local tarball named %j", async name => {
      using dir = tempDir("invalid-name-tarball", {
        "project/package.json": JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: { dep: "file:../packed.tgz" },
        }),
      });
      await Bun.Archive.write(
        join(String(dir), "packed.tgz"),
        { "package/package.json": JSON.stringify({ name, version: "1.0.0" }) },
        { compress: "gzip" },
      );

      await expectInstalledAs(String(dir), linker, "packed@../packed.tgz");
    });

    it.each(names)("installs a file: folder named %j", async name => {
      using dir = tempDir("invalid-name-folder", {
        "project/package.json": JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: { dep: "file:../lib" },
        }),
        "lib/package.json": JSON.stringify({ name, version: "1.0.0" }),
      });

      await expectInstalledAs(String(dir), linker, "lib@file:../lib");
    });

    it("installs a git dependency", async () => {
      using dir = tempDir("invalid-name-git", {
        "work/package.json": JSON.stringify({ name: "Project: X", version: "1.0.0" }),
      });
      await createDumbHttpGitRepo(String(dir), {});
      using server = serveDirectory(String(dir));
      await write(
        join(String(dir), "project", "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: { dep: `git+http://localhost:${server.port}/repo.git` },
        }),
      );

      await expectInstalledAs(String(dir), linker, `repo.git@git+http://localhost:${server.port}/repo.git#`);
    });
  });

  // Other packages depend on a member by this name.
  it("escapes the rejected name of a workspace member in the error message", async () => {
    using dir = tempDir("invalid-name-escaped", {
      "project/package.json": JSON.stringify({
        name: "foo",
        version: "0.0.1",
        workspaces: ["packages/*"],
      }),
      "project/packages/member/package.json": JSON.stringify({ name: "a\0b", version: "1.0.0" }),
    });

    const { err, exitCode } = await install(String(dir));
    expect(err).toContain('error: invalid package name "a\\u0000b"');
    expect(await exists(join(String(dir), "project", "bun.lock"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  it("fails to install a workspace whose member's name contains an @", async () => {
    using dir = tempDir("invalid-name-at-workspace", {
      "project/package.json": JSON.stringify({
        name: "foo",
        version: "0.0.1",
        workspaces: ["packages/*"],
      }),
      "project/packages/member/package.json": JSON.stringify({ name: "a@b", version: "1.0.0" }),
    });

    const { err, exitCode } = await install(String(dir));
    expect(err).toContain('error: invalid package name "a@b"');
    expect(err).toMatch(/ at .*member[\\/]package\.json:1:9\s/);
    expect(await exists(join(String(dir), "project", "bun.lock"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  it("still installs scoped names and writes a lockfile the next install loads", async () => {
    using dir = tempDir("valid-scoped-name-tarball", {
      "project/package.json": JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: { dep: "file:../dep.tgz" },
      }),
    });
    await Bun.Archive.write(
      join(String(dir), "dep.tgz"),
      { "package/package.json": JSON.stringify({ name: "@scope/dep", version: "1.0.0" }) },
      { compress: "gzip" },
    );

    const first = await install(String(dir));
    expect(first.err).not.toContain("error:");
    expect(first.out).toContain("1 package installed");
    expect(first.exitCode).toBe(0);
    expect(await file(join(String(dir), "project", "bun.lock")).text()).toContain('"dep": ["@scope/dep@../dep.tgz"');

    const second = await install(String(dir), "--frozen-lockfile");
    expect(second.err).not.toContain("Ignoring lockfile");
    expect(second.err).not.toContain("error:");
    expect(second.exitCode).toBe(0);
  });

  it("does not apply to the root package's own name", async () => {
    // The root is not a bun.lock `packages` entry; its name only appears in the
    // `workspaces` section, which accepts it as-is.
    using dir = tempDir("invalid-name-root", {
      "project/package.json": JSON.stringify({
        name: "a:b",
        version: "0.0.1",
        dependencies: { dep: "file:../lib" },
      }),
      "lib/package.json": JSON.stringify({ name: "lib", version: "1.0.0" }),
    });

    const first = await install(String(dir));
    expect(first.err).not.toContain("error:");
    expect(first.out).toContain("1 package installed");
    expect(first.exitCode).toBe(0);
    const lockfile = await file(join(String(dir), "project", "bun.lock")).text();
    expect(lockfile).toContain('"name": "a:b"');
    expect(lockfile).toContain('"dep": ["lib@file:../lib", {}]');

    const second = await install(String(dir), "--frozen-lockfile");
    expect(second.err).not.toContain("Ignoring lockfile");
    expect(second.err).not.toContain("error:");
    expect(second.exitCode).toBe(0);
  });
});

it.concurrent("does not install transitive file: dependencies with overlong folder targets", async () => {
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

// Resolving a folder dependency appends "/package.json" and a NUL to its absolute path in a
// path buffer (4096 bytes on Linux, 1024 on macOS). The absolute path itself is checked
// against the buffer when package.json is parsed, but the appended bytes were not, so a
// folder path within 13 bytes of the buffer size aborted the install. Windows' buffer is
// larger than any path the OS accepts, so the boundary cannot be reached there.
describe.concurrent.skipIf(isWindows)("file: dependency whose package.json path is around the path buffer size", () => {
  const PATH_BUFFER_BYTES = isLinux ? 4096 : 1024;

  // A relative path of exactly `bytes` bytes made of one letter directory names, so that a
  // path which fits the buffer is rejected by the OS as missing, not as too long.
  function pathOfLength(bytes: number) {
    const tail = bytes % 2 === 0 ? "dd" : "d";
    return Buffer.alloc(bytes - tail.length, "d/").toString() + tail;
  }

  // `packageJsonPathBytes` is the length of `<project>/<folder>/package.json`.
  async function installFolderDependency(projectDir: string, packageJsonPathBytes: number) {
    const folder = pathOfLength(
      packageJsonPathBytes - Buffer.byteLength(projectDir) - "/".length - "/package.json".length,
    );
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { dep: `file:./${folder}` } }),
    );
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { folder, err, exitCode };
  }

  it("is looked up on disk when the path and its NUL terminator fit", async () => {
    using dir = tempDir("file-dep-path-buffer-fits", {});

    const { folder, err, exitCode } = await installFolderDependency(String(dir), PATH_BUFFER_BYTES - 1);

    expect(err).toContain(`error: package.json not found for "file:${folder}"`);
    expect(exitCode).toBe(1);
  });

  it.each([
    ["exactly the buffer size, leaving no room for the NUL terminator", 0],
    // The folder path alone fits, but it doesn't with "/package.json" appended.
    ['longer than the buffer by less than the appended "/package.json"', 8],
  ])("fails with ENAMETOOLONG when it is %s", async (_, extraBytes) => {
    using dir = tempDir("file-dep-path-buffer-overflow", {});

    const { err, exitCode } = await installFolderDependency(String(dir), PATH_BUFFER_BYTES + extraBytes);

    expect(err).toContain("error: ENAMETOOLONG");
    expect(exitCode).toBe(1);
  });

  it("fails when the absolute path fits and the path relative to the project does not", async () => {
    using dir = tempDir("file-dep-relative-path-overflow", {
      "package.json": JSON.stringify({
        name: "my-app",
        dependencies: { dep: "file:/" + Buffer.alloc(PATH_BUFFER_BYTES - 2, "d").toString() },
      }),
    });
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(err).toContain('error: Dependency "dep" has an unsafe folder path');
    expect(exitCode).toBe(1);
  });
});

// The tarball form of the above. A `file:` tarball path is read relative to the
// project (or to the workspace declaring it), which is only meaningful for the
// package.json files that are part of the project. The same path declared by a
// package bun extracts from the cache (registry, git, remote tarball) used to be
// read from the project too, so a published package declaring `"x": "file:./x.tgz"`
// got whatever `x.tgz` the project directory held, and with `file:../x.tgz` or
// an absolute path any tarball on the machine, installed under its name.
describe.concurrent("file: tarballs declared by a package installed from the cache", () => {
  // Copied to every path that the declaring package refers to. If it gets installed, that's the bug.
  const planted = join(import.meta.dir, "baz-0.0.3.tgz");
  const plantedManifest = { name: "baz", version: "0.0.3", bin: { "baz-run": "index.js" } };

  // The project is <root>/project so that `../outside.tgz` stays inside the temp dir.
  function declaredTarballs(root: string): Record<string, string> {
    return {
      inside: "file:./inside.tgz",
      outside: "file:../outside.tgz",
      absolute: `file:${join(root, "absolute.tgz").replaceAll("\\", "/")}`,
    };
  }

  function plantDeclaredTarballs(root: string) {
    return Promise.all([
      cp(planted, join(root, "project", "inside.tgz")),
      cp(planted, join(root, "outside.tgz")),
      cp(planted, join(root, "absolute.tgz")),
    ]);
  }

  function rootPackageJson(dependencies: Record<string, string>, extra: object = {}) {
    return JSON.stringify({ name: "my-app", version: "1.0.0", dependencies, ...extra });
  }

  // <root>/project depends on `bar@0.0.2` from the dummy registry, whose manifest
  // for it carries `barManifest`, plus whatever `root` adds to its package.json.
  // Returns the URLs the registry gets asked for.
  async function writeRegistryProject(
    ctx: TestContext,
    root: string,
    barManifest: object,
    { dependencies = {}, ...rootExtra }: { dependencies?: Record<string, string>; [field: string]: unknown } = {},
  ) {
    const urls: string[] = [];
    setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.2": barManifest }));
    await write(join(root, "project", "package.json"), rootPackageJson({ bar: "0.0.2", ...dependencies }, rootExtra));
    await write(join(root, "project", "bunfig.toml"), `[install]\nregistry = "${ctx.registry_url}"\n`);
    return urls;
  }

  // Packs `manifest` as the package.json of an otherwise empty package into `tarball`.
  async function packManifest(tarball: string, manifest: object) {
    const archive = new Bun.Archive({ "package/package.json": JSON.stringify(manifest) }, { compress: "gzip" });
    await write(tarball, await archive.bytes());
  }

  async function install(root: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd: join(root, "project"),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(root, "cache") },
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
    });
    const [err, out, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    return { err, out, exitCode };
  }

  // Returns what Bun prints for a dependency that it refuses. `declarer` is how Bun prints the declaring package, which
  // depends on where it came from.
  function refusal(name: string, spec: string, declarer: string) {
    return [
      `error: refusing to resolve "${name}@${spec}" declared by ${declarer}: local tarballs are only allowed in this project's package.json files`,
      `note: add "${name}": "${spec}" to the root package.json to install it for ${declarer.slice(0, declarer.indexOf("@"))} too`,
    ];
  }

  // The rest of stderr is progress output ("Resolving dependencies", ...).
  function diagnostics(stderr: string) {
    return stderr.split(/\r?\n/).filter(line => line.startsWith("error:") || line.startsWith("note:"));
  }

  async function expectRejected(root: string, declarer: string) {
    const { err, out, exitCode } = await install(root);

    const rejected = Object.entries(declaredTarballs(root));
    const expected = [
      ...rejected.flatMap(([name, spec]) => refusal(name, spec, declarer)),
      ...rejected.map(([name, spec]) => `error: ${name}@${spec} failed to resolve`),
    ];
    // The dependencies are reported in the declaring package's dependency order,
    // which differs between a registry manifest and a package.json.
    expect(diagnostics(err).sort()).toEqual(expected.sort());
    expect(err).not.toContain("Saved lockfile");
    expect(out).not.toContain("installed");
    expect(await exists(join(root, "project", "node_modules"))).toBe(false);
    expect(await exists(join(root, "project", "bun.lock"))).toBe(false);
    expect(exitCode).toBe(1);
  }

  // A local tarball is part of the project, like a file: folder, so it can depend on other tarballs in the project.
  // Their paths are relative to the project.
  it("installs the ones declared by a local tarball dependency", async () => {
    using dir = tempDir("local-tarballs-of-local-tarball-dep", {
      "project/package.json": rootPackageJson({ bar: "file:./bar.tgz" }),
    });
    const root = String(dir);
    await plantDeclaredTarballs(root);
    await packManifest(join(root, "project", "bar.tgz"), {
      name: "bar",
      version: "0.0.2",
      dependencies: declaredTarballs(root),
    });

    const { err, out, exitCode } = await install(root);
    expect(diagnostics(err)).toEqual([]);
    expect(out).toContain("4 packages installed");
    expect(await readdirSorted(join(root, "project", "node_modules"))).toEqual([
      ".bin",
      "absolute",
      "bar",
      "inside",
      "outside",
    ]);
    const lockfile = await file(join(root, "project", "bun.lock")).text();
    expect(lockfile).toContain('"inside": ["baz@./inside.tgz"');
    expect(lockfile).toContain('"outside": ["baz@../outside.tgz"');
    expect(exitCode).toBe(0);
  });

  it("rejects the ones declared by a remote tarball dependency", async () => {
    using dir = tempDir("local-tarballs-of-remote-tarball-dep", {});
    const root = String(dir);
    using server = serveDirectory(root);
    const url = `http://localhost:${server.port}/bar.tgz`;
    await write(join(root, "project", "package.json"), rootPackageJson({ bar: url }));
    await plantDeclaredTarballs(root);
    await packManifest(join(root, "bar.tgz"), { name: "bar", version: "0.0.2", dependencies: declaredTarballs(root) });

    await expectRejected(root, `bar@${url}`);
  });

  it("rejects the ones declared by a git dependency", async () => {
    using dir = tempDir("local-tarballs-of-git-dep", {});
    const root = String(dir);
    await write(
      join(root, "work", "package.json"),
      JSON.stringify({ name: "bar", version: "0.0.2", dependencies: declaredTarballs(root) }),
    );
    const sha = await createDumbHttpGitRepo(root, {});
    using server = serveDirectory(root);
    const repo = `git+http://localhost:${server.port}/repo.git`;
    await write(join(root, "project", "package.json"), rootPackageJson({ bar: repo }));
    await plantDeclaredTarballs(root);

    await expectRejected(root, `bar@${repo}#${sha}`);
  });

  it("rejects the ones declared by a registry package", async () => {
    await withContext(defaultOpts, async ctx => {
      using dir = tempDir("local-tarballs-of-registry-dep", {});
      const root = String(dir);
      await writeRegistryProject(ctx, root, { dependencies: declaredTarballs(root) });
      await plantDeclaredTarballs(root);

      await expectRejected(root, "bar@0.0.2");
    });
  });

  // Peers are installed too, so they're refused the same way. Unlike a regular dependency, an unresolved peer isn't
  // reported a second time as "failed to resolve".
  it("rejects the one a registry package declares as a peer dependency", async () => {
    await withContext(defaultOpts, async ctx => {
      using dir = tempDir("peer-local-tarball-of-registry-dep", {});
      const root = String(dir);
      await writeRegistryProject(ctx, root, { peerDependencies: { inside: "file:./inside.tgz" } });
      await cp(planted, join(root, "project", "inside.tgz"));

      const { err, exitCode } = await install(root);
      expect(diagnostics(err)).toEqual(refusal("inside", "file:./inside.tgz", "bar@0.0.2"));
      expect(await exists(join(root, "project", "node_modules", "inside"))).toBe(false);
      expect(await exists(join(root, "project", "bun.lock"))).toBe(false);
      expect(exitCode).toBe(1);
    });
  });

  // This is the fix that the note describes. A tarball that the root package.json itself depends on under the same name
  // belongs to the project, so a registry package that asks for that exact dependency gets it too.
  it("installs the one the root package.json declares as well", async () => {
    await withContext(defaultOpts, async ctx => {
      using dir = tempDir("root-declared-local-tarball-of-registry-dep", {});
      const root = String(dir);
      await writeRegistryProject(
        ctx,
        root,
        { dependencies: { inside: "file:./inside.tgz" } },
        { dependencies: { inside: "file:./inside.tgz" } },
      );
      await cp(planted, join(root, "project", "inside.tgz"));

      const { err, out, exitCode } = await install(root);
      expect(diagnostics(err)).toEqual([]);
      expect(out).toContain("2 packages installed");
      expect(await readdirSorted(join(root, "project", "node_modules"))).toEqual([".bin", "bar", "inside"]);
      expect(await file(join(root, "project", "node_modules", "inside", "package.json")).json()).toEqual(
        plantedManifest,
      );
      const lockfile = await file(join(root, "project", "bun.lock")).text();
      expect(lockfile).toContain('"inside": ["baz@./inside.tgz"');
      expect(lockfile).not.toContain('"bar/inside"');
      expect(exitCode).toBe(0);
    });
  });

  // Only the identical dependency counts. The same name or the same path alone isn't enough.
  for (const [what, rootDependencies] of [
    ["another tarball under the same name", { inside: "file:./vendored.tgz" }],
    ["the same tarball under another name", { vendored: "file:./inside.tgz" }],
  ] as const) {
    it(`still rejects it when the root package.json declares ${what}`, async () => {
      await withContext(defaultOpts, async ctx => {
        using dir = tempDir("similar-root-local-tarball-of-registry-dep", {});
        const root = String(dir);
        await writeRegistryProject(
          ctx,
          root,
          { dependencies: { inside: "file:./inside.tgz" } },
          { dependencies: rootDependencies },
        );
        await Promise.all([
          cp(planted, join(root, "project", "inside.tgz")),
          cp(planted, join(root, "project", "vendored.tgz")),
        ]);

        const { err, exitCode } = await install(root);
        expect(diagnostics(err)).toEqual([
          ...refusal("inside", "file:./inside.tgz", "bar@0.0.2"),
          "error: inside@file:./inside.tgz failed to resolve",
        ]);
        expect(await exists(join(root, "project", "node_modules"))).toBe(false);
        expect(await exists(join(root, "project", "bun.lock"))).toBe(false);
        expect(exitCode).toBe(1);
      });
    });
  }

  // A bundled dependency ships inside the package that declares it, so adding it to the root wouldn't help, and the
  // note is omitted.
  it("rejects the one a registry package declares as bundled, without suggesting to add it to the root", async () => {
    await withContext(defaultOpts, async ctx => {
      using dir = tempDir("bundled-local-tarball-of-registry-dep", {});
      const root = String(dir);
      await writeRegistryProject(ctx, root, {
        dependencies: { inside: "file:./inside.tgz" },
        bundleDependencies: ["inside"],
      });
      await cp(planted, join(root, "project", "inside.tgz"));

      const { err, exitCode } = await install(root);
      expect(diagnostics(err)).toEqual([
        refusal("inside", "file:./inside.tgz", "bar@0.0.2")[0],
        "error: inside@file:./inside.tgz failed to resolve",
      ]);
      expect(await exists(join(root, "project", "bun.lock"))).toBe(false);
      expect(exitCode).toBe(1);
    });
  });

  it("leaves the one a registry package declares as optional uninstalled", async () => {
    await withContext(defaultOpts, async ctx => {
      using dir = tempDir("optional-local-tarball-of-registry-dep", {});
      const root = String(dir);
      await writeRegistryProject(ctx, root, { optionalDependencies: { inside: "file:./inside.tgz" } });
      await cp(planted, join(root, "project", "inside.tgz"));

      const { err, out, exitCode } = await install(root);
      expect(err).not.toContain("error:");
      expect(out).toContain("1 package installed");
      expect(await readdirSorted(join(root, "project", "node_modules"))).toEqual(["bar"]);
      const lockfile = await file(join(root, "project", "bun.lock")).text();
      expect(lockfile).toContain('"bar": ["bar@0.0.2"');
      expect(lockfile).not.toContain("baz@./inside.tgz");
      expect(exitCode).toBe(0);
    });
  });

  // `overrides` / `resolutions` are written in the root package.json, so a tarball
  // path coming from there is the project's own even when it replaces the
  // dependency of a registry package.
  for (const field of ["resolutions", "overrides"]) {
    it(`installs the one a root "${field}" entry puts on a registry package's dependency`, async () => {
      await withContext(defaultOpts, async ctx => {
        using dir = tempDir(`${field}-local-tarball-on-registry-dep`, {});
        const root = String(dir);
        const urls = await writeRegistryProject(
          ctx,
          root,
          { dependencies: { vendored: "0.0.1" } },
          { [field]: { vendored: "file:./vendored.tgz" } },
        );
        await cp(planted, join(root, "project", "vendored.tgz"));

        const { err, out, exitCode } = await install(root);
        expect(err).not.toContain("error:");
        expect(out).toContain("2 packages installed");
        expect(await file(join(root, "project", "node_modules", "vendored", "package.json")).json()).toEqual(
          plantedManifest,
        );
        expect(urls.sort()).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
        expect(exitCode).toBe(0);
      });
    });
  }

  // A `file:` folder's package.json is part of the project like a workspace's, so
  // it may declare local tarballs. The tarball is planted in both directories the
  // path could be taken relative to; which one bun reads is not what this pins.
  it("installs the one declared by a file: folder dependency", async () => {
    using dir = tempDir("local-tarball-of-folder-dep", {
      "project/package.json": rootPackageJson({ lib: "file:./vendor/lib" }),
      "project/vendor/lib/package.json": JSON.stringify({
        name: "lib",
        version: "1.0.0",
        dependencies: { tool: "file:./tool.tgz" },
      }),
    });
    const root = String(dir);
    await Promise.all([
      cp(planted, join(root, "project", "tool.tgz")),
      cp(planted, join(root, "project", "vendor", "lib", "tool.tgz")),
    ]);

    const { err, out, exitCode } = await install(root);
    expect(err).not.toContain("error:");
    expect(out).toContain("2 packages installed");
    expect(await file(join(root, "project", "node_modules", "tool", "package.json")).json()).toEqual(plantedManifest);
    expect(exitCode).toBe(0);
  });

  // Only a file: folder the root or a workspace declares counts. A folder a registry
  // package ships has no dependencies after a fresh resolve, but a lockfile migrated
  // from package-lock.json can give it some. The override edit makes bun resolve
  // the rows named `inside` again.
  it("rejects the one declared by a file: folder that a registry package ships", async () => {
    const lockfile = JSON.stringify({
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: { "": { name: "my-app", dependencies: { bar: "0.0.2" } } },
      overrides: { "zzz>inside": "1.0.0" },
      packages: {
        bar: [
          "bar@0.0.2",
          "",
          { dependencies: { inner: "file:./inner" } },
          `sha512-${Buffer.alloc(64).toString("base64")}`,
        ],
        "bar/inner": ["inner@file:inner", { dependencies: { inside: "file:./inside.tgz" } }],
        "bar/inner/inside": ["baz@./inside.tgz", { bin: { "baz-run": "index.js" } }],
      },
    });
    using dir = tempDir("local-tarball-of-shipped-folder", {
      "project/package.json": rootPackageJson({ bar: "0.0.2" }, { overrides: { "zzz>inside": "2.0.0" } }),
      "project/bunfig.toml": `[install]\nregistry = "http://localhost:1/"\n`,
      "project/bun.lock": lockfile,
    });
    const root = String(dir);
    await Promise.all([
      cp(planted, join(root, "project", "inside.tgz")),
      cp(planted, join(root, "project", "inner", "inside.tgz")),
    ]);

    const { err, exitCode } = await install(root, "--lockfile-only");
    expect(diagnostics(err)).toEqual([
      ...refusal("inside", "file:./inside.tgz", "inner@inner"),
      "error: inside@file:./inside.tgz failed to resolve",
    ]);
    expect(await file(join(root, "project", "bun.lock")).text()).toBe(lockfile);
    expect(exitCode).toBe(1);
  });
});

for (const field of ["resolutions", "overrides"]) {
  const installsFromRoot = `installs a file: dependency pointing outside the project when it came from root package.json "${field}"`;
  const installsFromRootWithLockfile = `${installsFromRoot} (existing lockfile)`;
  const stillRejectsTransitive = `still rejects a registry package's transitive file: dependency that escapes when a different name is in "${field}"`;

  it.concurrent(installsFromRoot, async () => {
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
      expect(err).not.toContain("package.json not found");
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

  it.concurrent(installsFromRootWithLockfile, async () => {
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
    expect(err).not.toContain("package.json not found");
    expect(err).not.toContain("failed to resolve");
    expect(exitCode).toBe(0);
    expect(out).toContain("shared");
    expect(await exists(join(projectDir, "node_modules", "shared", "package.json"))).toBe(true);
  });

  it.concurrent(stillRejectsTransitive, async () => {
    // An override for a different name must not whitelist an unrelated
    // transitive file: dependency of a registry package that points outside
    // its package. The target exists and is installable, so a bypassed check
    // would link it.
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      using dir = tempDir("registry-transitive-file-dep-unrelated-override", {
        "secret/package.json": JSON.stringify({ name: "loot", version: "1.0.0" }),
        "secret/credentials.txt": "do-not-link-me",
      });
      const secretDir = join(String(dir), "secret");
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": {
            dependencies: {
              loot: "file:" + secretDir.replaceAll("\\", "/"),
            },
          },
        }),
      );
      await write(
        join(ctx.package_dir, "shared", "package.json"),
        JSON.stringify({ name: "shared", version: "1.0.0" }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "my-app",
          version: "1.0.0",
          dependencies: {
            baz: "0.0.3",
          },
          [field]: {
            shared: "file:./shared",
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

      expect(await exists(join(ctx.package_dir, "node_modules", "loot"))).toBe(false);
      expect(await exists(join(ctx.package_dir, "node_modules", "baz", "node_modules", "loot"))).toBe(false);
      expect(err).toContain("package.json not found");
      expect(out).not.toContain("2 packages installed");
      expect(exitCode).toBe(1);
    });
  });

  it.concurrent(`applies a root "${field}" file: path to a registry package's dependency`, async () => {
    // overrides/resolutions are declared in the root package.json, so a file:
    // path applied through them is trusted even for a dependency declared by a
    // registry package (which is otherwise constrained; see the test above).
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      using dir = tempDir(`override-registry-file-dep-${field}`, {
        "shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0" }),
        "shared/index.js": "module.exports = 'shared';",
      });
      const sharedDir = join(String(dir), "shared");
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.3": {
            dependencies: {
              shared: "1.0.0",
            },
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "my-app",
          version: "1.0.0",
          dependencies: {
            baz: "0.0.3",
          },
          [field]: {
            shared: "file:" + sharedDir.replaceAll("\\", "/"),
          },
        }),
      );

      // The first install resolves the override (enqueue path); the second
      // starts from the saved lockfile with an empty node_modules (installer path).
      for (let i = 0; i < 2; i++) {
        if (i === 1) {
          await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });
        }
        const { stdout, stderr, exited } = spawn({
          cmd: i === 0 ? [bunExe(), "install", "--save-text-lockfile"] : [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });
        const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

        expect(err).not.toContain("package.json not found");
        expect(err).not.toContain("failed to resolve");
        expect(err).not.toContain("unsafe folder path");
        expect(err).not.toContain("refusing to install");
        expect(out).toContain("baz");
        expect(exitCode).toBe(0);
      }

      // The registry package's dependency resolved to the override's file: path
      // (no registry request for it was made) and is linked under baz, since
      // transitive folder dependencies are not hoisted.
      expect(urls.filter(url => url.includes("shared"))).toEqual([]);
      const lock = (await file(join(ctx.package_dir, "bun.lock")).text()).replaceAll("\\\\", "/");
      expect(lock).toContain('"baz/shared"');
      expect(lock).toContain("shared@file:");
      expect(await exists(join(ctx.package_dir, "node_modules", "baz", "node_modules", "shared", "index.js"))).toBe(
        true,
      );
    });
  });

  const nestedRule = (parent: string, value: string) =>
    field === "overrides" ? { [parent]: { shared: value } } : { [`${parent}/shared`]: value };

  it.concurrent(
    `rejects a nested "${field}" rule pointing at a file: path outside the project for a registry package's dependency`,
    async () => {
      // A nested rule only replaces one parent -> child edge, so it does not
      // make every edge of that name root authored. The trust checks therefore
      // only consult plain rules, and a nested file: path that escapes the
      // project is still rejected when the parent is a registry package.
      await withContext(defaultOpts, async ctx => {
        const urls: string[] = [];
        setContextHandler(
          ctx,
          dummyRegistryForContext(ctx, urls, {
            "0.0.3": {
              dependencies: {
                shared: "1.0.0",
              },
            },
          }),
        );
        // The project is a subdirectory so that `../shared` exists and is outside it.
        const projectDir = join(ctx.package_dir, "project");
        await write(
          join(ctx.package_dir, "shared", "package.json"),
          JSON.stringify({ name: "shared", version: "1.0.0" }),
        );
        await write(join(ctx.package_dir, "shared", "index.js"), "module.exports = 'shared';");
        await write(
          join(projectDir, "bunfig.toml"),
          `
[install]
cache = false
registry = "${ctx.registry_url}"
`,
        );
        await write(
          join(projectDir, "package.json"),
          JSON.stringify({
            name: "my-app",
            version: "1.0.0",
            dependencies: {
              baz: "0.0.3",
            },
            [field]: nestedRule("baz", "file:../shared"),
          }),
        );

        await using proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: projectDir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env,
        });
        const [err, out, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

        // stderr also carries the progress lines of the registry fetch of `baz`.
        expect(err.split(/\r?\n/).filter(line => line.startsWith("error:"))).toEqual([
          'error: package.json not found for "file:../shared" dependency "shared"',
          "error: shared@1.0.0 failed to resolve",
        ]);
        expect(out).not.toContain("packages installed");
        expect(await exists(join(projectDir, "node_modules", "shared"))).toBe(false);
        expect(await exists(join(projectDir, "node_modules", "baz", "node_modules", "shared"))).toBe(false);
        expect(await exists(join(projectDir, "bun.lock"))).toBe(false);
        expect(urls.filter(url => url.includes("shared"))).toEqual([]);
        expect(exitCode).toBe(1);
      });
    },
  );

  it.concurrent(
    `installs a nested "${field}" rule pointing at a file: path outside the project for a local file: package's dependency`,
    async () => {
      // The parent is a file: package of the root, so its dependencies' file:
      // paths are trusted like root dependencies (see the transitive file: tests
      // above), nested rule or not.
      using dir = tempDir("nested-override-file-dep-outside-local", {
        "shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0" }),
        "shared/index.js": "module.exports = 'shared';",
        "project/package.json": JSON.stringify({
          name: "my-app",
          version: "1.0.0",
          dependencies: {
            "pkg-a": "file:./pkg-a",
          },
          [field]: nestedRule("pkg-a", "file:../shared"),
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

      // The first pass resolves the rule (enqueue path); the second installs
      // from the lockfile it wrote (package installer path).
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
        expect(runOut).toBe("shared\n");
        expect(runExit).toBe(0);
      }

      const lock = (await file(join(projectDir, "bun.lock")).text()).replaceAll("\\\\", "/");
      expect(lock).toContain('"pkg-a/shared": ["shared@file:../shared", {}]');
    },
  );

  it.concurrent(`installs a nested "${field}" rule pointing at a file: path inside the project`, async () => {
    using dir = tempDir("nested-override-file-dep-inside", {
      "package.json": JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        dependencies: {
          "pkg-a": "file:./pkg-a",
        },
        [field]: nestedRule("pkg-a", "file:./vendor/shared"),
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

          "pkg-a/shared": ["shared@file:vendor/shared", {}],
        }
      }"
    `);
  });

  // Unlike `pkg-a` above, the package declaring the overridden dependency is a
  // registry package here, so the hoisted installer cannot source the folder
  // relative to a local declarer: the path only makes sense relative to the
  // project, where the rule was written.
  const isOddRules: [kind: string, rule: Record<string, unknown>][] = [
    ["plain", { "is-odd": "file:./vendor/is-odd" }],
    [
      "nested",
      field === "overrides"
        ? { "is-even": { "is-odd": "file:./vendor/is-odd" } }
        : { "is-even/is-odd": "file:./vendor/is-odd" },
    ],
  ];

  for (const [kind, rule] of isOddRules) {
    it.concurrent(`links a ${kind} "${field}" file: rule applied to a registry package's dependency`, async () => {
      await withContext(defaultOpts, async ctx => {
        const urls: string[] = [];
        setContextHandler(
          ctx,
          dummyRegistryForContext(ctx, urls, { "1.0.0": { dependencies: { "is-odd": "^0.1.2" } } }),
        );
        await writeIsEvenProject(ctx.package_dir, { [field]: rule });

        const { out } = await runBunInstall(env, ctx.package_dir, { saveTextLockfile: true });
        expect(out).toContain("2 packages installed");
        expect(urls.sort()).toEqual([`${ctx.registry_url}is-even`, `${ctx.registry_url}is-even-1.0.0.tgz`]);
        expect(await file(join(ctx.package_dir, "bun.lock")).text()).toContain(
          `"is-even/is-odd": ["is-odd@file:vendor/is-odd", {}]`,
        );
        await expectVendoredIsOddLinked(ctx.package_dir);

        // Installing again on top of the existing node_modules keeps it.
        await runBunInstall(env, ctx.package_dir, { savesLockfile: false });
        await expectVendoredIsOddLinked(ctx.package_dir);

        // Installing from the lockfile goes through the installer without re-resolving.
        await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });
        await runBunInstall(env, ctx.package_dir, { frozenLockfile: true });
        await expectVendoredIsOddLinked(ctx.package_dir);

        expect(urls.filter(url => url.includes("is-odd"))).toEqual([]);
      });
    });

    if (field !== "overrides") continue;

    // The isolated linker already sources every folder package from the project; pin the parity.
    it.concurrent(`isolated linker: a ${kind} file: override applied to a registry package's dependency`, async () => {
      await withContext({ linker: "isolated" }, async ctx => {
        const urls: string[] = [];
        setContextHandler(
          ctx,
          dummyRegistryForContext(ctx, urls, { "1.0.0": { dependencies: { "is-odd": "^0.1.2" } } }),
        );
        await writeIsEvenProject(ctx.package_dir, { [field]: rule });

        await runBunInstall(env, ctx.package_dir);
        expect(urls.filter(url => url.includes("is-odd"))).toEqual([]);
        await expectIsEvenUsesVendoredIsOdd(ctx.package_dir);
      });
    });
  }
}

/**
 * `is-even@1.0.0` (served by the dummy registry from the fixture tarball) does
 * `require("is-odd")`. `vendor/is-odd` is what the override rules above point it at;
 * it is recognizable at runtime by the line it prints.
 */
async function writeIsEvenProject(projectDir: string, rootPackageJsonFields: Record<string, unknown>) {
  await Promise.all([
    write(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: { "is-even": "1.0.0" },
        ...rootPackageJsonFields,
      }),
    ),
    write(join(projectDir, "vendor", "is-odd", "package.json"), JSON.stringify({ name: "is-odd", version: "9.9.9" })),
    write(
      join(projectDir, "vendor", "is-odd", "index.js"),
      `module.exports = function isOdd() { console.log("vendored is-odd"); return true; };`,
    ),
  ]);
}

async function expectIsEvenUsesVendoredIsOdd(projectDir: string) {
  await using proc = spawn({
    cmd: [bunExe(), "-e", `console.log(require("is-even")(2))`],
    cwd: projectDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).toBe("");
  expect(out).toBe("vendored is-odd\nfalse\n");
  expect(exitCode).toBe(0);
}

async function expectVendoredIsOddLinked(projectDir: string) {
  // Folder dependencies are never hoisted, so the rule's target is linked inside is-even.
  expect(await readdirSorted(join(projectDir, "node_modules", "is-even", "node_modules"))).toEqual(["is-odd"]);
  expect(await readdirSorted(join(projectDir, "node_modules", "is-even", "node_modules", "is-odd"))).toEqual([
    "index.js",
    "package.json",
  ]);
  await expectIsEvenUsesVendoredIsOdd(projectDir);
}

it.concurrent("fails when a file: override for a registry package's dependency names a missing folder", async () => {
  await withContext(defaultOpts, async ctx => {
    const urls: string[] = [];
    setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "1.0.0": { dependencies: { "is-odd": "^0.1.2" } } }));
    await write(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: { "is-even": "1.0.0" },
        overrides: { "is-odd": "file:./vendor/is-odd" },
      }),
    );

    const { out, err } = await runBunInstall(env, ctx.package_dir, {
      allowErrors: true,
      expectedExitCode: 1,
      savesLockfile: false,
    });

    // It's resolved like a file: dependency of the root, so the missing folder fails during resolution, before anything
    // is installed.
    expect(err).toContain('package.json not found for "file:./vendor/is-odd" dependency "is-odd"');
    expect(out).not.toContain("packages installed");
    expect(await exists(join(ctx.package_dir, "node_modules", "is-even", "node_modules", "is-odd"))).toBe(false);
    expect(await exists(join(ctx.package_dir, "bun.lock"))).toBe(false);
  });
});

it.concurrent("installs the transitive file: dependency of a file: dependency", async () => {
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

// The link: form of the file: containment rule tested above. A link: path names a
// directory of the machine running the install (bun reads it against the project),
// which only the package.json files read from the project can mean to do. A
// package installed from the cache (registry, git, tarball) declaring one used
// to get the directory's package.json read and recorded in bun.lock.
// What a link: path does for the project itself: bun-install-link-path.test.ts.
describe.concurrent("link: paths with .. or an absolute path declared by a dependency", () => {
  // The project is <root>/project so that `../outside` stays inside the temp dir.
  // `climbing` only climbs out after normalization.
  function declaredLinks(root: string): Record<string, string> {
    return {
      outside: "link:../outside",
      climbing: "link:x/../../climbing",
      absolute: `link:${join(root, "absolute").replaceAll("\\", "/")}`,
    };
  }

  // Every target exists, so resolving one of them is observable in bun.lock.
  function linkTargets(): Record<string, string> {
    return {
      "outside/package.json": JSON.stringify({ name: "outside-dir", version: "1.0.0" }),
      "climbing/package.json": JSON.stringify({ name: "climbing-dir", version: "1.0.0" }),
      "absolute/package.json": JSON.stringify({ name: "absolute-dir", version: "1.0.0" }),
    };
  }

  function rootPackageJson(dependencies: Record<string, string>, extra: object = {}) {
    return JSON.stringify({ name: "my-app", version: "1.0.0", dependencies, ...extra });
  }

  // <root>/project depends on `bar@0.0.2` from the dummy registry, whose manifest
  // for it carries `barManifest`.
  async function writeRegistryProject(ctx: TestContext, root: string, barManifest: object, rootExtra: object = {}) {
    setContextHandler(ctx, dummyRegistryForContext(ctx, [], { "0.0.2": barManifest }));
    await write(join(root, "project", "package.json"), rootPackageJson({ bar: "0.0.2" }, rootExtra));
    await write(join(root, "project", "bunfig.toml"), `[install]\nregistry = "${ctx.registry_url}"\n`);
  }

  // Packs <root>/tb-src into <root>/project/tb-1.0.0.tgz.
  async function packDeclarer(root: string, manifest: object) {
    await write(join(root, "tb-src", "package.json"), JSON.stringify({ name: "tb", version: "1.0.0", ...manifest }));
    await using proc = spawn({
      cmd: [bunExe(), "pm", "pack", "--destination", join(root, "project")],
      cwd: join(root, "tb-src"),
      env,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [packErr, packExitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(packErr).not.toContain("error:");
    expect(packExitCode).toBe(0);
  }

  async function install(root: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd: join(root, "project"),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(root, "cache"), BUN_INSTALL_GLOBAL_DIR: join(root, "global") },
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
    });
    const [err, out, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    return { err, out, exitCode };
  }

  // `declarer` is how bun prints the package declaring the dependency.
  function refusal(name: string, spec: string, declarer: string) {
    return `error: refusing to resolve "${name}@${spec}" declared by ${declarer}: only the root package.json, a workspace, or a top-level override may link to a path`;
  }

  // The rest of stderr is progress output ("Resolving dependencies", ...).
  function errorLines(stderr: string) {
    return stderr.split(/\r?\n/).filter(line => line.startsWith("error:"));
  }

  async function expectRefused(root: string, declarer: string) {
    const { err, out, exitCode } = await install(root);

    const refused = Object.entries(declaredLinks(root));
    const expected = [
      ...refused.map(([name, spec]) => refusal(name, spec, declarer)),
      ...refused.map(([name, spec]) => `error: ${name}@${spec} failed to resolve`),
    ];
    // Reported in the declaring package's dependency order, which differs between
    // a registry manifest and a package.json.
    expect(errorLines(err).sort()).toEqual(expected.sort());
    expect(err).not.toContain("Saved lockfile");
    expect(out).not.toContain("installed");
    expect(await exists(join(root, "project", "bun.lock"))).toBe(false);
    expect(await exists(join(root, "project", "node_modules"))).toBe(false);
    expect(exitCode).toBe(1);
  }

  it("are refused when a tarball dependency declares them", async () => {
    using dir = tempDir("escaping-links-of-tarball-dep", {
      ...linkTargets(),
      "project/package.json": rootPackageJson({ tb: "file:./tb-1.0.0.tgz" }),
    });
    const root = String(dir);
    await packDeclarer(root, { dependencies: declaredLinks(root) });

    await expectRefused(root, "tb@./tb-1.0.0.tgz");
  });

  it("are refused when a git dependency declares them", async () => {
    using dir = tempDir("escaping-links-of-git-dep", linkTargets());
    const root = String(dir);
    await write(
      join(root, "work", "package.json"),
      JSON.stringify({ name: "bar", version: "0.0.2", dependencies: declaredLinks(root) }),
    );
    const sha = await createDumbHttpGitRepo(root, {});
    using server = serveDirectory(root);
    const repo = `git+http://localhost:${server.port}/repo.git`;
    await write(join(root, "project", "package.json"), rootPackageJson({ bar: repo }));

    await expectRefused(root, `bar@${repo}#${sha}`);
  });

  it("are refused when a registry package declares them", async () => {
    await withContext(defaultOpts, async ctx => {
      using dir = tempDir("escaping-links-of-registry-dep", linkTargets());
      const root = String(dir);
      await writeRegistryProject(ctx, root, { dependencies: declaredLinks(root) });

      await expectRefused(root, "bar@0.0.2");
    });
  });

  it("are refused when a registry package declares one as a peer dependency", async () => {
    await withContext(defaultOpts, async ctx => {
      using dir = tempDir("escaping-peer-link-of-registry-dep", linkTargets());
      const root = String(dir);
      await writeRegistryProject(ctx, root, { peerDependencies: { outside: "link:../outside" } });

      // An unresolved peer is not reported a second time as "failed to resolve"
      // and does not stop bar itself from being installed; the error still fails
      // the install before the lockfile is saved.
      const { err, exitCode } = await install(root);
      expect(errorLines(err)).toEqual([refusal("outside", "link:../outside", "bar@0.0.2")]);
      expect(await exists(join(root, "project", "bun.lock"))).toBe(false);
      expect(await exists(join(root, "project", "node_modules", "outside"))).toBe(false);
      expect(exitCode).toBe(1);
    });
  });

  it("stay uninstalled when a registry package declares one as an optional dependency", async () => {
    await withContext(defaultOpts, async ctx => {
      using dir = tempDir("escaping-optional-link-of-registry-dep", linkTargets());
      const root = String(dir);
      await writeRegistryProject(ctx, root, { optionalDependencies: { outside: "link:../outside" } });

      const { err, out, exitCode } = await install(root);
      expect(err).not.toContain("error:");
      expect(out).toContain("1 package installed");
      expect(await readdirSorted(join(root, "project", "node_modules"))).toEqual(["bar"]);
      const lockfile = await file(join(root, "project", "bun.lock")).text();
      expect(lockfile).toContain('"bar": ["bar@0.0.2"');
      expect(lockfile).not.toContain("outside-dir");
      expect(exitCode).toBe(0);
    });
  });

  // A row bun.lock already holds is not resolved again, so both linkers repeat the check.
  for (const linker of ["hoisted", "isolated"]) {
    it(`are not installed by the ${linker} linker from a bun.lock that already holds one under a tarball dependency`, async () => {
      using dir = tempDir(`escaping-link-in-lockfile-${linker}`, {
        ...linkTargets(),
        // A node_modules from an earlier hoisted install.
        "project/node_modules/tb/package.json": JSON.stringify({ name: "tb", version: "1.0.0" }),
        "project/package.json": rootPackageJson({ tb: "file:./tb-1.0.0.tgz" }),
        "project/bun.lock": JSON.stringify({
          lockfileVersion: 2,
          configVersion: 1,
          workspaces: { "": { name: "my-app", dependencies: { tb: "file:./tb-1.0.0.tgz" } } },
          packages: {
            outside: ["outside-dir@link:../outside", {}],
            tb: ["tb@./tb-1.0.0.tgz", { dependencies: { outside: "link:../outside" } }],
          },
        }),
      });
      const root = String(dir);
      await packDeclarer(root, { dependencies: { outside: "link:../outside" } });

      const { err, exitCode } = await install(root, "--linker", linker);
      expect(errorLines(err)).toEqual([
        'error: refusing to link dependency outside-dir to "../outside": only the root package.json, a workspace, or a top-level override may link to a path',
      ]);
      // The hoisted linker places the link at the top level, the isolated linker
      // under the store entry of tb.
      expect(await exists(join(root, "project", "node_modules", "outside"))).toBe(false);
      const store = join(root, "project", "node_modules", ".bun");
      const tbEntries = (await exists(store))
        ? (await readdirSorted(store)).filter(name => name.startsWith("tb@"))
        : [];
      for (const entry of tbEntries) {
        expect(await exists(join(store, entry, "node_modules", "outside"))).toBe(false);
      }
      // The isolated linker refuses before it moves the existing node_modules aside.
      if (linker === "isolated") {
        expect(await file(join(root, "project", "node_modules", "tb", "package.json")).json()).toEqual({
          name: "tb",
          version: "1.0.0",
        });
      }
      expect(exitCode).toBe(1);
    });
  }

  // Both linkers check the rows they place. A row under a devDependency that
  // --production drops is not placed, so it is not refused either.
  for (const linker of ["hoisted", "isolated"]) {
    it(`are ignored by the ${linker} linker when --production drops the tarball dependency of a bun.lock that holds one`, async () => {
      using dir = tempDir(`escaping-link-in-lockfile-production-${linker}`, {
        ...linkTargets(),
        "project/package.json": rootPackageJson({}, { devDependencies: { tb: "file:./tb-1.0.0.tgz" } }),
        "project/bun.lock": JSON.stringify({
          lockfileVersion: 2,
          configVersion: 1,
          workspaces: { "": { name: "my-app", devDependencies: { tb: "file:./tb-1.0.0.tgz" } } },
          packages: {
            outside: ["outside-dir@link:../outside", {}],
            tb: ["tb@./tb-1.0.0.tgz", { dependencies: { outside: "link:../outside" } }],
          },
        }),
      });
      const root = String(dir);
      await packDeclarer(root, { dependencies: { outside: "link:../outside" } });

      const { err, exitCode } = await install(root, "--linker", linker, "--production");
      expect(err).not.toContain("error:");
      expect(await exists(join(root, "project", "node_modules", "outside"))).toBe(false);
      expect(await exists(join(root, "project", "node_modules", "tb"))).toBe(false);
      expect(exitCode).toBe(0);
    });
  }

  // The linkers' trust rule is keyed on the package, not on the particular dependency that they place. `--production`
  // drops the root's devDependency, so the only dependency left on the link is the peer dependency of `bar`.
  for (const linker of ["hoisted", "isolated"]) {
    it(`are still linked by the ${linker} linker when --production leaves only a registry package's peer dependency on a root-declared one`, async () => {
      await withContext(defaultOpts, async ctx => {
        using dir = tempDir(`root-link-peer-production-${linker}`, linkTargets());
        const root = String(dir);
        await writeRegistryProject(
          ctx,
          root,
          { peerDependencies: { outside: "*" }, peerDependenciesMeta: { outside: { optional: true } } },
          { devDependencies: { outside: "link:../outside" } },
        );

        const full = await install(root, "--linker", linker);
        expect(full.err).not.toContain("error:");
        expect(full.exitCode).toBe(0);
        await rm(join(root, "project", "node_modules"), { recursive: true, force: true });

        const { err, exitCode } = await install(root, "--linker", linker, "--production");
        expect(err).not.toContain("error:");
        const nodeModules = join(root, "project", "node_modules");
        let linked = join(nodeModules, "outside");
        if (linker === "isolated") {
          const store = join(nodeModules, ".bun");
          const barEntry = (await readdirSorted(store)).find(name => name.startsWith("bar@"))!;
          linked = join(store, barEntry, "node_modules", "outside");
        }
        expect(await file(join(linked, "package.json")).json()).toEqual({ name: "outside-dir", version: "1.0.0" });
        expect(exitCode).toBe(0);
      });
    });
  }

  // These are still allowed. A path is relative to the package.json that declares it.
  it("are still resolved when the root package.json or a workspace declares them", async () => {
    using dir = tempDir("escaping-links-of-root-and-workspace", {
      ...linkTargets(),
      "project/package.json": rootPackageJson({ outside: "link:../outside" }, { workspaces: ["packages/*"] }),
      "project/packages/ws/package.json": JSON.stringify({
        name: "ws",
        version: "1.0.0",
        dependencies: { climbing: "link:../../../climbing" },
      }),
    });
    const root = String(dir);

    const { err, exitCode } = await install(root, "--lockfile-only");
    expect(err).not.toContain("error:");
    const lockfile = await file(join(root, "project", "bun.lock")).text();
    expect(lockfile).toContain('"outside": ["outside-dir@link:../outside"');
    expect(lockfile).toContain('"climbing": ["climbing-dir@link:../climbing"');
    expect(exitCode).toBe(0);
  });

  // `overrides` / `resolutions` are written in the root package.json, so a link:
  // path coming from there is the project's own even when it replaces the
  // dependency of a registry package.
  for (const field of ["resolutions", "overrides"]) {
    it(`are still resolved when a root "${field}" entry puts one on a registry package's dependency`, async () => {
      await withContext(defaultOpts, async ctx => {
        using dir = tempDir(`${field}-escaping-link-on-registry-dep`, linkTargets());
        const root = String(dir);
        await writeRegistryProject(
          ctx,
          root,
          { dependencies: { vendored: "0.0.1" } },
          { [field]: { vendored: "link:../outside" } },
        );

        const { err, exitCode } = await install(root, "--lockfile-only");
        expect(err).not.toContain("error:");
        const lockfile = await file(join(root, "project", "bun.lock")).text();
        expect(lockfile).toContain('"vendored": ["outside-dir@link:../outside"');
        expect(exitCode).toBe(0);
      });
    });
  }

  // A scoped rule only replaces one parent -> child edge, so the trust rule
  // consults plain rules only, as it does for a nested rule with a `file:` path
  // (tested above). The error names the value the rule supplied.
  for (const [shape, rules] of [
    ["parent-name", { "bar>outside": "link:../outside" }],
    ["nested", { bar: { outside: "link:../outside" } }],
  ] as const) {
    it(`are refused when a scoped root override (${shape}) puts one on a registry package's dependency`, async () => {
      await withContext(defaultOpts, async ctx => {
        using dir = tempDir(`scoped-override-escaping-link-${shape}`, linkTargets());
        const root = String(dir);
        await writeRegistryProject(ctx, root, { dependencies: { outside: "0.0.1" } }, { overrides: rules });

        const { err, exitCode } = await install(root, "--lockfile-only");
        expect(errorLines(err)).toEqual([
          refusal("outside", "link:../outside", "bar@0.0.2"),
          "error: outside@0.0.1 failed to resolve",
        ]);
        expect(await exists(join(root, "project", "bun.lock"))).toBe(false);
        expect(exitCode).toBe(1);
      });
    });
  }

  // An override edit makes bun rebuild the root's dependency rows and resolve
  // every row whose name an override rule has again. The rows it replaced stay
  // in the buffer with no declaring package; resolving those too would be refused
  // by the trust rule (for `file:` it reported `Could not find package.json`).
  for (const protocol of ["link", "file"]) {
    it(`declared by the root as ${protocol}: are still resolved after an override edit`, async () => {
      using dir = tempDir(`root-${protocol}-override-edit`, linkTargets());
      const root = String(dir);
      const spec = `${protocol}:../outside`;
      const overrides = [
        { "foo>outside": spec },
        { "foo>outside": spec, zzz: "1.0.0" },
        { "foo>outside": spec, zzz: "1.0.1" },
      ];

      for (const rules of overrides) {
        await write(join(root, "project", "package.json"), rootPackageJson({ outside: spec }, { overrides: rules }));
        const { err, exitCode } = await install(root, "--lockfile-only");
        expect(err).not.toContain("error:");
        expect(await file(join(root, "project", "bun.lock")).text()).toContain(`"outside": ["outside-dir@${spec}"`);
        expect(exitCode).toBe(0);
      }
    });
  }

  // Only a file: directory the root or a workspace declares counts. One a registry
  // package ships has no dependencies after a fresh resolve, but a lockfile migrated
  // from package-lock.json can give it some. The override edit makes bun resolve
  // the rows named `outside` again.
  it("are refused when a file: directory that a registry package ships declares them", async () => {
    const lockfile = JSON.stringify({
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: { "": { name: "my-app", dependencies: { bar: "0.0.2" } } },
      overrides: { "zzz>outside": "1.0.0" },
      packages: {
        bar: [
          "bar@0.0.2",
          "",
          { dependencies: { inner: "file:./inner" } },
          `sha512-${Buffer.alloc(64).toString("base64")}`,
        ],
        "bar/inner": ["inner@file:inner", { dependencies: { outside: "link:../outside" } }],
        "bar/inner/outside": ["outside-dir@link:../outside", {}],
      },
    });
    using dir = tempDir("escaping-link-of-shipped-folder", {
      ...linkTargets(),
      "project/package.json": rootPackageJson({ bar: "0.0.2" }, { overrides: { "zzz>outside": "2.0.0" } }),
      "project/bunfig.toml": `[install]\nregistry = "http://localhost:1/"\n`,
      "project/bun.lock": lockfile,
    });
    const root = String(dir);

    const { err, exitCode } = await install(root, "--lockfile-only");
    expect(errorLines(err)).toEqual([
      refusal("outside", "link:../outside", "inner@inner"),
      "error: outside@link:../outside failed to resolve",
    ]);
    expect(await file(join(root, "project", "bun.lock")).text()).toBe(lockfile);
    expect(exitCode).toBe(1);
  });

  // A file: directory's package.json is read from the project like a workspace's,
  // so it may declare one. The target is planted both where bun reads the path
  // from today (the project) and next to the declaring directory; which of the
  // two it reads is not what this pins.
  it("are still resolved when a file: directory dependency declares them", async () => {
    using dir = tempDir("escaping-link-of-folder-dep", {
      ...linkTargets(),
      "project/outside/package.json": linkTargets()["outside/package.json"],
      "project/package.json": rootPackageJson({ lib: "file:./lib" }),
      "project/lib/package.json": JSON.stringify({
        name: "lib",
        version: "1.0.0",
        dependencies: { outside: "link:../outside" },
      }),
    });
    const root = String(dir);

    const { err, exitCode } = await install(root, "--lockfile-only");
    expect(err).not.toContain("error:");
    expect(await file(join(root, "project", "bun.lock")).text()).toContain('"outside": ["outside-dir@link:');
    expect(exitCode).toBe(0);
  });

  // The documented form: `link:<name>` is looked up in the global link directory that `bun link` populates, no matter
  // which package declares it.
  it("do not affect a registry package linking a package by name", async () => {
    await withContext(defaultOpts, async ctx => {
      using dir = tempDir("named-link-of-registry-dep", {
        "global/node_modules/linked-pkg/package.json": JSON.stringify({ name: "linked-pkg", version: "2.0.0" }),
      });
      const root = String(dir);
      await writeRegistryProject(ctx, root, { dependencies: { "linked-pkg": "link:linked-pkg" } });

      const { err, out, exitCode } = await install(root);
      expect(err).not.toContain("error:");
      expect(out).toContain("2 packages installed");
      expect(await readdirSorted(join(root, "project", "node_modules"))).toEqual(["bar", "linked-pkg"]);
      expect(await file(join(root, "project", "node_modules", "linked-pkg", "package.json")).json()).toEqual({
        name: "linked-pkg",
        version: "2.0.0",
      });
      expect(exitCode).toBe(0);
    });
  });
});

for (const lockfile of ["bun.lock", "bun.lockb"]) {
  it.concurrent(`installs a file: dependency whose version literal has leading whitespace (${lockfile})`, async () => {
    // The folder path is longer than an inline string so that it has to be appended to the
    // lockfile's string buffer, which only has room for it if the literal was classified as a folder.
    const literal = " file:./vendor/some-long-directory-name/lib";
    using dir = tempDir("whitespace-file-dep", {
      "package.json": JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        dependencies: {
          lib: literal,
        },
      }),
      "vendor/some-long-directory-name/lib/package.json": JSON.stringify({
        name: "lib",
        version: "1.0.0",
      }),
      "bunfig.toml": `install.saveTextLockfile = ${lockfile === "bun.lock"}`,
    });

    // The first pass resolves from package.json; the second installs from the lockfile the first
    // pass wrote, which stores the literal as written and has to parse it as a folder again.
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
      expect(out).toContain("1 package installed");
      expect(exitCode).toBe(0);

      expect(await file(join(String(dir), "node_modules", "lib", "package.json")).json()).toEqual({
        name: "lib",
        version: "1.0.0",
      });
      if (lockfile === "bun.lock") {
        expect(await file(join(String(dir), "bun.lock")).text()).toContain(`"lib": ${JSON.stringify(literal)}`);
      } else {
        expect(await exists(join(String(dir), "bun.lockb"))).toBe(true);
      }
    }
  });
}

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

it.concurrent("installs file: dependencies that depend on each other", async () => {
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

        "a/b": ["b@file:packages/b", { "dependencies": { "a": "file:../a" } }],

        "b/a": ["a@file:packages/a", { "dependencies": { "b": "file:../b" } }],
      }
    }"
  `);
});

it.concurrent(
  "installs file: dependencies that depend on each other from a lockfile that only lists the root's copies",
  async () => {
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
  },
);

it.concurrent(
  "reloads the lockfile it wrote when a file: dependency and the root declare the same folder",
  async () => {
    using dir = tempDir("shared-file-dep", {
      "package.json": JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        dependencies: {
          lib: "file:./vendor/lib",
          shared: "file:./vendor/shared",
        },
      }),
      "vendor/lib/package.json": JSON.stringify({
        name: "lib",
        version: "1.0.0",
        dependencies: { shared: "file:../shared" },
      }),
      "vendor/shared/package.json": JSON.stringify({
        name: "shared",
        version: "1.0.0",
        dependencies: { nested: "file:../nested" },
      }),
      "vendor/nested/package.json": JSON.stringify({ name: "nested", version: "1.0.0" }),
    });

    const install = async (...args: string[]) => {
      await using proc = spawn({
        cmd: [bunExe(), "install", ...args],
        cwd: String(dir),
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    };

    const [, err, exitCode] = await install();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
    const lock = await file(join(String(dir), "bun.lock")).text();

    // `lib/shared` was a second `shared` package with no dependencies. The parser
    // makes one package of the two rows, so it looked for a `lib/shared/nested` row:
    // "Failed to resolve prod dependency 'nested' for package 'lib/shared'".
    await rm(join(String(dir), "node_modules"), { recursive: true, force: true });
    const [, err2, exitCode2] = await install("--frozen-lockfile");
    expect(err2).not.toContain("error:");
    expect(err2).not.toContain("Ignoring lockfile");
    expect(exitCode2).toBe(0);
    expect(await file(join(String(dir), "bun.lock")).text()).toBe(lock);

    expect(normalizeBunSnapshot(lock, dir)).toMatchInlineSnapshot(`
    "{
      "lockfileVersion": 2,
      "configVersion": 1,
      "workspaces": {
        "": {
          "name": "my-app",
          "dependencies": {
            "lib": "file:./vendor/lib",
            "shared": "file:./vendor/shared",
          },
        },
      },
      "packages": {
        "lib": ["lib@file:vendor/lib", { "dependencies": { "shared": "file:../shared" } }],

        "shared": ["shared@file:vendor/shared", { "dependencies": { "nested": "file:../nested" } }],

        "lib/shared": ["shared@file:vendor/shared", { "dependencies": { "nested": "file:../nested" } }],

        "shared/nested": ["nested@file:vendor/nested", {}],

        "lib/shared/nested": ["nested@file:vendor/nested", {}],
      }
    }"
  `);
  },
);

it.concurrent("keeps a registry package's own file: folder apart from the root's folder of the same path", async () => {
  // A registry package's `file:` path is relative to that package, so `file:x`
  // under it names a different folder than the root's `file:x`. The root's copy
  // has the trusted `postinstall`; it must not run in the package's copy.
  const ctx = await createTestContext();
  try {
    const tarball = await new Bun.Archive(
      {
        "package/package.json": JSON.stringify({ name: "foo", version: "1.0.0", dependencies: { x: "file:x" } }),
        "package/x/package.json": JSON.stringify({ name: "x", version: "6.6.6" }),
        "package/x/build.js": `throw new Error("the postinstall of the root's x ran in foo's x");`,
      },
      { compress: "gzip" },
    ).bytes();

    setContextHandler(ctx, async request => {
      if (request.url.endsWith(".tgz")) return new Response(tarball);
      return Response.json({
        name: "foo",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": {
            name: "foo",
            version: "1.0.0",
            dependencies: { x: "file:x" },
            dist: {
              tarball: `${ctx.registry_url}foo-1.0.0.tgz`,
              integrity: `sha512-${new Bun.CryptoHasher("sha512").update(tarball).digest("base64")}`,
            },
          },
        },
      });
    });

    await Promise.all([
      write(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "my-app",
          version: "1.0.0",
          dependencies: { foo: "1.0.0", x: "file:x" },
          trustedDependencies: ["x"],
        }),
      ),
      write(
        join(ctx.package_dir, "x", "package.json"),
        JSON.stringify({ name: "x", version: "1.0.0", scripts: { postinstall: `${bunExe()} build.js` } }),
      ),
      write(join(ctx.package_dir, "x", "build.js"), `require("fs").writeFileSync("ran.txt", process.cwd());`),
    ]);

    await using proc = spawn({
      cmd: [bunExe(), "install", "--save-text-lockfile"],
      cwd: ctx.package_dir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });
    const [err, out, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(out).toContain("3 packages installed");
    expect(exitCode).toBe(0);

    // The script ran once, in the root's folder. `foo`'s copy has no marker and
    // keeps its own version.
    expect([
      await file(join(ctx.package_dir, "node_modules", "x", "ran.txt")).text(),
      await exists(join(ctx.package_dir, "node_modules", "foo", "node_modules", "x", "ran.txt")),
      await file(join(ctx.package_dir, "node_modules", "foo", "node_modules", "x", "package.json")).json(),
    ]).toEqual([join(ctx.package_dir, "node_modules", "x"), false, { name: "x", version: "6.6.6" }]);

    // two rows, so two packages
    const lock = await file(join(ctx.package_dir, "bun.lock")).text();
    expect(lock.split("\n").filter(line => line.includes(`["x@file:x"`))).toEqual([
      `    "x": ["x@file:x", { "hasInstallScript": true }],`,
      `    "foo/x": ["x@file:x", {}],`,
    ]);
  } finally {
    destroyTestContext(ctx);
  }
});

it.concurrent("fails when a transitive file: dependency's folder does not exist", async () => {
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

// A `file:` dependency is a folder package whose dependencies get installed; a
// `link:` dependency on the same directory is a bare symlink with none. The
// folder resolver caches resolutions per directory, so whichever of the two
// resolved first used to be handed out for the other one as well. Dependencies
// resolve in alias order, so "a" is resolved before "z".
for (const [first, second] of [
  ["link", "file"],
  ["file", "link"],
] as const) {
  it.concurrent(
    `resolves file: and link: to the same directory as separate packages (${first}: resolves first)`,
    async () => {
      using dir = tempDir("file-and-link-to-same-dir", {
        "shared/package.json": JSON.stringify({
          name: "shared",
          version: "1.0.0",
          dependencies: { extra: "file:../app/extra" },
        }),
        "app/extra/package.json": JSON.stringify({ name: "extra", version: "1.0.0" }),
        "app/package.json": JSON.stringify({
          name: "app",
          dependencies: { a: `${first}:../shared`, z: `${second}:../shared` },
        }),
      });
      const projectDir = join(String(dir), "app");
      const fileAlias = first === "file" ? "a" : "z";
      const linkAlias = first === "link" ? "a" : "z";

      await using proc = spawn({
        cmd: [bunExe(), "install", "--lockfile-only"],
        cwd: projectDir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const [err, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

      expect(err).not.toContain("error:");
      expect(exitCode).toBe(0);
      const lockfile = Bun.JSONC.parse(await file(join(projectDir, "bun.lock")).text()) as any;
      expect(lockfile.packages).toEqual({
        [fileAlias]: ["shared@file:../shared", { dependencies: { extra: "file:../app/extra" } }],
        [`${fileAlias}/extra`]: ["extra@file:extra", {}],
        [linkAlias]: ["shared@link:../shared", {}],
      });
    },
  );
}

const doesNotExtractOutsideTempDir =
  "does not extract a local file: tarball outside the temp dir for a dependency alias containing '..' path segments";
it.concurrent(doesNotExtractOutsideTempDir, async () => {
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
  expect(err).toContain('invalid dependency name "../../../../../.."');
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

const doesNotCreateCacheEntryOutside =
  "does not create a cache index entry outside the cache directory for a dependency alias of '..'";
it.concurrent(doesNotCreateCacheEntryOutside, async () => {
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
  expect(err).toContain('invalid dependency name ".."');
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
it.concurrent.skipIf(isWindows)("file: deps with colliding abs-path hashes resolve to distinct packages", async () => {
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

// The lockfile interns every string over 8 bytes in a pool keyed by Wyhash11(0, bytes).
it.concurrent.skipIf(isWindows)("two specifiers whose hashes collide stay two strings", async () => {
  const specA = "./t/m3daaaaaaaaaaaaaaaaaaaaaaaaa.7aQs_ePaaaaaaaaw9Aaaaaaaaaaaaaa.tgz";
  const specB = "./t/m3daaaaaaaaaaaaaaaaaaaaaaaaa.7aQs_ePbaaaaaaaw9Aaaaaaaaaaaaaa.tgz";
  expect(specA).not.toBe(specB);
  expect(wyhash11(0n, new TextEncoder().encode(specA))).toBe(wyhash11(0n, new TextEncoder().encode(specB)));

  using dir = tempDir("pool-collision", {
    "A/package/package.json": JSON.stringify({ name: "pa", version: "1.0.0" }),
    "B/package/package.json": JSON.stringify({ name: "pb", version: "2.0.0" }),
    "package.json": JSON.stringify({ name: "app", dependencies: { pa: specA, pb: specB } }),
  });
  const root = String(dir);
  await mkdir(join(root, "t"));
  for (const [src, spec] of [
    ["A", specA],
    ["B", specB],
  ]) {
    await using tar = Bun.spawn({ cmd: ["tar", "-czf", join(root, spec), "-C", join(root, src), "package"], env });
    expect(await tar.exited).toBe(0);
  }

  await using proc = Bun.spawn({ cmd: [bunExe(), "install"], cwd: root, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(stdout).toContain("2 packages installed");
  expect(exitCode).toBe(0);

  expect((await file(join(root, "node_modules", "pa", "package.json")).json()).name).toBe("pa");
  expect((await file(join(root, "node_modules", "pb", "package.json")).json()).name).toBe("pb");
  const lock = await file(join(root, "bun.lock")).text();
  expect(lock).toContain(`"pa": "${specA}"`);
  expect(lock).toContain(`"pb": "${specB}"`);
});

it.concurrent("reports an invalid URL for a manifest tarball URL containing a newline", async () => {
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

it.concurrent("reports an invalid URL for a manifest tarball URL containing a space", async () => {
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

it.concurrent.each([
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

it.concurrent.each([
  ["inside", "127.0.0\0.1"],
  ["after", "127.0.0.1\0.example.invalid"],
])("does not connect for a manifest tarball URL with a NUL %s the host", async (_where, host) => {
  await withContext(defaultOpts, async ctx => {
    let connections = 0;
    using listener = listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open() {
          connections++;
        },
        data() {},
      },
    });
    setContextHandler(ctx, async () =>
      Response.json({
        name: "baz",
        versions: {
          "0.0.2": {
            name: "baz",
            version: "0.0.2",
            dist: { tarball: `http://${host}:${listener.port}/baz-0.0.2.tgz` },
          },
        },
        "dist-tags": { latest: "0.0.2" },
      }),
    );
    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { baz: "0.0.2" } }),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.package_dir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });
    const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(err).toContain("InvalidURL downloading tarball");
    expect(connections).toBe(0);
    expect(exitCode).toBe(1);
  });
});

// A registry response is remote data, so none of these shapes breaks an invariant. The release build
// tolerates each one. A build with debug assertions used to abort on each one.
describe.concurrent("registry manifest with an unexpected shape", () => {
  function manifestOf(ctx: TestContext, name: string, version: string, fields: object = {}) {
    return {
      name,
      "dist-tags": { latest: version },
      versions: {
        [version]: { name, version, dist: { tarball: `${ctx.registry_url}${name}-${version}.tgz` }, ...fields },
      },
    };
  }

  // Serves `manifests[name]` for a package and the fixture tarball of the same file name for a `.tgz` URL.
  async function installFrom(ctx: TestContext, manifests: Record<string, object>, args = ["install"]) {
    const urls: string[] = [];
    setContextHandler(ctx, request => {
      urls.push(request.url);
      const pathname = new URL(request.url).pathname;
      if (pathname.endsWith(".tgz")) {
        return new Response(file(join(import.meta.dir, basename(pathname))));
      }
      const manifest = manifests[pathname.slice(`/${ctx.id}/`.length)];
      return manifest ? Response.json(manifest) : new Response("Not Found", { status: 404 });
    });
    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "0.0.2" } }),
    );
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd: ctx.package_dir,
      stdout: "ignore",
      stderr: "pipe",
      env,
    });
    const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const installed = (await readdirSorted(join(ctx.package_dir, "node_modules"))).filter(name => name !== ".cache");
    return { err, exitCode, urls: urls.sort(), installed };
  }

  it("skips a dependency whose value is not a string", async () => {
    await withContext(defaultOpts, async ctx => {
      const { err, exitCode, urls, installed } = await installFrom(ctx, {
        bar: manifestOf(ctx, "bar", "0.0.2", {
          dependencies: { "null-value": null, baz: "0.0.3", "number-value": 1 },
          optionalDependencies: { "boolean-value": false },
          peerDependencies: { "object-value": {} },
        }),
        baz: manifestOf(ctx, "baz", "0.0.3"),
      });
      expect(err).not.toContain("error:");
      expect(urls).toEqual([
        `${ctx.registry_url}bar`,
        `${ctx.registry_url}bar-0.0.2.tgz`,
        `${ctx.registry_url}baz`,
        `${ctx.registry_url}baz-0.0.3.tgz`,
      ]);
      expect(installed).toEqual(["bar", "baz"]);
      expect(exitCode).toBe(0);
    });
  });

  it.each([
    ["no dist", {}],
    ["an empty dist", { dist: {} }],
    ["a dist that is not an object", { dist: "bar-0.0.2.tgz" }],
    ["a dist.tarball that is not a string", { dist: { tarball: null } }],
  ])("downloads from the default tarball URL for a version with %s", async (_name, fields) => {
    await withContext(defaultOpts, async ctx => {
      const manifest = manifestOf(ctx, "bar", "0.0.2");
      manifest.versions["0.0.2"] = { name: "bar", version: "0.0.2", ...fields } as any;
      const { err, exitCode, urls, installed } = await installFrom(ctx, { bar: manifest });
      expect(err).not.toContain("error:");
      expect(urls).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar/-/bar-0.0.2.tgz`]);
      expect(installed).toEqual(["bar"]);
      expect(exitCode).toBe(0);
    });
  });

  // `Version::parse` rejects each of these keys. npm skips such a key and prints nothing.
  const invalidVersionKeys = ["not-a-version", "1.0.0.1", "", "latest"];
  const skipWarnings = invalidVersionKeys.map(
    key => `warn: Skipping version ${JSON.stringify(key)} of "bar": not a valid semver version`,
  );

  it.each<[string, string, string[]]>([
    ["install", "nothing", []],
    ["add bar", "nothing", []],
    ["install --verbose", "a warning for each key", skipWarnings],
  ])("bun %s skips versions keys that are not versions and logs %s", async (command, _logs, logged) => {
    await withContext(defaultOpts, async ctx => {
      const manifest = manifestOf(ctx, "bar", "0.0.2");
      for (const key of invalidVersionKeys) manifest.versions[key] = manifest.versions["0.0.2"];
      const { err, exitCode, urls, installed } = await installFrom(ctx, { bar: manifest }, command.split(" "));
      expect({
        logged: err.split(/\r?\n/).filter(line => /^(error|warn): /.test(line)),
        urls,
        installed,
        exitCode,
      }).toEqual({
        logged,
        urls: [`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`],
        installed: ["bar"],
        exitCode: 0,
      });
    });
  });

  it("installs from a manifest with two keys for one version", async () => {
    await withContext(defaultOpts, async ctx => {
      const manifest = manifestOf(ctx, "bar", "0.0.2");
      manifest.versions["00.0.2"] = manifest.versions["0.0.2"];
      const { err, exitCode, urls, installed } = await installFrom(ctx, { bar: manifest });
      expect(err).not.toContain("error:");
      expect(urls).toEqual([`${ctx.registry_url}bar`, `${ctx.registry_url}bar-0.0.2.tgz`]);
      expect(installed).toEqual(["bar"]);
      expect(exitCode).toBe(0);
    });
  });

  it("installs from a manifest with dependencies, no dist-tags and no tarball URL", async () => {
    await withContext(defaultOpts, async ctx => {
      const { err, exitCode, urls, installed } = await installFrom(ctx, {
        bar: { name: "bar", versions: { "0.0.2": { name: "bar", version: "0.0.2", dependencies: { baz: "0.0.3" } } } },
        baz: manifestOf(ctx, "baz", "0.0.3"),
      });
      expect(err).not.toContain("error:");
      expect(urls).toEqual([
        `${ctx.registry_url}bar`,
        `${ctx.registry_url}bar/-/bar-0.0.2.tgz`,
        `${ctx.registry_url}baz`,
        `${ctx.registry_url}baz-0.0.3.tgz`,
      ]);
      expect(installed).toEqual(["bar", "baz"]);
      expect(exitCode).toBe(0);
    });
  });

  // A short string is stored inline, and the inline form ends at the first NUL. An assertion of debug builds did not know.
  it("installs a dependency whose version has a NUL byte after it", async () => {
    await withContext(defaultOpts, async ctx => {
      const { err, exitCode, urls, installed } = await installFrom(ctx, {
        bar: manifestOf(ctx, "bar", "0.0.2", { dependencies: { baz: "0.0.3\u0000x" } }),
        baz: manifestOf(ctx, "baz", "0.0.3"),
      });
      expect(err).not.toContain("error:");
      expect(urls).toEqual([
        `${ctx.registry_url}bar`,
        `${ctx.registry_url}bar-0.0.2.tgz`,
        `${ctx.registry_url}baz`,
        `${ctx.registry_url}baz-0.0.3.tgz`,
      ]);
      expect(installed).toEqual(["bar", "baz"]);
      expect(exitCode).toBe(0);
    });
  });

  it("installs without an optional dependency whose name has a NUL byte", async () => {
    await withContext(defaultOpts, async ctx => {
      const { err, exitCode, installed } = await installFrom(ctx, {
        bar: manifestOf(ctx, "bar", "0.0.2", { optionalDependencies: { "no\u0000pe": "0.0.3" } }),
      });
      expect(err).not.toContain("error:");
      expect(installed).toEqual(["bar"]);
      expect(exitCode).toBe(0);
    });
  });
});

// The progress bar copies the name it is currently showing into a fixed
// 768-byte buffer (PackageManager.progress_name_buf). A longer name aborted the
// install with "panic: range end index 900 out of range for slice of length
// 768" whenever the progress bar was on. BUN_INSTALL_PROGRESS=1 turns it on
// without a TTY; with colors enabled an emoji shares the buffer with the name,
// so both color settings are covered.
describe.concurrent("progress bar with a long name", () => {
  // Names are now limited to 255 bytes, which always fit. The two tests with this name only check that the longest name
  // is displayed and reported in full.
  const longName = Buffer.alloc(255, "a").toString();
  const progressEnvs = [
    ["NO_COLOR", { ...env, BUN_INSTALL_PROGRESS: "1", NO_COLOR: "1" }],
    ["FORCE_COLOR", { ...env, BUN_INSTALL_PROGRESS: "1", NO_COLOR: undefined, FORCE_COLOR: "1" }],
  ] as const;

  // This can still be longer than the buffer. A dependency that has no name yet is keyed by its specifier (`bun add
  // <url>` writes that until the tarball provides the name), and a URL has no length limit.
  it.each(progressEnvs)("tarball URL longer than the buffer, not named yet (%s)", async (_colors, progressEnv) => {
    const tarball = await new Bun.Archive(
      { "package/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }) },
      { compress: "gzip" },
    ).bytes();
    using server = Bun.serve({ port: 0, fetch: () => new Response(tarball) });
    const url = `${server.url}${Buffer.alloc(900, "a")}.tgz`;
    using dir = tempDir("install-progress-long-url", {
      "package.json": JSON.stringify({ name: "foo", dependencies: { [url]: url } }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...progressEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(Bun.stripANSI(err)).not.toContain("error:");
    expect(Bun.stripANSI(out)).toContain(`+ dep@${url}`);
    expect(exitCode).toBe(0);
  });

  it.each(progressEnvs)("dependency whose manifest is fetched (%s)", async (_colors, progressEnv) => {
    await withContext(defaultOpts, async ctx => {
      const requests: string[] = [];
      setContextHandler(ctx, request => {
        requests.push(request.url);
        return new Response("Not Found", { status: 404 });
      });
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            [longName]: "1.0.0",
          },
        }),
      );

      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
        env: progressEnv,
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(requests).toEqual([`${ctx.registry_url}${longName}`]);
      expect(Bun.stripANSI(err)).toContain(`error: GET ${ctx.registry_url}${longName} - 404`);
      expect(Bun.stripANSI(err)).toContain(`error: ${longName}@1.0.0 failed to resolve`);
      expect(out).not.toContain("1 package installed");
      expect(exitCode).toBe(1);
    });
  });

  it.each(progressEnvs)("workspace package running a lifecycle script (%s)", async (_colors, progressEnv) => {
    using dir = tempDir("install-progress-long-name", {
      "package.json": JSON.stringify({
        name: "foo",
        workspaces: ["packages/*"],
      }),
      "packages/long/package.json": JSON.stringify({
        name: longName,
        version: "1.0.0",
        scripts: {
          postinstall: "echo ran > postinstall-ran",
        },
      }),
    });

    // Nothing depends on the workspace package, so the isolated linker never
    // creates a node_modules entry with this name: the progress bar is the
    // only thing that has to cope with it.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--linker", "isolated"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: progressEnv,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stderr: Bun.stripANSI(err), exitCode }).toEqual({
      stderr: expect.not.stringContaining("error:"),
      exitCode: 0,
    });
    expect(Bun.stripANSI(out)).toContain("Checked 2 packages");
    expect(await file(join(String(dir), "packages", "long", "postinstall-ran")).text()).toBe("ran\n");
  });
});

// `--cwd` is staged in a PATH_MAX-sized buffer (4096 bytes on Linux and Android, 1024 on macOS and
// the BSDs) before chdir. Values that did not leave room for the NUL terminator used to abort the
// process; the buffer on Windows (~96 KiB) is larger than any command line, so only POSIX is affected.
describe.concurrent.skipIf(isWindows)("--cwd that does not fit the path buffer", () => {
  const PATH_MAX = isLinux || isAndroid ? 4096 : 1024;
  const name = (length: number) => Buffer.alloc(length, "a").toString();

  it.each([
    ["install, PATH_MAX - 1 bytes (rejected by the kernel)", "install", name(PATH_MAX - 1)],
    ["install, exactly PATH_MAX bytes", "install", name(PATH_MAX)],
    ["install, longer than PATH_MAX", "install", name(PATH_MAX + 1000)],
    ["install, ./ prefix longer than PATH_MAX", "install", "./" + name(PATH_MAX + 1000)],
    ["add, longer than PATH_MAX", "add", name(PATH_MAX + 1000)],
  ])("%s", async (_, subcommand, cwd) => {
    using dir = tempDir("install-cwd-too-long", {
      "package.json": JSON.stringify({ name: "foo", version: "0.0.1" }),
    });

    await using proc = spawn({
      cmd: [bunExe(), subcommand, "--cwd", cwd, ...(subcommand === "add" ? ["bar"] : [])],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(err).toContain(`failed to change directory to "${cwd}": ENAMETOOLONG`);
    expect(out).toBe("");
    expect(exitCode).toBe(1);
  });
});

async function bunIn(cwd: string, cmd: string[], extraEnv: Record<string, string> = {}) {
  await using proc = spawn({
    cmd: [bunExe(), ...cmd],
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, BUN_INSTALL_CACHE_DIR: join(cwd, ".cache"), BUN_INSTALL: join(cwd, ".bun"), ...extraEnv },
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// These commands read their arguments twice, and `bun why` after the runtime's own parser did.
describe.concurrent("a relative --cwd is applied once", () => {
  it.each([
    [["--cwd=apps/web", "update"], "+ dep@dep"],
    [["--cwd=./apps/web", "update"], "+ dep@dep"],
    [["update", "--cwd", "apps/web"], "+ dep@dep"],
    [["--cwd=apps/web", "why", "dep"], "dep@dep\n  └─ web@workspace (requires file:../../dep)\n"],
    [["why", "--cwd", "./apps/web", "dep"], "dep@dep\n  └─ web@workspace (requires file:../../dep)\n"],
  ])("bun %j", async (cmd, expected) => {
    using dir = tempDir("install-cwd-relative", {
      "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["apps/*"] }),
      "apps/web/package.json": JSON.stringify({
        name: "web",
        version: "1.0.0",
        dependencies: { dep: "file:../../dep" },
      }),
      "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    });
    expect((await bunIn(String(dir), ["install"])).exitCode).toBe(0);
    await rm(join(String(dir), "node_modules"), { recursive: true });

    const { stdout, stderr, exitCode } = await bunIn(String(dir), cmd);
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain(expected);
    expect(exitCode).toBe(0);
  });

  // With no package.json anywhere above, both write one and start over.
  it.each(["link", "unlink"])("bun --cwd=fresh %s", async subcommand => {
    using dir = tempDir("install-cwd-relative-link", { "fresh/.keep": "" });

    const { stderr, exitCode } = await bunIn(String(dir), ["--cwd=fresh", subcommand]);
    expect(stderr).toBe(
      `error: package.json missing "name" in "${join(realpathSync(String(dir)), "fresh", "package.json")}"\n`,
    );
    expect(exitCode).toBe(1);
  });
});

// A skipped flag used to leave its value behind: `bun install --env-file ci.env` installed and saved the package
// "ci.env".
describe.concurrent("a long flag the command does not have", () => {
  const PACKAGE_JSON = JSON.stringify({ name: "foo", version: "0.0.1" });
  const project = () =>
    tempDir("install-unknown-flag", {
      "package.json": PACKAGE_JSON,
      "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    });
  const rejected = (command: string, flag = "--nope") => ({
    stdout: "",
    stderr: `error: bun ${command} has no ${flag} flag.\nnote: Run 'bun ${command} --help' for more information\n`,
    exitCode: 1,
  });

  it.each([
    ["install", ["install", "--nope", "./dep"]],
    ["install", ["i", "--nope=./dep"]],
    ["install", ["ci", "--nope"]],
    ["install", ["--nope", "install"]],
    ["install", ["install", "./dep", "--nope"]],
    ["add", ["add", "--nope", "./dep"]],
    ["add", ["install", "-g", "--nope", "./dep"]],
    ["remove", ["remove", "--nope", "dep"]],
    ["update", ["update", "--nope", "0"]],
    ["link", ["link", "--nope", "dep"]],
    ["unlink", ["unlink", "--nope"]],
    ["patch", ["patch", "--nope", "dep"]],
    ["patch-commit", ["patch-commit", "--nope", "dep"]],
    ["outdated", ["outdated", "--nope"]],
    ["pm", ["pm", "ls", "--nope"]],
    ["pm", ["pm", "pkg", "set", "a=1", "--nope"]],
    ["pm", ["pm", "pack", "--nope"]],
    ["publish", ["publish", "--nope"]],
    ["audit", ["audit", "--nope"]],
    ["info", ["info", "--nope", "dep"]],
    ["why", ["why", "--nope", "dep"]],
    ["dedupe", ["dedupe", "--nope"]],
    ["prune", ["prune", "--nope"]],
  ])("is an error: %s %j", async (command, cmd) => {
    using dir = project();
    const { stdout, ...rest } = await bunIn(String(dir), cmd);
    // these two print their name before they read their arguments
    expect({ stdout: stdout.replace(/^bun (outdated|publish) v.*\n/, ""), ...rest }).toEqual(rejected(command));
    expect(await file(join(String(dir), "package.json")).text()).toBe(PACKAGE_JSON);
    expect((await readdirSorted(String(dir))).filter(name => !name.startsWith("."))).toEqual(["dep", "package.json"]);
  });

  it("is an error even if another command has it", async () => {
    using dir = project();
    expect(await bunIn(String(dir), ["install", "--latest"])).toEqual(rejected("install", "--latest"));
  });

  it("is skipped when it comes from BUN_OPTIONS", async () => {
    using dir = project();
    const { stdout, stderr, exitCode } = await bunIn(String(dir), ["add", "./dep"], {
      BUN_OPTIONS: "--nope --nope2=1",
    });
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("installed dep@dep");
    expect(exitCode).toBe(0);

    // the same flag, typed
    expect(await bunIn(String(dir), ["add", "--nope", "./dep"], { BUN_OPTIONS: "--nope" })).toEqual(rejected("add"));
  });

  it("is a package name after --", async () => {
    using dir = project();
    const { stderr, exitCode } = await bunIn(String(dir), ["remove", "--", "--nope"]);
    expect(stderr).not.toContain("has no --nope flag");
    expect(exitCode).toBe(0);
  });
});

// `bun --bun install` is a habit, not a typo. None of them takes a value, so none leaves one behind.
describe.concurrent("the flags of the runtime that take no value", () => {
  // These have no help text.
  const hidden = [
    "--trace-events-enabled",
    "--trace-env",
    "--trace-env-js-stack",
    "--trace-env-native-stack",
    "--trace-exit",
    "--expose-internals",
  ];
  // Flags that some of these commands have themselves, with a different meaning.
  const taken = ["--help", "--silent", "--prefer-offline", "--no-env-file", "--check", "--interactive"];
  // These flags and --use-system-ca are mutually exclusive.
  const exclusive = ["--use-openssl-ca", "--use-bundled-ca"];
  async function runtimeFlags() {
    const { stdout, exitCode } = await bunIn(import.meta.dir, ["--help"]);
    expect(exitCode).toBe(0);
    const listed = Array.from(stdout.matchAll(/^ +(?:-\w, )?(--[\w.-]+) {2,}\S/gm), match => match[1]);
    expect(listed).toContain("--bun");
    expect(listed).toContain("--smol");
    expect(listed).not.toContain("--cwd");
    return [...listed, ...hidden].filter(flag => !taken.includes(flag) && !exclusive.includes(flag));
  }
  const project = (dependencies?: Record<string, string>) =>
    tempDir("install-runtime-flags", {
      "package.json": JSON.stringify({ name: "foo", version: "0.0.1", dependencies }),
      "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    });
  async function outcome(dependencies: Record<string, string> | undefined, cmd: string[]) {
    using dir = project(dependencies);
    const { stdout, ...rest } = await bunIn(String(dir), cmd);
    return {
      stdout: stdout.replace(/\[[\d.]+m?s\]/g, "[time]"),
      ...rest,
      packageJson: await file(join(String(dir), "package.json")).json(),
      files: (await readdirSorted(String(dir))).filter(name => !name.startsWith(".")),
    };
  }

  const commands: [string, Record<string, string> | undefined, string[]][] = [
    ["install", { dep: "./dep" }, []],
    ["add", undefined, ["./dep"]],
    ["remove", { dep: "./dep" }, ["dep"]],
    ["update", { dep: "./dep" }, []],
  ];

  it.each(commands)("don't change what bun %s does", async (command, dependencies, args) => {
    const flags = await runtimeFlags();
    const plain = await outcome(dependencies, [command, ...args]);
    expect(plain.stderr).not.toContain("error:");
    expect(plain.exitCode).toBe(0);

    expect(await outcome(dependencies, [...flags, command, ...args])).toEqual(plain);
    expect(await outcome(dependencies, [command, ...flags, ...args])).toEqual(plain);
    expect(await outcome(dependencies, [command, ...args, ...flags])).toEqual(plain);
  });

  it.each(commands)("-b is --bun for bun %s", async (command, dependencies, args) => {
    const plain = await outcome(dependencies, [command, ...args]);
    expect(await outcome(dependencies, ["-b", command, ...args])).toEqual(plain);
    expect(await outcome(dependencies, [command, "-b", ...args])).toEqual(plain);
  });

  it("are errors with a value", async () => {
    using dir = project();
    const { stderr, exitCode } = await bunIn(String(dir), ["add", "--bun=./dep"]);
    expect(stderr).toBe("error: The argument '--bun' does not take a value.\n");
    expect(exitCode).toBe(1);
  });
});

// A line that was `npm ci --no-audit --no-fund` keeps working, and `--save-dev` does what it says.
describe.concurrent("the flags of npm, yarn and pnpm", () => {
  const groups = {
    dependencies: { dep: "./dep" },
    devDependencies: { dev: "./dev" },
    optionalDependencies: { opt: "./opt" },
  };
  async function outcome(cmd: string[], packageJson: object = groups, locked = false) {
    using dir = tempDir("install-foreign-flags", {
      "package.json": JSON.stringify({ name: "foo", version: "0.0.1", ...packageJson }),
      "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      "dev/package.json": JSON.stringify({ name: "dev", version: "1.0.0" }),
      "opt/package.json": JSON.stringify({ name: "opt", version: "1.0.0" }),
    });
    if (locked) expect((await bunIn(String(dir), ["install", "--lockfile-only"])).exitCode).toBe(0);
    const { stdout, ...rest } = await bunIn(String(dir), cmd);
    const modules = join(String(dir), "node_modules");
    return {
      stdout: stdout.replace(/\[[\d.]+m?s\]/g, "[time]"),
      ...rest,
      packageJson: await file(join(String(dir), "package.json")).json(),
      files: (await readdirSorted(String(dir))).filter(name => !name.startsWith(".")),
      installed: (await exists(modules)) ? (await readdirSorted(modules)).filter(name => !name.startsWith(".")) : [],
    };
  }

  it.each([
    ["--save-dev", "--dev", "devDependencies"],
    ["--save-optional", "--optional", "optionalDependencies"],
    ["--save-peer", "--peer", "peerDependencies"],
  ])("%s is %s", async (theirs, ours, group) => {
    for (const command of ["add", "install"]) {
      const result = await outcome([command, theirs, "./dep"], {});
      expect(result.packageJson).toEqual({ name: "foo", version: "0.0.1", [group]: { dep: "./dep" } });
      expect(result).toEqual(await outcome([command, ours, "./dep"], {}));
    }
  });

  it("--save-exact is --exact", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: request =>
        request.url.endsWith(".tgz")
          ? new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")))
          : Response.json({
              name: "bar",
              "dist-tags": { latest: "0.0.2" },
              versions: { "0.0.2": { name: "bar", version: "0.0.2", dist: { tarball: `${server.url}bar-0.0.2.tgz` } } },
            }),
    });
    const { packageJson, exitCode } = await outcome(["add", "--save-exact", `--registry=${server.url}`, "bar"], {});
    expect(packageJson).toEqual({ name: "foo", version: "0.0.1", dependencies: { bar: "0.0.2" } });
    expect(exitCode).toBe(0);
  });

  // The value is consumed in both forms. If it were left behind, it would be the name of a package to add.
  it.each([
    [["--no-optional"], ["--omit=optional"], ["dep", "dev"]],
    [["--ignore-optional"], ["--omit=optional"], ["dep", "dev"]],
    [["--only=production"], ["--omit=dev"], ["dep", "opt"]],
    [["--only", "production"], ["--omit=dev"], ["dep", "opt"]],
    [["--only=prod"], ["--omit=dev"], ["dep", "opt"]],
    [["--production=true"], ["--production"], ["dep", "opt"]],
    [["--package-lock-only"], ["--lockfile-only"], []],
    [["--immutable"], ["--frozen-lockfile"], ["dep", "dev", "opt"]],
    [["--shamefully-hoist"], ["--linker=hoisted"], ["dep", "dev", "opt"]],
    [["--node-linker=hoisted"], ["--linker=hoisted"], ["dep", "dev", "opt"]],
    [["--node-linker", "isolated"], ["--linker=isolated"], ["dep", "dev", "opt"]],
    [["--install-strategy=linked"], ["--linker=isolated"], ["dep", "dev", "opt"]],
    [["--progress=false"], ["--no-progress"], ["dep", "dev", "opt"]],
    [["--progress", "false"], ["--no-progress"], ["dep", "dev", "opt"]],
    [["--loglevel=silent"], ["--silent"], ["dep", "dev", "opt"]],
    [["--loglevel", "silent"], ["--silent"], ["dep", "dev", "opt"]],
    [["--loglevel=error"], ["--quiet"], ["dep", "dev", "opt"]],
    [["--loglevel", "warn"], ["--quiet"], ["dep", "dev", "opt"]],
  ])("bun install %j is %j", async (theirs, ours, installed) => {
    const result = await outcome(["install", ...theirs], groups, true);
    expect(result.stderr).not.toContain("error:");
    expect(result.installed).toEqual(installed);
    expect(result.exitCode).toBe(0);
    expect(result).toEqual(await outcome(["install", ...ours], groups, true));
  });

  it.each([[["--loglevel=verbose"]], [["--loglevel", "silly"]]])("bun install %j is --verbose", async theirs => {
    const { stderr, packageJson, exitCode } = await outcome(["install", ...theirs]);
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain("Clean lockfile: ");
    expect(packageJson).toEqual({ name: "foo", version: "0.0.1", ...groups });
    expect(exitCode).toBe(0);
  });

  const satisfied = [
    ["--no-audit"],
    ["--audit=false"],
    ["--audit", "false"],
    ["--no-fund"],
    ["--fund=false"],
    ["--no-update-notifier"],
    ["--update-notifier=false"],
    ["--legacy-peer-deps"],
    ["--ignore-engines"],
    ["--unsafe-perm"],
    ["--non-interactive"],
    ["--prefer-frozen-lockfile"],
    ["--loglevel=notice"],
    ["--loglevel", "http"],
    ["--loglevel=info"],
  ].flat();

  // Flags with no Bun equivalent. `dep` is a folder that could be installed, so these also check that the value of a
  // flag is skipped along with it.
  const ignored = [
    ["--ci"],
    ["--yes"],
    ["--no-color"],
    ["--color=always"],
    ["--no-package-lock"],
    ["--no-lockfile"],
    ["--pure-lockfile"],
    ["--no-frozen-lockfile"],
    ["--no-immutable"],
    ["--check-files"],
    ["--no-bin-links"],
    ["--foreground-scripts"],
    ["--strict-peer-dependencies"],
    ["--no-strict-peer-dependencies"],
    ["--prefer-dedupe"],
    ["--strict-ssl=false"],
    ["--include=dev"],
    ["--include", "dep"],
    ["--only=dev"],
    ["--network-timeout=100000"],
    ["--network-timeout", "dep"],
    ["--fetch-retries", "dep"],
    ["--reporter=append-only"],
    ["--cache", "dep"],
    ["--cache-folder=dep"],
    ["--store-dir", "dep"],
    ["--mutex", "dep"],
    ["--install-strategy=nested"],
    ["--loglevel=debug"],
    ["--fund", "false"],
    ["--yes", "true"],
    // The next flag isn't this option's value.
    ["--cache", "--no-progress"],
    // Bun 1.4 ignored these too, so scripts that pass them keep working.
    ["--prefix=dep"],
    ["--prefix", "dep"],
    ["--dir", "dep"],
    ["--workspace=dep"],
    ["--workspace", "dep"],
    ["--ws"],
    ["--workspace-root"],
    ["--include-workspace-root"],
    ["--save-catalog-name=tools"],
    ["--lockfile-dir", "dep"],
    ["--virtual-store-dir=dep"],
    ["--tag=next"],
    ["--userconfig=dep/.npmrc"],
    ["--userconfig", "dep"],
    ["--globalconfig=dep/.npmrc"],
    ["--npmrc-auth-file=dep/.npmrc"],
    ["--before=2026-01-01"],
    ["--min-release-age", "7"],
    ["--config.frozen-lockfile=true"],
    ["--config.ignore-scripts=true"],
    ["--allow-git=none"],
    ["--legacy-peer-deps=true"],
    ["--save-dev=false"],
    ["--no-ignore-scripts"],
    ["--no-offline"],
    ["--no-save-peer"],
    ["--no-cache-folder"],
    // Unlike `--noproxy`, this one has no value, so the package after it still counts.
    ["--no-proxy"],
  ].flat();

  it.each([
    ["install", groups, []],
    ["ci", groups, []],
    ["add", {}, ["./dep"]],
    ["remove", groups, ["dep"]],
    ["update", groups, []],
  ] as [string, object, string[]][])(
    "a flag for something that bun %s already does isn't an error",
    async (command, pkg, args) => {
      const plain = await outcome([command, ...args], pkg, true);
      expect(plain.stderr).not.toContain("error:");
      expect(plain.exitCode).toBe(0);

      expect(await outcome([command, ...satisfied, ...args], pkg, true)).toEqual(plain);
      expect(await outcome([command, ...args, ...satisfied], pkg, true)).toEqual(plain);
      expect(await outcome([command, ...ignored, ...args], pkg, true)).toEqual(plain);
      expect(await outcome([command, ...args, ...ignored], pkg, true)).toEqual(plain);
    },
  );

  // They say where a new dependency is saved.
  it.each([
    ["remove", ["dev"], ["--save-dev", "--save-exact", "--save-optional", "--save-peer"]],
    ["update", [], ["--save-dev", "--save-optional", "--save-peer"]],
  ] as [string, string[], string[]][])("bun %s, which saves none, takes %j with %j", async (command, args, flags) => {
    const plain = await outcome([command, ...args], groups, true);
    expect(plain.stderr).not.toContain("error:");
    expect(plain.exitCode).toBe(0);

    for (const flag of flags) expect(await outcome([command, flag, ...args], groups, true)).toEqual(plain);
  });

  // `bun update --dev` and `--production` choose what gets updated. npm's flags with those names don't.
  it.each([
    [[], { a: "^1.1.0", b: "^1.1.0", exitCode: 0 }],
    [["--dev"], { a: "^1.0.0", b: "^1.1.0", exitCode: 0 }],
    [["--save-dev"], { a: "^1.1.0", b: "^1.1.0", exitCode: 0 }],
    [["--production"], { a: "^1.1.0", b: "^1.0.0", exitCode: 0 }],
    [["--production=true"], { a: "^1.0.0", b: "^1.0.0", exitCode: 1 }],
    [["--save-exact"], { a: "1.1.0", b: "1.1.0", exitCode: 0 }],
  ] as [string[], object][])("bun update %j gives %j", async (flags, expected) => {
    using dir = tempDir("update-foreign-flags", {
      "package.json": JSON.stringify({ name: "foo", dependencies: { a: "^1.0.0" }, devDependencies: { b: "^1.0.0" } }),
    });
    const versions = ["1.0.0"];
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname.slice(1);
        if (path.endsWith(".tgz")) return new Response(file(join(String(dir), path)));
        return Response.json({
          name: path,
          "dist-tags": { latest: versions.at(-1) },
          versions: Object.fromEntries(
            versions.map(version => [
              version,
              { name: path, version, dist: { tarball: `${server.url}${path}-${version}.tgz` } },
            ]),
          ),
        });
      },
    });
    for (const name of ["a", "b"]) {
      for (const version of ["1.0.0", "1.1.0"]) {
        await Bun.Archive.write(
          join(String(dir), `${name}-${version}.tgz`),
          { "package/package.json": JSON.stringify({ name, version }) },
          { compress: "gzip" },
        );
      }
    }
    const registry = `--registry=${server.url}`;
    expect((await bunIn(String(dir), ["install", registry])).exitCode).toBe(0);
    versions.push("1.1.0");

    const { stderr, exitCode } = await bunIn(String(dir), ["update", "--no-cache", registry, ...flags]);
    if (exitCode) expect(stderr).toBe("error: The argument '--production' does not take a value.\n");
    const { dependencies, devDependencies } = await file(join(String(dir), "package.json")).json();
    expect({ ...dependencies, ...devDependencies, exitCode }).toEqual(expected);
  });

  it.each([
    [["pm", "ls", "--no-audit"], "pm", "--no-audit"],
    [["link", "--no-fund"], "link", "--no-fund"],
    [["install", "--frozen-lockfil"], "install", "--frozen-lockfil"],
    [["install", "--no-ignore-script"], "install", "--no-ignore-script"],
  ] as [string[], string, string][])("bun %j is still an error", async (cmd, command, flag) => {
    const { stderr, packageJson, exitCode } = await outcome(cmd);
    expect(stderr).toBe(
      `error: bun ${command} has no ${flag} flag.\nnote: Run 'bun ${command} --help' for more information\n`,
    );
    expect(packageJson).toEqual({ name: "foo", version: "0.0.1", ...groups });
    expect(exitCode).toBe(1);
  });
});

describe.concurrent.each([
  // `save = true` is the default, and does not turn the lockfile back on
  ["[install] dryRun = true", "[install]\ndryRun = true\n\n[install.lockfile]\nsave = true\n", []],
  ["--dry-run", "", ["--dry-run"]],
])("%s", (_, bunfig, flags) => {
  const PACKAGE_JSON = JSON.stringify({
    name: "x",
    version: "1.0.0",
    dependencies: { a: "file:./vend/a" },
    scripts: { preinstall: "echo ran > preinstall-ran", postinstall: "echo ran > postinstall-ran" },
  });

  it.each([
    ["install", ["install"], {}],
    ["install --yarn", ["install", "--yarn"], {}],
    ["install, BUN_CONFIG_SKIP_SAVE_LOCKFILE=0", ["install"], { BUN_CONFIG_SKIP_SAVE_LOCKFILE: "0" }],
    ["install, BUN_CONFIG_SKIP_INSTALL_PACKAGES=0", ["install"], { BUN_CONFIG_SKIP_INSTALL_PACKAGES: "0" }],
    ["add", ["add", "./vend/b"], {}],
    ["update", ["update"], {}],
    ["pm pack", ["pm", "pack"], {}],
  ])("%s writes nothing", async (_, cmd, extraEnv) => {
    using dir = tempDir("install-dry-run", {
      "vend/a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
      "vend/b/package.json": JSON.stringify({ name: "b", version: "1.0.0" }),
      "package.json": PACKAGE_JSON,
      "bunfig.toml": bunfig,
    });

    const { stderr, exitCode } = await bunIn(String(dir), [...cmd, ...flags], extraEnv);
    expect(stderr).not.toContain("error:");
    expect((await readdirSorted(String(dir))).filter(name => !name.startsWith("."))).toEqual([
      "bunfig.toml",
      "package.json",
      "vend",
    ]);
    expect(await file(join(String(dir), "package.json")).text()).toBe(PACKAGE_JSON);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("deprecated versions", () => {
  type Versions = Record<string, Record<string, unknown>>;
  // Only manifests, because `--lockfile-only` resolves without downloading tarballs.
  function serveManifests(packages: Record<string, Versions>, tags?: Record<string, string>) {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const name = decodeURIComponent(new URL(req.url).pathname.slice(1));
        requests.push(name);
        if (!packages[name]) return new Response("not found", { status: 404 });
        const versions = Object.fromEntries(
          Object.entries(packages[name]).map(([version, rest]) => [
            version,
            { name, version, dist: { tarball: `${server.url}${name}-${version}.tgz` }, ...rest },
          ]),
        );
        return Response.json({ name, "dist-tags": tags ?? { latest: Object.keys(versions).at(-1) }, versions });
      },
    });
    return { server, requests, [Symbol.dispose]: () => void server.stop(true) };
  }
  const project = (packageJson: object, files: Record<string, string> = {}) =>
    tempDir("install-deprecated", { "package.json": JSON.stringify({ name: "foo", ...packageJson }), ...files });
  async function resolve(dir: string, registry: { server: Bun.Server<undefined> }, ...cmd: string[]) {
    const { stderr, exitCode } = await bunIn(dir, [...(cmd.length ? cmd : ["install"]), "--lockfile-only"], {
      BUN_CONFIG_REGISTRY: registry.server.url.href,
    });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    return stderr
      .split("\n")
      .filter(line => line.startsWith("warn:"))
      .map(line => line.trimEnd());
  }

  const packages = {
    old: { "1.0.0": {}, "1.1.0": { deprecated: "use new" }, "2.0.0": {} },
    undeprecated: { "1.0.0": { deprecated: "" } },
    blank: { "1.0.0": { deprecated: "   " } },
    hostile: { "1.0.0": { deprecated: "a\x1b[2Kb\nwarn: c" } },
    sunos: { "1.0.0": { deprecated: "gone", os: ["sunos"] } },
    parent: { "1.0.0": { dependencies: { old: "~1.1.0", child: "1.0.0" } } },
    child: { "1.0.0": { deprecated: "unmaintained" } },
    // one sentence for a run of versions, another one after it
    many: Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `1.0.${i}`,
        { deprecated: i < 30 ? "every 1.0.x below 30 has the bug" : "and these have another one" },
      ]),
    ),
  };

  it("a direct dependency gets a line with the message", async () => {
    using registry = serveManifests(packages);
    using dir = project({
      dependencies: { old: "~1.1.0", undeprecated: "1.0.0", blank: "1.0.0" },
      devDependencies: { hostile: "1.0.0" },
      optionalDependencies: { sunos: "1.0.0" },
    });
    expect((await resolve(String(dir), registry)).sort()).toEqual([
      "warn: deprecated blank@1.0.0:",
      "warn: deprecated hostile@1.0.0: a\\x1b[2Kb\\nwarn: c",
      "warn: deprecated old@1.1.0: use new",
    ]);
    // bun.lock has the versions now, so nothing is resolved.
    expect(await resolve(String(dir), registry)).toEqual([]);
  });

  it("the dependencies of dependencies are only reported with --verbose", async () => {
    using registry = serveManifests(packages);
    using dir = project({ dependencies: { parent: "1.0.0" } });
    expect(await resolve(String(dir), registry)).toEqual([]);

    await rm(join(String(dir), "bun.lock"));
    expect((await resolve(String(dir), registry, "install", "--verbose")).sort()).toEqual([
      "warn: deprecated child@1.0.0: unmaintained",
      "warn: deprecated old@1.1.0: use new",
    ]);
  });

  it("a version is reported once, as direct when a package.json of the project names it", async () => {
    using registry = serveManifests(packages);
    using dir = project(
      { workspaces: ["packages/*"], dependencies: { parent: "1.0.0" } },
      {
        "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { old: "1.1.0" } }),
        "packages/b/package.json": JSON.stringify({ name: "b", dependencies: { old: "1.1.0" } }),
      },
    );
    expect(await resolve(String(dir), registry)).toEqual(["warn: deprecated old@1.1.0: use new"]);
  });

  it("bun add and bun update report what they resolve", async () => {
    using registry = serveManifests(packages);
    using dir = project({ dependencies: { old: "1.0.0" } });
    expect(await resolve(String(dir), registry)).toEqual([]);
    expect(await resolve(String(dir), registry, "add", "child")).toEqual([
      "warn: deprecated child@1.0.0: unmaintained",
    ]);
    await write(
      join(String(dir), "package.json"),
      JSON.stringify({ name: "foo", dependencies: { old: "~1.0.0 || ~1.1.0" } }),
    );
    expect(await resolve(String(dir), registry, "update")).toEqual([]);
    await write(join(String(dir), "package.json"), JSON.stringify({ name: "foo", dependencies: { old: "~1.1.0" } }));
    expect(await resolve(String(dir), registry, "update")).toEqual(["warn: deprecated old@1.1.0: use new"]);
  });

  it("--silent prints nothing", async () => {
    using registry = serveManifests(packages);
    using dir = project({ dependencies: { old: "1.1.0", parent: "1.0.0" } });
    expect(
      await bunIn(String(dir), ["install", "--lockfile-only", "--silent"], {
        BUN_CONFIG_REGISTRY: registry.server.url.href,
      }),
    ).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("the message survives the manifest cache", async () => {
    using registry = serveManifests(packages);
    using dir = project({ dependencies: { many: "1.0.3", old: "1.1.0" } });
    const first = [
      "warn: deprecated many@1.0.3: every 1.0.x below 30 has the bug",
      "warn: deprecated old@1.1.0: use new",
    ];
    expect((await resolve(String(dir), registry)).sort()).toEqual(first);
    // The cache is written in the background. Until both manifests are in it, an install requests them from the
    // registry again.
    for (let attempt = 0; ; attempt++) {
      const cached = (await readdirSorted(join(String(dir), ".cache"))).filter(name => name.endsWith(".npm"));
      if (cached.length === 2) break;
      if (attempt === 20) throw new Error("the manifests were never cached");
      await rm(join(String(dir), "bun.lock"));
      await resolve(String(dir), registry);
    }

    for (const [version, message] of [
      ["1.0.3", "every 1.0.x below 30 has the bug"],
      ["1.0.29", "every 1.0.x below 30 has the bug"],
      ["1.0.30", "and these have another one"],
      ["1.0.39", "and these have another one"],
    ]) {
      await rm(join(String(dir), "bun.lock"));
      await write(join(String(dir), "package.json"), JSON.stringify({ name: "foo", dependencies: { many: version } }));
      const before = registry.requests.length;
      expect(await resolve(String(dir), registry, "install", "--offline")).toEqual([
        `warn: deprecated many@${version}: ${message}`,
      ]);
      expect(registry.requests.length).toBe(before);
    }
  });

  /** The version of `dep` in bun.lock; null when the command failed. */
  async function picked(dir: string, registry: { server: Bun.Server<undefined> }, ...cmd: string[]) {
    const { exitCode } = await bunIn(dir, [...cmd, "--lockfile-only"], {
      BUN_CONFIG_REGISTRY: registry.server.url.href,
    });
    return exitCode ? null : (await file(join(dir, "bun.lock")).text()).match(/\["dep@([^"]+)"/)![1];
  }
  const D = { deprecated: "old" };
  const nightly = "4.6.0-nightly.1";

  // The expected values are what npm-pick-manifest 11.0.3 picks, except that it refuses an explicit `latest` that
  // doesn't point to a version.
  it.each<[string, Versions, Record<string, string>, Record<string, string | null>]>([
    [
      "the newest versions are stubs, like @types/* once the package ships its own types",
      { "0.5.3": {}, "2.0.2": D, "2.0.3": D },
      { latest: "2.0.3" },
      {
        "*": "0.5.3",
        "": "0.5.3",
        ">=0.0.0": "0.5.3",
        "npm:dep": "0.5.3",
        "npm:dep@*": "0.5.3",
        "^2.0.0": "2.0.3",
        "2.0.2": "2.0.2",
        latest: "2.0.3",
        "npm:dep@latest": "2.0.3",
      },
    ],
    [
      "the highest match is deprecated",
      { "1.0.0": {}, "1.1.0": D, "2.0.0": {} },
      { latest: "2.0.0" },
      {
        "^1.0.0": "1.0.0",
        "1.x": "1.0.0",
        ">=1.0.0 <2.0.0": "1.0.0",
        "~1.1.0": "1.1.0",
        "1.1.0": "1.1.0",
        "*": "2.0.0",
      },
    ],
    ["every match is deprecated", { "1.0.0": D, "1.1.0": D, "2.0.0": {} }, { latest: "2.0.0" }, { "^1.0.0": "1.1.0" }],
    [
      "every version is deprecated",
      { "1.0.0": D, "2.0.0": D },
      { latest: "1.0.0" },
      { "*": "2.0.0", "": "2.0.0", latest: "1.0.0" },
    ],
    [
      "a deprecated placeholder is all there is",
      { "0.0.0-beta.0": D },
      { latest: "0.0.0-beta.0" },
      { "*": null, "": null, latest: "0.0.0-beta.0" },
    ],
    [
      "true counts, the empty string of `npm undeprecate` does not",
      { "1.0.0": {}, "1.1.0": { deprecated: "" }, "1.2.0": { deprecated: true } },
      { latest: "1.2.0" },
      { "*": "1.1.0", "^1.0.0": "1.1.0" },
    ],
    [
      "a range that names a prerelease",
      { "1.0.0-rc.1": {}, "1.0.0-rc.2": D, "1.0.0": D },
      { latest: "1.0.0" },
      { "^1.0.0-rc.0": "1.0.0-rc.1", "^1.0.0": "1.0.0" },
    ],
    [
      "latest is a prerelease",
      { "0.0.1": {}, [nightly]: {} },
      { latest: nightly },
      {
        "*": nightly,
        "": nightly,
        "npm:dep": nightly,
        "npm:dep@*": nightly,
        latest: nightly,
        x: "0.0.1",
        ">=0.0.0": "0.0.1",
        "* || 1": "0.0.1",
      },
    ],
    [
      "latest is a deprecated prerelease",
      { "0.0.1": {}, [nightly]: D },
      { latest: nightly },
      { "*": "0.0.1", "": "0.0.1", "npm:dep": "0.0.1", latest: nightly },
    ],
    [
      "there are only prereleases",
      { "1.0.0-a.1": {}, "1.0.0-a.2": {} },
      { latest: "1.0.0-a.1" },
      { "*": "1.0.0-a.1", "": "1.0.0-a.1", "npm:dep": "1.0.0-a.1", x: null },
    ],
    [
      "no dist-tags",
      { "1.0.0": {}, "2.0.0": {}, "3.0.0-rc.1": {} },
      {},
      { "*": "2.0.0", "": "2.0.0", latest: "2.0.0", beta: null },
    ],
    [
      "latest names a version that is not there",
      { "1.0.0": {}, "2.0.0": D },
      { latest: "9.9.9" },
      { "*": "1.0.0", "": "1.0.0", latest: "1.0.0", "npm:dep@latest": "1.0.0" },
    ],
    ["no dist-tags and only prereleases", { "3.0.0-rc.1": {} }, {}, { "*": null, "": null, latest: null }],
  ])("%s", async (_, versions, tags, expected) => {
    using registry = serveManifests({ dep: versions }, tags);
    const entries = await Promise.all(
      Object.keys(expected).map(async spec => {
        using dir = project({ dependencies: { [spec.startsWith("npm:") ? "alias" : "dep"]: spec } });
        return [spec, await picked(String(dir), registry, "install")];
      }),
    );
    expect(Object.fromEntries(entries)).toEqual(expected);
  });

  it.each<[string[], Versions, Record<string, string>, string | null, object]>([
    [["add", "dep"], { "1.0.0": {}, "2.0.0": D }, { latest: "2.0.0" }, "1.0.0", { dep: "^1.0.0" }],
    [["add", "dep@latest"], { "1.0.0": {}, "2.0.0": D }, { latest: "2.0.0" }, "2.0.0", { dep: "^2.0.0" }],
    [["add", "dep"], { "0.0.0-beta.0": D }, { latest: "0.0.0-beta.0" }, null, {}],
    [["add", "dep"], { "1.0.0": {}, "2.0.0": {} }, {}, "2.0.0", { dep: "^2.0.0" }],
  ])("bun %j of %j %j", async (cmd, versions, tags, version, dependencies) => {
    using registry = serveManifests({ dep: versions }, tags);
    using dir = project({ dependencies: {} });
    expect(await picked(String(dir), registry, ...cmd)).toBe(version);
    expect(await file(join(String(dir), "package.json")).json()).toEqual({ name: "foo", dependencies });
  });

  it.each<[string, Record<string, string>]>([
    ["names a version that is not there", { latest: "9.9.9" }],
    ["is missing", {}],
  ])("bun outdated lists a package whose latest %s", async (_, tags) => {
    using registry = serveManifests({ dep: { "1.0.0": {}, "1.1.0": {}, "2.0.0": {}, "3.0.0-rc.1": {} } }, tags);
    using dir = project({ dependencies: { dep: "~1.0.0" } });
    expect(await picked(String(dir), registry, "install")).toBe("1.0.0");
    const { stdout, exitCode } = await bunIn(String(dir), ["outdated"], {
      BUN_CONFIG_REGISTRY: registry.server.url.href,
    });
    expect(stdout.split("\n").flatMap(line => (line.includes("dep") ? [line.match(/[\w.-]+/g)] : []))).toEqual([
      ["dep", "1.0.0", "1.0.0", "2.0.0"],
    ]);
    expect(exitCode).toBe(0);
  });

  it("a version in bun.lock is kept when it gets deprecated, until bun update", async () => {
    const versions: Versions = { "1.0.0": {}, "1.1.0": {} };
    using registry = serveManifests({ dep: versions });
    using dir = project({ dependencies: { dep: "^1.0.0" } });
    expect(await picked(String(dir), registry, "install")).toBe("1.1.0");

    versions["1.1.0"] = D;
    await rm(join(String(dir), ".cache"), { recursive: true, force: true });
    registry.requests.length = 0;
    expect(await picked(String(dir), registry, "install")).toBe("1.1.0");
    expect(await picked(String(dir), registry, "install", "--frozen-lockfile")).toBe("1.1.0");
    expect(registry.requests).toEqual([]);
    expect(await picked(String(dir), registry, "update")).toBe("1.0.0");
  });
});

// `sshlatest` used to be handed to `git clone`, and `httplatest` was downloaded as a tarball.
it.concurrent("a word that starts with ssh or http is not a URL", async () => {
  const words = ["sshlatest", "httplatest", "httpslatest", "ssh", "http", "https"];
  const tarball = file(join(import.meta.dir, "baz-0.0.3.tgz"));
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      if (request.url.endsWith(".tgz")) return new Response(tarball);
      return Response.json({
        name: "baz",
        versions: { "0.0.3": { name: "baz", version: "0.0.3", dist: { tarball: `${server.url}baz-0.0.3.tgz` } } },
        "dist-tags": { latest: "0.0.3", ...Object.fromEntries(words.map(word => [word, "0.0.3"])) },
      });
    },
  });
  using dir = tempDir("install-word-not-url", {
    "package.json": JSON.stringify({
      name: "foo",
      dependencies: {
        baz: words[0],
        ...Object.fromEntries(words.slice(1).map(word => [`tag-${word}`, `npm:baz@${word}`])),
        url: `${server.url}url.tgz`,
        "file-ssh": "ssh.tar.gz",
        "file-http": "http.tar.gz",
      },
    }),
    "ssh.tar.gz": await tarball.bytes(),
    "http.tar.gz": await tarball.bytes(),
  });
  const { stderr, exitCode } = await bunIn(String(dir), ["install", "--lockfile-only"], {
    BUN_CONFIG_REGISTRY: server.url.href,
  });
  expect(stderr).not.toContain("error:");
  const { packages } = Bun.JSONC.parse(await file(join(String(dir), "bun.lock")).text()) as {
    packages: Record<string, [string]>;
  };
  expect(Object.fromEntries(Object.entries(packages).map(([name, [resolution]]) => [name, resolution]))).toEqual({
    baz: "baz@0.0.3",
    ...Object.fromEntries(words.slice(1).map(word => [`tag-${word}`, "baz@0.0.3"])),
    url: `baz@${server.url}url.tgz`,
    "file-ssh": "baz@ssh.tar.gz",
    "file-http": "baz@http.tar.gz",
  });
  expect(exitCode).toBe(0);
});

// `npm publish` from a monorepo creates this shape (exrs@1.0.3, vellum@0.12.2): the path leaves the package, and the
// tarball ships the copy in its node_modules. That copy is the dependency. The path is recorded but never followed.
describe.concurrent.each(["hoisted", "isolated"])(
  "a registry package's file: dependency with a path that leaves the package, %s linker",
  linker => {
    type Published = { json: Record<string, any>; files?: Record<string, string> };
    async function serve(...packages: Published[]) {
      const tarballs = new Map<string, Uint8Array>();
      for (const { json, files } of packages) {
        const archive = new Bun.Archive(
          { "package/package.json": JSON.stringify(json), ...files },
          { compress: "gzip" },
        );
        tarballs.set(`/${json.name}-${json.version}.tgz`, await archive.bytes());
      }
      return Bun.serve({
        port: 0,
        fetch(request) {
          const { origin, pathname } = new URL(request.url);
          const tarball = tarballs.get(pathname);
          if (tarball) return new Response(tarball);
          const versions = packages.filter(({ json }) => `/${json.name}` === pathname);
          if (versions.length === 0) return new Response("not found", { status: 404 });
          return Response.json({
            name: versions[0].json.name,
            "dist-tags": { latest: versions.at(-1)!.json.version },
            versions: Object.fromEntries(
              versions.map(({ json }) => [
                json.version,
                { ...json, dist: { tarball: `${origin}/${json.name}-${json.version}.tgz` } },
              ]),
            ),
          });
        },
      });
    }
    // `../inner`, seen from the project and from node_modules/outer, is a directory that is not the dependency.
    const project = (registry: string, dependencies: object) =>
      tempDir("install-bundled-file-outside", {
        "inner/package.json": JSON.stringify({ name: "inner", version: "9.9.9" }),
        "inner/outside.txt": "outside the project",
        "project/package.json": JSON.stringify({ name: "app", dependencies }),
        "project/bunfig.toml": `[install]\nregistry = "${registry}"\nlinker = "${linker}"\n`,
      });
    const errors = (stderr: string) => stderr.split(/\r?\n/).filter(line => line.startsWith("error:"));
    const outside = (cwd: string) => [...new Bun.Glob("**/outside.txt").scanSync({ cwd, dot: true, onlyFiles: false })];
    const bundledCopy = {
      "package/index.js": `module.exports = require("inner/package.json").version;`,
      "package/node_modules/inner/package.json": JSON.stringify({ name: "inner", version: "1.0.0" }),
    };

    it.each([
      ["dependencies only", {}],
      // the bundled name is in `dependencies`, and the later group does not drop its flag
      ["optionalDependencies too", { optionalDependencies: { leaf: "1.0.0" } }],
    ])("installs when the dependency is bundled, %s", async (_, more) => {
      const outer = { name: "outer", version: "1.0.0", dependencies: { inner: "file:../inner" }, ...more };
      await using server = await serve(
        { json: { ...outer, bundleDependencies: ["inner"] }, files: bundledCopy },
        { json: { name: "leaf", version: "1.0.0" } },
      );
      using dir = project(server.url.href, { outer: "1.0.0" });
      const cwd = join(String(dir), "project");

      const check = async (...args: string[]) => {
        const { stderr, exitCode } = await bunIn(cwd, ["install", ...args]);
        expect(errors(stderr)).toEqual([]);
        expect(exitCode).toBe(0);
        expect(await bunIn(cwd, ["-p", `require("outer")`])).toEqual({ stdout: "1.0.0\n", stderr: "", exitCode: 0 });
        expect(outside(cwd)).toEqual([]);
        return file(join(cwd, "bun.lock")).text();
      };
      const lockfile = await check();
      expect(lockfile).toContain(`"outer/inner": ["inner@file:../inner", { "bundled": true }],`);
      await rm(join(cwd, "node_modules"), { recursive: true, force: true });
      expect(await check("--frozen-lockfile")).toBe(lockfile);
    });

    it("is refused when the dependency is not bundled", async () => {
      await using server = await serve({
        json: { name: "outer", version: "1.0.0", dependencies: { inner: "file:../inner" } },
        files: bundledCopy,
      });
      using dir = project(server.url.href, { outer: "1.0.0" });
      const cwd = join(String(dir), "project");
      const { stderr, exitCode } = await bunIn(cwd, ["install"]);
      expect(errors(stderr)).toEqual([
        `error: package.json not found for "file:../inner" dependency "inner"`,
        "error: inner@file:../inner failed to resolve",
      ]);
      expect(outside(cwd)).toEqual([]);
      expect(await exists(join(cwd, "bun.lock"))).toBe(false);
      expect(exitCode).toBe(1);
    });

    // mid@1.0.0 is nested next to the bundled "inner" and has an optional peer on it, so the hoister binds that peer
    // to the package that holds the recorded path.
    it("the recorded path is not followed for another dependent", async () => {
      await using server = await serve(
        {
          json: {
            name: "outer",
            version: "1.0.0",
            dependencies: { inner: "file:../inner", mid: "1.0.0" },
            bundleDependencies: ["inner"],
          },
          files: bundledCopy,
        },
        {
          json: {
            name: "mid",
            version: "1.0.0",
            peerDependencies: { inner: "*" },
            peerDependenciesMeta: { inner: { optional: true } },
          },
        },
        // The root depends on this one, so mid@1.0.0 stays nested under "outer".
        { json: { name: "mid", version: "2.0.0" } },
      );
      using dir = project(server.url.href, { outer: "1.0.0", mid: "2.0.0" });
      const cwd = join(String(dir), "project");
      const { stderr, exitCode } = await bunIn(cwd, ["install"]);
      // Nothing is installed for the peer. In the hoisted tree, the copy that "outer" ships is next to mid@1.0.0, which
      // loads it. In the store, the folder is private to "outer", and the optional peer stays unlinked.
      expect(errors(stderr)).toEqual([]);
      expect(outside(cwd)).toEqual([]);
      expect(exitCode).toBe(0);
      if (linker === "hoisted") {
        expect(await readdirSorted(join(cwd, "node_modules", "outer", "node_modules"))).toEqual(["inner", "mid"]);
        expect(await readdirSorted(join(cwd, "node_modules"))).toEqual(["mid", "outer"]);
      }
    });
  },
);

// `overrides` and `resolutions` values are passed to the resolver unchanged.
it.concurrent.each(["resolutions", "overrides"])(
  'fails with ENAMETOOLONG for a file: path in root package.json "%s" that is longer than the path buffer',
  async field => {
    using dir = tempDir("override-file-dep-too-long", {
      "package.json": JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        dependencies: { dep: "1.0.0" },
        [field]: { dep: "file:./" + Buffer.alloc(MAX_PATH_BYTES + 1000, "a").toString() },
      }),
    });

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(err).toContain("error: ENAMETOOLONG");
    expect(err).toContain("failed to resolve");
    expect(exitCode).toBe(1);
  },
);

it.concurrent("doesn't install a bun.lock folder package whose path is longer than the path buffer", async () => {
  using dir = tempDir("lockfile-folder-too-long", {
    "package.json": JSON.stringify({ name: "foo", version: "1.0.0", dependencies: { okpkg: "file:./okpkg" } }),
    "okpkg/package.json": JSON.stringify({ name: "okpkg", version: "1.0.0" }),
    "bun.lock": JSON.stringify({
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: { "": { name: "foo", dependencies: { okpkg: "file:./okpkg" } } },
      packages: { okpkg: [`okpkg@file:${Buffer.alloc(MAX_PATH_BYTES + 1000, "a").toString()}`, {}] },
    }),
  });

  await using proc = spawn({
    cmd: [bunExe(), "install", "--linker", "hoisted"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(err).toContain("ENAMETOOLONG: folder path for package okpkg is too long");
  expect(out).not.toContain("1 package installed");
  expect(exitCode).toBe(1);
});
