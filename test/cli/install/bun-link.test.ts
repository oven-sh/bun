// @known-failing-on-windows: 1 failing
import { spawn, file } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { bunExe, bunEnv as env, toBeValidBin, toHaveBins } from "harness";
import { access, mkdtemp, readlink, realpath, rm, writeFile, mkdir } from "fs/promises";
import { basename, join, sep, dirname } from "path";
import { tmpdir } from "os";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  package_dir,
  readdirSorted,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

let link_dir: string;

expect.extend({
  toBeValidBin,
  toHaveBins,
});

beforeEach(async () => {
  link_dir = await mkdtemp(join(await realpath(tmpdir()), "bun-link.test"));
  await dummyBeforeEach();
});
afterEach(async () => {
  await rm(link_dir, { force: true, recursive: true });
  await dummyAfterEach();
});

it("should link and unlink workspace package", async () => {
  await writeFile(
    join(link_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      workspaces: ["packages/*"],
    }),
  );
  await mkdir(join(link_dir, "packages", "moo"), { recursive: true });
  await mkdir(join(link_dir, "packages", "boba"), { recursive: true });
  await writeFile(
    join(link_dir, "packages", "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.0.1",
    }),
  );
  await writeFile(
    join(link_dir, "packages", "boba", "package.json"),
    JSON.stringify({
      name: "boba",
      version: "0.0.1",
    }),
  );
  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: link_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  var err = await new Response(stderr).text();
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun install", " Saved lockfile", ""]);
  expect(stdout).toBeDefined();
  var out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    ` + boba@workspace:packages${sep}boba`,
    ` + moo@workspace:packages${sep}moo`,
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "link"],
    cwd: join(link_dir, "packages", "moo"),
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  expect(stderr).toBeDefined();
  err = await new Response(stderr).text();
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun link", ""]);
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toContain(`Success! Registered "moo"`);
  expect(await exited).toBe(0);

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "link", "moo"],
    cwd: join(link_dir, "packages", "boba"),
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  expect(stderr).toBeDefined();
  err = await new Response(stderr).text();
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun link", ""]);
  expect(stdout).toBeDefined();
  expect((await new Response(stdout).text()).replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    ` installed moo@link:moo`,
    "",
    " 1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(await file(join(link_dir, "packages", "boba", "node_modules", "moo", "package.json")).json()).toEqual({
    name: "moo",
    version: "0.0.1",
  });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "unlink"],
    cwd: join(link_dir, "packages", "moo"),
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  expect(stderr).toBeDefined();
  err = await new Response(stderr).text();
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun unlink", ""]);
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toContain(`success: unlinked package "moo"`);
  expect(await exited).toBe(0);

  // link the workspace root package to a workspace package
  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "link"],
    cwd: link_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  expect(stderr).toBeDefined();
  err = await new Response(stderr).text();
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun link", ""]);
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toContain(`Success! Registered "foo"`);
  expect(await exited).toBe(0);

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "link", "foo"],
    cwd: join(link_dir, "packages", "boba"),
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  expect(stderr).toBeDefined();
  err = await new Response(stderr).text();
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun link", ""]);
  expect(stdout).toBeDefined();
  expect((await new Response(stdout).text()).replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    ` installed foo@link:foo`,
    "",
    " 1 package installed",
  ]);
  expect(await file(join(link_dir, "packages", "boba", "node_modules", "foo", "package.json")).json()).toEqual({
    name: "foo",
    version: "1.0.0",
    workspaces: ["packages/*"],
  });
  expect(await exited).toBe(0);

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "unlink"],
    cwd: link_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  expect(stderr).toBeDefined();
  err = await new Response(stderr).text();
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun unlink", ""]);
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toContain(`success: unlinked package "foo"`);
  expect(await exited).toBe(0);
});

it("should link package", async () => {
  const link_name = basename(link_dir).slice("bun-link.".length);
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
  expect(await new Response(stdout1).text()).toContain(`Success! Registered "${link_name}"`);
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
    " 1 package installed",
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
  expect(await new Response(stdout4).text()).toBe("");
  expect(await exited4).toBe(1);
});

it("should link scoped package", async () => {
  const link_name = `@${basename(link_dir).slice("bun-link.".length)}/foo`;
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
  expect(await new Response(stdout1).text()).toContain(`Success! Registered "${link_name}"`);
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
    " 1 package installed",
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
  expect(await new Response(stdout4).text()).toBe("");
  expect(await exited4).toBe(1);
});

it("should link dependency without crashing", async () => {
  const link_name = basename(link_dir).slice("bun-link.".length) + "-really-long-name";
  await writeFile(
    join(link_dir, "package.json"),
    JSON.stringify({
      name: link_name,
      version: "0.0.1",
      bin: {
        [link_name]: `${link_name}.js`,
      },
    }),
  );
  await writeFile(join(link_dir, `${link_name}.js`), "console.log(42);");
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.2",
      dependencies: {
        [link_name]: `link:${link_name}`,
      },
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
  expect(await new Response(stdout1).text()).toContain(`Success! Registered "${link_name}"`);
  expect(await exited1).toBe(0);

  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun install", " Saved lockfile", ""]);
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    ` + ${link_name}@link:${link_name}`,
    "",
    " 1 package installed",
  ]);
  expect(await exited2).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", link_name].sort());
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins([link_name]);
  expect(join(package_dir, "node_modules", ".bin", link_name)).toBeValidBin(join("..", link_name, `${link_name}.js`));
  expect(await readdirSorted(join(package_dir, "node_modules", link_name))).toEqual(
    ["package.json", `${link_name}.js`].sort(),
  );
  await access(join(package_dir, "bun.lockb"));

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
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr4).toBeDefined();
  const err4 = await new Response(stderr4).text();
  expect(err4).toContain(`error: FileNotFound installing ${link_name}`);
  expect(stdout4).toBeDefined();
  const out4 = await new Response(stdout4).text();
  expect(out4.replace(/\[[0-9\.]+m?s\]/, "[]").split(/\r?\n/)).toEqual([
    "",
    "Failed to install 1 package",
    "[] done",
    "",
  ]);
  expect(await exited4).toBe(0);
});
