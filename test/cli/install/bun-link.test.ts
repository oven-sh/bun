import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import { access, mkdir, readlink, rm, writeFile } from "fs/promises";
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
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  getPort,
  package_dir,
  root_url,
  setHandler,
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

// https://github.com/oven-sh/bun/issues/4719
describe.each(["hoisted", "isolated"])("link: with a filesystem path (%s)", linker => {
  async function setLinker() {
    await writeFile(
      join(package_dir, "bunfig.toml"),
      `[install]\ncache = false\nregistry = "http://localhost:${getPort()}/"\nsaveTextLockfile = true\nlinker = "${linker}"\n`,
    );
  }

  async function checkLink(dep: string, expected: { name: string; version: string }) {
    await setLinker();
    const { out, err } = await runBunInstall(env, package_dir);
    expect(err).not.toContain("not linked");
    if (linker === "hoisted") expect(out).toContain(`+ ${expected.name}@link:`);

    const target = await readlink(join(package_dir, "node_modules", ...expected.name.split("/")));
    expect(target.replaceAll("\\", "/")).toContain(basename(dep));
    expect(await file(join(package_dir, "node_modules", expected.name, "package.json")).json()).toEqual(expected);

    const second = await runBunInstall(env, package_dir, { frozenLockfile: true });
    expect(second.err).not.toContain("Saved lockfile");
  }

  it("resolves a ./relative path", async () => {
    await mkdir(join(package_dir, "lib", "mypkg"), { recursive: true });
    await writeFile(
      join(package_dir, "lib", "mypkg", "package.json"),
      JSON.stringify({ name: "mypkg", version: "1.0.0" }),
    );
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "root",
        dependencies: { mypkg: "link:./lib/mypkg" },
      }),
    );
    await checkLink("./lib/mypkg", { name: "mypkg", version: "1.0.0" });
  });

  it("treats a bare relative path (no ./) as a path, and stores it as ./", async () => {
    await mkdir(join(package_dir, "lib", "bare"), { recursive: true });
    await writeFile(
      join(package_dir, "lib", "bare", "package.json"),
      JSON.stringify({ name: "bare", version: "1.0.0" }),
    );
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "root", dependencies: { bare: "link:lib/bare" } }),
    );
    await checkLink("lib/bare", { name: "bare", version: "1.0.0" });
    expect(await file(join(package_dir, "bun.lock")).text()).toContain('"bare@link:./lib/bare"');
  });

  it("resolves a ../relative path", async () => {
    await mkdir(join(link_dir, "sibling"), { recursive: true });
    await writeFile(
      join(link_dir, "sibling", "package.json"),
      JSON.stringify({ name: "sibling-pkg", version: "2.0.0" }),
    );
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "root",
        dependencies: { "sibling-pkg": `link:${join("..", basename(link_dir), "sibling").replaceAll("\\", "/")}` },
      }),
    );
    await checkLink("sibling", { name: "sibling-pkg", version: "2.0.0" });
  });

  it("resolves a scoped package path", async () => {
    await mkdir(join(package_dir, "packages", "scoped"), { recursive: true });
    await writeFile(
      join(package_dir, "packages", "scoped", "package.json"),
      JSON.stringify({ name: "@scope/pkg", version: "3.0.0" }),
    );
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "root",
        dependencies: { "@scope/pkg": "link:./packages/scoped" },
      }),
    );
    await checkLink("./packages/scoped", { name: "@scope/pkg", version: "3.0.0" });
  });

  it("resolves an absolute path", async () => {
    await mkdir(join(link_dir, "abspkg"), { recursive: true });
    await writeFile(join(link_dir, "abspkg", "package.json"), JSON.stringify({ name: "abspkg", version: "4.0.0" }));
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "root",
        dependencies: { abspkg: `link:${join(link_dir, "abspkg").replaceAll("\\", "/")}` },
      }),
    );
    await checkLink("abspkg", { name: "abspkg", version: "4.0.0" });
  });

  it("resolves relative to a workspace member", async () => {
    await mkdir(join(package_dir, "packages", "foo", "local"), { recursive: true });
    await writeFile(
      join(package_dir, "packages", "foo", "local", "package.json"),
      JSON.stringify({ name: "localpkg", version: "5.0.0" }),
    );
    await writeFile(
      join(package_dir, "packages", "foo", "package.json"),
      JSON.stringify({ name: "foo", dependencies: { localpkg: "link:./local" } }),
    );
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
    await setLinker();
    await runBunInstall(env, package_dir);

    const linked =
      linker === "hoisted"
        ? join(package_dir, "node_modules", "localpkg")
        : join(package_dir, "packages", "foo", "node_modules", "localpkg");
    expect(await file(join(linked, "package.json")).json()).toEqual({ name: "localpkg", version: "5.0.0" });
    expect((await readlink(linked)).replaceAll("\\", "/")).toContain("local");

    const second = await runBunInstall(env, package_dir, { frozenLockfile: true });
    expect(second.err).not.toContain("Saved lockfile");
  });

  it("the same directory as link: and file: is two packages (the file: one keeps its dependencies)", async () => {
    // The folder-resolution cache is keyed on the target's package.json path; a
    // link: entry (parsed without dependencies) must not be reused for file:.
    const urls: string[] = [];
    setHandler(dummyRegistry(urls));
    await mkdir(join(package_dir, "vendor", "dual"), { recursive: true });
    await writeFile(
      join(package_dir, "vendor", "dual", "package.json"),
      JSON.stringify({ name: "dual", version: "1.0.0", dependencies: { bar: "0.0.2" } }),
    );
    await mkdir(join(package_dir, "packages", "app"), { recursive: true });
    await writeFile(
      join(package_dir, "packages", "app", "package.json"),
      JSON.stringify({ name: "app", version: "1.0.0", dependencies: { dual: "file:../../vendor/dual" } }),
    );
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: { dual: "link:./vendor/dual" } }),
    );
    await setLinker();

    for (const args of [{}, { frozenLockfile: true }]) {
      const { err } = await runBunInstall(env, package_dir, args);
      expect(err).not.toContain("error:");
      // root: a symlink to the directory, no dependencies installed for it
      expect((await readlink(join(package_dir, "node_modules", "dual"))).replaceAll("\\", "/")).toContain(
        "vendor/dual",
      );
      // workspace: the file: copy, whose dependency `bar` was resolved and installed
      const bar =
        linker === "hoisted"
          ? join(package_dir, "node_modules", "bar")
          : join(package_dir, "node_modules", ".bun", "dual@file+vendor+dual", "node_modules", "bar");
      expect(await file(join(bar, "package.json")).json()).toEqual({ name: "bar", version: "0.0.2" });
    }
    expect(urls).toContain(`${root_url}/bar`);
    const lock = await file(join(package_dir, "bun.lock")).text();
    expect(lock).toContain('"dual@link:./vendor/dual"');
    expect(lock).toContain('"dual@file:vendor/dual", { "dependencies": { "bar": "0.0.2" } }');
  });

  it("errors at resolve time when the target directory does not exist", async () => {
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "root",
        dependencies: { missing: "link:./does-not-exist" },
      }),
    );
    await setLinker();
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('Could not find directory "./does-not-exist" for linked dependency "missing"');
    expect(stderr).not.toContain("is not linked");
    expect(stderr).not.toContain("bun link my-pkg-name-from-package-json");
    expect(stderr).not.toContain("Saved lockfile");
    expect(exited).toBe(1);
    // nothing is written: no lockfile, no dangling symlink
    expect(existsSync(join(package_dir, "bun.lock"))).toBeFalse();
    expect(existsSync(join(package_dir, "node_modules", "missing"))).toBeFalse();
  });

  it("accepts a target directory without a package.json", async () => {
    await mkdir(join(package_dir, "vendor", "plain"), { recursive: true });
    await writeFile(join(package_dir, "vendor", "plain", "index.js"), "module.exports = 'plain';");
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "root", dependencies: { plain: "link:vendor/plain" } }),
    );
    await setLinker();
    const { err } = await runBunInstall(env, package_dir);
    expect(err).not.toContain("error:");
    expect(await file(join(package_dir, "node_modules", "plain", "index.js")).text()).toContain("plain");
    expect(await file(join(package_dir, "bun.lock")).text()).toContain('"plain@link:./vendor/plain"');

    const second = await runBunInstall(env, package_dir, { frozenLockfile: true });
    expect(second.err).not.toContain("Saved lockfile");
  });
});

