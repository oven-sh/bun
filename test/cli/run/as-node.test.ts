import { describe, expect, test } from "bun:test";
import { join } from "path";
import { bunEnv, bunExe, fakeNodeRun, isMacOS, isWindows, tempDir } from "../../harness";

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
  // A Windows command line is too short for a path longer than the path buffer.
  test.skipIf(isWindows)("reports module not found for a relative script path longer than PATH_MAX", () => {
    const long = Array(21).fill(Buffer.alloc(200, "a").toString()).join("/") + ".js";
    using temp = tempDir("fake-node-long", {});
    const { exitCode, stdout, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "--bun", "node", long],
      cwd: String(temp),
      env: { ...bunEnv, NODE_ENV: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBe("");
    const path = join(String(temp), long);
    // On macOS the lookup fails in a syscall, so the error is ENAMETOOLONG.
    const expected = isMacOS
      ? `error: ENAMETOOLONG while resolving '${path}' from 'bun:main'`
      : `error: Module not found '${path}'`;
    expect(stderr.toString().split("\n")[0]).toBe(expected);
    expect(exitCode).toBe(1);
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
});

// node:net reads these two from process.execArgv. The value ran as the script when it was the next argument.
describe("the flags of Node.js that node:net reads take their value as the next argument", () => {
  const keylog = "--tls-keylog";
  const attemptTimeout = "--network-family-autoselection-attempt-timeout";

  // value.mjs throws: a run that takes the value for the script fails.
  const project = (files: Record<string, string> = {}) =>
    tempDir("node-net-flags", {
      "value.mjs": `throw new Error("the value of the flag ran as the script");`,
      "app.mjs": `console.log(JSON.stringify({ argv: process.argv.slice(2), execArgv: process.execArgv }));`,
      ...files,
    });
  async function bun(cwd: string, args: string[], env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: { ...bunEnv, ...env },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  }
  const printed = (value: unknown) => ({ stdout: JSON.stringify(value), stderr: "", exitCode: 0 });
  // `bun test` prints its version to stdout. What it prints to stderr ends with the counts.
  const tested = ({ stdout, stderr, exitCode }: Awaited<ReturnType<typeof bun>>) => ({
    stdout: stdout.replace(/^bun test v.*$/, "bun test"),
    counts: stderr.match(/^ \d+ pass\n[\s\S]*$/m)?.[0].replace(/ \[[\d.]+m?s\]$/, ""),
    exitCode,
  });

  describe.concurrent.each([keylog, attemptTimeout])("%s", flag => {
    const ran = printed({ argv: ["scriptarg"], execArgv: [flag, "./value.mjs"] });

    test.each([
      ["bun", []],
      ["bun run", ["run"]],
      ["node", ["--bun", "node"]],
    ])("%s <flag> <value> <script>", async (_, launcher) => {
      using dir = project();
      expect(await bun(dir, [...launcher, flag, "./value.mjs", "app.mjs", "scriptarg"])).toEqual(ran);
    });

    test("<flag>=<value> <script>", async () => {
      using dir = project();
      expect(await bun(dir, [`${flag}=./value.mjs`, "app.mjs", "scriptarg"])).toEqual(
        printed({ argv: ["scriptarg"], execArgv: [`${flag}=./value.mjs`] }),
      );
    });

    test("BUN_OPTIONS='<flag> <value>' bun <script>", async () => {
      using dir = project();
      expect(await bun(dir, ["app.mjs", "scriptarg"], { BUN_OPTIONS: `${flag} ./value.mjs` })).toEqual(ran);
    });

    test("the arguments after <flag> <value> are parsed", async () => {
      using dir = project();
      const code = "JSON.stringify(process.execArgv)";
      expect(await bun(dir, [flag, "./value.mjs", "-p", code])).toEqual(printed([flag, "./value.mjs", "-p", code]));
    });

    test("<flag> <value> after -p <code> is in process.execArgv", async () => {
      using dir = project();
      const code = "JSON.stringify(process.execArgv)";
      expect(await bun(dir, ["-p", code, flag, "./value.mjs"])).toEqual(printed(["-p", code, flag, "./value.mjs"]));
    });

    test("bun exec <flag> <value> <script>: the value is not the script", async () => {
      using dir = project();
      expect(await bun(dir, ["exec", flag, "./value.mjs", "echo hi"])).toEqual({
        stdout: "hi",
        stderr: "",
        exitCode: 0,
      });
    });

    test("bun test <flag> <value> <filter>: the value is not a filter", async () => {
      using dir = tempDir("node-net-flags-test", {
        "value.test.ts": `
          import { test } from "bun:test";
          test("value", () => { throw new Error("the value of the flag selected a test file"); });
        `,
        "app.test.ts": `
          import { test } from "bun:test";
          test("app", () => {});
        `,
      });
      expect(tested(await bun(dir, ["test", flag, "value", "app"]))).toEqual({
        stdout: "bun test",
        counts: " 1 pass\n 0 fail\nRan 1 test across 1 file.",
        exitCode: 0,
      });
    });

    // The package manager has its own flag table. It takes no flag of the runtime that has a value.
    test("bun add <flag> <value> is still an error", async () => {
      const packageJson = { name: "foo", version: "0.0.1" };
      using dir = tempDir("node-net-flags-add", {
        "package.json": JSON.stringify(packageJson),
        "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      });
      expect(await bun(dir, ["add", flag, "./value", "./dep"])).toEqual({
        stdout: "",
        stderr: `error: bun add has no ${flag} flag.\nnote: Run 'bun add --help' for more information`,
        exitCode: 1,
      });
      expect(await Bun.file(join(dir, "package.json")).json()).toEqual(packageJson);
    });
  });

  // From here the child loads node:net or node:tls, which is slow in a debug build: one at a time.
  describe("net.getDefaultAutoSelectFamilyAttemptTimeout()", () => {
    const files = {
      "timeout.mjs": `
        import net from "node:net";
        const fromFlag = net.getDefaultAutoSelectFamilyAttemptTimeout();
        net.setDefaultAutoSelectFamilyAttemptTimeout(40);
        console.log(JSON.stringify([fromFlag, net.getDefaultAutoSelectFamilyAttemptTimeout()]));
      `,
      "fork.mjs": `
        import { fork } from "node:child_process";
        fork("./forked.mjs", [], process.argv[2] === "explicit" ? { execArgv: ["${attemptTimeout}", "321"] } : {});
      `,
      "forked.mjs": `
        import net from "node:net";
        console.log(JSON.stringify({ execArgv: process.execArgv, timeout: net.getDefaultAutoSelectFamilyAttemptTimeout() }));
      `,
    };

    test.each([
      ["<flag> 321", [attemptTimeout, "321"], 321],
      ["<flag>=321", [`${attemptTimeout}=321`], 321],
      ["<flag>=700 <flag> 800", [`${attemptTimeout}=700`, attemptTimeout, "800"], 800],
      ["run <flag> 321", ["run", attemptTimeout, "321"], 321],
    ])("is the value of %s", async (_, args, fromFlag) => {
      using dir = project(files);
      expect(await bun(dir, [...args, "timeout.mjs"])).toEqual(printed([fromFlag, 40]));
    });

    test.each([
      ["its execArgv option", ["fork.mjs", "explicit"]],
      ["the execArgv of its parent", [attemptTimeout, "321", "fork.mjs"]],
    ])("is the value in a child_process.fork() child, from %s", async (_, args) => {
      using dir = project(files);
      expect(await bun(dir, args)).toEqual(printed({ execArgv: [attemptTimeout, "321"], timeout: 321 }));
    });

    // process.execArgv has the flags before the word `test`. A flag after it is parsed and does nothing.
    test("is the value of <flag>=700 before `bun test`", async () => {
      using dir = tempDir("node-net-flags-test", {
        "timeout.test.ts": `
          import { expect, test } from "bun:test";
          import net from "node:net";
          test("timeout", () => expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(700));
        `,
      });
      expect(tested(await bun(dir, [`${attemptTimeout}=700`, "test", "timeout.test.ts"]))).toEqual({
        stdout: "bun test",
        counts: " 1 pass\n 0 fail\n 1 expect() calls\nRan 1 test across 1 file.",
        exitCode: 0,
      });
    });
  });

  test("--tls-keylog <file> adds the keys of a TLS connection to the file", async () => {
    const keys = join(import.meta.dir, "../../js/node/test/fixtures/keys");
    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: { key: Bun.file(join(keys, "agent1-key.pem")), cert: Bun.file(join(keys, "agent1-cert.pem")) },
      socket: { data() {} },
    });
    using dir = project({
      "keys.log": "# an earlier run\n",
      "connect.mjs": `
        import { once } from "node:events";
        import tls from "node:tls";

        const client = tls.connect({
          port: Number(process.argv[2]),
          host: "127.0.0.1",
          rejectUnauthorized: false,
          // TLS 1.2 logs one line for a connection. TLS 1.3 logs five.
          maxVersion: "TLSv1.2",
        });
        await once(client, "secureConnect");
        client.destroy();
      `,
    });
    const { stdout, stderr, exitCode } = await bun(dir, [keylog, "keys.log", "connect.mjs", String(server.port)]);
    expect(stderr).toContain(
      "Using --tls-keylog makes TLS connections insecure by writing secret key material to file keys.log",
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 0 });
    expect(await Bun.file(join(dir, "keys.log")).text()).toMatch(
      /^# an earlier run\nCLIENT_RANDOM [0-9a-f]{64} [0-9a-f]{96}\n$/,
    );
  });

  test("--tls-keylog <file> creates no file when there is no TLS connection", async () => {
    using dir = project();
    expect(await bun(dir, [keylog, "never.log", "-e", "1"])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(await Bun.file(join(dir, "never.log")).exists()).toBe(false);
  });

  test("bun --help does not list them", async () => {
    const { stdout, exitCode } = await bun(import.meta.dir, ["--help"]);
    expect(stdout).toContain("--tls-min-v1.2");
    expect(stdout).not.toContain(keylog);
    expect(stdout).not.toContain(attemptTimeout);
    expect(exitCode).toBe(0);
  });
});
