import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs, { readdirSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "path";
import { parsePackageName, Registry } from "registry";

// `bun init` runs `bun install` in the project it writes. The cases that look at the project, and not at what the
// packages hold, install from this registry. It has every dependency that a template names, as a package of one
// file: the real ones are 1,500 to 7,700 files for each project.
const stubs = new Registry();
// These packages have the names and some of the versions of real ones, so they get a cache that no other install reads.
let stubCache: ReturnType<typeof tempDir> | undefined;
let stubEnv: NodeJS.Dict<string>;

// Whether `bun init` emits CLAUDE.md depends on a `claude` binary being on
// PATH, which varies by CI machine — disable the detection so the directory
// snapshots are stable everywhere.
let initEnv: NodeJS.Dict<string>;

// Only for a case that runs what the packages hold: the real packages, from the npm registry.
const npmEnv = { ...bunEnv, BUN_AGENT_RULE_DISABLED: "1" };

beforeAll(async () => {
  type Manifest = Partial<Record<"dependencies" | "devDependencies" | "peerDependencies", Record<string, string>>>;
  // The blank template is not a file: init_command.rs names its two dependencies.
  const manifests: Manifest[] = [
    { devDependencies: { "@types/bun": "latest" }, peerDependencies: { typescript: "^7" } },
  ];
  const templates = path.join(import.meta.dir, "..", "..", "..", "src", "runtime", "cli", "init");
  for (const template of ["react-app", "react-tailwind", "react-shadcn"]) {
    manifests.push(await Bun.file(path.join(templates, template, "package.json")).json());
  }
  const ranges = new Map<string, Set<string>>();
  for (const manifest of manifests) {
    for (const group of [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies]) {
      for (const [name, range] of Object.entries(group ?? {})) {
        ranges.set(name, (ranges.get(name) ?? new Set()).add(range));
      }
    }
  }

  const publisher = stubs.auth.addUser("bun-init", "bun-init");
  for (const [name, wanted] of ranges) {
    // One version for each name: "^19" asks for 19.0.0 and "^4.1.11" for 4.1.11, and "latest" takes what there is.
    // The setup stops at any other range, and at ranges of one name that no one version is in.
    const carets = [...wanted].filter(range => range !== "latest");
    const lowest = carets.map(range => {
      const caret = /^\^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range);
      if (caret) return `${caret[1]}.${caret[2] ?? 0}.${caret[3] ?? 0}`;
      throw new Error(`${name}: the stubs are for ranges such as "^1.2.3" and for "latest", not for "${range}"`);
    });
    const version = lowest.sort(Bun.semver.order).at(-1) ?? "1.0.0";
    if (!carets.every(range => Bun.semver.satisfies(version, range))) {
      throw new Error(`${name}: no one version is in each of the ranges ${carets.join(", ")}`);
    }
    const tarball = await new Bun.Archive(
      { "package/package.json": JSON.stringify({ name, version }) },
      { compress: "gzip" },
    ).bytes();
    await stubs.packages.publish(
      parsePackageName(name)!,
      {
        name,
        // A scoped package is restricted unless the publish says otherwise.
        access: "public",
        versions: { [version]: { name, version } },
        _attachments: { [`${name}-${version}.tgz`]: { data: Buffer.from(tarball).toString("base64") } },
      },
      publisher,
    );
  }

  stubs.start();
  stubCache = tempDir("bun-init-stub-cache", {});
  stubEnv = { ...bunEnv, BUN_CONFIG_REGISTRY: stubs.url, BUN_INSTALL_CACHE_DIR: String(stubCache) };
  initEnv = { ...stubEnv, BUN_AGENT_RULE_DISABLED: "1" };
});

afterAll(() => {
  using _ = stubCache;
  // Throws the first error that the registry had while it answered a request.
  stubs.stop();
});

