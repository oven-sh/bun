import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs, { readdirSync } from "fs";
import { bunEnv, bunExe, nodeExe, tempDir, tempDirWithFiles } from "harness";
import path from "path";

// The `bun install` that `bun init` runs reads this global bunfig. The
// tailwind and shadcn templates depend on bun-plugin-tailwind, whose `bun` peer
// dependency pulls in the npm `bun` package, and that package's postinstall
// costs several seconds per install on some CI machines (it shells out to
// `npm install` on musl and to PowerShell on Windows x64). Nothing in this file
// asserts on lifecycle scripts.
const globalConfigDir = tempDirWithFiles("bun-init-global-config", {
  ".bunfig.toml": "[install]\nignoreScripts = true\n",
});

// Whether `bun init` emits CLAUDE.md depends on a `claude` binary being on
// PATH, which varies by CI machine — disable the detection so the directory
// snapshots are stable everywhere.
const initEnv = { ...bunEnv, BUN_AGENT_RULE_DISABLED: "1", XDG_CONFIG_HOME: globalConfigDir };

// `src/cli` is a symlink to `src/runtime/cli`, which Windows checkouts may
// materialize as a plain file, so go through the real path.
const templateSourceDir = path.join(import.meta.dir, "../../../src/runtime/cli/init");

interface InitResult {
  dir: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Everything `bun init` left in `dir`, captured before any test builds into it. */
  files: string[];
}

// Relative paths of everything under `dir`, sorted, with node_modules listed
// as a single entry: the installed packages are asserted on separately.
function listFiles(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory() && entry.name !== "node_modules") {
      files.push(...listFiles(dir, rel));
    } else {
      files.push(rel);
    }
  }
  return files.sort();
}

