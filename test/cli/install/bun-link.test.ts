import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { access, exists, mkdir, readFile, readlink, symlink, writeFile } from "fs/promises";
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
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
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
  expect((await stdout.text()).replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
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
  expect((await stdout.text()).replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
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
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
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
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
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
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
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

// A `link:` target is normalized and joined onto the global link directory in
// fixed-size buffers (the normalizer's is 1024 bytes, the others are a path
// buffer). These used to be written without a length check, so a long enough
// specifier aborted `bun install` instead of failing the dependency.
describe("link: specifier longer than the path buffers", () => {
  // Longer than every buffer on every platform (the Windows path buffer is ~96 KiB).
  const LONG_SPEC_BYTES = 100_000;

  async function run(cwd: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err, exitCode };
  }

  it("fails to resolve a name that does not fit", async () => {
    const target = Buffer.alloc(LONG_SPEC_BYTES, "n").toString();
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: `link:${target}` } }),
    );

    const { err, exitCode } = await run(package_dir, "install");

    expect(err).toContain("error: ENAMETOOLONG");
    expect(err).toContain("error: bar@link:" + target.slice(0, 64));
    expect(exitCode).toBe(1);
  });

  // `x/../` segments normalize away, so this resolves to the linked package, but
  // the specifier itself (which is what gets linked) is still too long for a path.
  it("fails to install a linked package whose specifier only fits once normalized", async () => {
    const link_name = basename(link_dir).slice("bun-link.".length);
    await writeFile(join(link_dir, "package.json"), JSON.stringify({ name: link_name, version: "0.0.1" }));
    const registered = await run(link_dir, "link");
    expect(registered.err).toBe("");
    expect(registered.out).toContain(`Success! Registered "${link_name}"`);
    expect(registered.exitCode).toBe(0);

    try {
      const target = Buffer.alloc(LONG_SPEC_BYTES, "x/../").toString() + link_name;
      await writeFile(
        join(package_dir, "package.json"),
        JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { [link_name]: `link:${target}` } }),
      );

      const { out, err, exitCode } = await run(package_dir, "install");

      expect(err).toContain(`ENAMETOOLONG: link path for package ${link_name} is too long`);
      expect(out).toContain("Failed to install 1 package");
      expect(await file(join(package_dir, "node_modules", link_name, "package.json")).exists()).toBe(false);
      expect(exitCode).toBe(1);

      // Like the other per-package failures, the error respects --silent.
      expect(await run(package_dir, "install", "--silent")).toEqual({ out: "", err: "", exitCode: 1 });
    } finally {
      await run(link_dir, "unlink");
    }
  });

  it("still resolves a specifier that normalizes to a linked package", async () => {
    const link_name = basename(link_dir).slice("bun-link.".length);
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: { [link_name]: "link:" + Buffer.alloc(LONG_SPEC_BYTES, "x/../").toString() + link_name },
      }),
    );

    // Nothing is registered under this name: resolution gets as far as looking
    // the name up in the link directory, like `link:${link_name}` would.
    const { err, exitCode } = await run(package_dir, "install");

    expect(err).toContain(`error: Package "${link_name}" is not linked`);
    expect(err).not.toContain("ENAMETOOLONG");
    expect(exitCode).toBe(1);
  });
});

