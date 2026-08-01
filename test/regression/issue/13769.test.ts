// https://github.com/oven-sh/bun/issues/13769
// `bun update` should re-resolve git dependencies whose committish tracks a
// branch (or is absent) to the remote's current commit. Before the fix the
// lockfile's pinned SHA was reused and the update was a no-op.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

function gitEnv(root: string) {
  return {
    ...bunEnv,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(root, "empty.gitconfig"),
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function git(env: Record<string, string | undefined>, cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: ["git", ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout.trim();
}

async function makeUpstream(root: string, env: Record<string, string | undefined>) {
  const upstream = join(root, "upstream");
  const serve = join(root, "serve.git");

  await Bun.write(join(root, "empty.gitconfig"), "");
  await git(env, root, "init", "-q", "-b", "main", upstream);
  await git(env, upstream, "config", "user.email", "test@bun.sh");
  await git(env, upstream, "config", "user.name", "test");

  await Bun.write(join(upstream, "package.json"), JSON.stringify({ name: "issue13769lib", version: "1.0.0" }));
  await Bun.write(join(upstream, "index.js"), "module.exports = 'COMMIT_A';\n");
  await git(env, upstream, "add", "-A");
  await git(env, upstream, "commit", "-q", "-m", "A");

  // Bare repo exposed via git's dumb HTTP protocol.
  await git(env, root, "clone", "-q", "--bare", upstream, serve);
  await git(env, serve, "update-server-info");

  return { upstream, serve };
}

async function publishCommit(env: Record<string, string | undefined>, upstream: string, serve: string, marker: string) {
  await Bun.write(join(upstream, "index.js"), `module.exports = '${marker}';\n`);
  await git(env, upstream, "add", "-A");
  await git(env, upstream, "commit", "-q", "-m", marker);
  await git(env, serve, "fetch", "-q", upstream, "+refs/heads/*:refs/heads/*");
  await git(env, serve, "update-server-info");
  return git(env, upstream, "rev-parse", "HEAD");
}

function serveGit(serve: string) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      // Git's smart-HTTP probe appends ?service=git-upload-pack; replying with
      // the plain file body and a text content-type triggers the dumb fallback.
      const rel = url.pathname.replace(/^\/repo\.git\//, "");
      const file = Bun.file(join(serve, rel));
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file, { headers: { "Content-Type": "text/plain" } });
    },
  });
}

async function runBun(cwd: string, cache: string, env: Record<string, string | undefined>, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...env, BUN_INSTALL_CACHE_DIR: cache },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("bun update re-resolves git dependencies", () => {
  async function setup(root: string) {
    const env = gitEnv(root);
    const { upstream, serve } = await makeUpstream(root, env);
    const server = serveGit(serve);
    const repoUrl = `git+http://127.0.0.1:${server.port}/repo.git`;
    const app = join(root, "app");
    const cache = join(root, "cache");
    await Bun.write(join(app, "package.json"), JSON.stringify({ name: "app", version: "0.0.0" }));
    return { env, upstream, serve, server, repoUrl, app, cache };
  }

  async function assertInstalled(app: string, marker: string) {
    const body = await Bun.file(join(app, "node_modules", "issue13769lib", "index.js")).text();
    expect(body).toContain(marker);
  }

  test.concurrent("`bun update` moves a no-committish git dependency to the new HEAD", async () => {
    using root = tempDir("issue-13769-head", {});
    const { env, upstream, serve, server, repoUrl, app, cache } = await setup(String(root));
    await using _server = server;

    {
      const { stderr, exitCode } = await runBun(app, cache, env, "add", "--no-progress", repoUrl);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      await assertInstalled(app, "COMMIT_A");
    }

    const shaB = await publishCommit(env, upstream, serve, "COMMIT_B");

    const { stdout, stderr, exitCode } = await runBun(app, cache, env, "update", "--no-progress");
    expect(stderr).not.toContain("error:");
    expect(stdout).not.toContain("no changes");
    expect(exitCode).toBe(0);
    await assertInstalled(app, "COMMIT_B");

    const lock = await Bun.file(join(app, "bun.lock")).text();
    expect(lock).toContain(shaB);
  });

  test.concurrent("`bun update <name>` moves a branch-tracking git dependency to the branch tip", async () => {
    using root = tempDir("issue-13769-branch", {});
    const { env, upstream, serve, server, repoUrl, app, cache } = await setup(String(root));
    await using _server = server;

    {
      const { stderr, exitCode } = await runBun(app, cache, env, "add", "--no-progress", `${repoUrl}#main`);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      await assertInstalled(app, "COMMIT_A");
    }

    await publishCommit(env, upstream, serve, "COMMIT_B");

    const { stderr, exitCode } = await runBun(app, cache, env, "update", "--no-progress", "issue13769lib");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    await assertInstalled(app, "COMMIT_B");
  });

  test.concurrent("`bun update` is a no-op when the remote HEAD is unchanged", async () => {
    using root = tempDir("issue-13769-noop", {});
    const { env, server, repoUrl, app, cache } = await setup(String(root));
    await using _server = server;

    {
      const { exitCode } = await runBun(app, cache, env, "add", "--no-progress", repoUrl);
      expect(exitCode).toBe(0);
      await assertInstalled(app, "COMMIT_A");
    }

    const lockBefore = await Bun.file(join(app, "bun.lock")).text();
    const { stderr, exitCode } = await runBun(app, cache, env, "update", "--no-progress");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    await assertInstalled(app, "COMMIT_A");
    const lockAfter = await Bun.file(join(app, "bun.lock")).text();
    expect(lockAfter).toBe(lockBefore);
  });

  test.concurrent("`bun install` keeps the lockfile pin when the remote has moved", async () => {
    using root = tempDir("issue-13769-install", {});
    const { env, upstream, serve, server, repoUrl, app, cache } = await setup(String(root));
    await using _server = server;

    {
      const { exitCode } = await runBun(app, cache, env, "add", "--no-progress", repoUrl);
      expect(exitCode).toBe(0);
      await assertInstalled(app, "COMMIT_A");
    }

    await publishCommit(env, upstream, serve, "COMMIT_B");

    const lockBefore = await Bun.file(join(app, "bun.lock")).text();
    const { stderr, exitCode } = await runBun(app, cache, env, "install", "--no-progress");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    // `install` must honour the lockfile pin, not float to HEAD.
    await assertInstalled(app, "COMMIT_A");
    const lockAfter = await Bun.file(join(app, "bun.lock")).text();
    expect(lockAfter).toBe(lockBefore);
  });
});
