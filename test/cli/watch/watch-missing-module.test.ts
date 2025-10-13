import { expect, test } from "bun:test";
import * as fs from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("watch mode should poll and reload when a missing required file is created", async () => {
  using dir = tempDir("watch-missing-module", {
    "file1.ts": `
      try {
        const { message } = await import("./file2.ts");
        await Bun.write("success.txt", "SUCCESS: " + message);
      } catch (e) {
        await Bun.write("error.txt", "ERROR: " + e.message);
        throw e;
      }
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

  // Wait for error.txt to be created
  const errorPath = join(String(dir), "error.txt");
  while (!fs.existsSync(errorPath)) {
    await Bun.sleep(10);
  }

  const errorContent = fs.readFileSync(errorPath, "utf-8");
  expect(errorContent).toContain("ERROR:");

  // Now create the missing file
  fs.writeFileSync(join(String(dir), "file2.ts"), `export const message = "Hello from file2!";\n`);

  // Wait for success.txt to be created (polling should detect file and reload)
  const successPath = join(String(dir), "success.txt");
  let attempts = 0;
  while (!fs.existsSync(successPath) && attempts < 200) {
    await Bun.sleep(10);
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
      try {
        const { data } = await import("./lib/helper.ts");
        await Bun.write("success.txt", "LOADED: " + data);
      } catch (e) {
        await Bun.write("error.txt", "ERROR: " + e.message);
        throw e;
      }
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

  const errorPath = join(String(dir), "error.txt");
  while (!fs.existsSync(errorPath)) {
    await Bun.sleep(10);
  }

  fs.mkdirSync(join(String(dir), "lib"), { recursive: true });
  fs.writeFileSync(join(String(dir), "lib", "helper.ts"), `export const data = 42;\n`);

  const successPath = join(String(dir), "success.txt");
  let attempts = 0;
  while (!fs.existsSync(successPath) && attempts < 200) {
    await Bun.sleep(10);
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
      try {
        const { level1 } = await import("./level1/level2.ts");
        await Bun.write("success.txt", "RESULT: " + level1);
      } catch (e) {
        await Bun.write("error.txt", "ERROR: " + e.message);
        throw e;
      }
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

  const errorPath = join(String(dir), "error.txt");
  while (!fs.existsSync(errorPath)) {
    await Bun.sleep(10);
  }

  fs.writeFileSync(join(String(dir), "level1", "level2", "level3.ts"), `export const level3 = "level3";`);

  const successPath = join(String(dir), "success.txt");
  let attempts = 0;
  while (!fs.existsSync(successPath) && attempts < 200) {
    await Bun.sleep(10);
    attempts++;
  }

  proc.kill();

  expect(fs.existsSync(successPath)).toBe(true);
  const successContent = fs.readFileSync(successPath, "utf-8");
  expect(successContent).toContain("RESULT: level3 -> level2 -> level1");
});

test("watch mode should handle absolute path imports that don't exist", async () => {
  using dir = tempDir("watch-absolute-missing", {});

  const absolutePath = join(String(dir), "absolute.ts");

  fs.writeFileSync(
    join(String(dir), "index.ts"),
    `
      try {
        const { data } = await import("${absolutePath}");
        await Bun.write("success.txt", data);
      } catch (e) {
        await Bun.write("error.txt", "ERROR: " + e.message);
        throw e;
      }
    `,
  );

  const proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const errorPath = join(String(dir), "error.txt");
  while (!fs.existsSync(errorPath)) {
    await Bun.sleep(10);
  }

  fs.writeFileSync(absolutePath, `export const data = "absolute import works";`);

  const successPath = join(String(dir), "success.txt");
  let attempts = 0;
  while (!fs.existsSync(successPath) && attempts < 200) {
    await Bun.sleep(10);
    attempts++;
  }

  proc.kill();

  expect(fs.existsSync(successPath)).toBe(true);
  const successContent = fs.readFileSync(successPath, "utf-8");
  expect(successContent).toContain("absolute import works");
});

test("watch mode should handle missing CSS imports", async () => {
  using dir = tempDir("watch-css-missing", {
    "index.ts": `
      try {
        await import("./styles.css");
        await Bun.write("success.txt", "CSS imported");
      } catch (e) {
        await Bun.write("error.txt", "ERROR: " + e.message);
        throw e;
      }
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

  const errorPath = join(String(dir), "error.txt");
  while (!fs.existsSync(errorPath)) {
    await Bun.sleep(10);
  }

  fs.writeFileSync(join(String(dir), "styles.css"), `body { color: red; }`);

  const successPath = join(String(dir), "success.txt");
  let attempts = 0;
  while (!fs.existsSync(successPath) && attempts < 200) {
    await Bun.sleep(10);
    attempts++;
  }

  proc.kill();

  expect(fs.existsSync(successPath)).toBe(true);
  const successContent = fs.readFileSync(successPath, "utf-8");
  expect(successContent).toContain("CSS imported");
});

test("watch mode should handle missing JSON imports", async () => {
  using dir = tempDir("watch-json-missing", {
    "index.ts": `
      try {
        const data = await import("./data.json");
        await Bun.write("success.txt", data.default.message);
      } catch (e) {
        await Bun.write("error.txt", "ERROR: " + e.message);
        throw e;
      }
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

  const errorPath = join(String(dir), "error.txt");
  while (!fs.existsSync(errorPath)) {
    await Bun.sleep(10);
  }

  fs.writeFileSync(join(String(dir), "data.json"), JSON.stringify({ message: "hello from JSON" }));

  const successPath = join(String(dir), "success.txt");
  let attempts = 0;
  while (!fs.existsSync(successPath) && attempts < 200) {
    await Bun.sleep(10);
    attempts++;
  }

  proc.kill();

  expect(fs.existsSync(successPath)).toBe(true);
  const successContent = fs.readFileSync(successPath, "utf-8");
  expect(successContent).toContain("hello from JSON");
});
