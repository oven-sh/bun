// https://github.com/oven-sh/bun/issues/11548
// https://github.com/oven-sh/bun/issues/18947
// https://github.com/oven-sh/bun/issues/13769
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { rm } from "node:fs/promises";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

function gitEnv(root: string): Env {
  return {
    ...bunEnv,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(root, "empty.gitconfig"),
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function git(env: Env, cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: ["git", ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout.trim();
}

async function writeDep(upstream: string, version: string) {
  await Bun.write(join(upstream, "package.json"), JSON.stringify({ name: "dep", version }));
  await Bun.write(join(upstream, "index.js"), `module.exports = '${version}';`);
}

async function makeUpstream(root: string, env: Env) {
  const upstream = join(root, "upstream");
  const serve = join(root, "serve.git");

  await Bun.write(join(root, "empty.gitconfig"), "");
  await git(env, root, "init", "-q", "-b", "main", upstream);
  await git(env, upstream, "config", "user.email", "test@bun.sh");
  await git(env, upstream, "config", "user.name", "test");

  await writeDep(upstream, "1.0.0");
  await git(env, upstream, "add", "-A");
  await git(env, upstream, "commit", "-q", "-m", "v1.0.0");
  await git(env, upstream, "tag", "v1.0.0");

  // Bare repo that the HTTP server exposes via git's dumb protocol.
  await git(env, root, "clone", "-q", "--bare", upstream, serve);
  await git(env, serve, "update-server-info");

  return { upstream, serve };
}

// Commits `version` upstream and publishes only the named refs to the served
// repo, so a tag-only publish leaves the served branch heads where they were.
async function publishRef(
  env: Env,
  upstream: string,
  serve: string,
  version: string,
  ref: { tag?: string; branch?: string },
) {
  await writeDep(upstream, version);
  await git(env, upstream, "add", "-A");
  await git(env, upstream, "commit", "-q", "-m", `v${version}`);
  if (ref.tag) {
    await git(env, upstream, "tag", "-f", ref.tag);
    await git(env, serve, "fetch", "-fq", upstream, `+refs/tags/${ref.tag}:refs/tags/${ref.tag}`);
  }
  if (ref.branch) {
    await git(env, serve, "fetch", "-q", upstream, `+HEAD:refs/heads/${ref.branch}`);
  }
  await git(env, serve, "update-server-info");
  return git(env, upstream, "rev-parse", "HEAD");
}

function serveGit(serve: string) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      // Git's smart-HTTP probe appends ?service=git-upload-pack; serving the
      // plain info/refs body with a text content-type makes the client fall
      // back to the dumb protocol.
      const rel = url.pathname.replace(/^\/repo\.git\//, "");
      const file = Bun.file(join(serve, rel));
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file, { headers: { "Content-Type": "text/plain" } });
    },
  });
}

function writeApp(app: string, dependencies?: Record<string, string>) {
  return Bun.write(join(app, "package.json"), JSON.stringify({ name: "app", version: "0.0.0", dependencies }));
}

// `committish` is appended to the served repo's URL; omit it to start from a
// package.json with no dependencies and `bun add` one later.
async function setup(root: string, committish?: string) {
  const env = gitEnv(root);
  const { upstream, serve } = await makeUpstream(root, env);
  const server = serveGit(serve);
  const repoUrl = `git+http://127.0.0.1:${server.port}/repo.git`;
  const app = join(root, "app");
  const cache = join(root, "cache");
  await writeApp(app, committish === undefined ? undefined : { dep: repoUrl + committish });
  return { env, upstream, serve, server, repoUrl, app, cache };
}

async function runBun(cwd: string, cache: string, env: Env, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args, "--no-progress"],
    cwd,
    env: { ...env, BUN_INSTALL_CACHE_DIR: cache },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function installedVersion(app: string) {
  return Bun.file(join(app, "node_modules", "dep", "index.js")).text();
}

function lockfile(app: string) {
  return Bun.file(join(app, "bun.lock")).text();
}

const timeout = 60_000;

