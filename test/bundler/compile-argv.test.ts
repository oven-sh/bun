import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

// Shared entry used by every compiled binary below. It prints a single JSON
// line describing the process's argv/execArgv state so each `run` entry can
// assert exact values without recompiling.
const dumpArgvEntry = /* js */ `
  console.log(JSON.stringify({
    execArgv: process.execArgv,
    argv0: process.argv[0],
    argv1HasBunfs: String(process.argv[1] ?? "").includes("bunfs"),
    argvLength: process.argv.length,
    userArgs: process.argv.slice(2),
    title: process.title,
  }));
`;

type Dump = {
  execArgv: string[];
  argv0: string;
  argv1HasBunfs: boolean;
  argvLength: number;
  userArgs: string[];
  title: string;
};

function parse(stdout: string): Dump {
  return JSON.parse(stdout.trim());
}

// Four `bun build --compile` invocations run here. bundler_compile.test.ts and
// bundler_compile_autoload.test.ts avoid describe.concurrent because 8-20
// concurrent --compile links exhaust CI memory/IO (build #40193). Four is half
// the lower threshold and matches bundler_html_server.test.ts, so concurrent is
// kept for the wall-time win; drop `.concurrent` if this ever SIGTERMs in CI.
describe.concurrent("bundler", () => {
  // --compile-exec-argv flags are both processed at runtime AND exposed via
  // process.execArgv, and none of them leak into process.argv. Also covers
  // issue #26082: user-supplied --version/-v/--help/-h reach the app instead
  // of being intercepted by Bun's own CLI parser.
  itBundled("compile/CompileExecArgv", {
    compile: {
      execArgv: ["--title=CompileExecArgvTest", "--smol"],
    },
    backend: "cli",
    files: { "/entry.ts": dumpArgvEntry },
    run: [
      {
        args: ["runtime", "test"],
        validate({ stdout }) {
          const out = parse(stdout);
          // --title was actually applied, proving execArgv flags are processed.
          expect(out.title).toBe("CompileExecArgvTest");
          expect(out.execArgv).toEqual(["--title=CompileExecArgvTest", "--smol"]);
          expect(out.argv0).toBe("bun");
          expect(out.argv1HasBunfs).toBe(true);
          expect(out.userArgs).toEqual(["runtime", "test"]);
          expect(out.argvLength).toBe(4);
        },
      },
      {
        // #26082: --version must reach user code, not print Bun's version.
        args: ["--version"],
        validate({ stdout }) {
          const out = parse(stdout);
          expect(out.execArgv).toEqual(["--title=CompileExecArgvTest", "--smol"]);
          expect(out.userArgs).toEqual(["--version"]);
        },
      },
      {
        args: ["-v"],
        validate({ stdout }) {
          expect(parse(stdout).userArgs).toEqual(["-v"]);
        },
      },
      {
        args: ["--help"],
        validate({ stdout }) {
          expect(parse(stdout).userArgs).toEqual(["--help"]);
        },
      },
      {
        args: ["-h"],
        validate({ stdout }) {
          expect(parse(stdout).userArgs).toEqual(["-h"]);
        },
      },
    ],
  });

  // execArgv flags baked in at compile time never leak into process.argv,
  // regardless of whether the user passes their own arguments.
  itBundled("compile/CompileExecArgvNoLeak", {
    compile: {
      execArgv: ["--user-agent=test-agent", "--smol"],
    },
    backend: "cli",
    files: { "/entry.ts": dumpArgvEntry },
    run: [
      {
        // No user arguments: argv is exactly [exe, script].
        args: [],
        validate({ stdout }) {
          const out = parse(stdout);
          expect(out.execArgv).toEqual(["--user-agent=test-agent", "--smol"]);
          expect(out.argv0).toBe("bun");
          expect(out.argv1HasBunfs).toBe(true);
          expect(out.userArgs).toEqual([]);
          expect(out.argvLength).toBe(2);
        },
      },
      {
        // With user arguments: they appear verbatim after [exe, script] and
        // the baked-in execArgv flags are still absent from argv.
        args: ["user-arg1", "user-arg2"],
        validate({ stdout }) {
          const out = parse(stdout);
          expect(out.execArgv).toEqual(["--user-agent=test-agent", "--smol"]);
          expect(out.argv0).toBe("bun");
          expect(out.argv1HasBunfs).toBe(true);
          expect(out.userArgs).toEqual(["user-arg1", "user-arg2"]);
          expect(out.argvLength).toBe(4);
        },
      },
    ],
  });

  // BUN_OPTIONS is applied to standalone executables: its flags land in
  // process.execArgv and never in process.argv.
  itBundled("compile/BunOptionsEnv", {
    compile: true,
    backend: "cli",
    files: { "/entry.ts": dumpArgvEntry },
    run: [
      {
        env: { BUN_OPTIONS: "--smol" },
        validate({ stdout }) {
          const out = parse(stdout);
          expect(out.execArgv).toContain("--smol");
          expect(out.userArgs).toEqual([]);
          expect(out.argvLength).toBe(2);
        },
      },
      {
        // User arguments pass through untouched alongside BUN_OPTIONS.
        env: { BUN_OPTIONS: "--smol" },
        args: ["user-arg1", "user-arg2"],
        validate({ stdout }) {
          const out = parse(stdout);
          expect(out.execArgv).toContain("--smol");
          expect(out.userArgs).toEqual(["user-arg1", "user-arg2"]);
          expect(out.argvLength).toBe(4);
        },
      },
    ],
  });

  // BUN_OPTIONS combines with compile-time --compile-exec-argv: both sets of
  // flags show up in process.execArgv, neither in process.argv.
  itBundled("compile/BunOptionsEnvWithCompileExecArgv", {
    compile: {
      execArgv: ["--conditions=production"],
    },
    backend: "cli",
    files: { "/entry.ts": dumpArgvEntry },
    run: {
      env: { BUN_OPTIONS: "--smol" },
      validate({ stdout }) {
        const out = parse(stdout);
        expect(out.execArgv).toContain("--conditions=production");
        expect(out.execArgv).toContain("--smol");
        expect(out.userArgs).toEqual([]);
        expect(out.argvLength).toBe(2);
      },
    },
  });
});
