import type { Subprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isCI, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { itBundled } from "./expectBundled";

// `BUN_JSC_dumpOptions=2` prints every JSC option as `   name=value` on stderr
// once JSCInitialize has applied Bun's overrides.
function jscOption(stderr: string, name: string): string | undefined {
  return stderr.match(new RegExp(`^\\s*${name}=(\\S+)`, "m"))?.[1];
}

describe("bundler", () => {
  // Test that the --compile-exec-argv flag works for both runtime processing and execArgv
  itBundled("compile/CompileExecArgvDualBehavior", {
    compile: {
      execArgv: ["--title=CompileExecArgvDualBehavior", "--smol"],
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        // Test that --compile-exec-argv both processes flags AND populates execArgv
        console.log("execArgv:", JSON.stringify(process.execArgv));
        console.log("argv:", JSON.stringify(process.argv));

        if (process.argv.findIndex(arg => arg === "runtime") === -1) {
          console.error("FAIL: runtime not found in argv");
          process.exit(1);
        }

        if (process.argv.findIndex(arg => arg === "test") === -1) {
          console.error("FAIL: test not found in argv");
          process.exit(1);
        }
        
        if (process.execArgv.findIndex(arg => arg === "--title=CompileExecArgvDualBehavior") === -1) {
          console.error("FAIL: --title=CompileExecArgvDualBehavior not found in execArgv");
          process.exit(1);
        }

        if (process.execArgv.findIndex(arg => arg === "--smol") === -1) {
          console.error("FAIL: --smol not found in execArgv");
          process.exit(1);
        }

        if (process.title !== "CompileExecArgvDualBehavior") {
          console.error("FAIL: process.title mismatch. Expected: CompileExecArgvDualBehavior, Got:", process.title);
          process.exit(1);
        }

        console.log("SUCCESS: process.title and process.execArgv are both set correctly");
      `,
    },
    run: {
      args: ["runtime", "test"],
      stdout: /SUCCESS: process.title and process.execArgv are both set correctly/,
    },
  });

  // Test that exec argv options don't leak into process.argv when no user arguments are provided
  itBundled("compile/CompileExecArgvNoLeak", {
    compile: {
      execArgv: ["--user-agent=test-agent", "--smol"],
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        // Test that compile-exec-argv options don't appear in process.argv
        console.log("execArgv:", JSON.stringify(process.execArgv));
        console.log("argv:", JSON.stringify(process.argv));

        // Check that execArgv contains the expected options
        if (process.execArgv.length !== 2) {
          console.error("FAIL: Expected exactly 2 items in execArgv, got", process.execArgv.length);
          process.exit(1);
        }

        if (process.execArgv[0] !== "--user-agent=test-agent") {
          console.error("FAIL: Expected --user-agent=test-agent in execArgv[0], got", process.execArgv[0]);
          process.exit(1);
        }

        if (process.execArgv[1] !== "--smol") {
          console.error("FAIL: Expected --smol in execArgv[1], got", process.execArgv[1]);
          process.exit(1);
        }

        // Check that argv only contains the executable and script name, NOT the exec argv options
        if (process.argv.length !== 2) {
          console.error("FAIL: Expected exactly 2 items in argv (executable and script), got", process.argv.length, "items:", process.argv);
          process.exit(1);
        }

        // argv[0] should be "bun" for standalone executables
        if (process.argv[0] !== "bun") {
          console.error("FAIL: Expected argv[0] to be 'bun', got", process.argv[0]);
          process.exit(1);
        }

        // argv[1] should be the script path (contains the bundle path)
        // Windows uses "B:/~BUN/root/", Unix uses "/$bunfs/root/"
        if (!process.argv[1].includes("/$bunfs/") && !process.argv[1].includes("/~BUN/")) {
          console.error("FAIL: Expected argv[1] to contain standalone bundle root, got", process.argv[1]);
          process.exit(1);
        }

        // Make sure exec argv options are NOT in process.argv
        for (const arg of process.argv) {
          if (arg.includes("--user-agent") || arg === "--smol") {
            console.error("FAIL: exec argv option leaked into process.argv:", arg);
            process.exit(1);
          }
        }

        console.log("SUCCESS: exec argv options are properly separated from process.argv");
      `,
    },
    run: {
      // No user arguments provided - this is the key test case
      args: [],
      stdout: /SUCCESS: exec argv options are properly separated from process.argv/,
    },
  });

  // Test that user arguments are properly passed through when exec argv is present
  itBundled("compile/CompileExecArgvWithUserArgs", {
    compile: {
      execArgv: ["--user-agent=test-agent", "--smol"],
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        // Test that user arguments are properly included when exec argv is present
        console.log("execArgv:", JSON.stringify(process.execArgv));
        console.log("argv:", JSON.stringify(process.argv));

        // Check execArgv
        if (process.execArgv.length !== 2) {
          console.error("FAIL: Expected exactly 2 items in execArgv, got", process.execArgv.length);
          process.exit(1);
        }

        if (process.execArgv[0] !== "--user-agent=test-agent" || process.execArgv[1] !== "--smol") {
          console.error("FAIL: Unexpected execArgv:", process.execArgv);
          process.exit(1);
        }

        // Check argv contains executable, script, and user arguments
        if (process.argv.length !== 4) {
          console.error("FAIL: Expected exactly 4 items in argv, got", process.argv.length, "items:", process.argv);
          process.exit(1);
        }

        if (process.argv[0] !== "bun") {
          console.error("FAIL: Expected argv[0] to be 'bun', got", process.argv[0]);
          process.exit(1);
        }

        // Windows uses "B:/~BUN/root/", Unix uses "/$bunfs/root/"
        if (!process.argv[1].includes("/$bunfs/") && !process.argv[1].includes("/~BUN/")) {
          console.error("FAIL: Expected argv[1] to contain standalone bundle root, got", process.argv[1]);
          process.exit(1);
        }

        if (process.argv[2] !== "user-arg1") {
          console.error("FAIL: Expected argv[2] to be 'user-arg1', got", process.argv[2]);
          process.exit(1);
        }

        if (process.argv[3] !== "user-arg2") {
          console.error("FAIL: Expected argv[3] to be 'user-arg2', got", process.argv[3]);
          process.exit(1);
        }

        // Make sure exec argv options are NOT mixed with user arguments
        if (process.argv.includes("--user-agent=test-agent") || process.argv.includes("--smol")) {
          console.error("FAIL: exec argv options leaked into process.argv");
          process.exit(1);
        }

        console.log("SUCCESS: user arguments properly passed with exec argv present");
      `,
    },
    run: {
      args: ["user-arg1", "user-arg2"],
      stdout: /SUCCESS: user arguments properly passed with exec argv present/,
    },
  });

  // Test that --version and --help flags are passed through to user code (issue #26082)
  // When compile-exec-argv is used, user flags like --version should NOT be intercepted by Bun
  itBundled("compile/CompileExecArgvVersionHelpPassthrough", {
    compile: {
      execArgv: ["--smol"],
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        // Test that --version and --help are passed through to user code, not intercepted by Bun
        const args = process.argv.slice(2);
        console.log("User args:", JSON.stringify(args));

        if (args.includes("--version")) {
          console.log("APP_VERSION:1.0.0");
        } else if (args.includes("-v")) {
          console.log("APP_VERSION:1.0.0");
        } else if (args.includes("--help")) {
          console.log("APP_HELP:This is my app help");
        } else if (args.includes("-h")) {
          console.log("APP_HELP:This is my app help");
        } else {
          console.log("NO_FLAG_MATCHED");
        }
      `,
    },
    run: {
      args: ["--version"],
      stdout: /APP_VERSION:1\.0\.0/,
    },
  });

  // Test with -v short flag
  itBundled("compile/CompileExecArgvShortVersionPassthrough", {
    compile: {
      execArgv: ["--smol"],
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        const args = process.argv.slice(2);
        if (args.includes("-v")) {
          console.log("APP_VERSION:1.0.0");
        } else {
          console.log("FAIL: -v not found in args:", args);
          process.exit(1);
        }
      `,
    },
    run: {
      args: ["-v"],
      stdout: /APP_VERSION:1\.0\.0/,
    },
  });

  // Test with --help flag
  itBundled("compile/CompileExecArgvHelpPassthrough", {
    compile: {
      execArgv: ["--smol"],
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        const args = process.argv.slice(2);
        if (args.includes("--help")) {
          console.log("APP_HELP:my custom help");
        } else {
          console.log("FAIL: --help not found in args:", args);
          process.exit(1);
        }
      `,
    },
    run: {
      args: ["--help"],
      stdout: /APP_HELP:my custom help/,
    },
  });

  // Test with -h short flag
  itBundled("compile/CompileExecArgvShortHelpPassthrough", {
    compile: {
      execArgv: ["--smol"],
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        const args = process.argv.slice(2);
        if (args.includes("-h")) {
          console.log("APP_HELP:my custom help");
        } else {
          console.log("FAIL: -h not found in args:", args);
          process.exit(1);
        }
      `,
    },
    run: {
      args: ["-h"],
      stdout: /APP_HELP:my custom help/,
    },
  });

  // Test that BUN_OPTIONS env var is applied to standalone executables
  itBundled("compile/BunOptionsEnvApplied", {
    compile: true,
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        console.log("execArgv:", JSON.stringify(process.execArgv));
        console.log("argv:", JSON.stringify(process.argv));

        if (process.execArgv.findIndex(arg => arg === "--smol") === -1) {
          console.error("FAIL: --smol not found in execArgv:", process.execArgv);
          process.exit(1);
        }

        // BUN_OPTIONS args should NOT appear in process.argv
        for (const arg of process.argv) {
          if (arg === "--smol") {
            console.error("FAIL: --smol leaked into process.argv:", process.argv);
            process.exit(1);
          }
        }

        console.log("SUCCESS: BUN_OPTIONS applied to standalone executable");
      `,
    },
    run: {
      env: { BUN_OPTIONS: "--smol" },
      stdout: /SUCCESS: BUN_OPTIONS applied to standalone executable/,
    },
  });

  // Test BUN_OPTIONS combined with compile-exec-argv
  itBundled("compile/BunOptionsEnvWithCompileExecArgv", {
    compile: {
      execArgv: ["--conditions=production"],
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        console.log("execArgv:", JSON.stringify(process.execArgv));
        console.log("argv:", JSON.stringify(process.argv));

        if (process.execArgv.findIndex(arg => arg === "--conditions=production") === -1) {
          console.error("FAIL: --conditions=production not found in execArgv:", process.execArgv);
          process.exit(1);
        }

        if (process.execArgv.findIndex(arg => arg === "--smol") === -1) {
          console.error("FAIL: --smol not found in execArgv:", process.execArgv);
          process.exit(1);
        }

        // Neither BUN_OPTIONS nor compile-exec-argv args should be in process.argv
        for (const arg of process.argv) {
          if (arg === "--smol" || arg === "--conditions=production") {
            console.error("FAIL: exec option leaked into process.argv:", arg);
            process.exit(1);
          }
        }

        console.log("SUCCESS: BUN_OPTIONS and compile-exec-argv both applied");
      `,
    },
    run: {
      env: { BUN_OPTIONS: "--smol" },
      stdout: /SUCCESS: BUN_OPTIONS and compile-exec-argv both applied/,
    },
  });

  // Test BUN_OPTIONS with user passthrough args
  itBundled("compile/BunOptionsEnvWithPassthroughArgs", {
    compile: true,
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        console.log("execArgv:", JSON.stringify(process.execArgv));
        console.log("argv:", JSON.stringify(process.argv));

        if (process.execArgv.findIndex(arg => arg === "--smol") === -1) {
          console.error("FAIL: --smol not found in execArgv:", process.execArgv);
          process.exit(1);
        }

        if (process.argv.findIndex(arg => arg === "user-arg1") === -1) {
          console.error("FAIL: user-arg1 not found in argv:", process.argv);
          process.exit(1);
        }

        if (process.argv.findIndex(arg => arg === "user-arg2") === -1) {
          console.error("FAIL: user-arg2 not found in argv:", process.argv);
          process.exit(1);
        }

        // BUN_OPTIONS args should NOT be in process.argv
        for (const arg of process.argv) {
          if (arg === "--smol") {
            console.error("FAIL: --smol leaked into process.argv:", process.argv);
            process.exit(1);
          }
        }

        console.log("SUCCESS: BUN_OPTIONS separated from passthrough args");
      `,
    },
    run: {
      env: { BUN_OPTIONS: "--smol" },
      args: ["user-arg1", "user-arg2"],
      stdout: /SUCCESS: BUN_OPTIONS separated from passthrough args/,
    },
  });

  // `bun -e` / `bun -p` start JSC in one-shot mode (no concurrent JIT, one GC
  // marker). That is decided by scanning argv, and a compiled executable's argv
  // belongs to the program, so `./app -p 8080` must keep the full configuration.
  const expectFullJSCConfiguration = ({ stderr }: { stderr: string }) => {
    expect(jscOption(stderr, "useConcurrentJIT")).toBe("true");
  };
  itBundled("compile/EvalFlagsInUserArgsDoNotMeanOneShotStartup", {
    compile: true,
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `console.log(JSON.stringify(process.argv.slice(2)));`,
    },
    run: [
      {
        args: ["-e"],
        env: { BUN_JSC_dumpOptions: "2" },
        stdout: '["-e"]',
        validate: expectFullJSCConfiguration,
      },
      {
        args: ["-p", "8080"],
        env: { BUN_JSC_dumpOptions: "2" },
        stdout: '["-p","8080"]',
        validate: expectFullJSCConfiguration,
      },
      {
        args: ["--verbose", "--eval=x"],
        env: { BUN_JSC_dumpOptions: "2" },
        stdout: '["--verbose","--eval=x"]',
        validate: expectFullJSCConfiguration,
      },
      {
        args: ["--print=x"],
        env: { BUN_JSC_dumpOptions: "2" },
        stdout: '["--print=x"]',
        validate: expectFullJSCConfiguration,
      },
    ],
  });

  // Same thing when compile-exec-argv is present: that path rebuilds argv as
  // `[exe, ...execArgv, ...userArgs]` before JSC starts.
  itBundled("compile/EvalFlagsInUserArgsDoNotMeanOneShotStartupWithExecArgv", {
    compile: {
      execArgv: ["--smol"],
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `console.log(JSON.stringify([process.execArgv, process.argv.slice(2)]));`,
    },
    run: {
      args: ["--print"],
      env: { BUN_JSC_dumpOptions: "2" },
      stdout: '[["--smol"],["--print"]]',
      validate: expectFullJSCConfiguration,
    },
  });
});

