import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMusl, isWindows, tempDir } from "harness";
import { join } from "path";
import { itBundled } from "./expectBundled";

const runtimeEnv = {
  BUN_OPTIONS: undefined,
  BUN_BE_BUN: undefined,
  BUN_INSPECT: undefined,
  BUN_INSPECT_CONNECT_TO: undefined,
  BUN_INSPECT_PRELOAD: undefined,
  BUN_INSPECT_NOTIFY: undefined,
};

describe.each(["api", "cli"] as const)("compile env options (%s)", backend => {
  describe.each([false, true])("embedded flags: %s", embedded => {
    const execArgv = embedded ? ["--smol"] : [];
    itBundled(`compile/env-options/${backend}/disabled-${embedded}`, ({ root }) => {
      const preload = join(root, "preload.ts");
      return {
        backend,
        compile: { envOptions: false, execArgv },
        files: {
          "/entry.ts": `console.log(JSON.stringify({ entry: "APP", execArgv: process.execArgv, args: process.argv.slice(2), value: process.env.APP_VALUE, env: Object.fromEntries(["BUN_OPTIONS", "BUN_BE_BUN", "BUN_INSPECT", "BUN_INSPECT_CONNECT_TO", "BUN_INSPECT_PRELOAD"].map(key => [key, process.env[key]])) }));`,
        },
        runtimeFiles: { "/preload.ts": `console.log("PRELOAD");` },
        run: [
          [{ BUN_OPTIONS: `--preload=${preload}` }, ["argument"]],
          [{ BUN_OPTIONS: "--invalid-runtime-option" }, ["argument"]],
          [{ BUN_BE_BUN: "1" }, ["-e", 'console.log("CLI")']],
          [{ BUN_INSPECT_PRELOAD: preload }, ["argument"]],
          [{ BUN_INSPECT: "ws://127.0.0.1:0/compiled?wait=1" }, ["argument"]],
          [{ BUN_INSPECT_CONNECT_TO: "invalid inspector URL" }, ["argument"]],
          [
            { BUN_BE_BUN: "1", BUN_OPTIONS: `--preload=${preload}`, BUN_INSPECT_PRELOAD: preload },
            ["-e", 'console.log("CLI")'],
          ],
        ].map(([env, args]) => ({
          env: { ...runtimeEnv, APP_VALUE: "preserved", ...(env as Record<string, string>) },
          args: args as string[],
          validate({ stdout, stderr }) {
            expect(JSON.parse(stdout)).toEqual({ entry: "APP", execArgv, args, value: "preserved", env });
            expect(stderr).toBe("");
          },
        })),
      };
    });
  });

  describe.each([undefined, true])("envOptions: %s", envOptions => {
    itBundled(`compile/env-options/${backend}/enabled-${envOptions}`, ({ root }) => ({
      backend,
      compile: { envOptions, execArgv: ["--smol"] },
      files: { "/entry.ts": `console.log("APP");` },
      runtimeFiles: { "/preload.ts": `console.log("PRELOAD");` },
      run: [
        { env: { ...runtimeEnv, BUN_OPTIONS: `--preload=${join(root, "preload.ts")}` }, stdout: "PRELOAD\nAPP" },
        { env: { ...runtimeEnv, BUN_INSPECT_PRELOAD: join(root, "preload.ts") }, stdout: "PRELOAD\nAPP" },
        {
          env: { ...runtimeEnv, BUN_BE_BUN: "1" },
          args: ["-e", 'console.log("CLI", Bun.isStandaloneExecutable)'],
          stdout: "CLI false",
        },
      ],
    }));
  });
});

