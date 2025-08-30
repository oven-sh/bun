import { expect, test } from "bun:test";
import { bunExe, tempDirWithFiles } from "harness";

test("AutoBitSet async dependency propagation should work correctly", async () => {
  const files = {
    "a.js": `
      import { b } from "./b.js";
      console.log("a");
    `,
    "b.js": `
      import { c } from "./c.js"; 
      export const b = "b";
    `,
    "c.js": `
      await Promise.resolve();
      export const c = "c";
    `,
    "main.js": `
      import { b } from "./b.js";
      console.log(b);
    `,
    "package.json": `{
      "name": "test-async-propagation",
      "type": "module"
    }`,
  };

  const dir = tempDirWithFiles("test-async-propagation", files);

  // Bundle the main file
  const result = Bun.spawn({
    cmd: [bunExe(), "build", "main.js", "--outdir", "dist", "--format", "esm"],
    cwd: dir,
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, stdout, exitCode] = await Promise.all([result.stderr.text(), result.stdout.text(), result.exited]);

  // Should build successfully since we're using import statements, not require()
  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("error");
});

test("AutoBitSet should handle complex dependency chains", async () => {
  const files = {
    "a.js": `import "./b.js"; import "./d.js";`,
    "b.js": `import "./c.js";`,
    "c.js": `await Promise.resolve(); export const c = "c";`,
    "d.js": `import "./e.js";`,
    "e.js": `export const e = "e";`, // No async here
    "main.js": `import "./a.js";`,
    "package.json": `{ "type": "module" }`,
  };

  const dir = tempDirWithFiles("test-complex-chains", files);

  const result = Bun.spawn({
    cmd: [bunExe(), "build", "main.js", "--outdir", "dist"],
    cwd: dir,
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });

  const exitCode = await result.exited;
  expect(exitCode).toBe(0);
});
