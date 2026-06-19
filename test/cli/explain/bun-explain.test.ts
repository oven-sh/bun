import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("bun explain", () => {
  it("should print deprecation to stderr and exit 1 (no args)", async () => {
    using dir = tempDir("explain-no-args", {});
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "explain"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(err).toContain("bun explain");
    expect(err).toContain("removed");
    expect(err).toContain("bun why");
    expect(out).toBe("");
    expect(code).toBe(1);
  });

  it("should print deprecation to stderr and exit 1 (with args)", async () => {
    using dir = tempDir("explain-with-args", {});
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "explain", "react"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(err).toContain("bun explain");
    expect(err).toContain("bun why");
    expect(out).toBe("");
    expect(code).toBe(1);
  });

  it("should print deprecation to stderr and exit 1 (with flags)", async () => {
    using dir = tempDir("explain-with-flags", {});
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "explain", "--top"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(err).toContain("bun explain");
    expect(err).toContain("bun why");
    expect(out).toBe("");
    expect(code).toBe(1);
  });

  it("should print help-style message and exit 0 on --help", async () => {
    using dir = tempDir("explain-help", {});
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "explain", "--help"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    // Help goes to stdout via tagPrintHelp → Output.pretty (per why/help convention).
    const helpText = out + err;
    expect(helpText).toContain("bun explain");
    expect(helpText).toContain("bun why");
    expect(code).toBe(0);
  });
});
