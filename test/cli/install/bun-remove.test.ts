// @known-failing-on-windows: 1 failing
import { bunExe, bunEnv as env } from "harness";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "fs/promises";
import { join, relative } from "path";
import { tmpdir } from "os";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { dummyAfterAll, dummyAfterEach, dummyBeforeAll, dummyBeforeEach, package_dir } from "./dummy.registry";
import { spawn } from "bun";
import { file } from "bun";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

let remove_dir: string;

beforeEach(async () => {
  remove_dir = await mkdtemp(join(await realpath(tmpdir()), "bun-remove.test"));
  await dummyBeforeEach();
});

afterEach(async () => {
  await rm(remove_dir, { force: true, recursive: true });
  await dummyAfterEach();
});

it("should remove existing package", async () => {
  const pkg1_dir = join(remove_dir, "pkg1");
  const pkg1_path = relative(package_dir, pkg1_dir);
  await mkdir(pkg1_dir);
  const pkg2_dir = join(remove_dir, "pkg2");
  const pkg2_path = relative(package_dir, pkg2_dir);
  await mkdir(pkg2_dir);

  await writeFile(
    join(pkg1_dir, "package.json"),
    JSON.stringify({
      name: "pkg1",
      version: "0.0.1",
    }),
  );
  await writeFile(
    join(pkg2_dir, "package.json"),
    JSON.stringify({
      name: "pkg2",
      version: "0.0.1",
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.2",
    }),
  );
  const { exited: exited1 } = spawn({
    cmd: [bunExe(), "add", `file:${pkg1_path}`.replace(/\\/g, "\\\\")],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await exited1).toBe(0);
  const { exited: exited2 } = spawn({
    cmd: [bunExe(), "add", `file:${pkg2_path}`.replace(/\\/g, "\\\\")],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await exited2).toBe(0);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.2",
        dependencies: {
          pkg1: `file:${pkg1_path}`,
          pkg2: `file:${pkg2_path}`,
        },
      },
      null,
      2,
    ),
  );

  const {
    exited: removeExited1,
    stdout: stdout1,
    stderr: stderr1,
  } = spawn({
    cmd: [bunExe(), "remove", "pkg1"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await removeExited1).toBe(0);
  expect(stdout1).toBeDefined();
  const out1 = await new Response(stdout1).text();
  const err1 = await new Response(stderr1).text();

  expect(out1.replace(/\s*\[[0-9\.]+m?s\]/, "").split(/\r?\n/)).toEqual([
    "",
    ` + pkg2@${pkg2_path}`,
    "",
    " 1 package installed",
    "  Removed: 1",
    "",
  ]);
  expect(stderr1).toBeDefined();
  expect(err1.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun remove", " Saved lockfile", ""]);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.2",
        dependencies: {
          pkg2: `file:${pkg2_path}`,
        },
      },
      null,
      2,
    ),
  );

  const {
    exited: removeExited2,
    stdout: stdout2,
    stderr: stderr2,
  } = spawn({
    cmd: [bunExe(), "remove", "pkg2"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await removeExited2).toBe(0);
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  const err2 = await new Response(stderr2).text();

  expect(out2.replace(/\s*\[[0-9\.]+m?s\]/, "").split(/\r?\n/)).toEqual(["", " - pkg2", " 1 package removed", ""]);
  expect(stderr2).toBeDefined();
  expect(err2.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual([
    "bun remove",
    "",
    "package.json has no dependencies! Deleted empty lockfile",
    "",
  ]);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.2",
      },
      null,
      2,
    ),
  );
});

it("should not reject missing package", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  await writeFile(
    join(remove_dir, "package.json"),
    JSON.stringify({
      name: "pkg1",
      version: "0.0.2",
    }),
  );
  const pkg_path = relative(package_dir, remove_dir);
  const { exited: addExited } = spawn({
    cmd: [bunExe(), "add", `file:${pkg_path}`.replace(/\\/g, "\\\\")],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await addExited).toBe(0);

  const { exited: rmExited } = spawn({
    cmd: [bunExe(), "remove", "pkg2"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await rmExited).toBe(0);
});

it("should not affect if package is not installed", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "remove", "pkg"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await exited).toBe(0);
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toEqual("");
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual([
    "bun remove",
    "package.json doesn't have dependencies, there's nothing to remove!",
    "",
  ]);
});

it("should retain a new line in the end of package.json", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  await writeFile(
    join(remove_dir, "package.json"),
    JSON.stringify({
      name: "pkg",
      version: "0.0.2",
    }),
  );
  const pkg_path = relative(package_dir, remove_dir);
  const { exited: addExited } = spawn({
    cmd: [bunExe(), "add", `file:${pkg_path}`.replace(/\\/g, "\\\\")],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await addExited).toBe(0);
  const content_before_remove = await file(join(package_dir, "package.json")).text();
  expect(content_before_remove.endsWith("}")).toBe(true);
  await writeFile(join(package_dir, "package.json"), content_before_remove + "\n");

  const { exited } = spawn({
    cmd: [bunExe(), "remove", "pkg"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await exited).toBe(0);
  const content_after_remove = await file(join(package_dir, "package.json")).text();
  expect(content_after_remove.endsWith("}\n")).toBe(true);
  expect(content_after_remove).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
      },
      null,
      2,
    ) + "\n",
  );
});

it("should remove peerDependencies", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      peerDependencies: {
        bar: "~0.0.1",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "remove", "bar"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]/, "").split(/\r?\n/)).toEqual([" done", ""]);
  expect(await exited).toBe(0);
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
  });
});
