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

  it("bun link leaves entries that are not its own bins alone", async () => {
    using bunInstall = tempDir("link-global", {
      // A regular file, which is what `bun` itself is in this directory.
      [`bin/${binEntry("bun")}`]: "the bun binary",
      [`bin/${binEntry("adir")}/inner.txt`]: "keep",
      "elsewhere.txt": "",
    });
    const binDir = join(String(bunInstall), "bin");
    if (!isWindows) await symlink(join(String(bunInstall), "elsewhere.txt"), join(binDir, "foreign"));
    // Bins are linked in map order: the free name first, then the taken ones.
    using pkg = tempDir(
      "link-pkg",
      pkgFiles("taken-names", { "taken-names": "cli.js", bun: "cli.js", adir: "cli.js", foreign: "cli.js" }),
    );

    const { err, exitCode } = await run("link", String(pkg), String(bunInstall));
    expect(err).toContain("failed to link bin");
    expect(exitCode).toBe(1);

    expect(join(binDir, "taken-names")).toBeValidBin(linkTarget("taken-names", "cli.js"));
    expect(await readFile(join(binDir, binEntry("bun")), "utf8")).toBe("the bun binary");
    if (isWindows) expect(await exists(join(binDir, "bun.bunx"))).toBeFalse();
    expect(await readFile(join(binDir, binEntry("adir"), "inner.txt"), "utf8")).toBe("keep");
    if (!isWindows) expect(await readlink(join(binDir, "foreign"))).toBe(join(String(bunInstall), "elsewhere.txt"));
  });

  it("bun link does not take a bin name over from another linked package", async () => {
    using bunInstall = tempDir("link-global", {});
    using first = tempDir("link-pkg", pkgFiles("first-owner", { shared: "cli.js" }));
    using second = tempDir("link-pkg", pkgFiles("second-owner", { shared: "cli.js" }));
    const bin = join(String(bunInstall), "bin", "shared");

    let result = await run("link", String(first), String(bunInstall));
    expect(result.err).toBe("");
    expect(result.exitCode).toBe(0);
    expect(bin).toBeValidBin(linkTarget("first-owner", "cli.js"));

    result = await run("link", String(second), String(bunInstall));
    expect(result.err).toContain("failed to link bin");
    expect(result.exitCode).toBe(1);
    expect(bin).toBeValidBin(linkTarget("first-owner", "cli.js"));
  });

  it("bun link again replaces the bin links it made before", async () => {
    using bunInstall = tempDir("link-global", {});
    using pkg = tempDir("link-pkg", pkgFiles("moved-bin", { "moved-bin": "cli.js" }));
    const bin = join(String(bunInstall), "bin", "moved-bin");

    let result = await run("link", String(pkg), String(bunInstall));
    expect(result.err).toBe("");
    expect(result.exitCode).toBe(0);
    expect(bin).toBeValidBin(linkTarget("moved-bin", "cli.js"));

    await writeFile(
      join(String(pkg), "package.json"),
      pkgFiles("moved-bin", { "moved-bin": "dist/cli.js" })["package.json"],
    );
    result = await run("link", String(pkg), String(bunInstall));
    expect(result.err).toBe("");
    expect(result.exitCode).toBe(0);
    expect(bin).toBeValidBin(linkTarget("moved-bin", "dist", "cli.js"));
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
    expect(result.exitCode).toBe(1);
    expect(await Promise.all([exists(join(binDir, "half-shim.bunx")), exists(join(binDir, "half-shim.exe"))])).toEqual([
      false,
      false,
    ]);

    // Nothing is left behind that the next link would have to treat as foreign.
    await writeFile(join(String(pkg), "cli.js"), "#!/usr/bin/env node\n");
    result = await run("link", String(pkg), String(bunInstall));
    expect(result.err).toBe("");
    expect(result.exitCode).toBe(0);
    expect(join(binDir, "half-shim")).toBeValidBin(linkTarget("half-shim", "cli.js"));
  });

  it("bun unlink removes its own bins and nothing else", async () => {
    using bunInstall = tempDir("link-global", { "elsewhere.txt": "" });
    using pkg = tempDir("link-pkg", pkgFiles("own-bin", { "own-bin": "cli.js" }));
    const binDir = join(String(bunInstall), "bin");

    let result = await run("link", String(pkg), String(bunInstall));
    expect(result.err).toBe("");
    expect(result.exitCode).toBe(0);
    expect(join(binDir, "own-bin")).toBeValidBin(linkTarget("own-bin", "cli.js"));

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
    expect(result.exitCode).toBe(0);

    expect(await exists(join(binDir, binEntry("own-bin")))).toBeFalse();
    if (isWindows) expect(await exists(join(binDir, "own-bin.bunx"))).toBeFalse();
    expect(await readFile(join(binDir, binEntry("bun")), "utf8")).toBe("the bun binary");
    expect(await readFile(join(binDir, binEntry("adir"), "inner.txt"), "utf8")).toBe("keep");
    if (!isWindows) expect(await readlink(join(binDir, "foreign"))).toBe(join(String(bunInstall), "elsewhere.txt"));
  });
});