// The standalone boot path parses exec argv into the CLI context and then
// builds the VM through `init_with_module_graph`. Flags that only the VM acts
// on (the inspector, the DNS result order) must survive that hand-off, not
// just show up in `process.execArgv`.
describe("compile-exec-argv runtime flags reach the VM", () => {
  // Serial, like the other compile tests: each `bun build --compile` rewrites
  // the whole runtime binary (~800 MB for a debug build), and overlapping
  // builds starve CI (see bundler_compile.test.ts). Same local budget as the
  // `itBundled` compile tests.
  const compileTest = (name: string, fn: () => Promise<void>) =>
    test(name, fn, isCI ? undefined : isDebug ? Infinity : 30_000);

  // One program for every case. It reports what reached the VM and exits, or
  // stays up for an inspector client when run with `hold` (a connected client
  // then keeps it alive). A binary that dropped `--inspect` and runs without
  // `hold` exits at once, so its stderr ends without a URL.
  const entry = /* js */ `
    import { getDefaultResultOrder } from "node:dns";
    console.log(JSON.stringify({ execArgv: process.execArgv, dnsOrder: getDefaultResultOrder() }));
    if (process.argv.includes("hold")) setTimeout(() => {}, 10_000);
  `;
  const waitFlags = ["--inspect-wait=127.0.0.1:0", "--dns-result-order=ipv4first"];
  const inspectFlag = "--inspect=127.0.0.1:0";

  async function waitForInspectorUrl(stderr: ReadableStream<Uint8Array>): Promise<URL> {
    const reader = stderr.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const match = text.match(/^\s*(ws:\/\/\S+)\n/m);
      if (match) {
        // Keep draining so the child never blocks on a full stderr pipe.
        void (async () => {
          while (!(await reader.read()).done) {}
        })();
        return new URL(match[1]);
      }
    }
    throw new Error(`inspector did not start. stderr:\n${text}`);
  }

  async function readLine(stdout: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();
    return text;
  }

  async function compile(dir: string, execArgv: readonly string[]): Promise<string> {
    const exe = join(dir, isWindows ? "app.exe" : "app");
    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        ...(execArgv.length ? [`--compile-exec-argv=${execArgv.join(" ")}`] : []),
        "--outfile",
        exe,
        "entry.js",
      ],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("error");
    expect(buildExit).toBe(0);
    return exe;
  }

  // Opens a session on the inspectee. A dropped socket or a dead inspectee
  // rejects whatever is awaited instead of leaving it to the test timeout.
  async function connectInspector(proc: Subprocess, url: URL) {
    const ws = new WebSocket(url.href);
    const failed = Promise.withResolvers<never>();
    failed.promise.catch(() => {});
    ws.onerror = event => failed.reject(new Error("WebSocket error", { cause: event }));
    ws.onclose = event => failed.reject(new Error(`WebSocket closed (${event.code})`));
    proc.exited.then(code => failed.reject(new Error(`inspectee exited (${code}) before the inspector answered`)));

    const opened = Promise.withResolvers<void>();
    ws.onopen = () => opened.resolve();
    await Promise.race([opened.promise, failed.promise]);

    const pending = new Map<number, (reply: unknown) => void>();
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      pending.get(message.id)?.(message);
    };
    let nextId = 1;
    return {
      request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        const id = nextId++;
        const reply = Promise.withResolvers<unknown>();
        pending.set(id, reply.resolve);
        ws.send(JSON.stringify({ id, method, params }));
        return Promise.race([reply.promise, failed.promise]);
      },
      close: () => ws.close(),
    };
  }

  // `--inspect-wait` blocks the program until a client sends
  // `Inspector.initialized`: the binary prints the listening URL and waits,
  // then runs and reports the flags once the client releases it.
  async function expectWaitThenRun(exe: string, env: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: [exe],
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const url = await waitForInspectorUrl(proc.stderr);
    expect(url.hostname).toBe("127.0.0.1");

    const inspector = await connectInspector(proc, url);
    expect(await inspector.request("Inspector.initialized")).toEqual({ id: 1, result: {} });
    expect(await inspector.request("Runtime.evaluate", { expression: "1 + 1" })).toMatchObject({
      id: 2,
      result: { result: { type: "number", value: 2 } },
    });
    inspector.close();

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual({ execArgv: waitFlags, dnsOrder: "ipv4first" });
    expect(exitCode).toBe(0);
  }

  // Plain `--inspect` must not block the program: it reports before any client
  // connects, and the inspector answers while it runs.
  async function expectRunWithInspector(exe: string, env: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: [exe, "hold"],
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(JSON.parse(await readLine(proc.stdout))).toEqual({ execArgv: [inspectFlag], dnsOrder: "verbatim" });

    const url = await waitForInspectorUrl(proc.stderr);
    const inspector = await connectInspector(proc, url);
    expect(await inspector.request("Runtime.evaluate", { expression: "1 + 1" })).toMatchObject({
      id: 1,
      result: { result: { type: "number", value: 2 } },
    });
    inspector.close();
  }

  compileTest("--inspect-wait and --dns-result-order from --compile-exec-argv", async () => {
    using dir = tempDir("compile-exec-argv-wait", { "entry.js": entry });
    await expectWaitThenRun(await compile(String(dir), waitFlags), {});
  });

  compileTest("--inspect from --compile-exec-argv does not block the program", async () => {
    using dir = tempDir("compile-exec-argv-inspect", { "entry.js": entry });
    await expectRunWithInspector(await compile(String(dir), [inspectFlag]), {});
  });

  // The environment is read at run time, so one binary serves both cases.
  compileTest("--inspect-wait, --dns-result-order and --inspect from BUN_OPTIONS", async () => {
    using dir = tempDir("compile-exec-argv-bun-options", { "entry.js": entry });
    const exe = await compile(String(dir), []);
    await expectWaitThenRun(exe, { BUN_OPTIONS: waitFlags.join(" ") });
    await expectRunWithInspector(exe, { BUN_OPTIONS: inspectFlag });
  });
});
