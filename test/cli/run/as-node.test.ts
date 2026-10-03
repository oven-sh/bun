import { describe, expect, test } from "bun:test";
import { join } from "path";
import { bunEnv, bunExe, fakeNodeRun, tempDir } from "../../harness";

async function runNodeAlias(args: string[], stdin = "", files: Record<string, string> = {}) {
  using temp = tempDir("fake-node-stdio", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    argv0: "node",
    cwd: String(temp),
    env: bunEnv,
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

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

  test.each([
    { args: ["-v"] },
    { args: ["--version"] },
    { args: ["--no-warnings", "-v"] },
    { args: ["--no-warnings", "--version"] },
    { args: ["--require", "./preload.cjs", "--version"] },
    { args: ["--import", "./preload.mjs", "-v"] },
  ])("reports the Node compatibility version for $args", async ({ args }) => {
    expect(
      await runNodeAlias(args, "", {
        "preload.cjs": 'throw new Error("preload must not run")',
        "preload.mjs": 'throw new Error("preload must not run")',
      }),
    ).toEqual({
      stdout: `v${process.versions.node}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([
    { args: ["--revision"] },
    { args: ["--revision", "entry.cjs"] },
    { args: ["--revision", "-e", 'console.log("eval ran")'] },
  ])("rejects Bun-only revision before executing $args", async ({ args }) => {
    expect(
      await runNodeAlias(args, 'console.log("stdin ran")', {
        "entry.cjs": 'console.log("script ran")',
      }),
    ).toEqual({ stdout: "", stderr: "error: Invalid Argument '--revision'\n", exitCode: 1 });
  });

  test.each(
    ["--revision", "-v", "--version"].flatMap(flag => [
      { args: ["entry.cjs", flag], flag },
      { args: ["--", "entry.cjs", flag], flag },
    ]),
  )("passes $args through to the script", async ({ args, flag }) => {
    expect(
      await runNodeAlias(args, "", {
        "entry.cjs": "console.log(JSON.stringify(process.argv.slice(2)))",
      }),
    ).toEqual({ stdout: JSON.stringify([flag]) + "\n", stderr: "", exitCode: 0 });
  });

  test("Node help advertises version without the rejected revision flag", async () => {
    const { stdout, stderr, exitCode } = await runNodeAlias(["--help"]);
    expect(stdout).toContain("--version");
    expect(stdout).not.toContain("--revision");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
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
});
