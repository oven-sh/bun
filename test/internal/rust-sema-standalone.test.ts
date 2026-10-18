// `bun-sema` is the type checker of `bun check` as a tool of its own
// (src/sema/standalone). Cargo links it from Rust crates only: native.rs there
// stands in for the C and C++ symbols that `bun` has. So no `bun` binary has
// its `main` or those stand-ins, and a test of `bun` says nothing about them.
//
// This builds the tool in the dev profile and runs each subcommand. The build
// fails when a symbol that the dev link needs has no stand-in. A run fails on
// a debug assertion, which only the dev profile has. One of them is about how
// the tool starts: a thread that starts before `bun_core::output::stdio::init()`
// ran fails `STDOUT_STREAM_SET` in `Source::configure_thread`. The release link
// is not built here.
//
// No CI lane runs this file. It needs a checkout in which cargo can resolve the
// workspace (the vendored path deps and build_options.rs), and the test lanes
// run a prebuilt `bun`. Same prerequisite check as rust-windows-sys-link.test.ts.
import { which } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const cargo = which("cargo");
const repoRoot = join(import.meta.dir, "..", "..");
const workspaceResolvable =
  existsSync(join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) &&
  existsSync(join(repoRoot, "vendor", "rust-argon2", "Cargo.toml")) &&
  existsSync(join(repoRoot, "build", "debug", "codegen", "build_options.rs"));

// A target directory of its own, so the build neither waits for the lock on
// `target/debug` nor holds it while another cargo command wants it.
const targetDir = join(repoRoot, "target", "sema-standalone");
const tool = join(targetDir, "debug", "bun-sema");

// The global types that the checker asks for. With `noLib` a project reads no
// library file, so the dev build checks it in milliseconds.
const globals = "Array<T> Boolean CallableFunction Function IArguments NewableFunction Number Object RegExp String"
  .split(" ")
  .map(name => `interface ${name} {}\n`)
  .join("");
const tsconfig = (options: object, rest: object = {}) =>
  JSON.stringify({ compilerOptions: { strict: true, noLib: true, types: [], ...options }, ...rest });
const composite = { composite: true, emitDeclarationOnly: true, outDir: "out" };
const typeError = "index.ts(1,14): error TS2322:";

const isRunnable = !isWindows && cargo !== null && workspaceResolvable;

let fixtures: ReturnType<typeof tempDir>;
let dir: string;

// Not inside the `describe`: hooks of a block that is skipped are listed as skipped tests without a name.
if (isRunnable) {
  beforeAll(
    async () => {
      await using build = Bun.spawn({
        cmd: [cargo!, "build", "--locked", "-p", "bun_sema_standalone", "--target-dir", targetDir],
        cwd: repoRoot,
        // Most of what a dev build writes is debug information, which nothing here reads.
        env: { ...process.env, CARGO_PROFILE_DEV_DEBUG: "0", CARGO_TERM_COLOR: "never" },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
      // Cargo's errors, when the tool does not compile or does not link.
      expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });

      fixtures = tempDir("bun-sema", {
        ok: {
          "tsconfig.json": tsconfig({ noEmit: true }),
          "globals.d.ts": globals,
          "index.ts": "export const a: number = 1;\n",
        },
        error: {
          "tsconfig.json": tsconfig({ noEmit: true }),
          "globals.d.ts": globals,
          "index.ts": 'export const a: number = "x";\n',
        },
        referenced: {
          "tsconfig.json": tsconfig(composite),
          "globals.d.ts": globals,
          "index.ts": "export const a: number = 1;\n",
        },
        referencing: {
          "tsconfig.json": tsconfig(composite, { references: [{ path: "../referenced" }] }),
          "globals.d.ts": globals,
          "index.ts": 'import { a } from "../referenced/index";\nexport const b: number = a;\n',
        },
        // A test as TypeScript's own are written: one script, with its options in comments.
        tests: { "one.ts": `// @noLib: true\n// @strict: true\n${globals}const a: number = 1;\n` },
        baselines: { "names.txt": "" },
        each: {},
      });
      dir = String(fixtures);
    },
    // A cold build takes minutes.
    5 * 60_000,
  );
  afterAll(() => fixtures?.[Symbol.dispose]());
}

