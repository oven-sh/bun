import { file, listen, Socket, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { bunExe, bunEnv as env } from "harness";
import { access, mkdir, readlink, realpath, rm, writeFile } from "fs/promises";
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
} from "./dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(dummyBeforeEach);
afterEach(dummyAfterEach);

it("should update to latest version of dependency", async () => {
  const urls: string[] = [];
  const registry = {
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
  };
  setHandler(dummyRegistry(urls, registry));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        baz: "~0.0.2",
      },
    }),
  );
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1).not.toContain("error:");
  expect(err1).toContain("Saved lockfile");
  expect(stdout1).toBeDefined();
  const out1 = await new Response(stdout1).text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + baz@0.0.3",
    "",
    " 1 packages installed",
  ]);
  expect(await exited1).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
  // Perform `bun update` with updated registry & lockfile from before
  await rm(join(package_dir, "node_modules"), { force: true, recursive: true });
  urls.length = 0;
  registry.latest = "0.0.5";
  setHandler(dummyRegistry(urls, registry));
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "update", "baz"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2).not.toContain("error:");
  expect(err2).toContain("Saved lockfile");
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed baz@0.0.5 with binaries:",
    "  - baz-exec",
    "",
    "",
    " 1 packages installed",
  ]);
  expect(await exited2).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.5.tgz`]);
  expect(requested).toBe(4);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-exec"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-exec"))).toBe(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.5",
    bin: {
      "baz-exec": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should update to latest versions of dependencies", async () => {
  const urls: string[] = [];
  const registry = {
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
    "0.1.0": {},
    latest: "0.0.3",
  };
  setHandler(dummyRegistry(urls, registry));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        "@barn/moo": "^0.1.0",
        baz: "~0.0.2",
      },
    }),
  );
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1).not.toContain("error:");
  expect(err1).toContain("Saved lockfile");
  expect(stdout1).toBeDefined();
  const out1 = await new Response(stdout1).text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + @barn/moo@0.1.0",
    " + baz@0.0.3",
    "",
    " 2 packages installed",
  ]);
  expect(await exited1).toBe(0);
  expect(urls.sort()).toEqual([
    `${root_url}/@barn/moo`,
    `${root_url}/@barn/moo-0.1.0.tgz`,
    `${root_url}/baz`,
    `${root_url}/baz-0.0.3.tgz`,
  ]);
  expect(requested).toBe(4);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "@barn", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
  // Perform `bun update` with updated registry & lockfile from before
  await rm(join(package_dir, "node_modules"), { force: true, recursive: true });
  urls.length = 0;
  registry.latest = "0.0.5";
  setHandler(dummyRegistry(urls, registry));
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "update"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2).not.toContain("error:");
  expect(err2).toContain("Saved lockfile");
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + @barn/moo@0.1.0",
    " + baz@0.0.5",
    "",
    " 2 packages installed",
  ]);
  expect(await exited2).toBe(0);
  expect(urls.sort()).toEqual([
    `${root_url}/@barn/moo`,
    `${root_url}/@barn/moo-0.1.0.tgz`,
    `${root_url}/baz`,
    `${root_url}/baz-0.0.5.tgz`,
  ]);
  expect(requested).toBe(8);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "@barn", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-exec"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-exec"))).toBe(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.5",
    bin: {
      "baz-exec": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});
