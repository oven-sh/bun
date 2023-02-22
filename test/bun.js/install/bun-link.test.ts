import { spawn } from "bun";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { bunExe } from "bunExe";
import { bunEnv as env } from "bunEnv";
import { mkdtemp, realpath, rm, writeFile } from "fs/promises";
import { basename, join } from "path";
import { tmpdir } from "os";

let package_dir, link_dir;

beforeEach(async () => {
  link_dir = await mkdtemp(join(await realpath(tmpdir()), "bun-link.test"));
  package_dir = await mkdtemp(join(await realpath(tmpdir()), "bun-link.pkg"));
});
afterEach(async () => {
  await rm(link_dir, { force: true, recursive: true });
  await rm(package_dir, { force: true, recursive: true });
});

it("should link package", async () => {
  var link_name = basename(link_dir).slice("bun-link.".length);
  await writeFile(
    join(link_dir, "package.json"),
    JSON.stringify({
      name: link_name,
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

  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "link"],
    cwd: link_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun link", ""]);
  expect(stdout1).toBeDefined();
  expect(await new Response(stdout1).text()).toContain(`Success! Registered \\"${link_name}\\"`);
  expect(await exited1).toBe(0);

  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "link", link_name],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun link", ""]);
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    ` installed ${link_name}@link:${link_name}`,
    "",
    "",
    " 1 packages installed",
  ]);
  expect(await exited2).toBe(0);

  const {
    stdout: stdout3,
    stderr: stderr3,
    exited: exited3,
  } = spawn({
    cmd: [bunExe(), "unlink"],
    cwd: link_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr3).toBeDefined();
  const err3 = await new Response(stderr3).text();
  expect(err3.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun unlink", ""]);
  expect(stdout3).toBeDefined();
  expect(await new Response(stdout3).text()).toContain(`success: unlinked package "${link_name}"`);
  expect(await exited3).toBe(0);

  const {
    stdout: stdout4,
    stderr: stderr4,
    exited: exited4,
  } = spawn({
    cmd: [bunExe(), "link", link_name],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr4).toBeDefined();
  const err4 = await new Response(stderr4).text();
  expect(err4).toContain(`error: package "${link_name}" is not linked`);
  expect(stdout4).toBeDefined();
  const out4 = await new Response(stdout4).text();
  expect(await new Response(stdout4).text()).toBe("");
  expect(await exited4).toBe(1);
});

it("should link scoped package", async () => {
  var link_name = `@${basename(link_dir).slice("bun-link.".length)}/foo`;
  await writeFile(
    join(link_dir, "package.json"),
    JSON.stringify({
      name: link_name,
      version: "0.0.1",
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
    }),
  );

  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "link"],
    cwd: link_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun link", ""]);
  expect(stdout1).toBeDefined();
  expect(await new Response(stdout1).text()).toContain(`Success! Registered \\"${link_name}\\"`);
  expect(await exited1).toBe(0);

  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "link", link_name],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun link", ""]);
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    ` installed ${link_name}@link:${link_name}`,
    "",
    "",
    " 1 packages installed",
  ]);
  expect(await exited2).toBe(0);

  const {
    stdout: stdout3,
    stderr: stderr3,
    exited: exited3,
  } = spawn({
    cmd: [bunExe(), "unlink"],
    cwd: link_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr3).toBeDefined();
  const err3 = await new Response(stderr3).text();
  expect(err3.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun unlink", ""]);
  expect(stdout3).toBeDefined();
  expect(await new Response(stdout3).text()).toContain(`success: unlinked package "${link_name}"`);
  expect(await exited3).toBe(0);

  const {
    stdout: stdout4,
    stderr: stderr4,
    exited: exited4,
  } = spawn({
    cmd: [bunExe(), "link", link_name],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr4).toBeDefined();
  const err4 = await new Response(stderr4).text();
  expect(err4).toContain(`error: package "${link_name}" is not linked`);
  expect(stdout4).toBeDefined();
  const out4 = await new Response(stdout4).text();
  expect(await new Response(stdout4).text()).toBe("");
  expect(await exited4).toBe(1);
});
