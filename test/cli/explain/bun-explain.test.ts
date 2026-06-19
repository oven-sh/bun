import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

let i = 0;

describe.concurrent("bun explain", () => {
  // Set up a hermetic tempDir with a known package.json + pre-checked-in
  // bun.lock fixture (avoids reading the host cwd or the test process's
  // real deps; also avoids live npm-registry access). Returns a disposable
  // string — each test declares `using dir = await setupFixture()` to
  // auto-clean the temp dir on scope exit. The `bun.lock` fixture was
  // generated once by running `bun install --lockfile-only` against a fresh
  // tempDir with the same package.json and committed at
  // `fixture/bun.lock`; regenerate it manually if lodash resolution changes.
  async function setupFixture() {
    const lockfile = await Bun.file(import.meta.dir + "/fixture/bun.lock").text();
    return tempDir(`explain-${i++}`, {
      "package.json": JSON.stringify(
        {
          name: "explain-test",
          version: "1.0.0",
          dependencies: {
            lodash: "^4.17.21",
          },
        },
        null,
        2,
      ),
      "bun.lock": lockfile,
    });
  }

  // TS-1: alias wired, no-args.
  // `bun explain` with no args exits 1 and prints WhyCommand's usage text (which
  // begins with the `bun why v...` version line at why_command.zig:191). Proves
  // the matcher routed "explain" to .WhyCommand rather than AutoCommand.
  it("exits 1 and prints bun why usage on no args", async () => {
    using dir = await setupFixture();
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "explain"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    const combined = out + err;
    // Assert content before exit code for diagnostic clarity on failure.
    expect(combined).toContain("bun why");
    expect(code).toBe(1);
  });

  // TS-2: alias wired, with package arg.
  // `bun explain <pkg>` exits 0 and prints a dep tree whose root is <pkg>.
  it("shows direct dependency for a known package", async () => {
    using dir = await setupFixture();
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "explain", "lodash"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [output, , code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(output).toContain("lodash@");
    expect(code).toBe(0);
  });

  // TS-3: alias wired, with --top flag.
  // `bun explain <pkg> --top` exits 0 — the alias inherits WhyCommand's flag handling.
  it("accepts --top flag and exits 0", async () => {
    using dir = await setupFixture();
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "explain", "lodash", "--top"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [output, , code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(output).toContain("lodash@");
    expect(code).toBe(0);
  });

  // TS-4: alias wired, --help.
  // `bun explain --help` exits 0 and prints WhyCommand's help arm (which reads
  // "bun why" throughout). The --help short-circuit at Arguments.parse is
  // name-agnostic, so the alias inherits WhyCommand's help text for free.
  it("prints bun why help and exits 0 on --help", async () => {
    using dir = await setupFixture();
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "explain", "--help"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    const combined = out + err;
    expect(combined).toContain("bun why");
    expect(combined).toContain("Usage");
    expect(code).toBe(0);
  });

  // TS-5: cross-command equivalence.
  // `bun explain <pkg>` and `bun why <pkg>` produce byte-identical output in the
  // same fixture. The strongest assertion that the alias is exact, not merely
  // "same behavior in shape".
  it("produces byte-identical output to bun why for the same args", async () => {
    using dir = await setupFixture();
    const explain = spawn({
      cmd: [bunExe(), "explain", "lodash"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const why = spawn({
      cmd: [bunExe(), "why", "lodash"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Assert content (the triple) before exit code for diagnostic clarity.
    const [explainOut, explainErr, explainCode] = await Promise.all([
      explain.stdout.text(),
      explain.stderr.text(),
      explain.exited,
    ]);
    const [whyOut, whyErr, whyCode] = await Promise.all([why.stdout.text(), why.stderr.text(), why.exited]);

    expect({ stdout: explainOut, stderr: explainErr, exitCode: explainCode }).toEqual({
      stdout: whyOut,
      stderr: whyErr,
      exitCode: whyCode,
    });
  });
});