describe.skipIf(!isRunnable)("bun-sema, built by cargo in the dev profile", () => {
  async function run(cwd: string, args: string[], options: { env?: Record<string, string>; stdin?: string } = {}) {
    await using proc = Bun.spawn({
      cmd: [tool, ...args],
      cwd: join(dir, cwd),
      // `cli` asks for the directory of the library files. No project here reads one.
      env: { ...process.env, BUN_SEMA_TS_LIB: dir, ...options.env },
      stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // Starts no thread of a pool, so it does not depend on how the tool starts.
  test("hir prints the tree of a file", async () => {
    const { stdout, exitCode } = await run("ok", ["hir", "index.ts", "--print"]);
    expect(stdout).toContain("=== index.ts");
    expect(exitCode).toBe(0);
  });

  test("cli checks a project on the threads of the checker's pool", async () => {
    const { stderr, exitCode } = await run("ok", ["cli", "--plain", "--threads=1"]);
    expect(stderr).toContain("No type errors in 2 files");
    expect(exitCode).toBe(0);
  });

  test("cli reports a type error", async () => {
    const { stdout, stderr, exitCode } = await run("error", ["cli", "--plain"]);
    expect(stderr).toContain("Found 1 error in 1 file");
    expect(stdout).toContain(typeError);
    expect(exitCode).toBe(1);
  });

  test("cli --repeat=2 checks the project once more for each round", async () => {
    const { stderr, exitCode } = await run("ok", ["cli", "--plain", "--repeat=2"]);
    expect(stderr).toContain("repeat 2: 0 errors");
    expect(exitCode).toBe(0);
  });

  // Each project is built on a thread that the driver starts for it.
  test("cli -b builds a project and the project that it references", async () => {
    const { stderr, exitCode } = await run("referencing", ["cli", "--plain", "-b"]);
    expect(stderr).toContain("across 2 projects");
    expect(exitCode).toBe(0);
  });

  // Linux has those threads with this variable only. Nothing that the tool
  // prints tells whether they started.
  test("cli checks a project with the threads that only read files", async () => {
    const env = { BUN_FEATURE_FLAG_FORCE_IO_POOL: "1" };
    const { stderr, exitCode } = await run("ok", ["cli", "--plain", "--threads=4"], { env });
    expect(stderr).toContain("No type errors in 2 files");
    expect(exitCode).toBe(0);
  });

  test("each checks the project of each line in a fork of its own", async () => {
    // A line is a directory and the arguments to run there, with tabs between them.
    const stdin = ["ok", "error"].map(name => `${join(dir, name)}\tcli\t--plain\n`).join("");
    // `--limit`: a fork that hangs ends before this test does.
    const { exitCode } = await run(".", ["each", `--out=${join(dir, "each")}`, "--limit=4"], { stdin });
    // The parent exits with 0 whatever becomes of a fork. `<n>.status` has the
    // exit code of the fork of line `n`, or the signal that ended it.
    const written = (file: string) => readFileSync(join(dir, "each", file), "utf8");
    expect(written("0.err")).toContain("No type errors in 2 files");
    expect(written("1.out")).toContain(typeError);
    expect({ ok: written("0.status"), error: written("1.status"), exitCode }).toEqual({
      ok: "0",
      error: "1",
      exitCode: 0,
    });
  });

  test("baselines runs a test on the threads of Bun's pool", async () => {
    // The names of the baselines: none, so the test has to be without an error.
    const suite = `one=${join(dir, "tests")}=${join(dir, "baselines")}=${join(dir, "baselines", "names.txt")}`;
    // Both directories are for library files, which `noLib` leaves unread.
    const { stdout, stderr, exitCode } = await run(".", ["baselines", `--lib=${dir}`, `--testlib=${dir}`, suite]);
    expect(stderr).toBe("");
    expect(stdout).toContain("100.00%  of 1 Errors, byte for byte");
    expect(exitCode).toBe(0);
  });
});
