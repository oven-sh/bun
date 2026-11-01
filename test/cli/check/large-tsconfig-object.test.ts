import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("large tsconfig objects preserve duplicate-key behavior", async () => {
  const keys = Object.fromEntries(Array.from({ length: 1024 }, (_, i) => [`key_${i}`, i]));

  const config = `{
    "compilerOptions": {
      "noEmit": true,
      "types": [],
      "module": "preserve",
      "moduleResolution": "bundler",
      "paths": {
        "@answer": ["./incorrect.ts"],
        "@answer": ["./correct.ts"]
      }
    },
    "files": ["main.ts"],
    "x": ${JSON.stringify(keys)}
  }`;

  using dir = tempDir("large-tsconfig-object", {
    "tsconfig.json": config,
    "main.ts": `
      import { answer } from "@answer";
      const result: 42 = answer;
    `,
    "incorrect.ts": `export const answer = "wrong";`,
    "correct.ts": `export const answer = 42 as const;`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "-p", "."],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout + stderr).not.toContain("error TS");
  expect(exitCode).toBe(0);
});
