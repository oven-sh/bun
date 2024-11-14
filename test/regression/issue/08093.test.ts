import { file, spawn } from "bun";
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
  readdirSorted,
  requested,
  root_url,
  setHandler,
} from "./../../cli/install/dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(dummyBeforeEach);
afterEach(dummyAfterEach);

it("should install vendored node_modules with hardlink", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.1": {},
      latest: "0.0.1",
    }),
  );
  await writeFile(
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
    cmd: [bunExe(), "install", "--backend", "hardlink"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toContain("1 package installed");

  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/vendor-baz`, `${root_url}/vendor-baz-0.0.1.tgz`]);
  expect(requested).toBe(2);

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
