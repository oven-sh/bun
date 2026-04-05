import { describe, expect, test } from "bun:test";
import { join, dirname } from "path";
import { chmodSync, symlinkSync } from "fs";
import { bunEnv, bunExe, fakeNodeRun, isWindows, tempDirWithFiles } from "../../harness";

describe("fake node cli", () => {
  test("the node cli actually works", () => {
    const temp = tempDirWithFiles("fake-node", {
      "index.ts": "console.log(Bun.version)",
    });
    expect(fakeNodeRun(temp, join(temp, "index.ts")).stdout).toBe(Bun.version);
  });
  test("doesnt resolve bins", () => {
    const temp = tempDirWithFiles("fake-node", {
      "vite.js": "console.log('pass')",
      "node_modules/.bin/vite": "#!/usr/bin/sh\necho fail && exit 1",
    });
    expect(fakeNodeRun(temp, "vite").stdout).toBe("pass");
  });
  test("doesnt resolve scripts", () => {
    const temp = tempDirWithFiles("fake-node", {
      "vite.js": "console.log('pass')",
      "package.json": '{"scripts":{"vite":"echo fail && exit 1"}}',
    });
    expect(fakeNodeRun(temp, "vite").stdout).toBe("pass");
  });
  test("can run a script named run.js", () => {
    const temp = tempDirWithFiles("fake-node", {
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
      const temp = tempDirWithFiles("fake-node", {
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
      const temp = tempDirWithFiles("fake-node", {
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
      const temp = tempDirWithFiles("fake-node", {
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
      const temp = tempDirWithFiles("fake-node", {
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
    const temp = tempDirWithFiles("fake-node", {});
    expect(fakeNodeRun(temp, ["-e", "console.log('pass')"]).stdout).toBe("pass");
  });

  test("process args work", () => {
    const temp = tempDirWithFiles("fake-node", {
      "index.js": "console.log(JSON.stringify(process.argv.slice(1)))",
    });
    expect(fakeNodeRun(temp, ["index", "a", "b", "c"]).stdout).toBe(
      // note: no extension here is INTENTIONAL
      JSON.stringify([join(temp, "index"), "a", "b", "c"]),
    );
  });

  test("no args is exit code zero for now", () => {
    const temp = tempDirWithFiles("fake-node", {});
    expect(() => fakeNodeRun(temp, [])).toThrow();
  });

  test.skipIf(isWindows)("resolves symlinks for entry point so relative imports work", () => {
    // When bun runs as "node" and the entry point is a symlink (e.g.
    // node_modules/.bin/tool -> ../my-tool/cli.mjs), relative imports in
    // the script must resolve relative to the *target* file's directory,
    // not the symlink's directory. This matches Node.js default behavior.
    // Without symlink resolution, `import "./lib.mjs"` from a script in
    // node_modules/my-tool/ would look in .bin/ instead, and __dirname
    // would point to .bin/ rather than the real package directory.
    const temp = tempDirWithFiles("fake-node-symlink", {
      // The "real" tool with a relative import between sibling files
      "node_modules/my-tool/cli.mjs": `
        import { greet } from "./lib.mjs";
        console.log(greet());
      `,
      "node_modules/my-tool/lib.mjs": `
        export function greet() { return "hello from my-tool"; }
      `,
      ".bin/.gitkeep": "",
    });
    const realScript = join(temp, "node_modules/my-tool/cli.mjs");
    const symlinkPath = join(temp, ".bin/my-tool");
    symlinkSync(realScript, symlinkPath);

    // Create a symlink named "node" pointing to the bun binary so
    // argv[0] ends with "node" and triggers the execAsIfNode codepath.
    const nodePath = join(temp, "node");
    symlinkSync(bunExe(), nodePath);

    // Run the symlink through bun-as-node. Without symlink resolution,
    // the import of "./lib.mjs" would look in .bin/ instead of
    // node_modules/my-tool/ and fail with "Cannot find module".
    const result = Bun.spawnSync([nodePath, symlinkPath], {
      cwd: temp,
      env: bunEnv,
    });
    const stdout = result.stdout.toString("utf8").trim();
    const stderr = result.stderr.toString("utf8").trim();
    expect(stderr).toBe("");
    expect(stdout).toBe("hello from my-tool");
    expect(result.exitCode).toBe(0);
  });

  test.skipIf(isWindows)("resolves symlinks for entry point — __dirname points to real location", () => {
    // Verify that __dirname reflects the resolved (real) path, not the
    // symlink's directory. This is the Node.js default behavior controlled
    // by --preserve-symlinks-main.
    const temp = tempDirWithFiles("fake-node-dirname", {
      "node_modules/my-tool/cli.js": `console.log(__dirname)`,
      ".bin/.gitkeep": "",
    });
    const realScript = join(temp, "node_modules/my-tool/cli.js");
    const symlinkPath = join(temp, ".bin/my-tool");
    symlinkSync(realScript, symlinkPath);

    const nodePath = join(temp, "node");
    symlinkSync(bunExe(), nodePath);

    const result = Bun.spawnSync([nodePath, symlinkPath], {
      cwd: temp,
      env: bunEnv,
    });
    const stdout = result.stdout.toString("utf8").trim();
    const stderr = result.stderr.toString("utf8").trim();
    expect(stderr).toBe("");
    expect(stdout).toBe(dirname(realScript));
    expect(result.exitCode).toBe(0);
  });

  test.skipIf(isWindows)("resolves symlinks for entry point — process.argv[1] is real path", () => {
    // Node.js sets process.argv[1] to the resolved real path by default.
    const temp = tempDirWithFiles("fake-node-argv", {
      "node_modules/my-tool/cli.js": `console.log(process.argv[1])`,
      ".bin/.gitkeep": "",
    });
    const realScript = join(temp, "node_modules/my-tool/cli.js");
    const symlinkPath = join(temp, ".bin/my-tool");
    symlinkSync(realScript, symlinkPath);

    const nodePath = join(temp, "node");
    symlinkSync(bunExe(), nodePath);

    const result = Bun.spawnSync([nodePath, symlinkPath], {
      cwd: temp,
      env: bunEnv,
    });
    const stdout = result.stdout.toString("utf8").trim();
    expect(result.stderr.toString("utf8").trim()).toBe("");
    expect(stdout).toBe(realScript);
    expect(result.exitCode).toBe(0);
  });

  test.skipIf(isWindows)("bun run --bun resolves .bin symlinks for relative imports", () => {
    // End-to-end test for the full `bun run --bun <name>` flow:
    // 1. bun run finds the tool via PATH (node_modules/.bin/)
    // 2. spawns it via posix_spawn
    // 3. kernel reads shebang #!/usr/bin/env node
    // 4. bun (as fake node) runs the script
    // 5. relative imports must resolve against the real file location,
    //    not the .bin/ symlink directory
    const temp = tempDirWithFiles("bun-run-symlink", {
      "node_modules/my-tool/cli.mjs": `#!/usr/bin/env node
import { greet } from "./lib.mjs";
console.log(greet());
`,
      "node_modules/my-tool/lib.mjs": `export function greet() { return "it works"; }
`,
      "node_modules/.bin/.gitkeep": "",
      "package.json": "{}",
    });
    // Make the script executable and create the .bin symlink like `bun install` would
    chmodSync(join(temp, "node_modules/my-tool/cli.mjs"), 0o755);
    symlinkSync(join(temp, "node_modules/my-tool/cli.mjs"), join(temp, "node_modules/.bin/my-tool"));

    // Use --bun to force bun to act as node (creates fake node in PATH).
    // This is critical: without --bun, if real node is on PATH, the
    // shebang delegates to node which resolves symlinks correctly,
    // masking the bug.
    const result = Bun.spawnSync([bunExe(), "run", "--bun", "my-tool"], {
      cwd: temp,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = result.stdout.toString("utf8").trim();
    const stderr = result.stderr.toString("utf8").trim();
    expect(stderr).toBe("");
    expect(stdout).toBe("it works");
    expect(result.exitCode).toBe(0);
  });
});
