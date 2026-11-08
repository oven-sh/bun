import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  access,
  exists,
  link as fsLink,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "fs/promises";
import {
  bunExe,
  bunEnv as env,
  isASAN,
  isMacOS,
  isWindows,
  readdirSorted,
  runBunInstall,
  substDrive,
  tempDir,
  tmpdirSync,
  toBeValidBin,
  toHaveBins,
} from "harness";
import { basename, join } from "path";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistryForContext,
  package_dir,
  setContextHandler,
  type TestContext,
} from "./dummy.registry";

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
    // The install above was isolated: the root's links to both workspaces are new to the hoisted one.
    "3 packages installed",
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
  // Hoisted to the root, like any other dependency of a workspace.
  expect(await file(join(link_dir, "node_modules", "foo", "package.json")).json()).toEqual({
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
  // No stack trace after it in a debug build, on either stream.
  expect(err4.split(/\r?\n/)).toEqual([
    `FileNotFound: failed linking dependency/workspace to node_modules for package ${link_name}`,
    "",
  ]);
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
// https://github.com/oven-sh/bun/issues/29273
// `C:` is the current directory of drive C, it is not the root `C:\`.
it.skipIf(!isWindows)("should link a package in the root of a drive", async () => {
  const link_name = basename(link_dir).slice("bun-link.".length) + "-drive-root";
  await writeFile(join(link_dir, "package.json"), JSON.stringify({ name: link_name, version: "0.0.1" }));
  await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "bar", version: "0.0.2" }));
  using drive = substDrive(link_dir);

  async function run(cwd: string, ...args: string[]) {
    await using proc = spawn({ cmd: [bunExe(), ...args], cwd, stdout: "pipe", stdin: "ignore", stderr: "pipe", env });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const registered = await run(drive.root, "link");
  expect(registered.stderr).toBe("");
  expect(registered.stdout).toContain(`Success! Registered "${link_name}"`);
  expect(registered.exitCode).toBe(0);

  const linked = await run(package_dir, "link", link_name);
  expect(linked.stderr).toBe("");
  expect(linked.stdout).toContain(`installed ${link_name}@link:${link_name}`);
  expect(await file(join(package_dir, "node_modules", link_name, "package.json")).json()).toEqual({
    name: link_name,
    version: "0.0.1",
  });
  expect(linked.exitCode).toBe(0);

  const unlinked = await run(drive.root, "unlink");
  expect(unlinked.stderr).toBe("");
  expect(unlinked.stdout).toContain(`success: unlinked package "${link_name}"`);
  expect(unlinked.exitCode).toBe(0);
});

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

  // Too long for a package name, so it is a path (bun-install-link-path.test.ts).
  it("fails to read a target that does not fit", async () => {
    const target = Buffer.alloc(LONG_SPEC_BYTES, "n").toString();
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: `link:${target}` } }),
    );

    const { err, exitCode } = await run(package_dir, "install");

    expect(err).toContain('error: Dependency "bar" has an unsafe folder path');
    expect(exitCode).toBe(1);
  });

  // The resolution of a bun.lock row is what gets linked, as written.
  it("fails to install a bun.lock row that does not fit", async () => {
    const dependencies = { bar: "link:./bar" };
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1", dependencies }));
    await writeFile(
      join(package_dir, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "foo", dependencies } },
        packages: { bar: [`bar@link:./${Buffer.alloc(LONG_SPEC_BYTES, "n").toString()}`, {}] },
      }),
    );

    const { out, err, exitCode } = await run(package_dir, "install");

    expect(err).toContain("ENAMETOOLONG: link path for package bar is too long");
    expect(out).toContain("Failed to install 1 package");
    expect(await file(join(package_dir, "node_modules", "bar", "package.json")).exists()).toBe(false);
    expect(exitCode).toBe(1);

    // Like the other per-package failures, the error respects --silent.
    expect(await run(package_dir, "install", "--silent")).toEqual({ out: "", err: "", exitCode: 1 });
  });

  // `x/../` segments normalize away before the length counts.
  it("still resolves a specifier that only fits once normalized", async () => {
    const dependencies = { bar: "link:" + Buffer.alloc(LONG_SPEC_BYTES, "x/../").toString() + "vendor/bar" };
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1", dependencies }));

    const missing = await run(package_dir, "install");
    expect(missing.err).toContain('error: directory "./vendor/bar" not found for linked dependency "bar"');
    expect(missing.err).not.toContain("ENAMETOOLONG");
    expect(missing.exitCode).toBe(1);

    await mkdir(join(package_dir, "vendor", "bar"), { recursive: true });
    await writeFile(
      join(package_dir, "vendor", "bar", "package.json"),
      JSON.stringify({ name: "bar", version: "0.0.1" }),
    );

    const { err, exitCode } = await run(package_dir, "install");
    expect(err).not.toContain("error:");
    expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
      name: "bar",
      version: "0.0.1",
    });
    expect(exitCode).toBe(0);
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

