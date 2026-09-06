import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { lstatSync, readFileSync } from "fs";
import { access, mkdir, writeFile } from "fs/promises";
import {
  bunExe,
  bunEnv as env,
  isWindows,
  readdirSorted,
  runBunInstall,
  tempDir,
  tmpdirSync,
  toBeValidBin,
  toHaveBins,
} from "harness";
import { basename, join } from "path";
import { dummyAfterAll, dummyAfterEach, dummyBeforeAll, dummyBeforeEach, package_dir } from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

let link_dir: string;

expect.extend({
  toBeValidBin,
  toHaveBins,
});

beforeEach(async () => {
  link_dir = tmpdirSync();
  await dummyBeforeEach({ linker: "hoisted" });
});
afterEach(async () => {
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
  let { out, err } = await runBunInstall(env, link_dir);
  expect(err.split(/\r?\n/).slice(-2)).toEqual(["Saved lockfile", ""]);
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    "Done! Checked 3 packages (no changes)",
  ]);

  let { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "link"],
    cwd: join(link_dir, "packages", "moo"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  err = await stderr.text();
  expect(err.split(/\r?\n/)).toEqual([""]);
  expect(await stdout.text()).toContain(`Success! Registered "moo"`);
  expect(await exited).toBe(0);

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "link", "moo", "--linker=hoisted"],
    cwd: join(link_dir, "packages", "boba"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await stderr.text();
  expect(err.split(/\r?\n/)).toEqual([""]);
  expect((await stdout.text()).replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun link v1."),
    "",
    `installed moo@link:moo`,
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(await file(join(link_dir, "packages", "boba", "node_modules", "moo", "package.json")).json()).toEqual({
    name: "moo",
    version: "0.0.1",
  });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "unlink"],
    cwd: join(link_dir, "packages", "moo"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await stderr.text();
  expect(err.split(/\r?\n/)).toEqual([""]);
  expect(await stdout.text()).toContain(`success: unlinked package "moo"`);
  expect(await exited).toBe(0);

  // link the workspace root package to a workspace package
  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "link"],
    cwd: link_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await stderr.text();
  expect(err.split(/\r?\n/)).toEqual([""]);
  expect(await stdout.text()).toContain(`Success! Registered "foo"`);
  expect(await exited).toBe(0);

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "link", "foo", "--linker=hoisted"],
    cwd: join(link_dir, "packages", "boba"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await stderr.text();
  expect(err.split(/\r?\n/)).toEqual([""]);
  expect((await stdout.text()).replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun link v1."),
    "",
    `installed foo@link:foo`,
    "",
    "1 package installed",
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await stderr.text();
  expect(err.split(/\r?\n/)).toEqual([""]);
  expect(await stdout.text()).toContain(`success: unlinked package "foo"`);
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err1 = await new Response(stderr1).text();
  expect(err1.split(/\r?\n/)).toEqual([""]);
  expect(await new Response(stdout1).text()).toContain(`Success! Registered "${link_name}"`);
  expect(await exited1).toBe(0);

  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "link", link_name],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err2 = await new Response(stderr2).text();
  expect(err2.split(/\r?\n/)).toEqual([""]);
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun link v1."),
    "",
    `installed ${link_name}@link:${link_name}`,
    "",
    "1 package installed",
  ]);
  expect(await exited2).toBe(0);

  const {
    stdout: stdout3,
    stderr: stderr3,
    exited: exited3,
  } = spawn({
    cmd: [bunExe(), "unlink"],
    cwd: link_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err3 = await new Response(stderr3).text();
  expect(err3.split(/\r?\n/)).toEqual([""]);
  expect(await new Response(stdout3).text()).toContain(`success: unlinked package "${link_name}"`);
  expect(await exited3).toBe(0);

  const {
    stdout: stdout4,
    stderr: stderr4,
    exited: exited4,
  } = spawn({
    cmd: [bunExe(), "link", link_name],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err4 = await new Response(stderr4).text();
  expect(err4).toContain(`error: Package "${link_name}" is not linked`);
  expect(await new Response(stdout4).text()).toEqual(expect.stringContaining("bun link v1."));
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err1 = await new Response(stderr1).text();
  expect(err1.split(/\r?\n/)).toEqual([""]);
  expect(await new Response(stdout1).text()).toContain(`Success! Registered "${link_name}"`);
  expect(await exited1).toBe(0);

  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "link", link_name],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err2 = await new Response(stderr2).text();
  expect(err2.split(/\r?\n/)).toEqual([""]);
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun link v1."),
    "",
    `installed ${link_name}@link:${link_name}`,
    "",
    "1 package installed",
  ]);
  expect(await exited2).toBe(0);

  const {
    stdout: stdout3,
    stderr: stderr3,
    exited: exited3,
  } = spawn({
    cmd: [bunExe(), "unlink"],
    cwd: link_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err3 = await new Response(stderr3).text();
  expect(err3.split(/\r?\n/)).toEqual([""]);
  expect(await new Response(stdout3).text()).toContain(`success: unlinked package "${link_name}"`);
  expect(await exited3).toBe(0);

  const {
    stdout: stdout4,
    stderr: stderr4,
    exited: exited4,
  } = spawn({
    cmd: [bunExe(), "link", link_name],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err4 = await new Response(stderr4).text();
  expect(err4).toContain(`error: Package "${link_name}" is not linked`);
  expect((await new Response(stdout4).text()).split(/\r?\n/)).toEqual([expect.stringContaining("bun link v1."), ""]);
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
        [link_name]: `${link_name}.py`,
      },
    }),
  );
  // Use a Python script with \r\n shebang to test normalization
  await writeFile(join(link_dir, `${link_name}.py`), "#!/usr/bin/env python\r\nprint('hello from python')");
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err1 = await new Response(stderr1).text();
  expect(err1.split(/\r?\n/)).toEqual([""]);
  expect(await new Response(stdout1).text()).toContain(`Success! Registered "${link_name}"`);
  expect(await exited1).toBe(0);

  const { out: stdout2, err: stderr2, exited: exited2 } = await runBunInstall(env, package_dir);
  const err2 = await new Response(stderr2).text();
  expect(err2.split(/\r?\n/).slice(-2)).toEqual(["Saved lockfile", ""]);
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    `+ ${link_name}@link:${link_name}`,
    "",
    "1 package installed",
  ]);
  expect(await exited2).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", link_name].sort());
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins([link_name]);
  expect(join(package_dir, "node_modules", ".bin", link_name)).toBeValidBin(join("..", link_name, `${link_name}.py`));
  expect(await readdirSorted(join(package_dir, "node_modules", link_name))).toEqual(
    ["package.json", `${link_name}.py`].sort(),
  );
  // Verify that the shebang was normalized from \r\n to \n (only on non-Windows)
  const binContent = await file(join(package_dir, "node_modules", link_name, `${link_name}.py`)).text();
  if (isWindows) {
    expect(binContent).toStartWith("#!/usr/bin/env python\r\nprint");
  } else {
    expect(binContent).toStartWith("#!/usr/bin/env python\nprint");
    expect(binContent).not.toContain("\r\n");
  }
  await access(join(package_dir, "bun.lockb"));

  const {
    stdout: stdout3,
    stderr: stderr3,
    exited: exited3,
  } = spawn({
    cmd: [bunExe(), "unlink"],
    cwd: link_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err3 = await new Response(stderr3).text();
  expect(err3.split(/\r?\n/)).toEqual([""]);
  expect(await new Response(stdout3).text()).toContain(`success: unlinked package "${link_name}"`);
  expect(await exited3).toBe(0);

  const {
    stdout: stdout4,
    stderr: stderr4,
    exited: exited4,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err4 = await new Response(stderr4).text();
  expect(err4).toContain(`FileNotFound: failed linking dependency/workspace to node_modules for package ${link_name}`);
  const out4 = await new Response(stdout4).text();
  expect(out4.replace(/\[[0-9\.]+m?s\]/, "[]").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    "Failed to install 1 package",
    "[] done",
    "",
  ]);

  // This should fail with a non-zero exit code.
  expect(await exited4).toBe(1);
});

