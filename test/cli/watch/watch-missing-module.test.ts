import { expect, test } from "bun:test";
import * as fs from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("watch mode should poll and reload when a missing required file is created", async () => {
  using dir = tempDir("watch-missing-module", {
    "file1.ts": `
      import { message } from "./file2.ts";
      console.log("SUCCESS:", message);
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

  // Wait for initial error, then create the missing file
  const decoder = new TextDecoder();
  let output = "";

  for await (const chunk of proc.stderr) {
    output += decoder.decode(chunk);
    if (output.includes("Module not found") || output.includes("Cannot find module")) {
      // Now create the missing file
      fs.writeFileSync(join(String(dir), "file2.ts"), `export const message = "Hello from file2!";\n`);
      break;
    }
  }

  // Now read stdout for success
  for await (const chunk of proc.stdout) {
    output += decoder.decode(chunk);
    if (output.includes("SUCCESS: Hello from file2!")) {
      proc.kill();
      break;
    }
  }

  expect(output).toContain("SUCCESS: Hello from file2!");
});

test("watch mode should handle relative path imports that don't exist", async () => {
  using dir = tempDir("watch-missing-relative", {
    "index.ts": `
      import { data } from "./lib/helper.ts";
      console.log("LOADED:", data);
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

  const decoder = new TextDecoder();
  let output = "";

  for await (const chunk of proc.stderr) {
    output += decoder.decode(chunk);
    if (output.includes("Module not found") || output.includes("Cannot find module")) {
      fs.mkdirSync(join(String(dir), "lib"), { recursive: true });
      fs.writeFileSync(join(String(dir), "lib", "helper.ts"), `export const data = 42;\n`);
      break;
    }
  }

  for await (const chunk of proc.stdout) {
    output += decoder.decode(chunk);
    if (output.includes("LOADED: 42")) {
      proc.kill();
      break;
    }
  }

  expect(output).toContain("LOADED: 42");
});

test("watch mode should handle deeply nested missing imports", async () => {
  using dir = tempDir("watch-nested-missing", {
    "index.ts": `
      import { level1 } from "./level1/level2.ts";
      console.log("RESULT:", level1);
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

  const decoder = new TextDecoder();
  let output = "";

  for await (const chunk of proc.stderr) {
    output += decoder.decode(chunk);
    if (output.includes("Module not found") || output.includes("Cannot find module")) {
      fs.writeFileSync(join(String(dir), "level1", "level2", "level3.ts"), `export const level3 = "level3";`);
      break;
    }
  }

  for await (const chunk of proc.stdout) {
    output += decoder.decode(chunk);
    if (output.includes("RESULT: level3 -> level2 -> level1")) {
      proc.kill();
      break;
    }
  }

  expect(output).toContain("RESULT: level3 -> level2 -> level1");
});

test("watch mode should handle absolute path imports that don't exist", async () => {
  using dir = tempDir("watch-absolute-missing", {});

  const absolutePath = join(String(dir), "absolute.ts");

  fs.writeFileSync(join(String(dir), "index.ts"), `import { data } from "${absolutePath}";\nconsole.log(data);\n`);

  const proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const decoder = new TextDecoder();
  let output = "";

  for await (const chunk of proc.stderr) {
    output += decoder.decode(chunk);
    if (output.includes("Module not found") || output.includes("Cannot find module")) {
      fs.writeFileSync(absolutePath, `export const data = "absolute import works";`);
      break;
    }
  }

  for await (const chunk of proc.stdout) {
    output += decoder.decode(chunk);
    if (output.includes("absolute import works")) {
      proc.kill();
      break;
    }
  }

  expect(output).toContain("absolute import works");
});

test("watch mode should handle missing CSS imports", async () => {
  using dir = tempDir("watch-css-missing", {
    "index.ts": `
      import "./styles.css";
      console.log("CSS imported");
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

  const decoder = new TextDecoder();
  let output = "";

  for await (const chunk of proc.stderr) {
    output += decoder.decode(chunk);
    if (output.includes("Module not found") || output.includes("Cannot find module")) {
      fs.writeFileSync(join(String(dir), "styles.css"), `body { color: red; }`);
      break;
    }
  }

  for await (const chunk of proc.stdout) {
    output += decoder.decode(chunk);
    if (output.includes("CSS imported")) {
      proc.kill();
      break;
    }
  }

  expect(output).toContain("CSS imported");
});

test("watch mode should handle missing JSON imports", async () => {
  using dir = tempDir("watch-json-missing", {
    "index.ts": `
      import data from "./data.json";
      console.log(data.message);
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

  const decoder = new TextDecoder();
  let output = "";

  for await (const chunk of proc.stderr) {
    output += decoder.decode(chunk);
    if (output.includes("Module not found") || output.includes("Cannot find module")) {
      fs.writeFileSync(join(String(dir), "data.json"), JSON.stringify({ message: "hello from JSON" }));
      break;
    }
  }

  for await (const chunk of proc.stdout) {
    output += decoder.decode(chunk);
    if (output.includes("hello from JSON")) {
      proc.kill();
      break;
    }
  }

  expect(output).toContain("hello from JSON");
});