describe.concurrent("bun init", () => {
  // `bun init <template>` scaffolds the template and runs a real `bun install`
  // against the registry. Each template is initialized at most once per run
  // and the cases below share the result: the react templates are the
  // expensive installs (shadcn is ~60 packages), and the assertions only read
  // from the directory, apart from `bun run build`, which writes `dist/`.
  const templateInits = new Map<string, Promise<InitResult>>();

  function initTemplate(flag: string): Promise<InitResult> {
    let init = templateInits.get(flag);
    if (!init) {
      init = (async () => {
        const dir = tempDirWithFiles(`bun-init${flag.replace(/[^a-z]+/g, "-")}`, {});
        await using proc = Bun.spawn({
          cmd: [bunExe(), "init", flag],
          cwd: dir,
          stdio: ["ignore", "pipe", "pipe"],
          env: initEnv,
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { dir, stdout, stderr, exitCode, files: listFiles(dir) };
      })();
      templateInits.set(flag, init);
    }
    return init;
  }

  // bun dedupes downloads within one `bun install`, not across processes, so
  // on a cold CI cache concurrent inits would each fetch the same tarballs.
  // shadcn's dependency closure is a superset of every other template's
  // (including the blank one: @types/bun + typescript), so initializing it
  // first, alone, leaves every other install in this file fully cached.
  beforeAll(async () => {
    await initTemplate("--react=shadcn");
  }, 240_000);

  afterAll(async () => {
    const dirs = [globalConfigDir];
    for (const init of await Promise.allSettled(templateInits.values())) {
      if (init.status === "fulfilled") dirs.push(init.value.dir);
    }
    await Promise.all(dirs.map(dir => fs.promises.rm(dir, { recursive: true, force: true })));
  });

  // A react template's scaffold is fully determined by its source directory
  // plus the generated README.md and .gitignore. Whether the nested
  // `bun install` did its job is checked through what it leaves behind
  // (the lockfile is in the file listing, node_modules is checked here)
  // rather than through `bun init`'s exit code.
  function expectReactTemplate(init: InitResult, source: string, readmeTitle: string) {
    const { dir, stdout, stderr, exitCode } = init;
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
    expect(stderr).not.toMatch(/^(error|warn)/m);

    // Line endings are normalized because the checkout that built the binary
    // and the one running the tests need not agree on them.
    const lf = (file: string) => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    const sourceDir = path.join(templateSourceDir, source);
    // The template directory's own bun.lock (and the node_modules a local
    // `bun install` in there leaves behind) are not part of the scaffold;
    // `bun init` writes a fresh bun.lock.
    const templateFiles = listFiles(sourceDir).filter(file => file !== "bun.lock" && file !== "node_modules");
    expect(templateFiles.length).toBeGreaterThan(0);
    for (const file of templateFiles) {
      expect(lf(path.join(dir, file)), file).toBe(lf(path.join(sourceDir, file)));
    }

    const readme = fs.readFileSync(path.join(dir, "README.md"), "utf8");
    expect(readme).toStartWith(`# ${readmeTitle}\n`);
    expect(readme).toInclude("bun v" + Bun.version.replaceAll("-debug", ""));

    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }).sort();
    expect(declared).toContain("typescript");
    const installed = declared.filter(name => fs.existsSync(path.join(dir, "node_modules", name, "package.json")));
    expect(installed).toEqual(declared);
  }

  test("bun init works", async () => {
    await using temp = tempDir("bun-init-works", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "-y"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: initEnv,
    });

    expect(await exited).toBe(0);

    const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
    expect(pkg).toEqual({
      "name": path.basename(temp).toLowerCase().replaceAll(" ", "-"),
      "module": "index.ts",
      "type": "module",
      "private": true,
      "devDependencies": {
        "@types/bun": "latest",
      },
      "peerDependencies": {
        "typescript": "^6",
      },
    });
    const readme = fs.readFileSync(path.join(temp, "README.md"), "utf8");
    expect(readme).toStartWith("# " + path.basename(temp).toLowerCase().replaceAll(" ", "-") + "\n");
    expect(readme).toInclude("v" + Bun.version.replaceAll("-debug", ""));
    expect(readme).toInclude("index.ts");

    expect(readdirSync(temp).sort()).toEqual([
      ".gitignore",
      "README.md",
      "bun.lock",
      "index.ts",
      "node_modules",
      "package.json",
      "tsconfig.json",
    ]);
  }, 30_000);

  test("bun init falls back to --yes when stdin is not a TTY", async () => {
    await using temp = tempDir("bun-init-no-tty", {});

    // stdin is a pipe we never write to. Previously this hung at the template
    // menu waiting for a keystroke that never arrives.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "init"],
      cwd: temp,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: initEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // No interactive menu rendered: no "Select a project template" prompt and
    // no cursor-control escapes leaked into piped stdout.
    expect(stdout).not.toContain("Select a project template");
    expect(stdout).not.toContain("\x1b[");
    expect(stderr).not.toContain("\x1b[");
    expect(exitCode).toBe(0);

    // The blank template was scaffolded and installed, exactly as with -y.
    expect(readdirSync(temp).sort()).toEqual([
      ".gitignore",
      "README.md",
      "bun.lock",
      "index.ts",
      "node_modules",
      "package.json",
      "tsconfig.json",
    ]);
  }, 30_000);

  test("bun init in folder", async () => {
    await using temp = tempDir("bun-init-in-folder", {
      "mydir": {
        "index.ts": "// mydir/index.ts",
        "README.md": "// mydir/README.md",
        ".gitignore": "// mydir/.gitignore",
        "package.json": '{ "name": "mydir" }',
        "tsconfig.json": "// mydir/tsconfig.json",
      },
    });
    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "-y", "mydir"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: initEnv,
    });
    expect(await exited).toBe(0);
    expect(readdirSync(temp).sort()).toEqual(["mydir"]);
    expect(readdirSync(path.join(temp, "mydir")).sort()).toMatchInlineSnapshot(`
    [
      ".gitignore",
      "README.md",
      "bun.lock",
      "index.ts",
      "node_modules",
      "package.json",
      "tsconfig.json",
    ]
  `);
  });

  test("bun init error rather than overwriting file", async () => {
    await using temp = tempDir("bun-init-error-rather-than-overwriting-file", {
      "mydir": "don't delete me!!!",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "init", "-y", "mydir"],
      cwd: temp,
      stdio: ["ignore", "pipe", "pipe"],
      env: initEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toMatchInlineSnapshot(`
      "Failed to change directory to mydir: ENOTDIR
      "
    `);
    expect(exitCode).toBe(1);
    expect(readdirSync(temp).sort()).toEqual(["mydir"]);
    expect(await Bun.file(path.join(temp, "mydir")).text()).toBe("don't delete me!!!");
  });

  test("bun init utf-8", async () => {
    await using temp = tempDir("bun-init-utf-8", {});
    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "-y", "u t f ∞™/subpath"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: initEnv,
    });
    expect(await exited).toBe(0);
    expect(readdirSync(temp).sort()).toEqual(["u t f ∞™"]);
    expect(readdirSync(path.join(temp, "u t f ∞™")).sort()).toEqual(["subpath"]);
    expect(readdirSync(path.join(temp, "u t f ∞™/subpath")).sort()).toMatchInlineSnapshot(`
    [
      ".gitignore",
      "README.md",
      "bun.lock",
      "index.ts",
      "node_modules",
      "package.json",
      "tsconfig.json",
    ]
  `);
  });

  test("bun init twice", async () => {
    await using temp = tempDir("bun-init-twice", {});
    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "-y", "mydir"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: initEnv,
    });
    expect(await exited).toBe(0);
    expect(readdirSync(temp).sort()).toEqual(["mydir"]);
    expect(readdirSync(path.join(temp, "mydir")).sort()).toMatchInlineSnapshot(`
    [
      ".gitignore",
      "README.md",
      "bun.lock",
      "index.ts",
      "node_modules",
      "package.json",
      "tsconfig.json",
    ]
  `);
    await Bun.write(path.join(temp, "mydir/index.ts"), "my edited index.ts");
    await Bun.write(path.join(temp, "mydir/README.md"), "my edited README.md");
    await Bun.write(path.join(temp, "mydir/.gitignore"), "my edited .gitignore");
    await Bun.write(
      path.join(temp, "mydir/package.json"),
      JSON.stringify({
        ...(await Bun.file(path.join(temp, "mydir/package.json")).json()),
        name: "my edited package.json",
      }),
    );
    await Bun.write(path.join(temp, "mydir/tsconfig.json"), `my edited tsconfig.json`);
    const { exited: exited2, stderr } = Bun.spawn({
      cmd: [bunExe(), "init", "mydir"],
      cwd: temp,
      stdio: ["ignore", "pipe", "pipe"],
      env: initEnv,
    });
    expect(await exited2).toBe(0);
    // stdin is "ignore" (not a TTY), so this run behaves like `-y` and the
    // "package.json already exists" note is suppressed just as it is for `-y`.
    expect(await stderr.text()).toMatchInlineSnapshot(`""`);
    expect(await exited2).toBe(0);
    expect(readdirSync(temp).sort()).toEqual(["mydir"]);
    expect(readdirSync(path.join(temp, "mydir")).sort()).toMatchInlineSnapshot(`
    [
      ".gitignore",
      "README.md",
      "bun.lock",
      "index.ts",
      "node_modules",
      "package.json",
      "tsconfig.json",
    ]
  `);
    expect(await Bun.file(path.join(temp, "mydir/index.ts")).text()).toMatchInlineSnapshot(`"my edited index.ts"`);
    expect(await Bun.file(path.join(temp, "mydir/README.md")).text()).toMatchInlineSnapshot(`"my edited README.md"`);
    expect(await Bun.file(path.join(temp, "mydir/.gitignore")).text()).toMatchInlineSnapshot(`"my edited .gitignore"`);
    expect(await Bun.file(path.join(temp, "mydir/package.json")).json()).toMatchInlineSnapshot(`
    {
      "devDependencies": {
        "@types/bun": "latest",
      },
      "module": "index.ts",
      "name": "my edited package.json",
      "peerDependencies": {
        "typescript": "^6",
      },
      "private": true,
      "type": "module",
    }
  `);
    expect(await Bun.file(path.join(temp, "mydir/tsconfig.json")).text()).toMatchInlineSnapshot(
      `"my edited tsconfig.json"`,
    );
  });

  test("bun init --react works", async () => {
    const init = await initTemplate("--react");
    expect(init.files).toMatchInlineSnapshot(`
      [
        ".gitignore",
        "README.md",
        "bun-env.d.ts",
        "bun.lock",
        "bunfig.toml",
        "node_modules",
        "package.json",
        "src/APITester.tsx",
        "src/App.tsx",
        "src/frontend.tsx",
        "src/index.css",
        "src/index.html",
        "src/index.ts",
        "src/logo.svg",
        "src/react.svg",
        "tsconfig.json",
      ]
    `);
    expectReactTemplate(init, "react-app", "bun-react-template");
  }, 30_000);

  test("bun init --react=tailwind works", async () => {
    const init = await initTemplate("--react=tailwind");
    expect(init.files).toMatchInlineSnapshot(`
      [
        ".gitignore",
        "README.md",
        "build.ts",
        "bun-env.d.ts",
        "bun.lock",
        "bunfig.toml",
        "node_modules",
        "package.json",
        "src/APITester.tsx",
        "src/App.tsx",
        "src/frontend.tsx",
        "src/index.css",
        "src/index.html",
        "src/index.ts",
        "src/logo.svg",
        "src/react.svg",
        "tsconfig.json",
      ]
    `);
    expectReactTemplate(init, "react-tailwind", "bun-react-tailwind-template");
  }, 30_000);

  test("bun init --react=shadcn works", async () => {
    const init = await initTemplate("--react=shadcn");
    expect(init.files).toMatchInlineSnapshot(`
      [
        ".gitignore",
        "README.md",
        "build.ts",
        "bun-env.d.ts",
        "bun.lock",
        "bunfig.toml",
        "components.json",
        "node_modules",
        "package.json",
        "src/APITester.tsx",
        "src/App.tsx",
        "src/components/ui/button.tsx",
        "src/components/ui/card.tsx",
        "src/components/ui/input.tsx",
        "src/components/ui/label.tsx",
        "src/components/ui/select.tsx",
        "src/components/ui/textarea.tsx",
        "src/frontend.tsx",
        "src/index.css",
        "src/index.html",
        "src/index.ts",
        "src/lib/utils.ts",
        "src/logo.svg",
        "src/react.svg",
        "styles/globals.css",
        "tsconfig.json",
      ]
    `);
    expectReactTemplate(init, "react-shadcn", "bun-react-tailwind-shadcn-template");
  }, 30_000);

  // Every template declares `typescript: "^6"`, so the `bun install` that
  // `bun init` runs installs TypeScript 6. Typecheck and build with that
  // exact install. https://github.com/oven-sh/bun/issues/33050
  test.each(["-y", "--react", "--react=tailwind", "--react=shadcn"])(
    "bun init %s installs TypeScript 6, typechecks, and builds",
    async flag => {
      const { dir, stdout, stderr, exitCode } = await initTemplate(flag);
      expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });

      const tsPkg = JSON.parse(fs.readFileSync(path.join(dir, "node_modules/typescript/package.json"), "utf8"));
      expect(tsPkg.version).toStartWith("6.");

      // What matters is that the template typechecks, not which runtime runs
      // the compiler, and tsc under a debug+ASAN bun is 10-50x slower.
      await using tsc = Bun.spawn({
        cmd: [nodeExe() ?? bunExe(), "node_modules/typescript/bin/tsc", "--noEmit"],
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        env: bunEnv,
      });
      const [tscStdout, tscStderr, tscExited] = await Promise.all([tsc.stdout.text(), tsc.stderr.text(), tsc.exited]);
      expect({ tscStdout, tscStderr, tscExited }).toMatchObject({ tscExited: 0 });

      // The blank template has no `build` script; the react templates build
      // src/index.html into dist/. bun-plugin-tailwind's `bun` peer dep puts a
      // node_modules/.bin/bun ahead of bunExe() on the script's PATH (with
      // scripts ignored it is the npm package's placeholder, which only prints
      // an error), so pass --bun to run the script's `bun` as the bun under test.
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (flag === "-y") {
        expect(pkg.scripts).toBeUndefined();
        return;
      }
      expect(pkg.scripts).toHaveProperty("build");

      await using build = Bun.spawn({
        cmd: [bunExe(), "--bun", "run", "build"],
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        env: bunEnv,
      });
      const [buildStdout, buildStderr, buildExited] = await Promise.all([
        build.stdout.text(),
        build.stderr.text(),
        build.exited,
      ]);
      expect({ buildStdout, buildStderr, buildExited }).toMatchObject({ buildExited: 0 });
      expect(readdirSync(path.join(dir, "dist"))).toContain("index.html");
    },
    180_000,
  );

  test("nested `bun install` output is inherited", async () => {
    // `bun init` spawns `bun install` via spawn_sync_inherit. The child must
    // inherit stdout/stderr so its output reaches the parent's pipe — a
    // previous regression left the child with closed fds 1/2 and the install
    // output was silently dropped.
    await using temp = tempDir("bun-init-inherits-install-output", {});

    await using proc = Bun.spawn({
      cmd: [bunExe(), "init", "-y"],
      cwd: temp,
      env: initEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("EBADF");
    // `bun install` prints its own version header on startup; seeing it here
    // proves the child's stdout reached us.
    expect(stdout).toContain("bun install");
    expect(stdout).toMatch(/\bpackages? installed\b/);
    expect(fs.existsSync(path.join(temp, "node_modules"))).toBe(true);
    expect(exitCode).toBe(0);
  }, 30_000);

  test("bun init --minimal only creates package.json and tsconfig.json", async () => {
    // Regression test for https://github.com/oven-sh/bun/issues/26050
    // --minimal should not create .cursor/, CLAUDE.md, .gitignore, or README.md
    await using temp = tempDir("bun-init-minimal", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "--minimal", "-y"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...bunEnv,
        // Simulate Cursor being installed via CURSOR_TRACE_ID env var
        CURSOR_TRACE_ID: "test-trace-id",
      },
    });

    expect(await exited).toBe(0);

    // Should create package.json and tsconfig.json
    expect(fs.existsSync(path.join(temp, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);

    // Should NOT create these extra files with --minimal
    expect(fs.existsSync(path.join(temp, "index.ts"))).toBe(false);
    expect(fs.existsSync(path.join(temp, ".gitignore"))).toBe(false);
    expect(fs.existsSync(path.join(temp, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(temp, "CLAUDE.md"))).toBe(false);
    expect(fs.existsSync(path.join(temp, ".cursor"))).toBe(false);
  });
});