// A project `bunfig.toml` is part of the checkout. It must not point `bun link`
// at a directory outside the project: the global bin linker replaces whatever
// is already at each destination.
it("ignores [install] globalDir and globalBinDir from a project bunfig.toml", async () => {
  using dir = tempDir("bun-link-project-bunfig", {
    "lib/package.json": JSON.stringify({
      name: "hostile-lib",
      version: "1.0.0",
      bin: { "victim-file": "entry.js", "new-name": "entry.js" },
    }),
    "lib/entry.js": "#!/bin/sh\necho linked\n",
    "lib/bunfig.toml": ({ root }) =>
      `[install]\n` +
      `globalBinDir = '${join(root, "outside").replaceAll("\\", "/")}'\n` +
      `globalDir = '${join(root, "outside", "global").replaceAll("\\", "/")}'\n`,
    "outside/victim-file": "do not touch\n",
    "home/.keep": "",
  });

  const bunInstall = join(String(dir), "bun-install");
  const linkEnv: NodeJS.Dict<string> = {
    ...env,
    BUN_INSTALL: bunInstall,
    HOME: join(String(dir), "home"),
    XDG_CONFIG_HOME: join(String(dir), "home"),
  };
  delete linkEnv.BUN_INSTALL_BIN;
  delete linkEnv.BUN_INSTALL_GLOBAL_DIR;

  await using proc = spawn({
    cmd: [bunExe(), "link"],
    cwd: join(String(dir), "lib"),
    stdout: "pipe",
    stderr: "pipe",
    env: linkEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain('Success! Registered "hostile-lib"');

  // Nothing outside the project is created, replaced or deleted.
  expect(await readdirSorted(join(String(dir), "outside"))).toEqual(["victim-file"]);
  expect(readFileSync(join(String(dir), "outside", "victim-file"), "utf8")).toBe("do not touch\n");
  expect(lstatSync(join(String(dir), "outside", "victim-file")).isSymbolicLink()).toBe(false);

  // The bins go to $BUN_INSTALL/bin, which is where they belong.
  expect(await readdirSorted(join(bunInstall, "bin"))).toHaveBins(["new-name", "victim-file"]);

  // Bun says which keys it ignored.
  expect(stderr).toContain('"globalBinDir" is ignored in a project bunfig.toml');
  expect(stderr).toContain('"globalDir" is ignored in a project bunfig.toml');
  expect(exitCode).toBe(0);
});

it("honors [install] globalDir and globalBinDir from the user bunfig", async () => {
  using dir = tempDir("bun-link-user-bunfig", {
    "lib/package.json": JSON.stringify({
      name: "user-lib",
      version: "1.0.0",
      bin: { "user-bin": "entry.js" },
    }),
    "lib/entry.js": "#!/bin/sh\necho linked\n",
    "home/.bunfig.toml": ({ root }) =>
      `[install]\n` +
      `globalBinDir = '${join(root, "user-bin-dir").replaceAll("\\", "/")}'\n` +
      `globalDir = '${join(root, "user-global").replaceAll("\\", "/")}'\n`,
  });

  const linkEnv: NodeJS.Dict<string> = {
    ...env,
    BUN_INSTALL: join(String(dir), "bun-install"),
    HOME: join(String(dir), "home"),
    XDG_CONFIG_HOME: join(String(dir), "home"),
  };
  delete linkEnv.BUN_INSTALL_BIN;
  delete linkEnv.BUN_INSTALL_GLOBAL_DIR;

  await using proc = spawn({
    cmd: [bunExe(), "link"],
    cwd: join(String(dir), "lib"),
    stdout: "pipe",
    stderr: "pipe",
    env: linkEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain('Success! Registered "user-lib"');
  expect(exitCode).toBe(0);

  expect(await readdirSorted(join(String(dir), "user-bin-dir"))).toHaveBins(["user-bin"]);
  expect(await readdirSorted(join(String(dir), "user-global", "node_modules"))).toEqual(["user-lib"]);
});
