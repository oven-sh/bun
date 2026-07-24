import { describe, expect, test } from "bun:test";
import { join } from "path";
import { bunEnv, bunExe, fakeNodeRun, tempDir, tempDirWithFiles } from "../../harness";

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
});

describe("node value-taking CLI flags do not eat the entrypoint", () => {
  // Node.js flags that take a value and which Bun does not otherwise implement
  // must still consume their value argument so the *next* arg is parsed as the
  // entrypoint. Otherwise `bun --experimental-loader ./hooks.mjs app.mjs`
  // silently runs hooks.mjs as the program and app.mjs never executes.
  const appBody = `console.log(JSON.stringify({ argv: process.argv.slice(2), execArgv: process.execArgv }));`;
  const wrongBody = `throw new Error("flag value was run as the entrypoint");`;

  async function run(preArgs: string[], cwd: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...preArgs, "app.mjs", "scriptarg"],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  test("--experimental-loader ./hooks.mjs app.mjs runs app.mjs, not hooks.mjs", async () => {
    using dir = tempDir("node-value-flag", {
      "hooks.mjs": wrongBody,
      "app.mjs": appBody,
    });
    const { stdout, stderr, exitCode } = await run(["--experimental-loader", "./hooks.mjs"], String(dir));
    expect(stderr).not.toContain("flag value was run as the entrypoint");
    expect(JSON.parse(stdout)).toEqual({ argv: ["scriptarg"], execArgv: ["--experimental-loader", "./hooks.mjs"] });
    expect(exitCode).toBe(0);
  });

  const valueFlags = [
    "--experimental-loader",
    "--allow-fs-read",
    "--allow-fs-write",
    "--build-sea",
    "--build-snapshot-config",
    "--diagnostic-dir",
    "--disable-proto",
    "--disable-warning",
    "--env-file-if-exists",
    "--experimental-config-file",
    "--experimental-sea-config",
    "--heap-prof-interval",
    "--heapsnapshot-near-heap-limit",
    "--heapsnapshot-signal",
    "--icu-data-dir",
    "--input-type",
    "--inspect-port",
    "--debug-port",
    "--inspect-publish-uid",
    "--localstorage-file",
    "--max-old-space-size-percentage",
    "--network-family-autoselection-attempt-timeout",
    "--openssl-config",
    "--redirect-warnings",
    "--report-dir",
    "--report-directory",
    "--report-filename",
    "--report-signal",
    "--secure-heap",
    "--secure-heap-min",
    "--security-revert",
    "--security-reverts",
    "--snapshot-blob",
    "--tls-cipher-list",
    "--tls-keylog",
    "--trace-require-module",
    "--use-largepages",
    "--v8-pool-size",
    "--watch-path",
    "--watch-kill-signal",
    "--test-concurrency",
    "--test-coverage-branches",
    "--test-coverage-exclude",
    "--test-coverage-functions",
    "--test-coverage-include",
    "--test-coverage-lines",
    "--test-global-setup",
    "--test-isolation",
    "--experimental-test-isolation",
    "--test-random-seed",
    "--test-reporter",
    "--test-reporter-destination",
    "--test-rerun-failures",
    "--test-shard",
    "--test-skip-pattern",
    "--experimental-test-tag-filter",
    "--test-timeout",
    "--test-name-pattern",
  ];

  describe.each([[[]], [["run"]]])("bun %p", runArg => {
    test.concurrent.each(valueFlags)("%s <value> app.mjs runs app.mjs", async flag => {
      using dir = tempDir("node-value-flag", {
        "value.mjs": wrongBody,
        "app.mjs": appBody,
      });
      const { stdout, stderr, exitCode } = await run([...runArg, flag, "./value.mjs"], String(dir));
      expect(stderr).not.toContain("flag value was run as the entrypoint");
      expect(JSON.parse(stdout)).toEqual({ argv: ["scriptarg"], execArgv: [flag, "./value.mjs"] });
      expect(exitCode).toBe(0);
    });
  });

  test("hidden from --help", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--help"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).not.toContain("--experimental-loader");
    expect(stdout).not.toContain("--openssl-config");
    expect(stdout).not.toContain("--v8-pool-size");
    expect(exitCode).toBe(0);
  });
});
