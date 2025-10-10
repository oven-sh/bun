import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { access, writeFile } from "fs/promises";
import { bunExe, bunEnv as env } from "harness";
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
} from "./dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(async () => {
  await dummyBeforeEach();
});
afterEach(dummyAfterEach);

it.each(["bun.lockb", "bun.lock"])("should not download tarballs with --lockfile-only using %s", async lockfile => {
  const isLockb = lockfile === "bun.lockb";

  const urls: string[] = [];
  const registry = { "0.0.1": { as: "0.0.1" }, latest: "0.0.1" };

  setHandler(dummyRegistry(urls, registry));

  await writeFile(
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
    // the default beforeEach disables --save-text-lockfile in the dummy registry, so we should restore
    // default behaviour
    await writeFile(
      join(package_dir, "bunfig.toml"),
      `
      [install]
      cache = false
      registry = "${root_url}/"
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

  expect(urls.sort()).toEqual([`${root_url}/baz`]);
  expect(requested).toBe(1);

  await access(join(package_dir, lockfile));
});
