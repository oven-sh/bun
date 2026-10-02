import { beforeAll, describe, expect, test } from "bun:test";
import fs, { readdirSync } from "fs";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir, tempDirWithFiles } from "harness";
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
        "typescript": "^7",
      },
    });
    const readme = fs.readFileSync(path.join(temp, "README.md"), "utf8");
    expect(readme).toStartWith("# " + path.basename(temp).toLowerCase().replaceAll(" ", "-") + "\n");
    expect(readme).toInclude("v" + Bun.version.replaceAll("-debug", ""));
    expect(readme).toInclude("index.ts");

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

    expect(await Bun.file(path.join(temp, "package.json")).json()).toEqual({
      name: "x",
      devDependencies: { "@types/bun": "latest" },
      peerDependencies: { typescript: "^7" },
      module: "index.ts",
      type: "module",
      private: true,
    });
  }, 30_000);

  // `bun init` fills in a package.json that is absent or empty, and merges into
  // one that it parsed. Any other package.json is an error, like it is for
  // `bun add` / `bun pm pkg`, and stays as it is. It used to be treated as "no
  // package.json" and overwritten with the blank scaffold.
  async function init(cwd: string, args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "init", ...args],
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: initEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr: normalizeBunSnapshot(stderr, cwd), exitCode };
  }
  const fixOrRemove = "\nnote: fix or remove this file, then run 'bun init' again";
  const rootNotAnObject = 'error: package.json root must be an object in "<dir>/package.json"';
  // Root ignores permission bits, and Windows has none.
  const permissionBitsApply = !isWindows && process.getuid!() !== 0;

  test.each([
    {
      name: "syntax error",
      contents: '{\n  "name": "myapp",\n  "version": "2.0.0",\n  "dependencies": {\n    "foo": "^1.0.0",\n  }\n',
      error:
        '6 |   }\n       ^\nerror: Expected "}" but found end of file\n    at <dir>/package.json:6:4\n' +
        'ParserError: failed to parse "<dir>/package.json"',
    },
    {
      name: "lone {",
      contents: "{",
      error:
        '1 | {\n    ^\nerror: Expected "}" but found end of file\n    at <dir>/package.json:1:1\n' +
        'ParserError: failed to parse "<dir>/package.json"',
    },
    {
      name: "whitespace only",
      contents: "  \n",
      error:
        "error: Unexpected end of file\n    at <dir>/package.json:1:3\n" +
        'ParserError: failed to parse "<dir>/package.json"',
    },
    {
      name: "NUL byte in a string",
      contents: '{ "name": "my\0app" }\n',
      error:
        '1 | { "name": "my\0app" }\n              ^\nerror: Syntax Error\n    at <dir>/package.json:1:11\n' +
        'SyntaxError: failed to parse "<dir>/package.json"',
    },
    {
      name: "UTF-16",
      contents: Buffer.from("\uFEFF{}", "utf16le"),
      error:
        "1 | \uFFFD\uFFFD{\0}\0\n    ^\nerror: Unexpected \uFFFD\uFFFD\n    at <dir>/package.json:1:1\n" +
        'ParserError: failed to parse "<dir>/package.json"',
    },
    { name: "non-object root", contents: '["name", "myapp"]\n', error: rootNotAnObject },
    { name: "string root", contents: '"myapp"\n', error: rootNotAnObject },
    { name: "number root", contents: "42\n", error: rootNotAnObject },
    { name: "null root", contents: "null\n", error: rootNotAnObject },
  ])("bun init -y errors on an invalid package.json instead of overwriting it ($name)", async ({ contents, error }) => {
    await using temp = tempDir("bun-init-invalid-package-json", {
      "package.json": contents,
    });

    const { stdout, stderr, exitCode } = await init(temp, ["-y"]);

    expect(stdout).toBe("");
    expect(stderr).toBe(error + fixOrRemove);
    expect(fs.readFileSync(path.join(temp, "package.json"))).toEqual(Buffer.from(contents));
    expect(readdirSync(temp)).toEqual(["package.json"]);
    expect(exitCode).toBe(1);
  });

  test.each([
    { name: "-m -y", args: ["-m", "-y"], file: "package.json" },
    { name: "stdin is not a TTY", args: [], file: "package.json" },
    { name: "-y <folder>", args: ["-y", "sub"], file: "sub/package.json" },
  ])("bun init errors on an invalid package.json from every entry point ($name)", async ({ args, file }) => {
    await using temp = tempDir("bun-init-invalid-package-json-entry", { [file]: "{" });

    const { stdout, stderr, exitCode } = await init(temp, args);

    expect(stdout).toBe("");
    expect(stderr).toBe(
      `1 | {\n    ^\nerror: Expected "}" but found end of file\n    at <dir>/${file}:1:1\n` +
        `ParserError: failed to parse "<dir>/${file}"` +
        fixOrRemove,
    );
    expect(await Bun.file(path.join(temp, file)).text()).toBe("{");
    expect(readdirSync(path.dirname(path.join(temp, file)))).toEqual(["package.json"]);
    expect(exitCode).toBe(1);
  });

  test("bun init -y errors when package.json is a directory", async () => {
    await using temp = tempDir("bun-init-package-json-directory", { "package.json": {} });

    const { stdout, stderr, exitCode } = await init(temp, ["-y"]);

    expect(stdout).toBe("");
    // Windows opens a handle to the directory, so the file kind check reports it.
    expect(stderr).toBe(
      isWindows
        ? 'error: "<dir>/package.json" is not a regular file'
        : 'EISDIR: Is a directory: could not open "<dir>/package.json" (open)',
    );
    expect(readdirSync(temp)).toEqual(["package.json"]);
    expect(readdirSync(path.join(temp, "package.json"))).toEqual([]);
    expect(exitCode).toBe(1);
  });

  // Creating a symlink needs a privilege on Windows.
  test.skipIf(isWindows).each([
    {
      name: "symlink loop",
      target: "package.json",
      error: 'ELOOP: Too many levels of symbolic links: could not open "<dir>/package.json" (open)',
    },
    { name: "symlink to a device", target: "/dev/null", error: 'error: "<dir>/package.json" is not a regular file' },
  ])("bun init -y errors when package.json is not a regular file ($name)", async ({ target, error }) => {
    await using temp = tempDir("bun-init-package-json-symlink", {});
    fs.symlinkSync(target, path.join(temp, "package.json"));

    const { stdout, stderr, exitCode } = await init(temp, ["-y"]);

    expect(stdout).toBe("");
    expect(stderr).toBe(error);
    expect(fs.readlinkSync(path.join(temp, "package.json"))).toBe(target);
    expect(readdirSync(temp)).toEqual(["package.json"]);
    expect(exitCode).toBe(1);
  });

  test.skipIf(!permissionBitsApply).each([
    { name: "write-only", mode: 0o200 },
    { name: "read-only", mode: 0o444 },
  ])("bun init -y errors on a package.json it may not read and write ($name)", async ({ mode }) => {
    const contents = '{ "name": "myapp", "version": "2.0.0" }\n';
    await using temp = tempDir("bun-init-package-json-mode", { "package.json": contents });
    fs.chmodSync(path.join(temp, "package.json"), mode);

    const { stdout, stderr, exitCode } = await init(temp, ["-y"]);

    expect(stdout).toBe("");
    expect(stderr).toBe(
      'EACCES: Permission denied while opening "<dir>/package.json"\n' +
        "note: package.json must be readable and writable for bun init to update it",
    );
    fs.chmodSync(path.join(temp, "package.json"), 0o644);
    expect(await Bun.file(path.join(temp, "package.json")).text()).toBe(contents);
    expect(readdirSync(temp)).toEqual(["package.json"]);
    expect(exitCode).toBe(1);
  });

  test("bun init -y -m fills in an empty package.json", async () => {
    await using temp = tempDir("bun-init-empty-package-json", { "package.json": "" });

    const { stdout, exitCode } = await init(temp, ["-y", "-m"]);

    expect(stdout.split("\n")[0]).toBe(" + package.json");
    expect(await Bun.file(path.join(temp, "package.json")).json()).toEqual({
      devDependencies: { "@types/bun": "latest" },
    });
    expect(exitCode).toBe(0);
  });

  // Creating a symlink needs a privilege on Windows.
  test.skipIf(isWindows)("bun init -y -m creates the target of a dangling package.json symlink", async () => {
    await using temp = tempDir("bun-init-dangling-package-json", {});
    fs.symlinkSync("target.json", path.join(temp, "package.json"));

    const { exitCode } = await init(temp, ["-y", "-m"]);

    expect(fs.readlinkSync(path.join(temp, "package.json"))).toBe("target.json");
    expect(await Bun.file(path.join(temp, "target.json")).json()).toEqual({
      devDependencies: { "@types/bun": "latest" },
    });
    expect(exitCode).toBe(0);
  });

  // The React templates never load package.json. Their writer skips one that exists.
  test("bun init --react skips a package.json it cannot parse", async () => {
    await using temp = tempDir("bun-init-react-invalid-package-json", { "package.json": "{" });

    const { stdout, exitCode } = await init(temp, ["--react"]);

    expect(stdout.split("\n")).toContain(" ○ package.json (already exists, skipping)");
    expect(await Bun.file(path.join(temp, "package.json")).text()).toBe("{");
    expect(fs.existsSync(path.join(temp, "bunfig.toml"))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test.skipIf(!permissionBitsApply)("bun init --react skips a read-only package.json", async () => {
    const contents = '{ "name": "myapp" }\n';
    await using temp = tempDir("bun-init-react-read-only-package-json", { "package.json": contents });
    fs.chmodSync(path.join(temp, "package.json"), 0o444);

    const { stdout, exitCode } = await init(temp, ["--react"]);

    expect(stdout.split("\n")).toContain(" ○ package.json (already exists, skipping)");
    expect(await Bun.file(path.join(temp, "package.json")).text()).toBe(contents);
    expect(exitCode).toBe(0);
  });

  // ConPTY rewrites the child's output (it wraps lines at `cols`), so the text
  // these tests read from the terminal is only stable on a POSIX pty.
  describe.skipIf(isWindows)("on a TTY", () => {
    /** Runs `bun init` on a pty. `onPicker` runs once the template picker is shown. */
    async function initOnTTY(cwd: string, onPicker?: (terminal: Bun.Terminal) => void) {
      const decoder = new TextDecoder();
      let output = "";
      const picker = Promise.withResolvers<void>();
      await using terminal = new Bun.Terminal({
        cols: 80,
        rows: 24,
        data(_, chunk: Uint8Array) {
          output += decoder.decode(chunk, { stream: true });
          if (output.includes("Select a project template")) picker.resolve();
        },
      });
      await using proc = Bun.spawn({ cmd: [bunExe(), "init"], cwd, env: initEnv, terminal });
      if (onPicker) {
        // Fail with the child's output if it exits before the picker.
        const exitedEarly = proc.exited.then(code => {
          throw new Error(`bun init exited before the template picker (code ${code}):\n${output}`);
        });
        exitedEarly.catch(() => {});
        await Promise.race([picker.promise, exitedEarly]);
        onPicker(terminal);
      }
      const exitCode = await proc.exited;
      return { output: normalizeBunSnapshot(Bun.stripANSI(output), cwd), exitCode };
    }

    test("bun init errors on an invalid package.json before the template picker", async () => {
      await using temp = tempDir("bun-init-tty-invalid-package-json", { "package.json": "{" });

      const { output, exitCode } = await initOnTTY(temp);

      expect(output).toBe(
        '1 | {\n    ^\nerror: Expected "}" but found end of file\n    at <dir>/package.json:1:1\n' +
          'ParserError: failed to parse "<dir>/package.json"' +
          fixOrRemove,
      );
      expect(await Bun.file(path.join(temp, "package.json")).text()).toBe("{");
      expect(readdirSync(temp)).toEqual(["package.json"]);
      expect(exitCode).toBe(1);
    });

    test.each([
      { name: "created", before: undefined },
      { name: "given content", before: "" },
    ])("bun init keeps a package.json that is $name while the template picker is open", async ({ before }) => {
      const saved = '{ "name": "saved-during-the-picker" }\n';
      await using temp = tempDir(
        "bun-init-tty-package-json-changed",
        before === undefined ? {} : { "package.json": before },
      );

      const { output, exitCode } = await initOnTTY(temp, terminal => {
        fs.writeFileSync(path.join(temp, "package.json"), saved);
        // "1" picks the first entry (Blank) and submits it.
        terminal.write("1");
      });

      expect(output).toEndWith(
        'error: "<dir>/package.json" appeared or changed while bun init was running\n' + "note: run 'bun init' again",
      );
      expect(await Bun.file(path.join(temp, "package.json")).text()).toBe(saved);
      expect(readdirSync(temp)).toEqual(["package.json"]);
      expect(exitCode).toBe(1);
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

      // The blank template has no `build` script; the react templates do.
      // bun-plugin-tailwind's `bun` peer dep links a node_modules/.bin/bun that
      // would otherwise shadow bunExe() in the nested `bun run build.ts`, so
      // pass --bun.
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