describe("compile env options validation", () => {
  test.each([false, true])(
    "rejects a custom executable path in the API (path with spaces: %s)",
    async pathWithSpaces => {
      using dir = tempDir("compile-env-options-custom", {
        "entry.ts": `console.log("APP");`,
        "custom runtime café": "unused executable",
      });
      const executablePath = pathWithSpaces ? join(String(dir), "custom runtime café") : bunExe();
      const result = await Bun.build({
        entrypoints: [join(String(dir), "entry.ts")],
        compile: { outfile: join(String(dir), "out"), envOptions: false, executablePath },
        throw: false,
      });
      expect(result.logs.map(log => log.message)).toEqual([
        `Disabling runtime environment options cannot be combined with custom executable path ${JSON.stringify(executablePath)}.\nnote: Remove --compile-executable-path or compile.executablePath to use the current Bun executable.`,
      ]);
      expect(result.success).toBe(false);
    },
  );

  describe.each([
    { kind: "version", backend: "cli", bytecode: false },
    { kind: "executable", backend: "cli", bytecode: false },
    { kind: "version", backend: "cli", bytecode: true },
    { kind: "executable", backend: "cli", bytecode: true },
    { kind: "version", backend: "api", bytecode: false },
    { kind: "executable", backend: "api", bytecode: false },
    { kind: "version", backend: "api", bytecode: true },
    { kind: "executable", backend: "api", bytecode: true },
    { kind: "target", backend: "cli", bytecode: false },
    { kind: "target", backend: "cli", bytecode: true },
    { kind: "target", backend: "api", bytecode: false },
    { kind: "target", backend: "api", bytecode: true },
    { kind: "baseline", backend: "cli", bytecode: false },
    { kind: "baseline", backend: "cli", bytecode: true },
    { kind: "baseline", backend: "api", bytecode: false },
    { kind: "baseline", backend: "api", bytecode: true },
  ])("custom runtime %j", ({ kind, backend, bytecode }) => {
    test.concurrent("rejects an unverified runtime before downloading or writing it", async () => {
      using dir = tempDir("compile-env-options-target", { "entry.ts": `console.log("APP");` });
      let requests = 0;
      using server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          requests++;
          return new Response("unexpected download", { status: 500 });
        },
      });
      const hostPlatform = isWindows ? "windows" : process.platform;
      const otherPlatform = hostPlatform === "linux" ? "windows" : "linux";
      const libc = isMusl ? "-musl" : "";
      const target =
        kind === "version"
          ? `bun-linux-x64${libc}-v1.0.0`
          : kind === "baseline"
            ? `bun-${hostPlatform}-x64${libc}-baseline`
            : `bun-${otherPlatform}-x64`;
      const option = kind === "executable" ? `--compile-executable-path=${bunExe()}` : `--target=${target}`;
      await using proc = Bun.spawn({
        cmd:
          backend === "cli"
            ? [
                bunExe(),
                "build",
                "--compile",
                "--no-compile-env-options",
                ...(bytecode ? ["--bytecode"] : []),
                option,
                "--outfile",
                join(String(dir), "out"),
                join(String(dir), "entry.ts"),
              ]
            : [
                bunExe(),
                "-e",
                `const result = await Bun.build({
            entrypoints: [process.argv.at(-2)],
            compile: {
              outfile: process.argv.at(-1),
              envOptions: false,
              ${kind === "executable" ? `executablePath: ${JSON.stringify(bunExe())}` : `target: ${JSON.stringify(target)}`},
            },
            bytecode: ${bytecode},
            throw: false,
          });
          for (const log of result.logs) console.error(log.message);
          process.exit(result.success ? 0 : 1);`,
                join(String(dir), "entry.ts"),
                join(String(dir), "out"),
              ],
        env: {
          ...bunEnv,
          ...runtimeEnv,
          BUN_COMPILE_TARGET_TARBALL_URL: String(server.url),
          BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(requests).toBe(0);
      expect(stderr).toContain(
        kind === "executable"
          ? `Disabling runtime environment options cannot be combined with custom executable path "${bunExe()}".\nnote: Remove --compile-executable-path or compile.executablePath to use the current Bun executable.`
          : "Disabling runtime environment options requires the default Bun target",
      );
      if (kind !== "executable") {
        expect(stderr).toContain(
          `received "${kind === "version" ? target : `${target}-v${Bun.version.replaceAll("-debug", "")}`}"`,
        );
        expect(stderr).toContain("note: Remove --target or compile.target to use the current Bun executable.");
      }
      expect(await Bun.file(join(String(dir), "out")).exists()).toBe(false);
      expect(code).toBe(1);
    });
  });

  itBundled("compile/env-options/inspector-connect", {
    compile: { envOptions: false },
    outfile: "/app.exe",
    files: {
      "/entry.ts": `
        import { open, url } from "node:inspector";
        try {
          using inspector = open(0, "127.0.0.1");
          console.log(url() ? "opened" : "missing URL");
        } catch (error) {
          console.log(error.code);
        }
      `,
    },
    async onAfterBundle({ outfile, join }) {
      using listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open(socket) {
            socket.end();
          },
          data() {},
        },
      });
      const env = { ...bunEnv, ...runtimeEnv, BUN_INSPECT_CONNECT_TO: `tcp://127.0.0.1:${listener.port}` };
      // inspector.open() refuses a VM with an environment-configured inspector,
      // even if its debugger thread has not connected yet.
      {
        await using proc = Bun.spawn({ cmd: [bunExe(), join("entry.ts")], env, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stdout, code }).toEqual({ stdout: "ERR_INSPECTOR_ALREADY_ACTIVATED\n", code: 0 });
      }
      await using proc = Bun.spawn({ cmd: [outfile], env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("opened\n");
      expect(stderr).toMatch(/^Debugger listening on ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+\n$/);
      expect({ code, signal: proc.signalCode }).toEqual({ code: 0, signal: null });
    },
  });

  describe.each([null, "false", 0, {}, []].map(value => ({ value })))("envOptions: %j", ({ value: envOptions }) => {
    test("requires a boolean", () => {
      const build = () => Bun.build({ entrypoints: [import.meta.path], compile: { envOptions: envOptions as any } });
      expect(build).toThrow(TypeError);
      expect(build).toThrow(/compile\.envOptions.*boolean/);
    });
  });

  describe.each([false, true])("own envOptions: %s", own => {
    test("only reads an own property", async () => {
      let read = false;
      const property = {
        get envOptions() {
          read = true;
          return false;
        },
      };
      const compile = own ? property : Object.create(property);
      using dir = tempDir("compile-env-options-inherited", { "entry.ts": "const = ;" });
      const result = await Bun.build({ entrypoints: [join(String(dir), "entry.ts")], compile, throw: false });
      expect(result.success).toBe(false);
      expect(read).toBe(own);
    });
  });

  describe.each(["--compile-env-options", "--no-compile-env-options"])("%s", flag => {
    test.concurrent("requires --compile", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", flag, import.meta.path],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("--compile-env-options requires --compile");
      expect(code).toBe(1);
    });
  });

  test.concurrent("rejects conflicting CLI flags", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--compile-env-options", "--no-compile-env-options", import.meta.path],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Cannot use both --compile-env-options and --no-compile-env-options");
    expect(code).toBe(1);
  });
});

