import { expect, test } from "bun:test";
import * as fs from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("watch mode should poll and reload when a missing required file is created", async () => {
  using dir = tempDir("watch-missing-module", {
    "file1.ts": `
      import { message } from "./file2.ts";
      Bun.write("success.txt", "SUCCESS: " + message);
    `,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "file1.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  // Wait a bit for the error to happen
  await Bun.sleep(200);

  // Now create the missing file
  fs.writeFileSync(join(String(dir), "file2.ts"), `export const message = "Hello from file2!";\n`);

  // Wait for success.txt to be created (polling should detect file and reload)
  const successPath = join(String(dir), "success.txt");
  let attempts = 0;
  while (!fs.existsSync(successPath) && attempts < 100) {
    await Bun.sleep(50);
    attempts++;
  }

  proc.kill();

  expect(fs.existsSync(successPath)).toBe(true);
  const successContent = fs.readFileSync(successPath, "utf-8");
  expect(successContent).toContain("SUCCESS: Hello from file2!");
});

test("watch mode should handle relative path imports that don't exist", async () => {
  using dir = tempDir("watch-missing-relative", {
    "index.ts": `
      import { data } from "./lib/helper.ts";
      Bun.write("success.txt", "LOADED: " + data);
    `,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  await Bun.sleep(200);

  fs.mkdirSync(join(String(dir), "lib"), { recursive: true });
  fs.writeFileSync(join(String(dir), "lib", "helper.ts"), `export const data = 42;\n`);

  const successPath = join(String(dir), "success.txt");
  let attempts = 0;
  while (!fs.existsSync(successPath) && attempts < 100) {
    await Bun.sleep(50);
    attempts++;
  }

  proc.kill();

  expect(fs.existsSync(successPath)).toBe(true);
  const successContent = fs.readFileSync(successPath, "utf-8");
  expect(successContent).toContain("LOADED: 42");
});

test("watch mode should handle deeply nested missing imports", async () => {
  using dir = tempDir("watch-nested-missing", {
    "index.ts": `
      import { level1 } from "./level1/level2.ts";
      Bun.write("success.txt", "RESULT: " + level1);
    `,
    "level1/level2.ts": `
      import { level3 } from "./level2/level3.ts";
      export const level2 = level3 + " -> level2";
      export const level1 = level2 + " -> level1";
    `,
    "level1/level2": {},
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  await Bun.sleep(200);

  fs.writeFileSync(join(String(dir), "level1", "level2", "level3.ts"), `export const level3 = "level3";`);

  const successPath = join(String(dir), "success.txt");
  let attempts = 0;
  while (!fs.existsSync(successPath) && attempts < 100) {
    await Bun.sleep(50);
    attempts++;
  }

  proc.kill();

  expect(fs.existsSync(successPath)).toBe(true);
  const successContent = fs.readFileSync(successPath, "utf-8");
  expect(successContent).toContain("RESULT: level3 -> level2 -> level1");
});

test("watch mode should handle top-level await dynamic imports", async () => {
  using dir = tempDir("watch-tla-missing", {
    "index.ts": `
      const { data } = await import("./data.ts");
      Bun.write("success.txt", "TLA: " + data);
    `,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  await Bun.sleep(200);

  fs.writeFileSync(join(String(dir), "data.ts"), `export const data = "from TLA";\n`);

  const successPath = join(String(dir), "success.txt");
  let attempts = 0;
  while (!fs.existsSync(successPath) && attempts < 100) {
    await Bun.sleep(50);
    attempts++;
  }

  proc.kill();

  expect(fs.existsSync(successPath)).toBe(true);
  const successContent = fs.readFileSync(successPath, "utf-8");
  expect(successContent).toContain("TLA: from TLA");
});
