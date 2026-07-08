import { file, spawn, write } from "bun";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { access } from "fs/promises";
import { NpmRegistry, bunExe, bunEnv as env, readdirSorted, tmpdirSync } from "harness";
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

it("should install vendored node_modules with hardlink", async () => {
  // A package that ships a nested node_modules of its own.
  registry.define("vendor-baz", {
    "0.0.1": {
      tarball: {
        "index.js": '#! /usr/bin/env node\n\nconsole.log("run vendor-baz");\n',
        "cjs/node_modules/foo-dep/index.js": '#! /usr/bin/env node\n\nconsole.log("run foo-dep");\n',
      },
    },
  });
  await write(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "vendor-baz": "0.0.1",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--backend", "hardlink", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  expect(stderr).toBeDefined();
  const err = await stderr.text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await stdout.text();
  expect(out).toContain("1 package installed");

  expect(await exited).toBe(0);
  expect(registry.urls.sort()).toEqual([`${root_url}/vendor-baz`, `${root_url}/vendor-baz/-/vendor-baz-0.0.1.tgz`]);
  expect(registry.requestCount).toBe(2);

  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "vendor-baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "vendor-baz"))).toEqual([
    "cjs",
    "index.js",
    "package.json",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", "vendor-baz", "cjs", "node_modules"))).toEqual([
    "foo-dep",
  ]);
  expect(
    await readdirSorted(join(package_dir, "node_modules", "vendor-baz", "cjs", "node_modules", "foo-dep")),
  ).toEqual(["index.js"]);

  expect(await file(join(package_dir, "node_modules", "vendor-baz", "package.json")).json()).toEqual({
    name: "vendor-baz",
    version: "0.0.1",
  });
  await access(join(package_dir, "bun.lockb"));
});
