import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A `define` value is parsed as JSON and then deep-cloned out of the parser's
// thread-local store (`DefineData::parse` in `src/bundler/defines.rs`). The
// JSON parser bounds its own recursion, but `Expr::deep_clone` used to have no
// stack guard and its frames are larger than the parser's, so a value the
// parser accepted could still run the clone off the end of the stack and kill
// the process with a bare SIGSEGV.
//
// The window between "the parser accepts it" and "the clone overflows" depends
// on the frame sizes of the build (debug frames are much larger) and on the
// thread (`Bun.build` runs its bundler on a thread with a smaller stack), so
// each door is probed at several depths. Every one must end with either a
// successful run or the parser's "JSON document is too deeply nested" error.
// None may die on a signal.

const TOO_DEEP = "JSON document is too deeply nested";

// `Buffer.alloc` fill over `.repeat`: the latter is very slow in debug JSC.
function nested(depth: number): string {
  return Buffer.alloc(depth, "[").toString() + "1" + Buffer.alloc(depth, "]").toString();
}

// The same helper as source text for the child's `-e` script.
const NESTED_FN = `const nested = d => Buffer.alloc(d, "[").toString() + "1" + Buffer.alloc(d, "]").toString();`;

describe("deeply nested define value does not overflow the stack", () => {
  for (const depth of [700, 1000, 1300, 5000, 20000, 30000]) {
    test.concurrent(`Bun.Transpiler, depth ${depth}`, async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `${NESTED_FN}
          try {
            new Bun.Transpiler({ define: { DEEPX: nested(${depth}) } });
            console.log("ok");
          } catch (e) {
            console.log("error: " + e.message);
          }`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(proc.signalCode).toBeNull();
      expect(stdout).toMatch(/^(ok|error: StackOverflow Failed to load define)\n$/);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  }

  for (const depth of [200, 250, 300, 3000, 5000]) {
    test.concurrent(`Bun.build, depth ${depth}`, async () => {
      using dir = tempDir("define-deep-nesting-build", {
        "entry.ts": `console.log("ran");`,
      });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `${NESTED_FN}
          const result = await Bun.build({
            entrypoints: ["./entry.ts"],
            define: { DEEPX: nested(${depth}) },
            throw: false,
          });
          console.log(result.success ? "ok" : "error: " + result.logs.map(String).join("\\n"));`,
        ],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(proc.signalCode).toBeNull();
      expect(stdout).toMatch(new RegExp(`^(ok|error: BuildMessage: ${TOO_DEEP})\n$`));
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  }

  // Windows caps a command line at 32K characters, so the largest depth for
  // the flag stays below that. `bunfig.toml` carries the bigger values.
  for (const depth of [800, 1400, 12000]) {
    test.concurrent(`bun run --define, depth ${depth}`, async () => {
      using dir = tempDir("define-deep-nesting-cli", {
        "entry.ts": `console.log("ran");`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--define", `DEEPX=${nested(depth)}`, "./entry.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(proc.signalCode).toBeNull();
      if (exitCode === 0) {
        expect(stdout).toBe("ran\n");
      } else {
        expect(stderr).toContain(TOO_DEEP);
        expect(exitCode).toBe(1);
      }
    });
  }

  for (const depth of [1100, 20000]) {
    test.concurrent(`bunfig.toml [define], depth ${depth}`, async () => {
      using dir = tempDir("define-deep-nesting-bunfig", {
        "entry.ts": `console.log("ran");`,
        "bunfig.toml": `[define]\n"DEEPX" = '${nested(depth)}'\n`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "./entry.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(proc.signalCode).toBeNull();
      if (exitCode === 0) {
        expect(stdout).toBe("ran\n");
      } else {
        expect(stderr).toContain(TOO_DEEP);
        expect(exitCode).toBe(1);
      }
    });
  }
});