// The install family shares one flag table, but `bun link <package>` and `bun unlink` invert the
// --save default (CommandLineArguments.parse): they only touch package.json and the lockfile when
// --save is passed, so their --help has to describe the flag differently from bun install's.
it.each([
  ["install", "Save to package.json (true by default)", "Don't update package.json or save a lockfile"],
  ["add", "Save to package.json (true by default)", "Don't update package.json or save a lockfile"],
  ["update", "Save to package.json (true by default)", "Don't update package.json or save a lockfile"],
  ["remove", "Save to package.json (true by default)", "Don't update package.json or save a lockfile"],
  [
    "link",
    "Update package.json and save a lockfile (false by default)",
    "Don't update package.json or save a lockfile (the default)",
  ],
  [
    "unlink",
    "Update package.json and save a lockfile (false by default)",
    "Don't update package.json or save a lockfile (the default)",
  ],
])("bun %s --help describes the --save default it actually has", async (subcommand, save, noSave) => {
  await using proc = spawn({
    cmd: [bunExe(), subcommand, "--help"],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lines = stdout.split(/\r?\n/).map(line => line.trim());
  const descriptionOf = (flag: string) =>
    lines
      .find(line => line.startsWith(`${flag} `))
      ?.slice(flag.length)
      .trim();
  expect({ "--save": descriptionOf("--save"), "--no-save": descriptionOf("--no-save"), stderr, exitCode }).toEqual({
    "--save": save,
    "--no-save": noSave,
    stderr: "",
    exitCode: 0,
  });
});

it("bun link <package> only writes package.json and a lockfile when --save is passed", async () => {
  const appPackageJson = JSON.stringify({ name: "app", version: "1.0.0" });
  using dir = tempDir("bun-link-save", {
    "lib/package.json": JSON.stringify({ name: "lib-to-link", version: "1.0.0" }),
    "app/package.json": appPackageJson,
  });
  const app = join(String(dir), "app");
  // Register the package in a global dir private to this test instead of the machine's real one.
  const linkEnv = {
    ...env,
    BUN_INSTALL_GLOBAL_DIR: join(String(dir), "global", "install", "global"),
    BUN_INSTALL_BIN: join(String(dir), "global", "bin"),
  };
  async function bun(cwd: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: linkEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  let { stdout, stderr, exitCode } = await bun(join(String(dir), "lib"), "link");
  expect(stderr).toBe("");
  expect(stdout).toContain('Success! Registered "lib-to-link"');
  expect(exitCode).toBe(0);

  ({ stdout, stderr, exitCode } = await bun(app, "link", "lib-to-link"));
  expect(stderr).toBe("");
  expect(stdout).toContain("installed lib-to-link@link:lib-to-link");
  expect(exitCode).toBe(0);
  expect(await file(join(app, "node_modules", "lib-to-link", "package.json")).json()).toEqual({
    name: "lib-to-link",
    version: "1.0.0",
  });
  expect(await file(join(app, "package.json")).text()).toBe(appPackageJson);
  expect(await readdirSorted(app)).toEqual(["node_modules", "package.json"]);

  ({ stdout, stderr, exitCode } = await bun(app, "link", "lib-to-link", "--save"));
  expect(stderr).toContain("Saved lockfile");
  expect(stdout).toContain("installed lib-to-link@link:lib-to-link");
  expect(exitCode).toBe(0);
  expect(await file(join(app, "package.json")).json()).toEqual({
    name: "app",
    version: "1.0.0",
    dependencies: { "lib-to-link": "link:lib-to-link" },
  });
  expect(await readdirSorted(app)).toEqual(["bun.lock", "node_modules", "package.json"]);
});

it("link and unlink --dry-run do not touch the global link directory", async () => {
  using dir = tempDir("link-dry-run", {
    "package.json": JSON.stringify({ name: "linkme-dry", version: "1.0.0" }),
  });
  const bunInstall = join(String(dir), "bun-install");
  const globalLinks = join(bunInstall, "install", "global", "node_modules");

  const run = async (...cmd: string[]) => {
    await using proc = spawn({
      cmd: [bunExe(), ...cmd],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...env, BUN_INSTALL: bunInstall },
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.replace(/^bun (un)?link v.*\n+/, ""), stderr, exitCode };
  };

  expect(await run("link", "--dry-run")).toEqual({
    stdout: 'dry run: would link "linkme-dry"\n',
    stderr: "",
    exitCode: 0,
  });
  expect(await readdirSorted(globalLinks).catch(() => [])).toEqual([]);

  expect(await run("link")).toMatchObject({
    stdout: expect.stringContaining('Success! Registered "linkme-dry"'),
    exitCode: 0,
  });
  expect(await readdirSorted(globalLinks)).toEqual(["linkme-dry"]);

  expect(await run("unlink", "--dry-run")).toEqual({
    stdout: 'dry run: would unlink "linkme-dry"\n',
    stderr: "",
    exitCode: 0,
  });
  expect(await readdirSorted(globalLinks)).toEqual(["linkme-dry"]);

  expect(await run("unlink")).toMatchObject({
    stdout: expect.stringContaining('success: unlinked package "linkme-dry"'),
    exitCode: 0,
  });
  expect(await readdirSorted(globalLinks)).toEqual([]);
});

// The registry of `bun link` is the global folder already. With `-g` the commands ran in that
// folder: `bun link -g` and `bun unlink -g` failed on its package.json (`missing "name"`), and
// `bun link -g <name>` removed the registration of <name> and exited 0.
it("link and unlink ignore -g", async () => {
  using dir = tempDir("link-global-flag", {
    "lib/package.json": JSON.stringify({ name: "linkme-global", version: "1.0.0" }),
    "app/package.json": JSON.stringify({ name: "app", version: "1.0.0" }),
  });
  const bunInstall = join(String(dir), "bun-install");
  const global = join(bunInstall, "install", "global");

  const run = async (cwd: string, ...cmd: string[]) => {
    await using proc = spawn({
      cmd: [bunExe(), ...cmd],
      cwd: join(String(dir), cwd),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...env, BUN_INSTALL: bunInstall },
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };

  expect(await run("lib", "link", "-g")).toMatchObject({
    stdout: expect.stringContaining('Success! Registered "linkme-global"'),
    exitCode: 0,
  });
  expect(await readdirSorted(global)).toEqual(["node_modules"]);
  expect(await file(join(global, "node_modules", "linkme-global", "package.json")).json()).toEqual({
    name: "linkme-global",
    version: "1.0.0",
  });

  expect(await run("app", "link", "-g", "linkme-global")).toMatchObject({
    stdout: expect.stringContaining("installed linkme-global@link:linkme-global"),
    exitCode: 0,
  });
  expect(await file(join(String(dir), "app", "node_modules", "linkme-global", "package.json")).json()).toEqual({
    name: "linkme-global",
    version: "1.0.0",
  });
  expect(await readdirSorted(join(global, "node_modules"))).toEqual(["linkme-global"]);

  expect(await run("lib", "unlink", "-g")).toMatchObject({
    stdout: expect.stringContaining('success: unlinked package "linkme-global"'),
    exitCode: 0,
  });
  expect(await readdirSorted(join(global, "node_modules"))).toEqual([]);
});

describe("global bin dir", () => {
  // What a bin named `name` occupies in a bin dir: the symlink itself on POSIX, the `.exe` half
  // of the `.exe` + `.bunx` shim pair on Windows.
  const binEntry = (name: string) => (isWindows ? `${name}.exe` : name);
  const linkTarget = (pkg: string, ...file: string[]) => join("..", "install", "global", "node_modules", pkg, ...file);
  const pkgFiles = (name: string, bin: Record<string, string>) => ({
    "package.json": JSON.stringify({ name, version: "1.0.0", bin }),
    "cli.js": "#!/usr/bin/env node\n",
    "dist/cli.js": "#!/usr/bin/env node\n",
  });

  async function run(command: "link" | "unlink", pkg: string, bunInstall: string) {
    await using proc = spawn({
      cmd: [bunExe(), command],
      cwd: pkg,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...env, BUN_INSTALL: bunInstall },
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err, exitCode };
  }

  it("bun link leaves what bun did not put there alone", async () => {
    using bunInstall = tempDir("link-global", {
      // A regular file, which is what `bun` itself is in this directory.
      [`bin/${binEntry("bun")}`]: "the bun binary",
      [`bin/${binEntry("adir")}/inner.txt`]: "keep",
      "elsewhere.txt": "",
    });
    const binDir = join(String(bunInstall), "bin");
    if (!isWindows) await symlink(join(String(bunInstall), "elsewhere.txt"), join(binDir, "foreign"));
    // Bins are linked in map order: the taken names first, then the free one.
    using pkg = tempDir(
      "link-pkg",
      pkgFiles("taken-names", { bun: "cli.js", adir: "cli.js", foreign: "cli.js", "taken-names": "cli.js" }),
    );

    const { err, exitCode } = await run("link", String(pkg), String(bunInstall));
    expect(err).toContain("failed to link bin due to error EEXIST");

    expect(join(binDir, "taken-names")).toBeValidBin(linkTarget("taken-names", "cli.js"));
    expect(await readFile(join(binDir, binEntry("bun")), "utf8")).toBe("the bun binary");
    if (isWindows) expect(await exists(join(binDir, "bun.bunx"))).toBeFalse();
    expect(await readFile(join(binDir, binEntry("adir"), "inner.txt"), "utf8")).toBe("keep");
    if (!isWindows) expect(await readlink(join(binDir, "foreign"))).toBe(join(String(bunInstall), "elsewhere.txt"));
    expect(exitCode).toBe(1);
  });

  it("bun link takes a bin name over from another linked package", async () => {
    using bunInstall = tempDir("link-global", {});
    using first = tempDir("link-pkg", pkgFiles("first-owner", { shared: "cli.js" }));
    using second = tempDir("link-pkg", pkgFiles("second-owner", { shared: "cli.js" }));
    const bin = join(String(bunInstall), "bin", "shared");

    let result = await run("link", String(first), String(bunInstall));
    expect(result.err).toBe("");
    expect(bin).toBeValidBin(linkTarget("first-owner", "cli.js"));
    expect(result.exitCode).toBe(0);

    result = await run("link", String(second), String(bunInstall));
    expect(result.err).toBe("");
    expect(bin).toBeValidBin(linkTarget("second-owner", "cli.js"));
    expect(result.exitCode).toBe(0);

    // The name is no longer the first package's to remove.
    result = await run("unlink", String(first), String(bunInstall));
    expect(result.out).toContain('success: unlinked package "first-owner"');
    if (!isWindows) expect(bin).toBeValidBin(linkTarget("second-owner", "cli.js"));
    expect(result.exitCode).toBe(0);
  });

  it("bun link again replaces the bin links it made before", async () => {
    using bunInstall = tempDir("link-global", {});
    using pkg = tempDir("link-pkg", pkgFiles("moved-bin", { "moved-bin": "cli.js" }));
    const bin = join(String(bunInstall), "bin", "moved-bin");

    let result = await run("link", String(pkg), String(bunInstall));
    expect(result.err).toBe("");
    expect(bin).toBeValidBin(linkTarget("moved-bin", "cli.js"));
    expect(result.exitCode).toBe(0);

    await writeFile(
      join(String(pkg), "package.json"),
      pkgFiles("moved-bin", { "moved-bin": "dist/cli.js" })["package.json"],
    );
    result = await run("link", String(pkg), String(bunInstall));
    expect(result.err).toBe("");
    expect(bin).toBeValidBin(linkTarget("moved-bin", "dist", "cli.js"));
    expect(result.exitCode).toBe(0);
  });

  it.skipIf(!isWindows)("bun link removes a shim it could not finish writing", async () => {
    using bunInstall = tempDir("link-global", {});
    using pkg = tempDir("link-pkg", pkgFiles("half-shim", { "half-shim": "cli.js" }));
    const binDir = join(String(bunInstall), "bin");
    // The launcher is not valid UTF-8, so encoding the .bunx sidecar fails after the file was created.
    await writeFile(
      join(String(pkg), "cli.js"),
      Buffer.concat([Buffer.from("#!/usr/bin/env n"), Buffer.from([0x80, 0x80]), Buffer.from("\n")]),
    );

    let result = await run("link", String(pkg), String(bunInstall));
    expect(result.err).toContain("InvalidBinContent");
    expect(await Promise.all([exists(join(binDir, "half-shim.bunx")), exists(join(binDir, "half-shim.exe"))])).toEqual([
      false,
      false,
    ]);
    expect(result.exitCode).toBe(1);

    await writeFile(join(String(pkg), "cli.js"), "#!/usr/bin/env node\n");
    result = await run("link", String(pkg), String(bunInstall));
    expect(result.err).toBe("");
    expect(join(binDir, "half-shim")).toBeValidBin(linkTarget("half-shim", "cli.js"));
    expect(result.exitCode).toBe(0);
  });

  it("bun unlink removes its own bins and nothing else", async () => {
    using bunInstall = tempDir("link-global", { "elsewhere.txt": "" });
    using pkg = tempDir("link-pkg", pkgFiles("own-bin", { "own-bin": "cli.js" }));
    const binDir = join(String(bunInstall), "bin");

    let result = await run("link", String(pkg), String(bunInstall));
    expect(result.err).toBe("");
    expect(join(binDir, "own-bin")).toBeValidBin(linkTarget("own-bin", "cli.js"));
    expect(result.exitCode).toBe(0);

    // `bun unlink` removes the names in the bin map as it is now, not as it was when linking.
    await writeFile(join(binDir, binEntry("bun")), "the bun binary");
    await mkdir(join(binDir, binEntry("adir")));
    await writeFile(join(binDir, binEntry("adir"), "inner.txt"), "keep");
    if (!isWindows) await symlink(join(String(bunInstall), "elsewhere.txt"), join(binDir, "foreign"));
    await writeFile(
      join(String(pkg), "package.json"),
      pkgFiles("own-bin", { "own-bin": "cli.js", bun: "cli.js", adir: "cli.js", foreign: "cli.js" })["package.json"],
    );

    result = await run("unlink", String(pkg), String(bunInstall));
    expect(result.out).toContain('success: unlinked package "own-bin"');

    expect(await exists(join(binDir, binEntry("own-bin")))).toBeFalse();
    if (isWindows) expect(await exists(join(binDir, "own-bin.bunx"))).toBeFalse();
    expect(await readFile(join(binDir, binEntry("bun")), "utf8")).toBe("the bun binary");
    expect(await readFile(join(binDir, binEntry("adir"), "inner.txt"), "utf8")).toBe("keep");
    if (!isWindows) expect(await readlink(join(binDir, "foreign"))).toBe(join(String(bunInstall), "elsewhere.txt"));
    expect(result.exitCode).toBe(0);
  });
});