// `bun init` exits with 0 when its install fails, and then there is no bun.lock. A bun.lock has the URL of each
// tarball that is not from the default registry.
function expectInstalledFromStubs(project: string) {
  const lockfile = path.join(project, "bun.lock");
  if (!fs.existsSync(lockfile)) {
    throw new Error(`\`bun init\` did not install: there is no ${lockfile}. Is a stub in each range that it writes?`);
  }
  const { packages } = Bun.JSONC.parse(fs.readFileSync(lockfile, "utf8")) as {
    packages: Record<string, [resolution: string, tarball: string]>;
  };
  const origins = Object.values(packages).map(([, tarball]) => tarball.slice(0, stubs.url.length));
  expect([...new Set(origins)]).toEqual([stubs.url]);
}

(isWindows ? describe : describe.concurrent)("bun init", () => {
  test("bun init works", async () => {
    await using temp = tempDir("bun-init-works", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "-y"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: initEnv,
    });

    expect(await exited).toBe(0);
    expectInstalledFromStubs(temp);

    const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
    expect(pkg).toEqual({
      "name": path.basename(temp).toLowerCase().replaceAll(" ", "-"),
      "module": "index.ts",
      "type": "module",
      "private": true,
      "scripts": {
        "typecheck": "bun check",
      },
      "devDependencies": {
        "@types/bun": "latest",
      },
      "peerDependencies": {
        "typescript": "^7",
      },
    });
    const readme = fs.readFileSync(path.join(temp, "README.md"), "utf8");
    expect(readme).toStartWith("# " + path.basename(temp).toLowerCase().replaceAll(" ", "-") + "\n");
    expect(readme).toInclude("v" + Bun.version.replaceAll("-debug", ""));
    expect(readme).toInclude("index.ts");
    expect(readme).toInclude("bun check");
    expect(readme).toInclude("`bun lint`");
    expect(readme).toInclude("`bun fmt`");

    expect(fs.existsSync(path.join(temp, "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(temp, ".gitignore"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "node_modules"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);
  });

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
    expectInstalledFromStubs(temp);

    expect(fs.existsSync(path.join(temp, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);
  });

  // Ctrl-D is EOF only on a POSIX tty; the Windows console has no equivalent
  // key that ends a cooked-mode read.
  test.skipIf(isWindows)("bun init exits quietly on Ctrl-D at a text prompt", async () => {
    await using temp = tempDir("bun-init-ctrl-d", {});

    const decoder = new TextDecoder();
    let output = "";
    const menu = Promise.withResolvers<void>();
    const namePrompt = Promise.withResolvers<void>();
    await using terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_, chunk: Uint8Array) {
        output += decoder.decode(chunk, { stream: true });
        if (output.includes("Select a project template")) menu.resolve();
        if (output.includes("package name")) namePrompt.resolve();
      },
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "init"],
      cwd: temp,
      env: initEnv,
      terminal,
    });
    // Fail with the child's output if it exits before a prompt we wait for.
    const exitedEarly = proc.exited.then(code => {
      throw new Error(`bun init exited before the prompt (code ${code}):\n${output}`);
    });
    exitedEarly.catch(() => {});

    await Promise.race([menu.promise, exitedEarly]);
    // "3" picks the third entry (Library) and submits it. Library is the
    // template that asks text questions.
    terminal.write("3");
    await Promise.race([namePrompt.promise, exitedEarly]);
    // The menu left raw mode before the text prompt printed, so Ctrl-D on the
    // empty line is EOF.
    terminal.write("\x04");

    const exitCode = await proc.exited;
    expect(output).not.toContain("An internal error occurred");
    expect(output).not.toContain("EndOfStream");
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(temp, "package.json"))).toBe(false);
  });

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
    expectInstalledFromStubs(path.join(temp, "mydir"));
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
    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "-y", "mydir"],
      cwd: temp,
      stdio: ["ignore", "pipe", "pipe"],
      env: initEnv,
    });
    expect(await exited).not.toBe(0);
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
    expectInstalledFromStubs(path.join(temp, "u t f ∞™/subpath"));
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
    expectInstalledFromStubs(path.join(temp, "mydir"));
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
        "typescript": "^7",
      },
      "private": true,
      "scripts": {
        "typecheck": "bun check",
      },
      "type": "module",
    }
  `);
    expect(await Bun.file(path.join(temp, "mydir/tsconfig.json")).text()).toMatchInlineSnapshot(
      `"my edited tsconfig.json"`,
    );
  });

  test("bun init replaces a non-object dependencies field in an existing package.json", async () => {
    // A dependencies field that is not an object is garbage for every package
    // manager. `bun init` used to crash on it instead of filling in its own
    // entries.
    await using temp = tempDir("bun-init-non-object-deps", {
      "package.json": JSON.stringify({ name: "x", devDependencies: "nope", peerDependencies: null }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "init", "-y"],
      cwd: temp,
      stdio: ["ignore", "pipe", "pipe"],
      env: initEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
    expectInstalledFromStubs(temp);

    expect(await Bun.file(path.join(temp, "package.json")).json()).toEqual({
      name: "x",
      scripts: { typecheck: "bun check" },
      devDependencies: { "@types/bun": "latest" },
      peerDependencies: { typescript: "^7" },
      module: "index.ts",
      type: "module",
      private: true,
    });
  });

  test("bun init writes a typecheck script that is the type checker where `bun check` is a script", async () => {
    await using temp = tempDir("bun-init-check-script", {
      "package.json": JSON.stringify({ name: "x", scripts: { check: "echo mine" } }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "init", "-y"],
      cwd: temp,
      stdio: ["ignore", "pipe", "pipe"],
      env: initEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
    expectInstalledFromStubs(temp);

    expect((await Bun.file(path.join(temp, "package.json")).json()).scripts).toEqual({
      check: "echo mine",
      typecheck: "bun --check",
    });
  });

  test("bun init --react works", async () => {
    await using temp = tempDir("bun-init--react-works", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "--react"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: initEnv,
    });

    expect(await exited).toBe(0);
    expectInstalledFromStubs(temp);

    const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
    expect(pkg).toHaveProperty("dependencies.react");
    expect(pkg).toHaveProperty("dependencies.react-dom");
    expect(pkg).toHaveProperty("devDependencies.@types/react");
    expect(pkg).toHaveProperty("devDependencies.@types/react-dom");
    expect(pkg.peerDependencies).toEqual({ typescript: "^7" });

    expect(fs.existsSync(path.join(temp, "src"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "src/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);
  });

  test("bun init --react=tailwind works", async () => {
    await using temp = tempDir("bun-init--react=tailwind-works", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "--react=tailwind"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: initEnv,
    });

    expect(await exited).toBe(0);
    expectInstalledFromStubs(temp);

    const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
    expect(pkg).toHaveProperty("dependencies.react");
    expect(pkg).toHaveProperty("dependencies.react-dom");
    expect(pkg).toHaveProperty("devDependencies.@types/react");
    expect(pkg).toHaveProperty("devDependencies.@types/react-dom");
    expect(pkg).toHaveProperty("dependencies.bun-plugin-tailwind");
    expect(pkg.peerDependencies).toEqual({ typescript: "^7" });

    expect(fs.existsSync(path.join(temp, "src"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "src/index.ts"))).toBe(true);
  });

  test("bun init --react=shadcn works", async () => {
    await using temp = tempDir("bun-init--react=shadcn-works", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "--react=shadcn"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: initEnv,
    });

    expect(await exited).toBe(0);
    expectInstalledFromStubs(temp);

    const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
    expect(pkg).toHaveProperty("dependencies.react");
    expect(pkg).toHaveProperty("dependencies.react-dom");
    expect(pkg).toHaveProperty("dependencies.@radix-ui/react-slot");
    expect(pkg).toHaveProperty("dependencies.class-variance-authority");
    expect(pkg).toHaveProperty("dependencies.clsx");
    expect(pkg).toHaveProperty("dependencies.bun-plugin-tailwind");
    expect(pkg.peerDependencies).toEqual({ typescript: "^7" });

    expect(fs.existsSync(path.join(temp, "src"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "src/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "src/components"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "src/components/ui"))).toBe(true);
  });

  test.each(["--react", "--react=tailwind", "--react=shadcn"])(
    "bun init %s writes the same [lint] section to bunfig.toml as bun lint --init",
    async flag => {
      await using temp = tempDir("bun-init-lint-section", { "alone/a.js": "" });
      const run = async (cwd: string, ...args: string[]) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), ...args],
          cwd,
          stdio: ["ignore", "pipe", "inherit"],
          env: initEnv,
        });
        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
        return { stdout, exitCode };
      };
      expect((await run(path.join(temp, "alone"), "lint", "--init")).exitCode).toBe(0);
      expect((await run(String(temp), "init", flag, "app")).exitCode).toBe(0);
      expectInstalledFromStubs(path.join(temp, "app"));
      expect(fs.readFileSync(path.join(temp, "app/bunfig.toml"), "utf8")).toEndWith(
        'env = "BUN_PUBLIC_*"\n\n' + fs.readFileSync(path.join(temp, "alone/bunfig.toml"), "utf8"),
      );
      expect(await run(path.join(temp, "app"), "lint", "--init")).toEqual({
        stdout: "bunfig.toml already has a [lint] section\n",
        exitCode: 0,
      });
      expect(fs.readFileSync(path.join(temp, "app/README.md"), "utf8")).toInclude("`bun lint`");
    },
  );

  // Every template declares `typescript: "^7"`, so the `bun install` that
  // `bun init` runs installs TypeScript 7. Typecheck and build with that
  // exact install. https://github.com/oven-sh/bun/issues/33050
  //
  // bun dedupes downloads within a process but not across them, so on a cold
  // cache four concurrent inits would each fetch and extract the same tarballs.
  // The first of these cases to start installs alone. It is `--react=shadcn`,
  // whose packages include those of the other three, and the others start
  // their install when it has ended.
  let firstInit: Promise<unknown> | undefined;
  test.each(["--react=shadcn", "-y", "--react", "--react=tailwind"])(
    "bun init %s installs TypeScript 7, typechecks, and builds",
    async flag => {
      await using temp = tempDir(`bun-init-ts7${flag.replace(/[^a-z]+/g, "-")}`, {});

      const init = async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "init", flag],
          cwd: temp,
          stdio: ["ignore", "pipe", "pipe"],
          env: npmEnv,
        });
        return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      };
      const ran = firstInit === undefined ? init() : firstInit.then(init, init);
      firstInit ??= ran;
      const [initStdout, initStderr, initExited] = await ran;
      expect({ initStdout, initStderr, initExited }).toMatchObject({ initExited: 0 });

      // `bun init` exits with 0 when its install fails, so the output of the install is in what this compares.
      const typescript = path.join(temp, "node_modules/typescript/package.json");
      const version = fs.existsSync(typescript) ? JSON.parse(fs.readFileSync(typescript, "utf8")).version : undefined;
      expect({ initStdout, initStderr, version }).toMatchObject({ version: expect.stringMatching(/^7\./) });

      // TypeScript 7's bin/tsc is a small ESM shim that execs the native
      // compiler from @typescript/typescript-<os>-<arch>, so running it under
      // the bun build under test is cheap, and it is what `bunx tsc` runs on a
      // machine without node.
      await using tsc = Bun.spawn({
        cmd: [bunExe(), "node_modules/typescript/bin/tsc", "--noEmit"],
        cwd: temp,
        stdio: ["ignore", "pipe", "pipe"],
        env: bunEnv,
      });
      const [tscStdout, tscStderr, tscExited] = await Promise.all([tsc.stdout.text(), tsc.stderr.text(), tsc.exited]);
      expect({ tscStdout, tscStderr, tscExited }).toMatchObject({ tscExited: 0 });

      // So does `bun check`, which is what the `typecheck` script of every template runs.
      // bun-plugin-tailwind's `bun` peer dep links a node_modules/.bin/bun that
      // would otherwise shadow bunExe() in the nested `bun check`, so pass --bun.
      await using check = Bun.spawn({
        cmd: [bunExe(), "--bun", "run", "typecheck"],
        cwd: temp,
        stdio: ["ignore", "pipe", "pipe"],
        env: bunEnv,
      });
      const [checkStdout, checkStderr, checkExited] = await Promise.all([
        check.stdout.text(),
        check.stderr.text(),
        check.exited,
      ]);
      expect({ checkStdout, checkStderr, checkExited }).toMatchObject({ checkStdout: "", checkExited: 0 });

      // `bun lint` reports nothing, not even a warning, and `bun fmt` has nothing to change.
      await using lint = Bun.spawn({
        cmd: [bunExe(), "lint", "-f", "json"],
        cwd: temp,
        stdio: ["ignore", "pipe", "pipe"],
        env: bunEnv,
      });
      const [lintStdout, lintStderr, lintExited] = await Promise.all([
        lint.stdout.text(),
        lint.stderr.text(),
        lint.exited,
      ]);
      const problems = JSON.parse(lintStdout).flatMap((file: { messages: unknown[] }) => file.messages);
      expect({ problems, lintStderr, lintExited }).toMatchObject({ problems: [], lintExited: 0 });

      await using format = Bun.spawn({
        cmd: [bunExe(), "fmt", "--check"],
        cwd: temp,
        stdio: ["ignore", "pipe", "pipe"],
        env: bunEnv,
      });
      const [formatStdout, formatStderr, formatExited] = await Promise.all([
        format.stdout.text(),
        format.stderr.text(),
        format.exited,
      ]);
      expect({ formatStdout, formatStderr, formatExited }).toMatchObject({ formatExited: 0 });

      // The blank template has no `build` script; the react templates do.
      // --bun for the same reason: the script is `bun run build.ts`.
      const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
      if (pkg.scripts?.build) {
        await using build = Bun.spawn({
          cmd: [bunExe(), "--bun", "run", "build"],
          cwd: temp,
          stdio: ["ignore", "pipe", "pipe"],
          env: bunEnv,
        });
        const [buildStdout, buildStderr, buildExited] = await Promise.all([
          build.stdout.text(),
          build.stderr.text(),
          build.exited,
        ]);
        expect({ buildStdout, buildStderr, buildExited }).toMatchObject({ buildExited: 0 });
      }
    },
    180_000,
  );

  test.skipIf(isWindows)("`bun fmt --check` passes on the generated CLAUDE.md", async () => {
    await using temp = tempDir("bun-init-claude-md", { "bin/claude": "#!/bin/sh\n" });
    fs.chmodSync(path.join(temp, "bin/claude"), 0o755);
    await using init = Bun.spawn({
      cmd: [bunExe(), "init", "-y", "app"],
      cwd: temp,
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...stubEnv, PATH: `${path.join(temp, "bin")}:${bunEnv.PATH}`, CURSOR_AGENT_RULE_DISABLED: "1" },
    });
    expect(await init.exited).toBe(0);
    expectInstalledFromStubs(path.join(temp, "app"));
    expect(fs.readFileSync(path.join(temp, "app/CLAUDE.md"), "utf8")).toStartWith("Default to using Bun");

    await using format = Bun.spawn({
      cmd: [bunExe(), "fmt", "--check", "CLAUDE.md"],
      cwd: path.join(temp, "app"),
      stdio: ["ignore", "pipe", "pipe"],
      env: bunEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([format.stdout.text(), format.stderr.text(), format.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  });

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
    expectInstalledFromStubs(temp);
  });

  test("bun init --minimal only creates package.json and tsconfig.json", async () => {
    // Regression test for https://github.com/oven-sh/bun/issues/26050
    // --minimal should not create .cursor/, CLAUDE.md, .gitignore, or README.md
    await using temp = tempDir("bun-init-minimal", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "--minimal", "-y"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...stubEnv,
        // Simulate Cursor being installed via CURSOR_TRACE_ID env var
        CURSOR_TRACE_ID: "test-trace-id",
      },
    });

    expect(await exited).toBe(0);
    expectInstalledFromStubs(temp);

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
