import { spawn, write } from "bun";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { access } from "fs/promises";
import { NpmRegistry, bunExe, bunEnv as env, tmpdirSync } from "harness";
import { join } from "path";

let registry: NpmRegistry;
let root_url: string;
let package_dir: string;

beforeEach(async () => {
  registry = await new NpmRegistry().start();
  root_url = registry.url.slice(0, -1);
  package_dir = tmpdirSync();
  await write(
    join(package_dir, "bunfig.toml"),
    `
[install]
cache = false
registry = "${registry.url}"
saveTextLockfile = false
`,
  );
});

afterEach(() => {
  registry.stop();
});

it.each(["bun.lockb", "bun.lock"])("should not download tarballs with --lockfile-only using %s", async lockfile => {
  const isLockb = lockfile === "bun.lockb";

  registry.define("baz", { "0.0.1": {} });

  await write(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        baz: "0.0.1",
      },
    }),
  );

  const cmd = [bunExe(), "install", "--lockfile-only"];

  if (!isLockb) {
    // the default bunfig above disables --save-text-lockfile, so restore
    // default behaviour for the bun.lock case
    await write(
      join(package_dir, "bunfig.toml"),
      `
      [install]
      cache = false
      registry = "${registry.url}"
      `,
    );
  }

  const { stdout, stderr, exited } = spawn({
    cmd,
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  expect(await exited).toBe(0);
  const err = await stderr.text();

  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");

  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    expect.stringContaining(`Saved ${lockfile}`),
  ]);

  expect(registry.urls.sort()).toEqual([`${root_url}/baz`]);
  expect(registry.requestCount).toBe(1);

  await access(join(package_dir, lockfile));
});