// `BUN_JSC_dumpOptions=2` prints every JSC option as `   name=value` on stderr
// once JSCInitialize has applied Bun's overrides.
function jscOption(stderr: string, name: string): string | undefined {
  return stderr.match(new RegExp(`^\\s*${name}=(\\S+)`, "m"))?.[1];
}

describe("bundler", () => {
  // --disallow-code-generation-from-strings=strict baked into the executable: it is on with no
  // arguments, a Worker has it and reports it, BUN_OPTIONS cannot lower it, its own command line is
  // not read as flags, and BUN_JSC_useDollarVM does not bring back $vm (which evaluates strings).
  for (const [name, embedded, env, execArgv] of [
    ["", "--disallow-code-generation-from-strings=strict", {}, ["--disallow-code-generation-from-strings=strict"]],
    [
      "BunOptionsCannotLower",
      "--disallow-code-generation-from-strings=strict",
      { BUN_OPTIONS: "--disallow-code-generation-from-strings" },
      ["--disallow-code-generation-from-strings", "--disallow-code-generation-from-strings=strict"],
    ],
    // The embedded flags are unquoted before they are parsed, and the floor is what was parsed.
    [
      "QuotedBunOptionsCannotLower",
      '"--disallow-code-generation-from-strings=strict"',
      { BUN_OPTIONS: "--disallow-code-generation-from-strings" },
      ["--disallow-code-generation-from-strings", '"--disallow-code-generation-from-strings=strict"'],
    ],
  ] as const) {
    const refused = "EvalError: Code generation from strings disallowed for this context";
    const seen = {
      execArgv,
      eval: refused,
      Function: refused,
      vm: refused,
      importData: refused,
      importFile: 2,
      dollarVM: "undefined",
    };
    itBundled("compile/CompileExecArgvDisallowCodeGenerationFromStrings" + name, {
      compile: {
        execArgv: [embedded],
      },
      backend: "cli",
      files: {
        "/entry.ts": /* js */ `
          import { Worker } from "node:worker_threads";
          import { see } from "./see.ts";
          const main = await see();
          const worker = await new Promise((resolve, reject) => {
            const worker = new Worker("./worker.ts");
            worker.on("message", resolve);
            worker.on("error", reject);
          });
          const workerEmptyExecArgv = await new Promise((resolve, reject) => {
            const worker = new Worker("./worker.ts", { execArgv: [] });
            worker.on("message", resolve);
            worker.on("error", reject);
          });
          console.log(JSON.stringify({ main, worker, workerEmptyExecArgv }));
          process.exit(0);
        `,
        "/worker.ts": /* js */ `
          import { parentPort } from "node:worker_threads";
          import { see } from "./see.ts";
          parentPort.postMessage(await see());
        `,
        "/see.ts": /* js */ `
          import vm from "node:vm";
          const attempt = async fn => { try { return await fn(); } catch (e) { return e.constructor.name + ": " + e.message; } };
          // Computed, so that it is a string at run time: the bundler makes a literal "data:" specifier
          // part of the program when it builds.
          const data = ["data:text/javascript", "export default 1 + 1"].join(",");
          export const see = async () => ({
            execArgv: process.execArgv,
            eval: await attempt(() => eval("1 + 1")),
            Function: await attempt(() => new Function("return 1 + 1")()),
            vm: await attempt(() => vm.runInThisContext("1 + 1")),
            importData: await attempt(async () => (await import(data)).default),
            importFile: await attempt(async () => (await import("./imported.ts")).default),
            dollarVM: typeof $vm,
          });
        `,
        "/imported.ts": /* js */ `export default 2;`,
      },
      entryPointsRaw: ["./entry.ts", "./worker.ts"],
      outfile: "dist/out",
      run: {
        file: "dist/out",
        setCwd: true,
        env: { ...env, BUN_JSC_useDollarVM: "1" },
        args: ["--disallow-code-generation-from-strings"],
        stdout: JSON.stringify({
          main: seen,
          worker: seen,
          workerEmptyExecArgv: { ...seen, execArgv: ["--disallow-code-generation-from-strings=strict"] },
        }),
      },
    });
  }

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