// A path-form link: declared by a package that is not the root or a workspace
// (here: a file: dependency of the project) may only point inside the project.
// Same rule and same fixtures as the transitive file: tests in bun-install.test.ts.
describe.each(["hoisted", "isolated"])("transitive path-form link: (%s)", linker => {
  // Called inside each test: the dummy registry only exists after beforeAll.
  const bunfig = () => `[install]\ncache = false\nregistry = "http://localhost:${getPort()}/"\nlinker = "${linker}"\n`;
  const refusal = "only the root package.json, a workspace, or an override may link to a path outside the project";

  // Every place either linker could have put the link (node_modules/<name>,
  // a nested node_modules, or an isolated store entry), dangling links included.
  function linksNamed(project: string, name: string): string[] {
    const node_modules = join(project, "node_modules");
    if (!existsSync(node_modules)) return [];
    return Array.from(
      new Bun.Glob(`**/${name}`).scanSync({ cwd: node_modules, onlyFiles: false, dot: true, followSymlinks: false }),
    );
  }

  async function install(cwd: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err, exitCode };
  }

  it("is refused when it escapes the project (resolve)", async () => {
    using dir = tempDir("transitive-link-escape", {
      "secret/package.json": JSON.stringify({ name: "loot", version: "1.0.0" }),
      "project/bunfig.toml": bunfig(),
      "project/package.json": JSON.stringify({ name: "my-app", dependencies: { evil: "file:./evil" } }),
      "project/evil/package.json": JSON.stringify({
        name: "evil",
        version: "1.0.0",
        dependencies: { loot: "link:../../secret" },
      }),
    });
    const project = join(String(dir), "project");

    const { err, exitCode } = await install(project);
    expect(err).toContain(refusal);
    expect(err).not.toContain("Could not find directory");
    expect(exitCode).toBe(1);
    expect(linksNamed(project, "loot")).toEqual([]);
  });

  it("is refused when it escapes the project (existing lockfile)", async () => {
    // The lockfile already carries the escaping resolution, so resolution is
    // skipped and the installer is what has to refuse it.
    using dir = tempDir("transitive-link-escape-lock", {
      "secret/package.json": JSON.stringify({ name: "loot", version: "1.0.0" }),
      "project/bunfig.toml": bunfig(),
      "project/package.json": JSON.stringify({ name: "my-app", dependencies: { evil: "file:./evil" } }),
      "project/evil/package.json": JSON.stringify({
        name: "evil",
        version: "1.0.0",
        dependencies: { loot: "link:../../secret" },
      }),
      "project/bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "my-app", dependencies: { evil: "file:./evil" } } },
        packages: {
          evil: ["evil@file:evil", { dependencies: { loot: "link:../../secret" } }],
          loot: ["loot@link:../secret", {}],
        },
      }),
    });
    const project = join(String(dir), "project");

    const { err, exitCode } = await install(project);
    expect(err).toContain(refusal);
    expect(exitCode).toBe(1);
    expect(linksNamed(project, "loot")).toEqual([]);
  });

  it("is installed when it stays inside the project", async () => {
    using dir = tempDir("transitive-link-inside", {
      "bunfig.toml": bunfig(),
      "package.json": JSON.stringify({ name: "my-app", dependencies: { lib: "file:./vendor/lib" } }),
      "vendor/lib/package.json": JSON.stringify({
        name: "lib",
        version: "1.0.0",
        main: "index.js",
        dependencies: { nested: "link:../nested" },
      }),
      "vendor/lib/index.js": `module.exports = require("nested");`,
      "vendor/nested/package.json": JSON.stringify({ name: "nested", version: "1.0.0", main: "index.js" }),
      "vendor/nested/index.js": `module.exports = "it worked";`,
    });
    const project = String(dir);

    for (const args of [[], ["--frozen-lockfile"]]) {
      await rm(join(project, "node_modules"), { recursive: true, force: true });
      const { err, exitCode } = await install(project, ...args);
      expect(err).not.toContain("error:");
      expect(exitCode).toBe(0);

      await using run = spawn({
        cmd: [bunExe(), "-e", `console.log(require("lib"))`],
        cwd: project,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [runOut, runErr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
      expect(runErr).toBe("");
      expect(runOut.trim()).toBe("it worked");
      expect(runExit).toBe(0);
    }
    // The declaring package's importer-relative target is stored root-relative.
    expect(await file(join(project, "bun.lock")).text()).toContain('"nested@link:./vendor/nested"');
  });

  // A root overrides/resolutions entry is root-authored, whether it is plain or
  // scoped to the one edge it rewrites (pnpm `parent>name` / yarn `parent/name`).
  for (const [field, key] of [
    ["overrides", "shared"],
    ["resolutions", "shared"],
    ["overrides", "pkg-a>shared"],
    ["resolutions", "pkg-a/shared"],
  ]) {
    it(`may escape the project when the target comes from root "${field}" ("${key}")`, async () => {
      using dir = tempDir("transitive-link-override", {
        "shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0", main: "index.js" }),
        "shared/index.js": `module.exports = "shared";`,
        "project/bunfig.toml": bunfig(),
        "project/package.json": JSON.stringify({
          name: "my-app",
          dependencies: { "pkg-a": "file:./pkg-a" },
          [field]: { [key]: "link:../shared" },
        }),
        "project/pkg-a/package.json": JSON.stringify({
          name: "pkg-a",
          version: "1.0.0",
          main: "index.js",
          dependencies: { shared: "1.0.0" },
        }),
        "project/pkg-a/index.js": `module.exports = require("shared");`,
      });
      const project = join(String(dir), "project");

      for (const args of [[], ["--frozen-lockfile"]]) {
        await rm(join(project, "node_modules"), { recursive: true, force: true });
        const { err, exitCode } = await install(project, ...args);
        expect(err).not.toContain(refusal);
        expect(err).not.toContain("error:");
        expect(exitCode).toBe(0);

        await using run = spawn({
          cmd: [bunExe(), "-e", `console.log(require("pkg-a"))`],
          cwd: project,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [runOut, runErr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
        expect(runErr).toBe("");
        expect(runOut.trim()).toBe("shared");
        expect(runExit).toBe(0);
      }
    });
  }
});
