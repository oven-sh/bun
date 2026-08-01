// https://github.com/oven-sh/bun/issues/11548
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { rm } from "node:fs/promises";
import { join } from "node:path";

describe("bun install refreshes cached git dependencies", () => {
  function gitEnv(root: string) {
    return {
      ...bunEnv,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(root, "empty.gitconfig"),
      GIT_TERMINAL_PROMPT: "0",
    };
  }

  async function git(env: Record<string, string | undefined>, cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({ cmd: ["git", ...args], cwd, env, stdout: "ignore", stderr: "pipe" });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }

  async function makeUpstream(root: string, env: Record<string, string | undefined>) {
    const upstream = join(root, "upstream");
    const serve = join(root, "serve.git");

    await Bun.write(join(root, "empty.gitconfig"), "");
    await git(env, root, "init", "-q", upstream);
    await git(env, upstream, "config", "user.email", "test@bun.sh");
    await git(env, upstream, "config", "user.name", "test");

    await Bun.write(join(upstream, "package.json"), JSON.stringify({ name: "dep", version: "1.0.0" }));
    await Bun.write(join(upstream, "index.js"), "module.exports = '1.0.0';");
    await git(env, upstream, "add", "-A");
    await git(env, upstream, "commit", "-q", "-m", "v1.0.0");
    await git(env, upstream, "tag", "v1.0.0");

    // Bare repo that the HTTP server exposes via git's dumb protocol.
    await git(env, root, "clone", "-q", "--bare", upstream, serve);
    await git(env, serve, "update-server-info");

    return { upstream, serve };
  }

  async function publishRef(
    env: Record<string, string | undefined>,
    upstream: string,
    serve: string,
    version: string,
    ref: { tag?: string; branch?: string },
  ) {
    await Bun.write(join(upstream, "package.json"), JSON.stringify({ name: "dep", version }));
    await Bun.write(join(upstream, "index.js"), `module.exports = '${version}';`);
    await git(env, upstream, "add", "-A");
    await git(env, upstream, "commit", "-q", "-m", `v${version}`);
    if (ref.tag) {
      await git(env, upstream, "tag", "-f", ref.tag);
      await git(env, serve, "fetch", "-fq", upstream, `+refs/tags/${ref.tag}:refs/tags/${ref.tag}`);
    }
    if (ref.branch) {
      await git(env, upstream, "branch", "-f", ref.branch);
      await git(env, serve, "fetch", "-q", upstream, `+refs/heads/${ref.branch}:refs/heads/${ref.branch}`);
    }
    await git(env, serve, "update-server-info");
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

  async function runInstall(cwd: string, cache: string, env: Record<string, string | undefined>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-progress"],
      cwd,
      env: { ...env, BUN_INSTALL_CACHE_DIR: cache },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const timeout = 60_000;

  test.concurrent(
    "picks up a tag pushed after the repo was first cached",
    async () => {
      using root = tempDir("git-tag-refresh", {});
      const env = gitEnv(String(root));
      const { upstream, serve } = await makeUpstream(String(root), env);
      await using server = serveGit(serve);
      const repoUrl = `git+http://127.0.0.1:${server.port}/repo.git`;

      const app = join(String(root), "app");
      const cache = join(String(root), "cache");
      await Bun.write(
        join(app, "package.json"),
        JSON.stringify({ name: "app", dependencies: { dep: `${repoUrl}#v1.0.0` } }),
      );

      {
        const { stdout, stderr, exitCode } = await runInstall(app, cache, env);
        expect(stderr).not.toContain("no commit matching");
        expect(stdout).toContain("+ dep@");
        expect(exitCode).toBe(0);
        expect(await Bun.file(join(app, "node_modules", "dep", "index.js")).text()).toContain("1.0.0");
      }

      // Publish v1.0.1 upstream and bump the dependency to the new tag.
      await publishRef(env, upstream, serve, "1.0.1", { tag: "v1.0.1" });
      await Bun.write(
        join(app, "package.json"),
        JSON.stringify({ name: "app", dependencies: { dep: `${repoUrl}#v1.0.1` } }),
      );

      const { stdout, stderr, exitCode } = await runInstall(app, cache, env);
      expect(stderr).not.toContain("no commit matching");
      expect(stderr).not.toContain("error:");
      expect(stdout).toContain("+ dep@");
      expect(exitCode).toBe(0);
      expect(await Bun.file(join(app, "node_modules", "dep", "index.js")).text()).toContain("1.0.1");
    },
    timeout,
  );

  test.concurrent(
    "picks up a branch created after the repo was first cached",
    async () => {
      using root = tempDir("git-branch-refresh", {});
      const env = gitEnv(String(root));
      const { upstream, serve } = await makeUpstream(String(root), env);
      await using server = serveGit(serve);
      const repoUrl = `git+http://127.0.0.1:${server.port}/repo.git`;

      const app = join(String(root), "app");
      const cache = join(String(root), "cache");
      await Bun.write(
        join(app, "package.json"),
        JSON.stringify({ name: "app", dependencies: { dep: `${repoUrl}#v1.0.0` } }),
      );

      {
        const { stderr, exitCode } = await runInstall(app, cache, env);
        expect(stderr).not.toContain("no commit matching");
        expect(exitCode).toBe(0);
      }

      await publishRef(env, upstream, serve, "2.0.0", { branch: "release-2" });
      await Bun.write(
        join(app, "package.json"),
        JSON.stringify({ name: "app", dependencies: { dep: `${repoUrl}#release-2` } }),
      );

      const { stderr, exitCode } = await runInstall(app, cache, env);
      expect(stderr).not.toContain("no commit matching");
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await Bun.file(join(app, "node_modules", "dep", "index.js")).text()).toContain("2.0.0");
    },
    timeout,
  );

  test.concurrent(
    "re-fetches a tag that was force-moved upstream",
    async () => {
      using root = tempDir("git-retag-refresh", {});
      const env = gitEnv(String(root));
      const { upstream, serve } = await makeUpstream(String(root), env);
      await using server = serveGit(serve);
      const repoUrl = `git+http://127.0.0.1:${server.port}/repo.git`;

      const app = join(String(root), "app");
      const cache = join(String(root), "cache");
      await Bun.write(
        join(app, "package.json"),
        JSON.stringify({ name: "app", dependencies: { dep: `${repoUrl}#v1.0.0` } }),
      );

      {
        const { stderr, exitCode } = await runInstall(app, cache, env);
        expect(stderr).not.toContain("error:");
        expect(exitCode).toBe(0);
        expect(await Bun.file(join(app, "node_modules", "dep", "index.js")).text()).toContain("1.0.0");
      }

      // Move v1.0.0 to a new commit upstream and drop the lockfile so the
      // committish is re-resolved against the refreshed cache.
      await publishRef(env, upstream, serve, "1.0.0-patched", { tag: "v1.0.0" });
      await rm(join(app, "bun.lock"), { force: true });
      await rm(join(app, "node_modules"), { recursive: true, force: true });

      const { stderr, exitCode } = await runInstall(app, cache, env);
      expect(stderr).not.toContain('"git fetch"');
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await Bun.file(join(app, "node_modules", "dep", "index.js")).text()).toContain("1.0.0-patched");
    },
    timeout,
  );
});
