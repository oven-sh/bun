import { describe, expect, test } from "bun:test";
import { realpathSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, toTOMLString } from "harness";
import { join as pathJoin } from "node:path";

describe.each(["bun run", "bun"])(`%s`, cmd => {
  const runCmd = cmd === "bun" ? ["-c=bunfig.toml", "run"] : ["-c=bunfig.toml"];
  const node = Bun.which("node")!;
  const execPath = process.execPath;

  describe.each(["--bun", "without --bun"])("%s", cmd2 => {
    test("which node", async () => {
      const bun = cmd2 === "--bun";
      const bunFlag = bun ? ["--bun"] : [];
      const bunfig = toTOMLString({
        run: {
          bun,
        },
      });

      await using cwd = tempDir("run.where.node", {
        "bunfig.toml": bunfig,
        "package.json": JSON.stringify(
          {
            scripts: {
              "where-node": `which node`,
            },
          },
          null,
          2,
        ),
      });

      const result = Bun.spawnSync({
        cmd: [bunExe(), "--silent", ...bunFlag, ...runCmd, "where-node"],
        env: bunEnv,
        stderr: "inherit",
        stdout: "pipe",
        stdin: "ignore",
        cwd,
      });
      const nodeBin = result.stdout.toString().trim();

      if (bun) {
        if (isWindows) {
          expect(realpathSync(nodeBin)).toContain("\\bun-node-");
        } else {
          expect(realpathSync(nodeBin)).toBe(realpathSync(execPath));
        }
      } else {
        expect(realpathSync(nodeBin)).toBe(realpathSync(node));
      }
      expect(result.success).toBeTrue();
    });
  });

  describe.each(["bun", "system", "default"])(`run.shell = "%s"`, shellStr => {
    if (isWindows && shellStr === "system") return; // windows always uses the bun shell now
    const shell = shellStr === "default" ? (isWindows ? "bun" : "system") : shellStr;
    const command_not_found =
      isWindows && shell === "system" ? "is not recognized as an internal or external command" : "command not found";
    test.each(["true", "false"])('run.silent = "%s"', silentStr => {
      const silent = silentStr === "true";
      const bunfig = toTOMLString({
        run: {
          shell: shellStr === "default" ? undefined : shell,
          silent,
        },
      });

      using cwd = tempDir(Bun.hash(bunfig).toString(36), {
        "bunfig.toml": bunfig,
        "package.json": JSON.stringify(
          {
            scripts: {
              startScript: "echo 1",
            },
          },
          null,
          2,
        ),
      });

      const result = Bun.spawnSync({
        cmd: [bunExe(), ...runCmd, "startScript"],
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
        stdin: "ignore",
        cwd,
      });

      if (silent) {
        expect(result.stderr.toString().trim()).toBe("");
      } else {
        expect(result.stderr.toString().trim()).toContain("$ echo 1");
      }
      expect(result.success).toBeTrue();
    });
    test("command not found", async () => {
      const bunfig = toTOMLString({
        run: {
          shell,
        },
      });

      await using cwd = tempDir("run.shell.system-" + Bun.hash(bunfig).toString(32), {
        "bunfig.toml": bunfig,
        "package.json": JSON.stringify(
          {
            scripts: {
              start: "this-should-start-with-bun-in-the-error-message",
            },
          },
          null,
          2,
        ),
      });

      const result = Bun.spawnSync({
        cmd: [bunExe(), "--silent", ...runCmd, "start"],
        env: bunEnv,
        stderr: "pipe",
        stdout: "inherit",
        stdin: "ignore",
        cwd,
      });

      const err = result.stderr.toString().trim();
      expect(err).toContain(command_not_found);
      expect(err).toContain("this-should-start-with-bun-in-the-error-message");
      expect(result.success).toBeFalse();
    });
  });

  test("autoload local bunfig.toml (same cwd)", async () => {
    const runCmd = cmd === "bun" ? ["run"] : [];

    const bunfig = toTOMLString({
      run: {
        bun: true,
      },
    });

    await using cwd = tempDir("run.where.node", {
      "bunfig.toml": bunfig,
      "package.json": JSON.stringify(
        {
          scripts: {
            "where-node": `which node`,
          },
        },
        null,
        2,
      ),
    });

    const result = Bun.spawnSync({
      cmd: [bunExe(), "--silent", ...runCmd, "where-node"],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
      stdin: "ignore",
      cwd,
    });
    const nodeBin = result.stdout.toString().trim();

    if (isWindows) {
      expect(realpathSync(nodeBin)).toContain("\\bun-node-");
    } else {
      expect(realpathSync(nodeBin)).toBe(realpathSync(execPath));
    }
  });

  test("NOT autoload local bunfig.toml (sub cwd)", async () => {
    const runCmd = cmd === "bun" ? ["run"] : [];

    const bunfig = toTOMLString({
      run: {
        bun: true,
      },
    });

    await using cwd = tempDir("run.where.node", {
      "bunfig.toml": bunfig,
      "package.json": JSON.stringify(
        {
          scripts: {
            "where-node": `which node`,
          },
        },
        null,
        2,
      ),
      "subdir/a.txt": "a",
    });

    const result = Bun.spawnSync({
      cmd: [bunExe(), "--silent", ...runCmd, "where-node"],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
      stdin: "ignore",
      cwd: pathJoin(cwd, "./subdir"),
    });
    const nodeBin = result.stdout.toString().trim();

    expect(realpathSync(nodeBin)).toBe(realpathSync(node));
    expect(result.success).toBeTrue();
  });

  test("NOT autoload home bunfig.toml", async () => {
    const runCmd = cmd === "bun" ? ["run"] : [];

    const bunfig = toTOMLString({
      run: {
        bun: true,
      },
    });

    await using cwd = tempDir("run.where.node", {
      "my-home/.bunfig.toml": bunfig,
      "package.json": JSON.stringify(
        {
          scripts: {
            "where-node": `which node`,
          },
        },
        null,
        2,
      ),
    });

    const result = Bun.spawnSync({
      cmd: [bunExe(), "--silent", ...runCmd, "where-node"],
      env: {
        ...bunEnv,
        HOME: pathJoin(cwd, "./my-home"),
      },
      stderr: "inherit",
      stdout: "pipe",
      stdin: "ignore",
      cwd,
    });
    const nodeBin = result.stdout.toString().trim();

    expect(realpathSync(nodeBin)).toBe(realpathSync(node));
    expect(result.success).toBeTrue();
  });
});

