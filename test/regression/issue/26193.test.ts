import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/26193
// tsconfig paths with .js extension pattern were not resolved correctly
test("tsconfig paths with .js extension pattern resolves correctly", async () => {
  using dir = tempDir("issue-26193", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        paths: {
          "@src/*.js": ["./src/*.ts"],
        },
      },
    }),
    "src/lib.ts": `export const greeting = "Hello";`,
    "main.ts": `import { greeting } from "@src/lib.js";
console.log(greeting);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("Hello");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("tsconfig paths with complex extension patterns", async () => {
  using dir = tempDir("issue-26193-complex", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        paths: {
          "@utils/*.js": ["./utils/*.ts"],
          "@components/*.jsx": ["./components/*.tsx"],
        },
      },
    }),
    "utils/helper.ts": `export const helper = () => "helper";`,
    "components/Button.tsx": `export const Button = () => "Button";`,
    "main.ts": `import { helper } from "@utils/helper.js";
import { Button } from "@components/Button.jsx";
console.log(helper(), Button());`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("helper Button");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
