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

  // Bare `node` now matches Node.js: a TTY stdin enters the REPL, a
  // non-TTY stdin (pipe) prints "Missing script". fakeNodeRun's default
  // stdin is platform-dependent (Windows may inherit a console), so pin
  // a piped stdin here.
  test("no args with piped stdin errors with 'Missing script'", () => {
    const temp = tempDirWithFiles("fake-node", {});
    const result = Bun.spawnSync([bunExe(), "--bun", "node"], {
      cwd: temp,
      env: { ...bunEnv, NODE_ENV: undefined },
      stdin: Buffer.alloc(0),
    });
    expect(result.stderr.toString()).toContain("Missing script");
    expect(result.success).toBe(false);
  });
});

describe("unsupported Node.js security flags are refused at startup", () => {
  // Each of these flags asks for a security restriction Bun does not implement.
  // Before this was fixed, Bun echoed the flag in process.execArgv and ran the
  // application unrestricted; now it must refuse to start so the failure is
  // visible instead of silent.
  const cases: [flag: string, probe: string, failOpenMarker: string][] = [
    ["--enable-fips", `"fips=" + require("crypto").getFips()`, "fips=0"],
    ["--force-fips", `"fips=" + require("crypto").getFips()`, "fips=0"],
    [
      "--tls-cipher-list=ECDHE-RSA-AES128-GCM-SHA256",
      `"ciphers=" + require("tls").DEFAULT_CIPHERS.split(":").length`,
      "ciphers=19",
    ],
    ["--experimental-loader=./hooks.mjs", `"ran"`, "ran"],
    ["--policy=./policy.json", `"ran"`, "ran"],
    ["--experimental-policy=./policy.json", `"ran"`, "ran"],
    ["--experimental-config-file=./node.config.json", `"ran"`, "ran"],
    ["--frozen-intrinsics", `(Object.assign = 1, "assign=" + typeof Object.assign)`, "assign=number"],
    ["--disallow-code-generation-from-strings", `"eval=" + eval("1+1")`, "eval=2"],
    ["--disable-proto=throw", `"proto=" + (({}).__proto__ !== undefined)`, "proto=true"],
    ["--secure-heap=65536", `"ran"`, "ran"],
    ["--secure-heap-min=4096", `"ran"`, "ran"],
    ["--permission", `require("fs").readdirSync("."), "fs=allowed"`, "fs=allowed"],
    ["--experimental-permission", `"ran"`, "ran"],
  ];

  async function run(cmd: string[], cwd: string) {
    await using proc = Bun.spawn({ cmd, env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  describe.each([
    ["bun", (flag: string, app: string) => [bunExe(), flag, app]],
    ["bun run", (flag: string, app: string) => [bunExe(), "run", flag, app]],
    ["bun-as-node", (flag: string, app: string) => [bunExe(), "--bun", "node", flag, app]],
  ] as const)("%s", (_, cmd) => {
    test.concurrent.each(cases)("%s refuses to start", async (flag, probe, failOpenMarker) => {
      const flagName = flag.split("=")[0];
      using dir = tempDir("security-flag", {
        "app.mjs": `console.log(${probe}, JSON.stringify(process.execArgv));`,
        "hooks.mjs": `throw new Error("loader hooks file should not have been executed as the entrypoint");`,
      });
      const { stdout, stderr, exitCode } = await run(cmd(flag, "app.mjs"), String(dir));
      // The application must not have started: no fail-open marker on stdout,
      // and the flag must not appear in a printed execArgv receipt.
      expect(stdout).not.toContain(failOpenMarker);
      expect(stdout).not.toContain(flagName);
      expect(stderr).toContain(`${flagName} is not supported in Bun`);
      expect(exitCode).toBe(9);
    });
  });

  test.concurrent("--experimental-loader <value> (space form) does not run the value as the entrypoint", async () => {
    using dir = tempDir("security-flag", {
      "hooks.mjs": `console.log("HOOKS_RAN");`,
      "app.mjs": `console.log("APP_RAN");`,
    });
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "--experimental-loader", "./hooks.mjs", "app.mjs"],
      String(dir),
    );
    expect(stdout).not.toContain("HOOKS_RAN");
    expect(stdout).not.toContain("APP_RAN");
    expect(stderr).toContain("--experimental-loader is not supported in Bun");
    expect(exitCode).toBe(9);
  });

  test.concurrent("bun-as-node --loader=./hooks.mjs is refused (Node's loader, not Bun's)", async () => {
    using dir = tempDir("security-flag", {
      "hooks.mjs": `throw new Error("should not run");`,
      "app.mjs": `console.log("APP_RAN");`,
    });
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "--bun", "node", "--loader=./hooks.mjs", "app.mjs"],
      String(dir),
    );
    expect(stdout).not.toContain("APP_RAN");
    expect(stderr).toContain("--loader is not supported in Bun");
    expect(exitCode).toBe(9);
  });

  test.concurrent("bun --loader .ext:loader (Bun's own option) is still accepted", async () => {
    using dir = tempDir("security-flag", {
      "data.xyz": `hello`,
      "app.mjs": `import data from "./data.xyz"; console.log("text=" + data);`,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "--loader", ".xyz:text", "app.mjs"], String(dir));
    expect(stderr).not.toContain("is not supported in Bun");
    expect(stdout.trim()).toBe("text=hello");
    expect(exitCode).toBe(0);
  });

  test.concurrent("flags Bun does implement still work", async () => {
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "--zero-fill-buffers", "--no-addons", "--tls-min-v1.2", "-e", `console.log("ok")`],
      process.cwd(),
    );
    expect(stderr).not.toContain("is not supported in Bun");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });
});
