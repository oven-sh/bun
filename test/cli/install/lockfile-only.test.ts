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
beforeEach(dummyBeforeEach);
afterEach(dummyAfterEach);

it("should not download tarballs with --lockfile-only", async () => {
  const urls: string[] = [];
  const registry = {
    "0.0.1": {
      // use a tarball that doesn't exist so if it tries to fetch it would fail
      as: "0.0.1",
    },
    latest: "0.0.1",
  };
  setHandler(dummyRegistry(urls, registry));

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        // Use absolute version (not semver range) to ensure we hit the code path
        baz: "0.0.1",
      },
    }),
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--lockfile-only", "--save-text-lockfile"], // TODO: Should be bun.lock by default?
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
    expect.stringContaining("Saved bun.lock"), // lockfile should be saved but no packages installed
  ]);

  console.log(out);

  expect(urls.sort()).toEqual([`${root_url}/baz`]);
  expect(requested).toBe(1);

  await access(join(package_dir, "bun.lock"));
});
