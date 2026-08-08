import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/24124
// GitHub Actions exports XDG_CONFIG_HOME=~/.config while `npm login` writes ~/.npmrc;
// npm itself ignores XDG_CONFIG_HOME entirely. `bun publish` / `bun install` must not
// silently skip ~/.npmrc just because XDG_CONFIG_HOME happens to be set.

async function publishDryRun(dir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "publish", "--dry-run"],
    cwd: join(dir, "pkg"),
    env: {
      ...bunEnv,
      XDG_CONFIG_HOME: join(dir, "xdg"),
      HOME: join(dir, "home"),
      USERPROFILE: join(dir, "home"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, exitCode };
}

test.concurrent("falls back to $HOME/.npmrc when $XDG_CONFIG_HOME is set but has no .npmrc", async () => {
  using dir = tempDir("npmrc-xdg-fallback", {
    "xdg/.keep": "",
    "home/.npmrc": `registry=http://localhost:1/\n//localhost:1/:_authToken=from-home\n`,
    "pkg/package.json": JSON.stringify({ name: "npmrc-xdg-fallback-pkg", version: "0.0.1" }),
  });

  const { out, err, exitCode } = await publishDryRun(String(dir));

  expect(err).not.toContain("missing authentication");
  expect(out).toContain("Registry: http://localhost:1/");
  expect(out).toContain("(dry-run)");
  expect(exitCode).toBe(0);
});

test.concurrent("prefers $XDG_CONFIG_HOME/.npmrc over $HOME/.npmrc when both exist", async () => {
  using dir = tempDir("npmrc-xdg-wins", {
    "xdg/.npmrc": `registry=http://localhost:1/\n//localhost:1/:_authToken=from-xdg\n`,
    "home/.npmrc": `registry=http://localhost:2/\n`,
    "pkg/package.json": JSON.stringify({ name: "npmrc-xdg-wins-pkg", version: "0.0.1" }),
  });

  const { out, err, exitCode } = await publishDryRun(String(dir));

  expect(err).not.toContain("missing authentication");
  expect(out).toContain("Registry: http://localhost:1/");
  expect(out).toContain("(dry-run)");
  expect(exitCode).toBe(0);
});
