import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("const enum members can reference const variables with constant initializers", async () => {
  using dir = tempDir("19581", {
    "index.ts": `
      const enum First {
        A = 1,
        B = 2,
        C = 3,
      }

      const multiplier = 5;

      const enum Second {
        D = First.A * multiplier,
        E = First.B * multiplier,
        F = First.C * multiplier,
      }

      console.log(Second.D, Second.E, Second.F, Second.E + Second.F);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", String(dir) + "/index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The const enum values should be fully folded to numeric literals.
  // Second.D = First.A * multiplier = 1 * 5 = 5
  // Second.E = First.B * multiplier = 2 * 5 = 10
  // Second.F = First.C * multiplier = 3 * 5 = 15
  expect(stdout).toContain("5 /* D */");
  expect(stdout).toContain("10 /* E */");
  expect(stdout).toContain("15 /* F */");
  // The multiplier variable should not appear in the enum output
  expect(stdout).not.toContain("* multiplier");
  expect(exitCode).toBe(0);
});

test("const enum with const variable folds completely with --minify", async () => {
  using dir = tempDir("19581-minify", {
    "index.ts": `
      const enum First { A = 1, B = 2, C = 3 }
      const multiplier = 5;
      const enum Second {
        D = First.A * multiplier,
        E = First.B * multiplier,
        F = First.C * multiplier,
      }
      console.log(Second.E + Second.F);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--minify", String(dir) + "/index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // With minification, 10 + 15 should fold to 25
  expect(stdout.trim()).toBe("console.log(25);");
  expect(exitCode).toBe(0);
});

test("const enum folding with simple const variable", async () => {
  using dir = tempDir("19581-simple", {
    "index.ts": `
      const base = 10;
      const enum MyEnum {
        A = base,
        B = base + 1,
        C = base * 2,
      }
      console.log(MyEnum.A, MyEnum.B, MyEnum.C);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", String(dir) + "/index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("10 /* A */");
  expect(stdout).toContain("11 /* B */");
  expect(stdout).toContain("20 /* C */");
  // The enum values should be folded, not left as "base" or "base + 1"
  expect(stdout).not.toContain("= base");
  expect(exitCode).toBe(0);
});
