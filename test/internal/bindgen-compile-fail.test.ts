// `bun_jsc::bindgen` makes rustc enforce how native code may touch the JS heap. Each file in
// bindgen-compile-fail/fail is a mistake it must refuse, for the reason on the file's first line and no
// other; each file in bindgen-compile-fail/pass is the right way to do the same work.
//
// The cases are type-checked against the metadata `cargo check` leaves behind; nothing is linked.
import { which } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const cargo = which("cargo");
const rustc = which("rustc");
const repoRoot = join(import.meta.dir, "..", "..");
const cases = join(import.meta.dir, "bindgen-compile-fail");
const codegenDir = process.env.BUN_CODEGEN_DIR ?? join(dirname(bunExe()), "codegen");
// The test lanes run a prebuilt binary: no toolchain, no vendored crates, no generated code. The `cargo clippy` job of
// .github/workflows/rust-lints.yml has all three and runs this file.
const canCheck =
  !!cargo &&
  !!rustc &&
  existsSync(join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) &&
  existsSync(join(codegenDir, "generated_bindgen_bun_jsc.rs"));

const env = { ...process.env, CARGO_TERM_COLOR: "never", BUN_CODEGEN_DIR: codegenDir };

describe.skipIf(!canCheck)("bun_jsc::bindgen", () => {
  let metadata = "";
  const searchPaths = new Set<string>();
  const prelude = readFileSync(join(cases, "prelude.rs"), "utf8");

  beforeAll(async () => {
    await using proc = Bun.spawn({
      cmd: [cargo!, "check", "--locked", "-p", "bun_jsc", "--message-format=json"],
      cwd: repoRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toMatchObject({ exitCode: 0 });
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.startsWith("{")) continue;
      const message = JSON.parse(line);
      if (message.reason !== "compiler-artifact") continue;
      for (const name of message.filenames as string[]) searchPaths.add(dirname(name));
      if (message.target.name === "bun_jsc" && message.target.kind.includes("lib"))
        metadata = message.filenames.find((name: string) => name.endsWith(".rmeta"));
    }
    expect(metadata).toEndWith(".rmeta");
  }, 600_000);

  /** The distinct errors rustc reports for the case: a code, or "lifetime" for the one that has none. */
  async function check(kind: string, file: string): Promise<{ codes: string[]; ok: boolean; stderr: string }> {
    using dir = tempDir("bindgen-compile-fail", { [file]: prelude + readFileSync(join(cases, kind, file), "utf8") });
    const source = join(String(dir), file);
    await using proc = Bun.spawn({
      cmd: [
        rustc!,
        "--edition=2024",
        "--crate-type=bin",
        "--emit=metadata",
        "--error-format=short",
        `--out-dir=${String(dir)}`,
        "-Cpanic=abort",
        ...Array.from(searchPaths, path => `-Ldependency=${path}`),
        "--extern",
        `bun_jsc=${metadata}`,
        source,
      ],
      cwd: repoRoot,
      env,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const errors = stderr
      .split(/\r?\n/)
      .filter(line => /\berror\b/.test(line) && !line.startsWith("error: aborting due to"));
    const code = (line: string) =>
      /error\[(E\d+)\]/.exec(line)?.[1] ?? (line.includes("lifetime may not live long enough") ? "lifetime" : line);
    return { codes: [...new Set(errors.map(code))], ok: exitCode === 0, stderr };
  }

  describe("pass", () => {
    test.concurrent.each(readdirSync(join(cases, "pass")))("%s", async file => {
      expect(await check("pass", file)).toMatchObject({ codes: [], ok: true });
    });
  });

  describe("fail", () => {
    test.concurrent.each(readdirSync(join(cases, "fail")))("%s", async file => {
      const expected = /^\/\/ (E\d+|lifetime): /.exec(readFileSync(join(cases, "fail", file), "utf8"))![1];
      expect(await check("fail", file)).toMatchObject({ codes: [expected], ok: false });
    });
  });
});