// These entry points read ./bunfig.toml after argument parsing. A file that does not parse
// stops them with the same report as `bun <file>` and `bun run --filter`.
describe.concurrent("bunfig.toml that does not parse", () => {
  const configs: [problem: string, bunfig: string, stderr: string[]][] = [
    [
      "a TOML syntax error",
      "[install]\nregistry =\n",
      [
        "2 | registry =",
        "              ^",
        "error: Missing value after '='; values must be on the same line",
        "    at bunfig.toml:2:11",
        "",
        "SyntaxError: failed to load bunfig",
        "",
      ],
    ],
    [
      "a value of the wrong type",
      '[run]\nbun = "yes"\n',
      [
        '2 | bun = "yes"',
        "          ^",
        "error: Expected boolean",
        "    at bunfig.toml:2:7",
        "",
        "Invalid Bunfig: failed to load bunfig",
        "",
      ],
    ],
  ];
  const commands: [command: string, args: string[]][] = [
    ["bun run <script>", ["run", "hello"]],
    ["bun <script>", ["hello"]],
    ["bun run <file>", ["run", "index.js"]],
    ["bun run ./<file>", ["run", "./index.js"]],
    ["bun run -", ["run", "-"]], // the script comes from stdin
    ["bun run --watch <file>", ["run", "--watch", "index.js"]],
    ["bun run --hot <file>", ["run", "--hot", "index.js"]],
    ["bun repl", ["repl"]],
  ];

  async function run(bunfig: string, cmd: (dir: string) => string[]) {
    using dir = tempDir("bunfig-does-not-parse", {
      "bunfig.toml": bunfig,
      "package.json": JSON.stringify({ scripts: { hello: "echo ran" } }),
      "index.js": `console.log("ran");`,
    });
    await using proc = Bun.spawn({
      cmd: cmd(String(dir)),
      env: bunEnv,
      cwd: String(dir),
      stdin: new Blob([`console.log("ran");`]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  describe.each(configs)("%s", (_, bunfig, expectedStderr) => {
    const stopped = { stdout: "", stderr: expectedStderr.join("\n"), exitCode: 1, signalCode: null };

    test.each(commands)("stops %s", async (_, args) => {
      expect(await run(bunfig, () => [bunExe(), ...args])).toEqual(stopped);
    });

    // Bun runs as node when its executable is named node. A symlink needs privileges on Windows.
    test.skipIf(isWindows)("stops node <file> when node is bun", async () => {
      expect(
        await run(bunfig, dir => {
          symlinkSync(bunExe(), pathJoin(dir, "node"));
          return [pathJoin(dir, "node"), "index.js"];
        }),
      ).toEqual(stopped);
    });
  });
});

// A merge can leave conflict markers in bunfig.toml. `bun run <file>` printed the parse error and ran the
// file anyway: the preload did not run, and a missing package was requested from the default registry.
describe.concurrent("bun run <file> next to a bunfig.toml with conflict markers", () => {
  const withConflictMarkers = (config: string) =>
    `<<<<<<< HEAD\n${config}=======\n${config}telemetry = false\n>>>>>>> feature\n`;

  const scopePackage = new Bun.Archive(
    {
      "package/package.json": JSON.stringify({ name: "@corp/lib", version: "1.0.0" }),
      "package/index.js": `module.exports = "from the @corp registry";\n`,
    },
    { compress: "gzip" },
  ).bytes();

  /** Runs `bun ...args`. The only package that exists is `@corp/lib`, in the registry whose URL `bunfig` gets. */
  async function run(bunfig: (scopeRegistry: string) => string, specifier: string, args: string[]) {
    const tarball = await scopePackage;
    using scopeRegistry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const { origin, pathname } = new URL(request.url);
        if (pathname.endsWith(".tgz")) return new Response(tarball);
        const version = { name: "@corp/lib", version: "1.0.0", dist: { tarball: `${origin}/lib-1.0.0.tgz` } };
        return Response.json({ name: "@corp/lib", "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": version } });
      },
    });
    const defaultRegistryAsked: string[] = [];
    using defaultRegistry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        defaultRegistryAsked.push(decodeURIComponent(new URL(request.url).pathname.slice(1)));
        return new Response("{}", { status: 404 });
      },
    });
    using dir = tempDir("run-bunfig-conflict-markers", {
      "bunfig.toml": bunfig(scopeRegistry.url.href),
      "guard.ts": `globalThis.guardRan = true;`,
      "main.ts": `
        let loaded;
        try { loaded = require(${JSON.stringify(specifier)}); } catch { loaded = "cannot load"; }
        console.log((globalThis.guardRan ? "the guard ran" : "the guard did not run") + ", ${specifier}: " + loaded);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: {
        ...bunEnv,
        HOME: pathJoin(String(dir), "home"),
        BUN_INSTALL_CACHE_DIR: pathJoin(String(dir), "cache"),
        BUN_CONFIG_REGISTRY: defaultRegistry.url.href,
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, defaultRegistryAsked };
  }

  const settings: [setting: string, bunfig: (scopeRegistry: string) => string, specifier: string, loaded: string][] = [
    [
      '[install] auto = "disable"',
      () => `preload = ["./guard.ts"]\n[install]\nauto = "disable"\n`,
      "ghost",
      "cannot load",
    ],
    [
      "[install.scopes] a registry for @corp",
      scopeRegistry => `preload = ["./guard.ts"]\n[install.scopes]\n"@corp" = "${scopeRegistry}"\n`,
      "@corp/lib",
      "from the @corp registry",
    ],
  ];

  describe.each(settings)("with a preload and %s", (_, bunfig, specifier, loaded) => {
    test("the settings apply while the file parses", async () => {
      expect(await run(bunfig, specifier, ["run", "main.ts"])).toEqual({
        stdout: `the guard ran, ${specifier}: ${loaded}\n`,
        stderr: "",
        exitCode: 0,
        defaultRegistryAsked: [],
      });
    });

    test.each(["main.ts", "./main.ts"])("bun run %s stops", async file => {
      expect(await run(scopeRegistry => withConflictMarkers(bunfig(scopeRegistry)), specifier, ["run", file])).toEqual({
        stdout: "",
        stderr: [
          "1 | <<<<<<< HEAD",
          "    ^",
          "error: Expected a key but found (redacted)",
          "    at bunfig.toml:1:1",
          "",
          "SyntaxError: failed to load bunfig",
          "",
        ].join("\n"),
        exitCode: 1,
        defaultRegistryAsked: [],
      });
    });
  });
});
