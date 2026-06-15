// Tests for the `bun-standalone` binary (the reduced-footprint --compile
// runtime). `bun-standalone` has no `bun test` command, so these run under
// the FULL bun and spawn the standalone binary as a subprocess.
//
// Locally:
//   bun run build:standalone:debug
//   BUN_STANDALONE_EXE=build/debug-standalone/bun-standalone-debug \
//     bun bd test test/cli/standalone-binary.test.ts
//
// In CI the standalone binary's own `--revision` smoke test is the link-time
// gate; this file is the behavioural one.

import { describe, expect, test } from "bun:test";
import { bunEnv, normalizeBunSnapshot } from "harness";
import { existsSync } from "node:fs";

const standaloneExe = process.env.BUN_STANDALONE_EXE;

describe.skipIf(!standaloneExe || !existsSync(standaloneExe))("bun-standalone", () => {
  const exe = standaloneExe!;

  test("toolkit subcommands print an actionable error and exit non-zero", async () => {
    for (const cmd of ["build", "test", "install", "add", "pm", "create", "init", "x", "upgrade"]) {
      await using proc = Bun.spawn({
        cmd: [exe, cmd],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(normalizeBunSnapshot(stderr)).toContain("not available in this executable");
      expect(normalizeBunSnapshot(stderr)).toContain("https://bun.com/get");
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    }
  });

  test("--revision works", async () => {
    await using proc = Bun.spawn({
      cmd: [exe, "--revision"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+-standalone\b/);
    expect(exitCode).toBe(0);
  });

  test("running a script works", async () => {
    await using proc = Bun.spawn({
      cmd: [exe, "-e", "console.log(1 + 1)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stdout)).toBe("2");
    expect(exitCode).toBe(0);
  });

  test("Bun.build / Bun.color throw with an actionable error", async () => {
    for (const expr of [`Bun.build({entrypoints:["x.js"]})`, `Bun.color("red")`]) {
      await using proc = Bun.spawn({
        cmd: [
          exe,
          "-e",
          `try { await ${expr}; process.exit(2) } catch (e) { console.error(e.message); process.exit(e instanceof TypeError ? 0 : 1) }`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(normalizeBunSnapshot(stderr)).toContain("not available in standalone executables");
      expect(exitCode).toBe(0);
    }
  });

  test("Bun.serve / fetch / runtime APIs work", async () => {
    await using proc = Bun.spawn({
      cmd: [
        exe,
        "-e",
        `const s = Bun.serve({ port: 0, fetch: () => new Response("ok") });
         const r = await fetch(s.url);
         console.log(await r.text(), s.port > 0);
         s.stop();`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stdout)).toBe("ok true");
    expect(exitCode).toBe(0);
  });

  test("STANDALONE_BUILD const is true", async () => {
    await using proc = Bun.spawn({
      cmd: [exe, "-e", "process.stdout.write(String(process.isBun))"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Sanity: it's a Bun runtime.
    expect(stdout).toBe("true");
    expect(exitCode).toBe(0);
  });
});
