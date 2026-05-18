import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("bun --check", () => {
  test("exits 0 and produces no output for a syntactically valid file", async () => {
    using dir = tempDir("check-valid", {
      "ok.js": `const x = 1;\nconsole.log("SHOULD NOT RUN");\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--check", "ok.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stdout).toBe("");
    // The script must not execute.
    expect(stdout).not.toContain("SHOULD NOT RUN");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("exits 1 and reports a syntax error for an invalid file", async () => {
    using dir = tempDir("check-invalid", {
      "bad.js": `const x = ;\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--check", "bad.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toContain("error");
    expect(stderr).toContain("bad.js");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("does not execute the file", async () => {
    using dir = tempDir("check-noexec", {
      "side-effect.js": `
        import fs from "node:fs";
        fs.writeFileSync("ran.txt", "1");
        process.exit(42);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--check", "side-effect.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
    expect(await Bun.file(`${dir}/ran.txt`).exists()).toBe(false);
  });

  test("accepts TypeScript syntax in .ts files", async () => {
    using dir = tempDir("check-ts", {
      "ok.ts": `interface Foo { x: number }\nconst y: Foo = { x: 1 };\nexport { y };\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--check", "ok.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });

  test("accepts ESM import/export syntax", async () => {
    using dir = tempDir("check-esm", {
      "esm.mjs": `import foo from "bar";\nexport const x = 1;\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--check", "esm.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });

  test("accepts top-level await", async () => {
    using dir = tempDir("check-tla", {
      "tla.js": `const x = await Promise.resolve(1);\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--check", "tla.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });

  test("reads from stdin when no file is given", async () => {
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--check"],
        env: bunEnv,
        stdin: new Blob(["let x = 1;\n"]),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);
      expect(stderr).toBe("");
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    }
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--check"],
        env: bunEnv,
        stdin: new Blob(["const x = ;\n"]),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);
      expect(stderr).toContain("error");
      expect(stderr).toContain("[stdin]");
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    }
  });

  test("exits non-zero when the file does not exist", async () => {
    using dir = tempDir("check-missing", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--check", "nope.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toContain("error");
    expect(stderr).toContain("nope.js");
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });

  test("rejects combining --check with --eval or --print", async () => {
    for (const flag of ["-e", "--eval", "-p", "--print"]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--check", flag, "1 + 1"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);
      expect(stderr.toLowerCase()).toContain("either --check or --eval");
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    }
  });

  test("works via `bun run --check <file>`", async () => {
    using dir = tempDir("check-run", {
      "bad.js": `function f( {\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--check", "bad.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toContain("error");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });
});