// https://github.com/oven-sh/bun/issues/24190
describe.each(["hoisted", "isolated"] as const)("bun link <package> in a workspace member (%s linker)", linker => {
  /** Installs the workspace, runs `bun link lib-to-link` in `packages/app` and says what that left behind. */
  async function linkInMember(dependencies: Record<string, string>, ...flags: string[]) {
    using dir = tempDir("bun-link-member", {
      "lib/package.json": JSON.stringify({ name: "lib-to-link", version: "1.0.0" }),
      "mono/bunfig.toml": `[install]\nlinker = "${linker}"\n`,
      "mono/package.json": JSON.stringify({ name: "mono", workspaces: ["packages/*"] }),
      "mono/packages/app/package.json": JSON.stringify({ name: "app", dependencies }),
      "mono/packages/util/package.json": JSON.stringify({ name: "util", version: "1.0.0" }),
      "mono/vendor/bar-0.0.2.tgz": await readFile(join(import.meta.dir, "bar-0.0.2.tgz")),
    });
    const mono = join(String(dir), "mono");
    const app = join(mono, "packages", "app");
    async function bun(cwd: string, ...args: string[]) {
      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd,
        env: { ...env, BUN_INSTALL: join(String(dir), "bun-install") },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    expect(await bun(mono, "install")).toMatchObject({ exitCode: 0 });
    expect(await bun(join(String(dir), "lib"), "link")).toMatchObject({ stderr: "", exitCode: 0 });
    const lockfile = await file(join(mono, "bun.lock")).text();

    const { stdout, stderr, exitCode } = await bun(app, "link", "lib-to-link", ...flags);
    return {
      stderr,
      installed: stdout.includes("installed lib-to-link@link:lib-to-link"),
      linksToLib:
        (await realpath(join(linker === "hoisted" ? mono : app, "node_modules", "lib-to-link")).catch(() => null)) ===
        (await realpath(join(String(dir), "lib"))),
      app: await readdirSorted(app),
      appNodeModules: await readdirSorted(join(app, "node_modules")).catch(() => []),
      dependencies: (await file(join(app, "package.json")).json()).dependencies,
      addedToRootLockfile: (await file(join(mono, "bun.lock")).text())
        .split("\n")
        .filter(line => !lockfile.includes(line))
        .map(line => line.trim()),
      exitCode,
    };
  }
  const isolated = linker === "isolated";
  const bar = "file:../../vendor/bar-0.0.2.tgz";

  it.concurrent("finds the sibling the member depends on", async () => {
    expect(await linkInMember({ util: "workspace:*" })).toEqual({
      stderr: "",
      installed: true,
      linksToLib: true,
      app: isolated ? ["node_modules", "package.json"] : ["package.json"],
      appNodeModules: isolated ? ["lib-to-link", "util"] : [],
      dependencies: { util: "workspace:*" },
      addedToRootLockfile: [],
      exitCode: 0,
    });
  });

  it.concurrent("does not install the member's dependencies a second time", async () => {
    expect(await linkInMember({ bar })).toEqual({
      stderr: "",
      installed: true,
      linksToLib: true,
      app: isolated ? ["node_modules", "package.json"] : ["package.json"],
      appNodeModules: isolated ? ["bar", "lib-to-link"] : [],
      dependencies: { bar },
      addedToRootLockfile: [],
      exitCode: 0,
    });
  });

  it.concurrent("--save writes the member's package.json and the root's bun.lock", async () => {
    expect(await linkInMember({ bar }, "--save")).toEqual({
      stderr: expect.stringContaining("Saved lockfile"),
      installed: true,
      linksToLib: true,
      app: isolated ? ["node_modules", "package.json"] : ["package.json"],
      appNodeModules: isolated ? ["bar", "lib-to-link"] : [],
      dependencies: { bar, "lib-to-link": "link:lib-to-link" },
      addedToRootLockfile: [
        '"lib-to-link": "link:lib-to-link",',
        '"lib-to-link": ["lib-to-link@link:lib-to-link", {}],',
      ],
      exitCode: 0,
    });
  });
});

it("a link: dependency whose link is in place is not linked again", async () => {
  using dir = tempDir("bun-link-warm", {
    "lib/package.json": JSON.stringify({ name: "lib-to-link", version: "1.0.0" }),
    "other/package.json": JSON.stringify({ name: "lib-to-link", version: "1.0.0" }),
    "app/package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { "lib-to-link": "link:lib-to-link" },
    }),
  });
  const app = join(String(dir), "app");
  const link = join(app, "node_modules", "lib-to-link");
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

  expect((await bun(join(String(dir), "lib"), "link")).exitCode).toBe(0);
  let { stdout, exitCode } = await bun(app, "install", "--linker=hoisted");
  expect(stdout).toContain("1 package installed");
  expect(exitCode).toBe(0);
  // A hard link of the symlink keeps its inode number from being used for a new one. On macOS
  // link() follows the symlink, and APFS gives no number out twice.
  if (!isWindows && !isMacOS) await fsLink(link, join(String(dir), "pin"));
  const before = (await lstat(link)).ino;

  ({ stdout, exitCode } = await bun(app, "install", "--linker=hoisted"));
  expect(stdout).toContain("(no changes)");
  expect(exitCode).toBe(0);
  if (!isWindows) expect((await lstat(link)).ino).toBe(before);

  // The same name and version registered from another directory: the link has to move.
  expect((await bun(join(String(dir), "other"), "link")).exitCode).toBe(0);
  ({ stdout, exitCode } = await bun(app, "install", "--linker=hoisted"));
  expect(stdout).toContain("1 package installed");
  expect(exitCode).toBe(0);
  expect(await realpath(link)).toBe(await realpath(join(String(dir), "other")));
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

describe.each(["link", "unlink"])("bun %s", command => {
  it.each([
    [{ version: "0.0.1" }, 'error: package.json missing "name"'],
    [{ name: "NOT a valid name!", version: "0.0.1" }, 'error: invalid package.json name "NOT a valid name!"'],
  ])("refuses %j", async (packageJson, message) => {
    using dir = tempDir("link-bad-name", { "package.json": JSON.stringify(packageJson) });
    await using proc = spawn({
      cmd: [bunExe(), command],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...env, BUN_INSTALL: join(String(dir), "bun-install") },
    });
    const [err, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(err).toContain(message);
    expect(exitCode).toBe(1);
  });

  it("--dry-run creates no package.json", async () => {
    using dir = tempDir("link-dry-run-empty", {});
    using bunInstall = tempDir("link-dry-run-empty-install", {});
    await using proc = spawn({
      cmd: [bunExe(), command, "--dry-run"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...env, BUN_INSTALL: String(bunInstall) },
    });
    const [err, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(err).toContain("could not find a package.json");
    expect(await readdirSorted(String(dir))).toEqual([]);
    expect(exitCode).toBe(1);
  });
});

describe("global bin dir", () => {
  // Returns the file that a bin named `name` creates in a bin directory: the symlink itself on POSIX, and the `.exe`
  // half of the `.exe` + `.bunx` shim pair on Windows.
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

  it("bun link doesn't touch files that bun didn't create", async () => {
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

describe.each(["hoisted", "isolated"] as const)("when a package fails to install (%s linker)", linker => {
  async function run(ctx: TestContext, cmd: string, stdin?: string) {
    await using proc = spawn({
      cmd: [bunExe(), ...cmd.split(" ")],
      cwd: ctx.package_dir,
      env: { ...env, BUN_INSTALL_GLOBAL_DIR: join(ctx.package_dir, "global") },
      stdin: stdin === undefined ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    if (stdin !== undefined) {
      proc.stdin!.write(stdin);
      proc.stdin!.end();
    }
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // An installed project with a `file:` dependency `dep`, a package `linked` that is registered
  // for `bun link`, and a registry that serves `baz` 0.0.3 and 0.0.5.
  async function withProject(dependencies: Record<string, string>, fn: (ctx: TestContext) => Promise<void>) {
    const ctx = await createTestContext({ linker });
    try {
      setContextHandler(ctx, dummyRegistryForContext(ctx, [], { "0.0.3": {}, "0.0.5": {} }));
      const dir = ctx.package_dir;
      for (const name of ["dep", "linked"]) {
        await mkdir(join(dir, name));
        await writeFile(join(dir, name, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
      }
      await mkdir(join(dir, "global", "node_modules"), { recursive: true });
      await symlink(join(dir, "linked"), join(dir, "global", "node_modules", "linked"), "junction");
      await writeFile(join(dir, "entry.js"), `import "baz";`);
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ name: "app", dependencies: { dep: "file:./dep", ...dependencies } }),
      );
      expect(await run(ctx, "install")).toMatchObject({ exitCode: 0 });
      await fn(ctx);
    } finally {
      destroyTestContext(ctx);
    }
  }

  // The lockfile resolves `dep` to a folder that no longer exists, so the install step of every
  // command fails to place that one package.
  async function withFailingInstall(dependencies: Record<string, string>, fn: (ctx: TestContext) => Promise<void>) {
    await withProject(dependencies, async ctx => {
      await rm(join(ctx.package_dir, "dep"), { recursive: true });
      await rm(join(ctx.package_dir, "node_modules"), { recursive: true });
      await fn(ctx);
    });
  }

  async function expectExit1(cmd: string, dependencies: Record<string, string> = {}, stdin?: string) {
    await withFailingInstall(dependencies, async ctx => {
      const { stdout, exitCode } = await run(ctx, cmd, stdin);
      expect({ stdout, exitCode }).toEqual({
        stdout: expect.stringContaining("Failed to install 1 package"),
        exitCode: 1,
      });
    });
  }

  it.concurrent.each([
    { cmd: "install" },
    { cmd: "add baz" },
    { cmd: "add baz --filter *" },
    { cmd: "link linked" },
    { cmd: "install baz" },
    { cmd: "install baz --filter *" },
    { cmd: "remove not-a-dependency" },
    // Space selects baz, Enter confirms.
    { cmd: "update --interactive --latest", dependencies: { baz: "0.0.3" }, stdin: " \r" },
    { cmd: "update --interactive --latest --recursive", dependencies: { baz: "0.0.3" }, stdin: " \r" },
  ])("bun $cmd exits 1", async ({ cmd, dependencies, stdin }) => {
    await expectExit1(cmd, dependencies, stdin);
  });

  // Not concurrent, because this command runs the bundler, which is slow on a debug build. `--analyze` exits from
  // inside the bundler's scan, even when it succeeds, and LeakSanitizer reports what the scan has allocated.
  it.skipIf(isASAN)("bun install --analyze entry.js exits 1", async () => {
    await expectExit1("install --analyze entry.js");
  });

  it.concurrent("bun link <pkg> --silent exits 1", async () => {
    await withFailingInstall({}, async ctx => {
      const { stdout, exitCode } = await run(ctx, "link linked --silent");
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
    });
  });

  it.concurrent("bun patch <pkg> prepares the patch before it exits 1", async () => {
    await withFailingInstall({ baz: "0.0.3" }, async ctx => {
      const { stdout, exitCode } = await run(ctx, "patch baz");
      expect({ stdout, exitCode }).toEqual({
        stdout: expect.stringMatching(/Failed to install 1 package.*To patch baz/s),
        exitCode: 1,
      });
    });
  });

  it.concurrent("bun remove <name that is not a dependency> exits 0 when every package installs", async () => {
    await withProject({}, async ctx => {
      const { stdout, exitCode } = await run(ctx, "remove not-a-dependency");
      expect({ stdout, exitCode }).toEqual({
        stdout: expect.not.stringContaining("Failed to install"),
        exitCode: 0,
      });
    });
  });
});
