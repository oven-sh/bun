import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "fs";
import { join } from "path";
import { bunEnv, bunExe, fakeNodeRun, tempDir } from "../../harness";

describe("fake node cli", () => {
  test("the node cli actually works", () => {
    using temp = tempDir("fake-node", {
      "index.ts": "console.log(Bun.version)",
    });
    expect(fakeNodeRun(temp, join(temp, "index.ts")).stdout).toBe(Bun.version);
  });
  test("doesnt resolve bins", () => {
    using temp = tempDir("fake-node", {
      "vite.js": "console.log('pass')",
      "node_modules/.bin/vite": "#!/usr/bin/sh\necho fail && exit 1",
    });
    expect(fakeNodeRun(temp, "vite").stdout).toBe("pass");
  });
  test("doesnt resolve scripts", () => {
    using temp = tempDir("fake-node", {
      "vite.js": "console.log('pass')",
      "package.json": '{"scripts":{"vite":"echo fail && exit 1"}}',
    });
    expect(fakeNodeRun(temp, "vite").stdout).toBe("pass");
  });
  test("can run a script named run.js", () => {
    using temp = tempDir("fake-node", {
      "run.js": "console.log('pass')",
      "run/index.js": "console.log('fail')",
      "node_modules/run/index.js": "console.log('fail')",
    });
    expect(fakeNodeRun(temp, "run").stdout).toBe("pass");
  });
  describe("entrypoint file extension picking", () => {
    // Bun supports JSX and TS, and node doesnt, so our behavior here differs a bit
    // Hopefully these priorization rules will not break any node apps.
    test("picks tsx over any other ext", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.jsx": "console.log('fail (build.jsx)')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('fail (build.ts)')",
        "build.cts": "console.log('fail (build.cts)')",
        "build.mts": "console.log('fail (build.mts)')",
        "build.tsx": "console.log('pass')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
    test("picks jsx over ts", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.jsx": "console.log('pass')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('fail (build.ts)')",
        "build.cts": "console.log('fail (build.cts)')",
        "build.mts": "console.log('fail (build.mts)')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
    test("picks mts over ts", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('fail (build.ts)')",
        "build.cts": "console.log('fail (build.cts)')",
        "build.mts": "console.log('pass')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
    test("picks ts over js/cjs/etc", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('pass')",
        "build.cts": "console.log('fail (build.cts)')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
  });

  test("node -e ", () => {
    using temp = tempDir("fake-node", {});
    expect(fakeNodeRun(temp, ["-e", "console.log('pass')"]).stdout).toBe("pass");
  });

  test("process args work", () => {
    using temp = tempDir("fake-node", {
      "index.js": "console.log(JSON.stringify(process.argv.slice(1)))",
    });
    expect(fakeNodeRun(temp, ["index", "a", "b", "c"]).stdout).toBe(
      // note: no extension here is INTENTIONAL
      JSON.stringify([join(temp, "index"), "a", "b", "c"]),
    );
  });

  // Bare `node` now matches Node.js: a TTY stdin enters the REPL, a
  // non-TTY stdin (pipe) prints "Missing script". fakeNodeRun's default
  // stdin is platform-dependent (Windows may inherit a console), so pin
  // a piped stdin here.
  test("no args with piped stdin errors with 'Missing script'", () => {
    using temp = tempDir("fake-node", {});
    const result = Bun.spawnSync([bunExe(), "--bun", "node"], {
      cwd: temp,
      env: { ...bunEnv, NODE_ENV: undefined },
      stdin: Buffer.alloc(0),
    });
    expect(result.stderr.toString()).toContain("Missing script");
    expect(result.success).toBe(false);
  });

  // These tests are not concurrent. In a debug build each `bun --bun` deletes and makes again the
  // directory of the `node` shim, so a concurrent one can fail with `Script not found "node"`.

  // `node ./pkg`, `node .`, `node ./entry` and `node ./bin/link` do not name the file that runs.
  describe("an entry point that does not name the file that runs", () => {
    const cjs = `console.log(JSON.stringify({
      argv1: process.argv[1],
      filename: __filename,
      requireMain: require.main === module,
      mainModule: process.mainModule === module,
      bunMain: Bun.main,
    }));`;
    const esm = `console.log(JSON.stringify({
      argv1: process.argv[1],
      filename: import.meta.filename,
      importMetaMain: import.meta.main,
      bunMain: Bun.main,
    }));`;
    const entryPoints = [
      { name: "a directory", pkg: {}, file: "pkg/index.js", cwd: ".", arg: "./pkg", argv1: "pkg" },
      {
        name: "`.` with a package.json main",
        pkg: { main: "./lib/entry.js" },
        file: "pkg/lib/entry.js",
        cwd: "pkg",
        arg: ".",
        argv1: "pkg",
      },
      {
        name: "a file without its extension",
        pkg: {},
        file: "pkg/entry.js",
        cwd: "pkg",
        arg: "./entry",
        argv1: "pkg/entry",
      },
    ];

    test.each(entryPoints)("CommonJS, $name", async ({ pkg, file, cwd, arg, argv1 }) => {
      using temp = tempDir("fake-node-main", { "pkg/package.json": JSON.stringify(pkg), [file]: cjs });
      const result = await runAsNode(join(temp, cwd), [arg]);
      expect({ ...result, stdout: parse(result.stdout) }).toEqual({
        stdout: {
          argv1: join(temp, argv1),
          filename: join(temp, file),
          requireMain: true,
          mainModule: true,
          bunMain: join(temp, file),
        },
        stderr: "",
        exitCode: 0,
      });
    });

    test.each(entryPoints)("ESM, $name", async ({ pkg, file, cwd, arg, argv1 }) => {
      using temp = tempDir("fake-node-main", {
        "pkg/package.json": JSON.stringify({ ...pkg, type: "module" }),
        [file]: esm,
      });
      const result = await runAsNode(join(temp, cwd), [arg]);
      expect({ ...result, stdout: parse(result.stdout) }).toEqual({
        stdout: {
          argv1: join(temp, argv1),
          filename: join(temp, file),
          importMetaMain: true,
          bunMain: join(temp, file),
        },
        stderr: "",
        exitCode: 0,
      });
    });

    test("CommonJS, a symlink", async () => {
      using temp = tempDir("fake-node-main", { "pkg/package.json": "{}", "pkg/cli.js": cjs });
      mkdirSync(join(temp, "bin"));
      symlinkSync(join("..", "pkg", "cli.js"), join(temp, "bin", "link"));
      const result = await runAsNode(String(temp), ["./bin/link"]);
      expect({ ...result, stdout: parse(result.stdout) }).toEqual({
        stdout: {
          argv1: join(temp, "bin", "link"),
          filename: join(temp, "pkg", "cli.js"),
          requireMain: true,
          mainModule: true,
          bunMain: join(temp, "pkg", "cli.js"),
        },
        stderr: "",
        exitCode: 0,
      });
    });

    test("NODE_PRESERVE_SYMLINKS=1 keeps the path through a symlinked directory", async () => {
      using temp = tempDir("fake-node-main", {
        "real/package.json": JSON.stringify({ type: "module" }),
        "real/entry.js": "console.log(import.meta.filename);",
      });
      symlinkSync(join(temp, "real"), join(temp, "link"), "dir");
      const result = await runAsNode(String(temp), ["./link/entry.js"], { NODE_PRESERVE_SYMLINKS: "1" });
      expect(result).toEqual({ stdout: join(temp, "link", "entry.js") + "\n", stderr: "", exitCode: 0 });
    });

    test("a package.json that does not parse adds no output", async () => {
      using temp = tempDir("fake-node-main", {
        "pkg/package.json": "{",
        "pkg/index.js": "console.log(require.main === module);",
      });
      expect(await runAsNode(String(temp), ["./pkg"])).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
    });

    test("cron execution mode still calls scheduled()", async () => {
      using temp = tempDir("fake-node-main", {
        "pkg/package.json": JSON.stringify({ type: "module" }),
        "pkg/index.js": "export default { scheduled(controller) { console.log(controller.cron); } };",
      });
      const result = await runAsNode(String(temp), ["--cron-title=job", "--cron-period=* * * * *", "./pkg"]);
      expect(result).toEqual({ stdout: "* * * * *\n", stderr: "", exitCode: 0 });
    });

    test("the Bun shell `$1` is process.argv[1]", async () => {
      using temp = tempDir("fake-node-main", {
        "pkg/package.json": JSON.stringify({ type: "module" }),
        "pkg/index.js": "console.log(JSON.stringify([process.argv[1], (await Bun.$`echo $1`.text()).trim()]));",
      });
      const result = await runAsNode(String(temp), ["./pkg"]);
      expect({ ...result, stdout: parse(result.stdout) }).toEqual({
        stdout: [join(temp, "pkg"), join(temp, "pkg")],
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // Until the main module loads, Bun parses an import with an unknown extension as code.
  describe("an import with an unknown extension is an asset", () => {
    const files = {
      "pkg/package.json": JSON.stringify({ type: "module" }),
      "pkg/index.js": `
        import asset from "./asset.bin";
        import { basename } from "node:path";
        console.log(JSON.stringify({ filename: import.meta.filename, asset: basename(asset) }));`,
      "pkg/asset.bin": "this is not javascript {",
    };
    const loaded = (temp: string) => ({
      stdout: { filename: join(temp, "pkg", "index.js"), asset: "asset.bin" },
      stderr: "",
      exitCode: 0,
    });

    test("when the entry point is a directory", async () => {
      using temp = tempDir("fake-node-asset", files);
      const result = await runAsNode(String(temp), ["./pkg"]);
      expect({ ...result, stdout: parse(result.stdout) }).toEqual(loaded(temp));
    });

    // On Windows the module loader names the entry point with `\`.
    test("when the entry point is an absolute path with `/`", async () => {
      using temp = tempDir("fake-node-asset", files);
      const result = await runAsNode(String(temp), [join(temp, "pkg", "index.js").replaceAll("\\", "/")]);
      expect({ ...result, stdout: parse(result.stdout) }).toEqual(loaded(temp));
    });

    test("when the entry point is a symlink", async () => {
      using temp = tempDir("fake-node-asset", files);
      mkdirSync(join(temp, "bin"));
      symlinkSync(join("..", "pkg", "index.js"), join(temp, "bin", "link"));
      const result = await runAsNode(String(temp), ["./bin/link"]);
      expect({ ...result, stdout: parse(result.stdout) }).toEqual(loaded(temp));
    });
  });
});

async function runAsNode(cwd: string, args: string[], env?: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--bun", "node", ...args],
    cwd,
    env: { ...bunEnv, NODE_ENV: undefined, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// A child that fails prints no JSON. Keep what it printed for the failure message.
function parse(stdout: string) {
  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}