describe("bun install refreshes cached git dependencies", () => {
  test.concurrent(
    "picks up a tag pushed after the repo was first cached",
    async () => {
      using root = tempDir("git-tag-refresh", {});
      const { env, upstream, serve, server, repoUrl, app, cache } = await setup(String(root), "#v1.0.0");
      await using _server = server;

      {
        const { stdout, stderr, exitCode } = await runBun(app, cache, env, "install");
        expect(stderr).not.toContain("no commit matching");
        expect(stdout).toContain("+ dep@");
        expect(exitCode).toBe(0);
        expect(await installedVersion(app)).toContain("1.0.0");
      }

      await publishRef(env, upstream, serve, "1.0.1", { tag: "v1.0.1" });
      await writeApp(app, { dep: `${repoUrl}#v1.0.1` });

      const { stdout, stderr, exitCode } = await runBun(app, cache, env, "install");
      expect(stderr).not.toContain("no commit matching");
      expect(stderr).not.toContain("error:");
      expect(stdout).toContain("+ dep@");
      expect(exitCode).toBe(0);
      expect(await installedVersion(app)).toContain("1.0.1");
    },
    timeout,
  );

  test.concurrent(
    "picks up a branch created after the repo was first cached",
    async () => {
      using root = tempDir("git-branch-refresh", {});
      const { env, upstream, serve, server, repoUrl, app, cache } = await setup(String(root), "#v1.0.0");
      await using _server = server;

      {
        const { stderr, exitCode } = await runBun(app, cache, env, "install");
        expect(stderr).not.toContain("no commit matching");
        expect(exitCode).toBe(0);
      }

      await publishRef(env, upstream, serve, "2.0.0", { branch: "release-2" });
      await writeApp(app, { dep: `${repoUrl}#release-2` });

      const { stderr, exitCode } = await runBun(app, cache, env, "install");
      expect(stderr).not.toContain("no commit matching");
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await installedVersion(app)).toContain("2.0.0");
    },
    timeout,
  );

  test.concurrent(
    "re-fetches a tag that was force-moved upstream",
    async () => {
      using root = tempDir("git-retag-refresh", {});
      const { env, upstream, serve, server, app, cache } = await setup(String(root), "#v1.0.0");
      await using _server = server;

      {
        const { stderr, exitCode } = await runBun(app, cache, env, "install");
        expect(stderr).not.toContain("error:");
        expect(exitCode).toBe(0);
        expect(await installedVersion(app)).toContain("1.0.0");
      }

      // Move v1.0.0 to a new commit upstream and drop the lockfile so the
      // committish is re-resolved against the refreshed cache.
      await publishRef(env, upstream, serve, "1.0.0-patched", { tag: "v1.0.0" });
      await rm(join(app, "bun.lock"), { force: true });
      await rm(join(app, "node_modules"), { recursive: true, force: true });

      const { stderr, exitCode } = await runBun(app, cache, env, "install");
      expect(stderr).not.toContain('"git fetch"');
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await installedVersion(app)).toContain("1.0.0-patched");
    },
    timeout,
  );

  test.concurrent(
    "keeps the lockfile pin after the cache is refreshed to a newer branch tip",
    async () => {
      using root = tempDir("git-install-pin", {});
      const { env, upstream, serve, server, repoUrl, app, cache } = await setup(String(root));
      await using _server = server;

      {
        const { stderr, exitCode } = await runBun(app, cache, env, "add", repoUrl);
        expect(stderr).not.toContain("error:");
        expect(exitCode).toBe(0);
        expect(await installedVersion(app)).toContain("1.0.0");
      }

      await publishRef(env, upstream, serve, "1.0.1", { branch: "main" });

      // Keep the bare clone but drop node_modules and the per-commit
      // checkouts, so this install refreshes the clone and then has to check
      // out the commit the lockfile records rather than the new tip.
      await rm(join(app, "node_modules"), { recursive: true, force: true });
      for await (const entry of new Bun.Glob("@G@*").scan({ cwd: cache, onlyFiles: false })) {
        await rm(join(cache, entry), { recursive: true, force: true });
      }

      const lockBefore = await lockfile(app);
      const { stderr, exitCode } = await runBun(app, cache, env, "install");
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await installedVersion(app)).toContain("1.0.0");
      expect(await lockfile(app)).toBe(lockBefore);
    },
    timeout,
  );
});

describe("bun update re-resolves git dependencies against the refreshed cache", () => {
  test.concurrent(
    "moves a dependency without a committish to the new remote HEAD",
    async () => {
      using root = tempDir("git-update-head", {});
      const { env, upstream, serve, server, repoUrl, app, cache } = await setup(String(root));
      await using _server = server;

      {
        const { stderr, exitCode } = await runBun(app, cache, env, "add", repoUrl);
        expect(stderr).not.toContain("error:");
        expect(exitCode).toBe(0);
        expect(await installedVersion(app)).toContain("1.0.0");
      }

      const sha = await publishRef(env, upstream, serve, "1.0.1", { branch: "main" });

      const { stdout, stderr, exitCode } = await runBun(app, cache, env, "update");
      expect(stderr).not.toContain("error:");
      expect(stdout).not.toContain("no changes");
      expect(exitCode).toBe(0);
      expect(await installedVersion(app)).toContain("1.0.1");
      expect(await lockfile(app)).toContain(sha);
    },
    timeout,
  );

  test.concurrent(
    "`bun update <name>` moves a branch dependency to the branch tip",
    async () => {
      using root = tempDir("git-update-branch", {});
      const { env, upstream, serve, server, repoUrl, app, cache } = await setup(String(root));
      await using _server = server;

      {
        const { stderr, exitCode } = await runBun(app, cache, env, "add", `${repoUrl}#main`);
        expect(stderr).not.toContain("error:");
        expect(exitCode).toBe(0);
        expect(await installedVersion(app)).toContain("1.0.0");
      }

      await publishRef(env, upstream, serve, "1.0.1", { branch: "main" });

      const { stderr, exitCode } = await runBun(app, cache, env, "update", "dep");
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await installedVersion(app)).toContain("1.0.1");
    },
    timeout,
  );

  test.concurrent(
    "leaves the lockfile alone when the remote has not changed",
    async () => {
      using root = tempDir("git-update-noop", {});
      const { env, server, repoUrl, app, cache } = await setup(String(root));
      await using _server = server;

      {
        const { stderr, exitCode } = await runBun(app, cache, env, "add", repoUrl);
        expect(stderr).not.toContain("error:");
        expect(exitCode).toBe(0);
        expect(await installedVersion(app)).toContain("1.0.0");
      }

      const lockBefore = await lockfile(app);
      const { stderr, exitCode } = await runBun(app, cache, env, "update");
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await installedVersion(app)).toContain("1.0.0");
      expect(await lockfile(app)).toBe(lockBefore);
    },
    timeout,
  );
});
