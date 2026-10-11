import { beforeAll, describe, expect, test } from "bun:test";
import fs, { readdirSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithFiles } from "harness";
import path from "path";

// Whether `bun init` emits CLAUDE.md depends on a `claude` binary being on
// PATH, which varies by CI machine — disable the detection so the directory
// snapshots are stable everywhere.
const initEnv = { ...bunEnv, BUN_AGENT_RULE_DISABLED: "1" };

(isWindows ? describe : describe.concurrent)("bun init", () => {
  // Every test's `bun init` runs a real `bun install`. bun dedupes downloads
  // within a process but not across them, so on a cold CI cache the concurrent
  // inits each re-fetch the same tarballs. Prime the shared install cache once,
  // serially: `--react=shadcn`'s lockfile is a superset of the other react
  // templates', and `-y` covers the blank template (typescript + @types/bun).
  beforeAll(async () => {
    for (const flag of ["-y", "--react=shadcn"]) {
      const temp = tempDirWithFiles("bun-init-cache-prime", {});
      await using proc = Bun.spawn({
        cmd: [bunExe(), "init", flag],
        cwd: temp,
        stdio: ["ignore", "ignore", "ignore"],
        env: initEnv,
      });
      await proc.exited;
    }
  }, 240_000);

  test("bun init works", async () => {
    await using temp = tempDir("bun-init-works", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "-y"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: initEnv,
    });

    expect(await exited).toBe(0);

    const pkgText = fs.readFileSync(path.join(temp, "package.json"), "utf8");
    const pkg = JSON.parse(pkgText);
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
    // A new package.json has a 2-space indent and ends with a newline.
    expect(pkgText).toBe(JSON.stringify(pkg, null, 2) + "\n");
    const readme = fs.readFileSync(path.join(temp, "README.md"), "utf8");
    expect(readme).toStartWith("# " + path.basename(temp).toLowerCase().replaceAll(" ", "-") + "\n");
    expect(readme).toInclude("v" + Bun.version.replaceAll("-debug", ""));
    expect(readme).toInclude("index.ts");
    expect(readme).toInclude("bun check");

    expect(fs.existsSync(path.join(temp, "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(temp, ".gitignore"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "node_modules"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);
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

    expect(fs.existsSync(path.join(temp, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);
  }, 30_000);

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

    // The package.json is an existing one, so it gets no `type` and no `private`.
    expect(await Bun.file(path.join(temp, "package.json")).json()).toEqual({
      name: "x",
      scripts: { typecheck: "bun check" },
      devDependencies: { "@types/bun": "latest" },
      peerDependencies: { typescript: "^7" },
      module: "index.ts",
    });
  }, 30_000);

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

    expect((await Bun.file(path.join(temp, "package.json")).json()).scripts).toEqual({
      check: "echo mine",
      typecheck: "bun --check",
    });
  }, 30_000);

  // `bun init` adds these two dependencies. A package.json that lists them
  // gets no nested `bun install`, so the tests that use them stay offline.
  const initDeps = { devDependencies: { "@types/bun": "latest" }, peerDependencies: { typescript: "^7" } };

  // Beside an index.ts, `bun init` has nothing to add to this package.json.
  const completeManifest = {
    name: "app",
    module: "index.ts",
    type: "module",
    private: true,
    scripts: { typecheck: "bun check" },
    ...initDeps,
  };
  const completeWithout = (key: keyof typeof completeManifest) => {
    const { [key]: _, ...rest } = completeManifest;
    return rest;
  };

  async function runInit(cwd: string, args: string[], stdin: "ignore" | "pipe" = "ignore") {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "init", ...args],
      cwd,
      stdio: [stdin, "pipe", "pipe"],
      env: initEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const entryFields = [
    { entry: "no entry field", fields: {} },
    { entry: "module", fields: { module: "esm.js" } },
    { entry: "main", fields: { main: "main.js" } },
    { entry: "main and module", fields: { main: "main.js", module: "esm.js" } },
  ];
  const privateValues = [undefined, true, false, "yes"];
  const label = (value: unknown) => (value === undefined ? "absent" : JSON.stringify(value));

  test.each(
    [undefined, "module", "commonjs", 123].flatMap((type, t) =>
      entryFields.map(({ entry, fields }, e) => {
        const isPrivate = privateValues[(t + e) % privateValues.length];
        return { type, isPrivate, entry, fields, typeLabel: label(type), privateLabel: label(isPrivate) };
      }),
    ),
  )(
    "bun init -y does not change type ($typeLabel) or private ($privateLabel) in an existing package.json with $entry",
    async ({ type, isPrivate, entry, fields }) => {
      // JSON.stringify drops a key whose value is undefined, so that key is absent from the file.
      const manifest = { name: "app", version: "1.0.0", type, private: isPrivate, ...fields, ...initDeps };
      await using temp = tempDir("bun-init-keeps-values", {
        "package.json": JSON.stringify(manifest, null, 2) + "\n",
        "index.js": "module.exports = 1;\n",
      });

      const { stdout, stderr, exitCode } = await runInit(String(temp), ["-y"]);

      // Only a package.json with no entry field gains a key: the entry point that `bun init` found.
      const gainsEntry = entry === "no entry field";
      expect(await Bun.file(path.join(temp, "package.json")).json()).toEqual(
        JSON.parse(JSON.stringify({ ...manifest, ...(gainsEntry ? { module: "index.js" } : {}) })),
      );
      expect(stdout.includes(" ~ package.json")).toBe(gainsEntry);
      expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
    },
  );

  // A CommonJS package that can be published. `bun init` used to change it to
  // `"type": "module"` and `"private": true`.
  const commonjsManifest = { name: "cjs-app", version: "1.0.0", type: "commonjs", private: false, ...initDeps };
  const commonjsFiles = {
    "package.json": JSON.stringify(commonjsManifest, null, 2) + "\n",
    "index.js": `const os = require("os");\nconsole.log(os.platform());\n`,
  };
  const commonjsAfterInit = JSON.stringify({ ...commonjsManifest, module: "index.js" }, null, 2) + "\n";

  test.each([
    { run: "bun init -y", args: ["-y"], stdin: "ignore" as const, folder: "", after: commonjsAfterInit },
    { run: "bun init with a stdin pipe", args: [], stdin: "pipe" as const, folder: "", after: commonjsAfterInit },
    {
      run: "bun init -y <folder>",
      args: ["-y", "app"],
      stdin: "ignore" as const,
      folder: "app",
      after: commonjsAfterInit,
    },
    // --minimal adds only the dependencies, and they are all present.
    {
      run: "bun init -m -y",
      args: ["-m", "-y"],
      stdin: "ignore" as const,
      folder: "",
      after: commonjsFiles["package.json"],
    },
  ])("$run keeps type commonjs and private false", async ({ args, stdin, folder, after }) => {
    await using temp = tempDir("bun-init-commonjs", folder ? { [folder]: commonjsFiles } : commonjsFiles);

    const { stdout, stderr, exitCode } = await runInit(String(temp), args, stdin);

    expect(await Bun.file(path.join(temp, folder, "package.json")).text()).toBe(after);
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  });

  test.skipIf(isWindows)("bun init on a TTY keeps type commonjs and private false", async () => {
    await using temp = tempDir("bun-init-commonjs-tty", commonjsFiles);
    await using terminal = new Bun.Terminal({ cols: 80, rows: 24, data() {} });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "init"],
      cwd: temp,
      env: initEnv,
      terminal,
    });
    const exitCode = await proc.exited;

    expect(await Bun.file(path.join(temp, "package.json")).text()).toBe(commonjsAfterInit);
    expect(exitCode).toBe(0);
  });

  // `bun init` adds scripts.typecheck to this package.json and writes it back.
  const withoutTypecheck = completeWithout("scripts");

  test.each([
    ...[
      { layout: "2 spaces", indent: 2 },
      { layout: "4 spaces", indent: 4 },
      { layout: "tabs", indent: "\t" },
    ].flatMap(({ layout, indent }) =>
      [
        { eof: "a newline at the end", end: "\n" },
        { eof: "no newline at the end", end: "" },
      ].map(({ eof, end }) => ({
        layout: `${layout} and ${eof}`,
        print: (manifest: object) => JSON.stringify(manifest, null, indent) + end,
        printAfter: (manifest: object) => JSON.stringify(manifest, null, indent) + end,
      })),
    ),
    // A file with no line breaks has no indentation to keep.
    {
      layout: "one line, as 2 spaces",
      print: (manifest: object) => JSON.stringify(manifest) + "\n",
      printAfter: (manifest: object) => JSON.stringify(manifest, null, 2) + "\n",
    },
  ])("bun init -y writes an existing package.json back with $layout", async ({ print, printAfter }) => {
    await using temp = tempDir("bun-init-keeps-layout", {
      "package.json": print(withoutTypecheck),
      "index.ts": "export {};\n",
    });

    const { stdout, stderr, exitCode } = await runInit(String(temp), ["-y"]);

    expect(await Bun.file(path.join(temp, "package.json")).text()).toBe(
      printAfter({ ...withoutTypecheck, scripts: { typecheck: "bun check" } }),
    );
    expect(stdout).toContain(" ~ package.json");
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  });

  const completeText = JSON.stringify(completeManifest, null, 2);
  const unchangedSince = new Date("2020-01-01T00:00:00.000Z");

  test.each(
    [
      { layout: "4 spaces", text: JSON.stringify(completeManifest, null, 4) + "\n" },
      { layout: "tabs", text: JSON.stringify(completeManifest, null, "\t") + "\n" },
      { layout: "one line", text: JSON.stringify(completeManifest) + "\n" },
      { layout: "CRLF line ends", text: completeText.replaceAll("\n", "\r\n") + "\r\n" },
      {
        layout: "a comment and a trailing comma",
        text: completeText.replace("{\n", "{\n  // a comment\n").replace(/\n}$/, ",\n}\n"),
      },
      {
        layout: "an object on one line",
        text:
          completeText.replace(
            /"scripts": \{\s+"typecheck": "bun check"\s+\}/,
            `"scripts": { "typecheck": "bun check" }`,
          ) + "\n",
      },
      { layout: "no newline at the end", text: completeText },
    ].flatMap(row => [
      { ...row, flags: "-y", args: ["-y"] },
      { ...row, flags: "-m -y", args: ["-m", "-y"] },
    ]),
  )("bun init $flags does not write a package.json with $layout when it has nothing to add", async ({ text, args }) => {
    await using temp = tempDir("bun-init-nothing-to-add", {
      "package.json": text,
      "index.ts": "export {};\n",
    });
    const file = path.join(temp, "package.json");
    fs.utimesSync(file, unchangedSince, unchangedSince);

    const { stdout, stderr, exitCode } = await runInit(String(temp), args);

    expect(fs.readFileSync(file, "utf8")).toBe(text);
    expect(fs.statSync(file).mtimeMs).toBe(unchangedSince.getTime());
    expect(stdout).not.toContain("package.json");
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  });

  test.each([
    {
      change: "adds a name that is missing",
      manifest: completeWithout("name"),
      after: (name: string) => ({ ...completeManifest, name }),
    },
    {
      change: "replaces a name that is not a string",
      manifest: { ...completeManifest, name: 123 },
      after: (name: string) => ({ ...completeManifest, name }),
    },
    {
      change: "adds an entry point that is missing",
      manifest: completeWithout("module"),
      after: () => completeManifest,
    },
    {
      change: "adds a typecheck script that is missing",
      manifest: withoutTypecheck,
      after: () => completeManifest,
    },
  ])("bun init -y $change and prints ' ~ package.json'", async ({ manifest, after }) => {
    await using temp = tempDir("bun-init-one-change", {
      "package.json": JSON.stringify(manifest, null, 2) + "\n",
      "index.ts": "export {};\n",
    });

    const { stdout, stderr, exitCode } = await runInit(String(temp), ["-y"]);

    expect(await Bun.file(path.join(temp, "package.json")).json()).toEqual(
      after(path.basename(temp).toLowerCase().replaceAll(" ", "-")),
    );
    expect(stdout).toContain(" ~ package.json");
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  });

  test("bun init -y adds a dependency that is missing and prints ' ~ package.json'", async () => {
    // This package.json does not list @types/bun, so the nested `bun install` runs.
    await using temp = tempDir("bun-init-one-change-install", {
      "package.json": JSON.stringify(completeWithout("devDependencies"), null, 2) + "\n",
      "index.ts": "export {};\n",
    });

    const { stdout, stderr, exitCode } = await runInit(String(temp), ["-y"]);

    expect(await Bun.file(path.join(temp, "package.json")).json()).toEqual(completeManifest);
    expect(stdout).toContain(" ~ package.json");
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  }, 30_000);

  test("bun init --react works", async () => {
    await using temp = tempDir("bun-init--react-works", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "--react"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: initEnv,
    });

    expect(await exited).toBe(0);

    const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
    expect(pkg).toHaveProperty("dependencies.react");
    expect(pkg).toHaveProperty("dependencies.react-dom");
    expect(pkg).toHaveProperty("devDependencies.@types/react");
    expect(pkg).toHaveProperty("devDependencies.@types/react-dom");
    expect(pkg.peerDependencies).toEqual({ typescript: "^7" });

    expect(fs.existsSync(path.join(temp, "src"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "src/index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);
  }, 30_000);

  test("bun init --react=tailwind works", async () => {
    await using temp = tempDir("bun-init--react=tailwind-works", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "--react=tailwind"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: initEnv,
    });

    expect(await exited).toBe(0);

    const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
    expect(pkg).toHaveProperty("dependencies.react");
    expect(pkg).toHaveProperty("dependencies.react-dom");
    expect(pkg).toHaveProperty("devDependencies.@types/react");
    expect(pkg).toHaveProperty("devDependencies.@types/react-dom");
    expect(pkg).toHaveProperty("dependencies.bun-plugin-tailwind");
    expect(pkg.peerDependencies).toEqual({ typescript: "^7" });

    expect(fs.existsSync(path.join(temp, "src"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "src/index.ts"))).toBe(true);
  }, 30_000);

  test("bun init --react=shadcn works", async () => {
    await using temp = tempDir("bun-init--react=shadcn-works", {});

    const { exited } = Bun.spawn({
      cmd: [bunExe(), "init", "--react=shadcn"],
      cwd: temp,
      stdio: ["ignore", "inherit", "inherit"],
      env: initEnv,
    });

    expect(await exited).toBe(0);

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
  }, 30_000);

  // Every template declares `typescript: "^7"`, so the `bun install` that
  // `bun init` runs installs TypeScript 7. Typecheck and build with that
  // exact install. https://github.com/oven-sh/bun/issues/33050
  test.each(["-y", "--react", "--react=tailwind", "--react=shadcn"])(
    "bun init %s installs TypeScript 7, typechecks, and builds",
    async flag => {
      await using temp = tempDir(`bun-init-ts7${flag.replace(/[^a-z]+/g, "-")}`, {});

      await using init = Bun.spawn({
        cmd: [bunExe(), "init", flag],
        cwd: temp,
        stdio: ["ignore", "pipe", "pipe"],
        env: initEnv,
      });
      const [initStdout, initStderr, initExited] = await Promise.all([
        init.stdout.text(),
        init.stderr.text(),
        init.exited,
      ]);
      expect({ initStdout, initStderr, initExited }).toMatchObject({ initExited: 0 });

      const tsPkg = JSON.parse(fs.readFileSync(path.join(temp, "node_modules/typescript/package.json"), "utf8"));
      expect(tsPkg.version).toStartWith("7.");

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
