import { file, spawn } from "bun";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { chmodSync, existsSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import {
  bunExe,
  bunEnv as env,
  isWindows,
  normalizeBunSnapshot,
  tempDir,
  tmpdirSync,
  unprivilegedSpawnOptions,
} from "harness";
import { join, relative } from "path";
import { createTestContext, destroyTestContext, dummyAfterAll, dummyBeforeAll } from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

it.concurrent("should remove existing package", async () => {
  const ctx = await createTestContext();
  try {
    const package_dir = ctx.package_dir;
    const remove_dir = tmpdirSync();
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
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await exited1).toBe(0);
    const { exited: exited2 } = spawn({
      cmd: [bunExe(), "add", `file:${pkg2_path}`.replace(/\\/g, "\\\\")],
      cwd: package_dir,
      stdout: "pipe",
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
            pkg1: `file:${pkg1_path.replace(/\\/g, "/")}`,
            pkg2: `file:${pkg2_path.replace(/\\/g, "/")}`,
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
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await removeExited1).toBe(0);
    const out1 = await new Response(stdout1).text();
    const err1 = await new Response(stderr1).text();

    expect(out1.replace(/\s*\[[0-9\.]+m?s\]/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun remove v1."),
      "",
      "- pkg1",
      "1 package removed",
      "",
    ]);
    expect(err1.split(/\r?\n/)).toEqual(["Saved lockfile", ""]);
    expect(await file(join(package_dir, "package.json")).text()).toEqual(
      JSON.stringify(
        {
          name: "foo",
          version: "0.0.2",
          dependencies: {
            pkg2: `file:${pkg2_path.replace(/\\/g, "/")}`,
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
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await removeExited2).toBe(0);
    const out2 = await new Response(stdout2).text();
    const err2 = await new Response(stderr2).text();

    expect(out2.replace(/ \[[0-9\.]+m?s\]/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun remove v1."),
      "",
      "- pkg2",
      "1 package removed",
      "",
    ]);
    expect(err2.split(/\r?\n/)).toEqual(["", "package.json has no dependencies! Deleted empty lockfile", ""]);
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
  } finally {
    destroyTestContext(ctx);
  }
});

it.concurrent("should not reject missing package", async () => {
  const ctx = await createTestContext();
  try {
    const package_dir = ctx.package_dir;
    const remove_dir = tmpdirSync();
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
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await addExited).toBe(0);

    const { exited: rmExited } = spawn({
      cmd: [bunExe(), "remove", "pkg2"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await rmExited).toBe(0);
  } finally {
    destroyTestContext(ctx);
  }
});

it.concurrent("should not affect if package is not installed", async () => {
  const ctx = await createTestContext();
  try {
    const package_dir = ctx.package_dir;
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
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await exited).toBe(0);
    const out = await stdout.text();
    expect(out.split("\n")).toEqual([expect.stringContaining("bun remove v1."), ""]);
    const err = await stderr.text();
    expect(err.replace(/ \[[0-9\.]+m?s\]/, "").split(/\r?\n/)).toEqual([
      "package.json doesn't have dependencies, there's nothing to remove!",
      "",
    ]);
  } finally {
    destroyTestContext(ctx);
  }
});

it.concurrent("should retain a new line in the end of package.json", async () => {
  const ctx = await createTestContext();
  try {
    const package_dir = ctx.package_dir;
    const remove_dir = tmpdirSync();
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
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await addExited).toBe(0);
    const content_before_remove = await file(join(package_dir, "package.json")).text();
    expect(content_before_remove.endsWith("}")).toBe(true);
    expect(content_before_remove).toEqual(
      JSON.stringify(
        {
          name: "foo",
          version: "0.0.1",
          dependencies: {
            pkg: `file:${pkg_path.replace(/\\/g, "/")}`,
          },
        },
        null,
        2,
      ),
    );
    await writeFile(join(package_dir, "package.json"), content_before_remove + "\n");

    const { exited } = spawn({
      cmd: [bunExe(), "remove", "pkg"],
      cwd: package_dir,
      stdout: "pipe",
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
  } finally {
    destroyTestContext(ctx);
  }
});

it.concurrent("should remove peerDependencies", async () => {
  const ctx = await createTestContext();
  try {
    const package_dir = ctx.package_dir;
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
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    const out = await stdout.text();
    expect(out.replace(/\[[0-9\.]+m?s\]/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun remove v1."),
      "",
      " done",
      "",
    ]);
    expect(await exited).toBe(0);
    expect(await file(join(package_dir, "package.json")).json()).toEqual({
      name: "foo",
    });
  } finally {
    destroyTestContext(ctx);
  }
});

const local = (name: string) => ({ [`${name}/package.json`]: JSON.stringify({ name, version: "1.0.0" }) });

const localBin = (name: string) => ({
  [`${name}/package.json`]: JSON.stringify({ name, version: "1.0.0", bin: { [name]: "cli.js" } }),
  [`${name}/cli.js`]: "#!/usr/bin/env node\n",
});

async function runWithEnv(extraEnv: Record<string, string>, dir: string, ...args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), ...args],
    cwd: dir,
    env: { ...env, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache"), ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const run = (dir: string, ...args: string[]) => runWithEnv({}, dir, ...args);

const remove = (dir: string, ...names: string[]) => run(dir, "remove", ...names);

const binEntries = (dir: string) => {
  const bin = join(dir, "node_modules", ".bin");
  return existsSync(bin) ? readdirSync(bin).sort() : [];
};

// On Windows a bin is a `.bunx` and `.exe` shim pair, not a symlink.
const binFiles = (...names: string[]) =>
  (isWindows ? names.flatMap(name => [`${name}.bunx`, `${name}.exe`]) : names).sort();

it.concurrent("bun remove drops every duplicate key of the removed package", async () => {
  using dir = tempDir("bun-remove-dup", {
    ...local("foo"),
    ...local("bar"),
    "package.json": `{
  "name": "dup",
  "dependencies": {
    "foo": "file:./foo",
    "bar": "file:./bar",
    "foo": "file:./foo"
  }
}
`,
  });

  const { stderr, exitCode } = await remove(String(dir), "foo");

  expect(stderr).not.toContain("error:");
  expect(await file(join(String(dir), "package.json")).json()).toStrictEqual({
    name: "dup",
    dependencies: { bar: "file:./bar" },
  });
  expect(existsSync(join(String(dir), "node_modules", "foo"))).toBe(false);
  expect(existsSync(join(String(dir), "node_modules", "bar", "package.json"))).toBe(true);
  expect(exitCode).toBe(0);
});

it.concurrent("bun remove drops the list when the removed package is its only (duplicated) entry", async () => {
  using dir = tempDir("bun-remove-dup-only", {
    ...local("foo"),
    ...local("bar"),
    "package.json": `{
  "name": "dup",
  "dependencies": { "bar": "file:./bar" },
  "devDependencies": {
    "foo": "file:./foo",
    "foo": "file:./foo"
  }
}
`,
  });

  const { stderr, exitCode } = await remove(String(dir), "foo");

  expect(stderr).not.toContain("error:");
  expect(await file(join(String(dir), "package.json")).json()).toStrictEqual({
    name: "dup",
    dependencies: { bar: "file:./bar" },
  });
  expect(exitCode).toBe(0);
});

it.concurrent(
  "bun remove rejects a dependency list that is not an object and leaves package.json untouched",
  async () => {
    const pkg = JSON.stringify({ name: "x", dependencies: ["foo"], devDependencies: { bar: "file:./bar" } });
    using dir = tempDir("bun-remove-malformed", { ...local("bar"), "package.json": pkg });

    const { stderr, exitCode } = await remove(String(dir), "bar");

    expect(stderr).toContain("dependencies expects a map of specifiers");
    expect(await file(join(String(dir), "package.json")).text()).toBe(pkg);
    expect(exitCode).toBe(1);
  },
);

for (const linker of ["hoisted", "isolated"] as const) {
  it.concurrent(`bun remove unlinks only the removed package's .bin entry (${linker})`, async () => {
    using dir = tempDir(`bun-remove-bin-${linker}`, {
      ...localBin("what-bin"),
      ...localBin("other-bin"),
      "package.json": JSON.stringify({
        name: "root",
        dependencies: { "what-bin": "file:./what-bin", "other-bin": "file:./other-bin" },
      }),
    });

    {
      const { stderr, exitCode } = await run(String(dir), "install", "--linker", linker);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }
    expect(binEntries(String(dir))).toStrictEqual(binFiles("other-bin", "what-bin"));

    const { stderr, exitCode } = await remove(String(dir), "what-bin", "--linker", linker);
    expect(stderr).not.toContain("error:");
    expect(binEntries(String(dir))).toStrictEqual(binFiles("other-bin"));
    expect(existsSync(join(String(dir), "node_modules", ".bin", binFiles("other-bin")[0]))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules", "what-bin"))).toBe(false);
    expect(await file(join(String(dir), "package.json")).json()).toStrictEqual({
      name: "root",
      dependencies: { "other-bin": "file:./other-bin" },
    });
    expect(exitCode).toBe(0);
  });

  // The bin dir of the second row is not beside the global dir, so what leads from it to a package starts with `..`.
  for (const [where, binParts] of [
    ["", ["global", "bin"]],
    [", in a bin dir elsewhere", ["nested", "separate-bin"]],
  ] as const) {
    it.concurrent(`bun remove -g removes the bins of the removed package only (${linker}${where})`, async () => {
      using dir = tempDir(`bun-remove-global-bin-${linker}`, {
        ...localBin("what-bin"),
        ...localBin("other-bin"),
        ...local("linked"),
      });
      const bunInstall = join(String(dir), "global");
      const globalDir = join(bunInstall, "install", "global");
      const globalBin = join(String(dir), ...binParts);
      // Every global-dir variable is set so an inherited one can never point the test at the developer's real global folder.
      const globalEnv = { BUN_INSTALL: bunInstall, BUN_INSTALL_GLOBAL_DIR: globalDir, BUN_INSTALL_BIN: globalBin };
      const runGlobal = (...args: string[]) => runWithEnv(globalEnv, String(dir), ...args, "-g", "--linker", linker);

      for (const name of ["what-bin", "other-bin"]) {
        const { stderr, exitCode } = await runGlobal("add", join(String(dir), name));
        expect(stderr).not.toContain("error:");
        expect(exitCode).toBe(0);
      }
      expect({ globalBin: readdirSync(globalBin).sort(), bin: binEntries(globalDir) }).toStrictEqual({
        globalBin: binFiles("other-bin", "what-bin"),
        bin: [],
      });

      // The global node_modules is also the `bun link` registry.
      {
        const { stderr, exitCode } = await runWithEnv(globalEnv, join(String(dir), "linked"), "link");
        expect(stderr).not.toContain("error:");
        expect(exitCode).toBe(0);
      }

      // The global bin directory can be a folder like ~/.local/bin, where a dead link may belong to another tool.
      const foreign = isWindows ? [] : ["foreign-absolute", "foreign-relative"];
      if (!isWindows) {
        symlinkSync(join(String(dir), "gone", "cli.js"), join(globalBin, "foreign-absolute"));
        symlinkSync(join("..", "gone", "cli.js"), join(globalBin, "foreign-relative"));
      }

      const { stderr, exitCode } = await runGlobal("remove", "what-bin");
      expect(stderr).not.toContain("error:");
      expect({
        globalBin: readdirSync(globalBin).sort(),
        bin: binEntries(globalDir),
        removed: existsSync(join(globalDir, "node_modules", "what-bin")),
        linked: existsSync(join(globalDir, "node_modules", "linked", "package.json")),
      }).toStrictEqual({
        globalBin: [...foreign, ...binFiles("other-bin")].sort(),
        bin: [],
        removed: false,
        linked: true,
      });
      expect(exitCode).toBe(0);
    });
  }

  it.concurrent(`bun remove -g gives a bin name back to the global package that lost it (${linker})`, async () => {
    const serve = (name: string) => ({
      [`${name}/package.json`]: JSON.stringify({ name, version: "1.0.0", bin: { serve: "cli.js" } }),
      [`${name}/cli.js`]: "#!/usr/bin/env node\n",
    });
    using dir = tempDir(`bun-remove-global-same-bin-${linker}`, {
      ...serve("first"),
      ...serve("second"),
      ...localBin("what-bin"),
    });
    const bunInstall = join(String(dir), "global");
    const globalDir = join(bunInstall, "install", "global");
    const globalBin = join(bunInstall, "bin");
    const globalEnv = { BUN_INSTALL: bunInstall, BUN_INSTALL_GLOBAL_DIR: globalDir, BUN_INSTALL_BIN: globalBin };
    const runGlobal = (...args: string[]) => runWithEnv(globalEnv, String(dir), ...args, "-g", "--linker", linker);
    const serveOf = (name: string) => join("..", "install", "global", "node_modules", name, "cli.js");

    for (const name of ["first", "second", "what-bin"]) {
      const { stderr, exitCode } = await runGlobal("add", join(String(dir), name));
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }
    expect(join(globalBin, "serve")).toBeValidBin(serveOf("second"));

    // As long as both are installed, the one that was added last keeps the name.
    for (const [name, bins, owner] of [
      ["what-bin", ["serve"], "second"],
      ["second", ["serve"], "first"],
      ["first", [], ""],
    ] as const) {
      const { stderr, exitCode } = await runGlobal("remove", name);
      expect(stderr).not.toContain("error:");
      expect(readdirSync(globalBin).sort()).toStrictEqual(binFiles(...bins));
      if (owner) expect(join(globalBin, "serve")).toBeValidBin(serveOf(owner));
      expect(exitCode).toBe(0);
    }
  });

  it.concurrent(`bun add -g links the bin that another global package lost (${linker})`, async () => {
    using dir = tempDir(`bun-add-global-lost-bin-${linker}`, { ...localBin("what-bin"), ...localBin("other-bin") });
    const bunInstall = join(String(dir), "global");
    const globalDir = join(bunInstall, "install", "global");
    const globalBin = join(bunInstall, "bin");
    const globalEnv = { BUN_INSTALL: bunInstall, BUN_INSTALL_GLOBAL_DIR: globalDir, BUN_INSTALL_BIN: globalBin };
    const runGlobal = (...args: string[]) => runWithEnv(globalEnv, String(dir), ...args, "-g", "--linker", linker);

    for (const name of ["what-bin", "other-bin"]) {
      const { stderr, exitCode } = await runGlobal("add", join(String(dir), name));
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      if (name === "what-bin") for (const entry of readdirSync(globalBin)) rmSync(join(globalBin, entry));
    }
    expect(readdirSync(globalBin).sort()).toStrictEqual(binFiles("other-bin", "what-bin"));
    expect(join(globalBin, "what-bin")).toBeValidBin(
      join("..", "install", "global", "node_modules", "what-bin", "cli.js"),
    );
  });
}

// https://github.com/oven-sh/bun/issues/9351, https://github.com/oven-sh/bun/issues/7215
it.concurrent("bun remove keeps the order of the remaining keys", async () => {
  const manifest = (groups: Record<string, unknown>) =>
    JSON.stringify(
      {
        name: "@neodon/bun-is-awesome",
        version: "0.1.0",
        private: true,
        type: "module",
        module: "index.ts",
        scripts: { hello: "echo hello" },
        ...groups,
        license: "MIT",
      },
      null,
      2,
    ) + "\n";
  const [zz, aa, mm, dev] = ["zz", "aa", "mm", "dev"].map(name => ({ [name]: `file:./${name}` }));
  using dir = tempDir("bun-remove-key-order", {
    ...local("zz"),
    ...local("aa"),
    ...local("mm"),
    ...local("dev"),
    "package.json": manifest({ dependencies: { ...zz, ...aa, ...mm }, devDependencies: dev }),
  });

  // From the middle of a group that is not sorted, the last of a group between other keys, the last of all.
  for (const [name, groups] of [
    ["aa", { dependencies: { ...zz, ...mm }, devDependencies: dev }],
    ["dev", { dependencies: { ...zz, ...mm } }],
    ["zz", { dependencies: mm }],
    ["mm", {}],
  ] as const) {
    const { stderr, exitCode } = await remove(String(dir), name);
    expect(stderr).not.toContain("error:");
    expect(await file(join(String(dir), "package.json")).text()).toBe(manifest(groups));
    expect(exitCode).toBe(0);
  }
});

it.concurrent("bun remove keeps tabs and a missing final newline", async () => {
  using dir = tempDir("bun-remove-tabs", {
    ...local("foo"),
    "package.json": '{\n\t"type": "module",\n\t"dependencies": {\n\t\t"foo": "file:./foo"\n\t},\n\t"name": "tabs"\n}',
  });

  const { stderr, exitCode } = await remove(String(dir), "foo");
  expect(stderr).not.toContain("error:");
  expect(await file(join(String(dir), "package.json")).text()).toBe('{\n\t"type": "module",\n\t"name": "tabs"\n}');
  expect(exitCode).toBe(0);
});

// Printed again, this file would come out with other line ends, escapes and inline objects.
it.concurrent("bun remove of a package that is not declared does not write package.json", async () => {
  const text =
    '{\r\n  "name": "caf\\u00e9",\r\n  "scripts": { "t": "x" },\r\n  "dependencies": { "foo": "file:.\\/foo" }\r\n}\r\n';
  using dir = tempDir("bun-remove-nothing", { ...local("foo"), "package.json": text });
  const packageJson = join(String(dir), "package.json");
  utimesSync(packageJson, 1, 1);

  const { stderr, exitCode } = await remove(String(dir), "bar");
  expect(stderr).not.toContain("error:");
  expect(await file(packageJson).text()).toBe(text);
  expect(statSync(packageJson).mtimeMs).toBe(1000);
  expect(exitCode).toBe(0);
});

// A path has no package name. The folder removed for it used to be `node_modules/` + "".
it.concurrent.each(["../src", "./bar", "file:./bar"])(
  "bun remove foo %s removes foo and doesn't touch the rest of node_modules",
  async path => {
    using dir = tempDir("bun-remove-path", {
      ...local("foo"),
      ...local("bar"),
      "src/index.ts": "export {};",
      "package.json": JSON.stringify({ name: "root", dependencies: { foo: "file:./foo", bar: "file:./bar" } }),
    });
    expect((await run(String(dir), "install")).exitCode).toBe(0);

    const { stderr, exitCode } = await remove(String(dir), "foo", path);
    expect(stderr).not.toContain("error:");
    expect(await file(join(String(dir), "package.json")).json()).toEqual({
      name: "root",
      dependencies: { bar: "file:./bar" },
    });
    expect(readdirSync(join(String(dir), "node_modules")).filter(name => !name.startsWith("."))).toEqual(["bar"]);
    expect(await file(join(String(dir), "node_modules", "bar", "package.json")).json()).toEqual({
      name: "bar",
      version: "1.0.0",
    });
    expect(
      readdirSync(String(dir))
        .filter(name => !name.startsWith("."))
        .sort(),
    ).toEqual(["bar", "bun.lock", "foo", "node_modules", "package.json", "src"]);
    expect(existsSync(join(String(dir), "src", "index.ts"))).toBe(true);
    expect(exitCode).toBe(0);
  },
);

it.concurrent("bun r is an alias of bun remove", async () => {
  using dir = tempDir("bun-r-alias", {
    ...local("foo"),
    ...local("bar"),
    "package.json": JSON.stringify({ name: "root", dependencies: { foo: "file:./foo", bar: "file:./bar" } }),
  });

  {
    const { stderr, exitCode } = await run(String(dir), "install");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  const { stdout, stderr, exitCode } = await run(String(dir), "r", "foo");
  expect(stderr).not.toContain("error:");
  expect(normalizeBunSnapshot(stdout, String(dir))).toMatchInlineSnapshot(`
    "bun remove <version> (<revision>)

    - foo
    1 package removed"
  `);
  expect(await file(join(String(dir), "package.json")).json()).toStrictEqual({
    name: "root",
    dependencies: { bar: "file:./bar" },
  });
  expect(existsSync(join(String(dir), "node_modules", "foo"))).toBe(false);
  expect(existsSync(join(String(dir), "node_modules", "bar", "package.json"))).toBe(true);
  expect(exitCode).toBe(0);
});

// Serial: `unprivilegedSpawnOptions` may change and restore the modes of directories above the test's own.
it.serial.skipIf(isWindows)("bun remove that cannot save bun.lock leaves node_modules as it was", async () => {
  const pkg = JSON.stringify({ name: "root", dependencies: { foo: "file:./foo", bar: "file:./bar" } });
  using dir = tempDir("bun-remove-lockfile-not-saved", { ...local("foo"), ...local("bar"), "package.json": pkg });
  expect(await run(String(dir), "install")).toMatchObject({ exitCode: 0 });
  const lockfile = await file(join(String(dir), "bun.lock")).text();

  using unprivileged = unprivilegedSpawnOptions(String(dir));
  // bun.lock is replaced by a temporary file created next to it.
  chmodSync(String(dir), 0o555);
  try {
    await using proc = spawn({
      cmd: [bunExe(), "remove", "foo"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
      stdout: "pipe",
      stderr: "pipe",
      ...unprivileged,
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("failed to create temporary file to save lockfile");
    expect(existsSync(join(String(dir), "node_modules", "foo", "package.json"))).toBe(true);
    expect(await file(join(String(dir), "package.json")).text()).toBe(pkg);
    expect(await file(join(String(dir), "bun.lock")).text()).toBe(lockfile);
    expect(exitCode).toBe(1);
  } finally {
    chmodSync(String(dir), 0o755);
  }
});

it.concurrent("bun remove -r is rejected and leaves package.json untouched", async () => {
  const pkg = JSON.stringify({ name: "root", dependencies: { foo: "file:./foo" } });
  using dir = tempDir("bun-remove-dash-r", { ...local("foo"), "package.json": pkg });

  const { stderr, exitCode } = await remove(String(dir), "foo", "-r");
  expect(stderr).toContain("error: Invalid Argument '-r'");
  expect(await file(join(String(dir), "package.json")).text()).toBe(pkg);
  expect(exitCode).toBe(1);
});

const MONOREPO_ROOT = `{
  "name": "root",
  "workspaces": ["packages/*"],
  "dependencies": { "dep": "file:./dep" }
}
`;
const WORKSPACE = (name: string) => `{
  "name": "${name}",
  "dependencies": { "dep": "file:../../dep" }
}
`;

function monorepo(prefix: string) {
  return tempDir(prefix, {
    ...local("dep"),
    "package.json": MONOREPO_ROOT,
    "packages/api/package.json": WORKSPACE("api"),
    "packages/web/package.json": WORKSPACE("web"),
  });
}

it.concurrent("bun remove -F edits only the selected workspace", async () => {
  using dir = monorepo("bun-remove-F");

  const { stderr, exitCode } = await remove(String(dir), "dep", "-F", "api");
  expect(stderr).not.toContain("error:");
  expect(await file(join(String(dir), "packages", "api", "package.json")).json()).toStrictEqual({ name: "api" });
  expect(await file(join(String(dir), "packages", "web", "package.json")).text()).toBe(WORKSPACE("web"));
  expect(await file(join(String(dir), "package.json")).text()).toBe(MONOREPO_ROOT);
  expect(exitCode).toBe(0);
});

it.concurrent("bun remove ignores pnpm's --recursive, so it only removes from the current package", async () => {
  using dir = monorepo("bun-remove-recursive");

  const { stderr } = await remove(String(dir), "dep", "--recursive");
  expect(stderr).not.toContain("--recursive");
  expect(await file(join(String(dir), "packages", "api", "package.json")).text()).toBe(WORKSPACE("api"));
  expect(await file(join(String(dir), "packages", "web", "package.json")).text()).toBe(WORKSPACE("web"));
});

// Serves version 1.0.0 of every name; `extra` adds fields to a package's manifest.
function serveAnyPackage(extra: Record<string, object> = {}) {
  const registry = Bun.serve({
    port: 0,
    async fetch(req) {
      const name = new URL(req.url).pathname.slice(1).replace(/-1\.0\.0\.tgz$/, "");
      const manifest = { name, version: "1.0.0", ...extra[name] };
      if (req.url.endsWith(".tgz")) {
        const files = { "package/package.json": JSON.stringify(manifest) };
        return new Response(await new Bun.Archive(files, { compress: "gzip" }).bytes());
      }
      const versions = { "1.0.0": { ...manifest, dist: { tarball: `${registry.url}${name}-1.0.0.tgz` } } };
      return Response.json({ name, "dist-tags": { latest: "1.0.0" }, versions });
    },
  });
  return registry;
}

for (const linker of ["hoisted", "isolated"] as const) {
  it.concurrent(
    `bun remove keeps the folder another workspace has under that name for an alias (${linker})`,
    async () => {
      await using registry = serveAnyPackage();
      using dir = tempDir(`bun-remove-alias-${linker}`, {
        "bunfig.toml": `[install]\nregistry = "${registry.url}"\nlinker = "${linker}"\n`,
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { foo: "npm:bar@1" } }),
        "packages/b/package.json": JSON.stringify({ name: "b", dependencies: { foo: "^1" } }),
      });
      // Returns what `import "foo"` in packages/a finds.
      const fooOfA = async () => {
        for (const from of [join(String(dir), "packages", "a"), String(dir)]) {
          const manifest = file(join(from, "node_modules", "foo", "package.json"));
          if (await manifest.exists()) return (await manifest.json()).name;
        }
      };
      expect(await run(String(dir), "install")).toMatchObject({ exitCode: 0 });
      expect(await fooOfA()).toBe("bar");

      const { stderr, exitCode } = await remove(join(String(dir), "packages", "b"), "foo");
      expect(stderr).not.toContain("error:");
      expect(await fooOfA()).toBe("bar");
      expect(exitCode).toBe(0);
    },
  );

  it.concurrent(`bun remove deletes the folder of a package that is still an optional peer (${linker})`, async () => {
    await using registry = serveAnyPackage({
      ui: { peerDependencies: { react: "*" }, peerDependenciesMeta: { react: { optional: true } } },
    });
    using dir = tempDir(`bun-remove-optional-peer-${linker}`, {
      "bunfig.toml": `[install]\nregistry = "${registry.url}"\nlinker = "${linker}"\n`,
      "package.json": JSON.stringify({ name: "app", dependencies: { react: "1.0.0", ui: "1.0.0" } }),
    });
    const react = join(String(dir), "node_modules", "react");
    expect(await run(String(dir), "install")).toMatchObject({ exitCode: 0 });
    expect(existsSync(react)).toBe(true);

    const { stderr, exitCode } = await remove(String(dir), "react");
    expect(stderr).not.toContain("error:");
    expect(existsSync(react)).toBe(false);
    expect(exitCode).toBe(0);
  });

  // The hoisted linker has `b` at the top for `a`. The isolated linker only has it there for the project.
  it.concurrent(`bun remove of a package that another dependency still needs (${linker})`, async () => {
    await using registry = serveAnyPackage({ a: { dependencies: { b: "1.0.0" } } });
    using dir = tempDir(`bun-remove-still-needed-${linker}`, {
      "bunfig.toml": `[install]\nregistry = "${registry.url}"\nlinker = "${linker}"\n`,
      "package.json": JSON.stringify({ name: "app", dependencies: { a: "1.0.0", b: "1.0.0" } }),
    });
    expect(await run(String(dir), "install")).toMatchObject({ exitCode: 0 });

    const { stderr, exitCode } = await remove(String(dir), "b");
    expect(stderr).not.toContain("error:");
    expect(existsSync(join(String(dir), "node_modules", "a"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules", "b"))).toBe(linker === "hoisted");
    expect(exitCode).toBe(0);
  });

  it.concurrent(`bun remove in a workspace removes the package from node_modules (${linker})`, async () => {
    await using registry = serveAnyPackage();
    using dir = tempDir(`bun-remove-in-workspace-${linker}`, {
      "bunfig.toml": `[install]\nregistry = "${registry.url}"\nlinker = "${linker}"\n`,
      "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      "packages/w/package.json": JSON.stringify({ name: "w", dependencies: { b: "1.0.0", c: "1.0.0" } }),
    });
    const workspace = join(String(dir), "packages", "w");
    // The folders that `import` in packages/w searches.
    const found = (name: string) => [workspace, String(dir)].some(from => existsSync(join(from, "node_modules", name)));
    expect(await run(String(dir), "install")).toMatchObject({ exitCode: 0 });
    expect([found("b"), found("c")]).toEqual([true, true]);

    const { stderr, exitCode } = await remove(workspace, "b");
    expect(stderr).not.toContain("error:");
    expect([found("b"), found("c")]).toEqual([false, true]);
    expect(exitCode).toBe(0);
  });
}
