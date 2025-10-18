import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("import attributes should create separate module cache entries - json vs text", async () => {
  using dir = tempDir("import-attrs-cache", {
    "data.json": JSON.stringify({ test: 123 }),
    "test.ts": `
      import json from "./data.json";
      import text from "./data.json" with { type: "text" };

      console.log("JSON type:", typeof json);
      console.log("JSON value:", JSON.stringify(json));
      console.log("Text type:", typeof text);
      console.log("Text value:", text);
      console.log("Different?:", json !== text);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);

  // Verify the json import returns an object
  expect(stdout).toContain("JSON type: object");
  expect(stdout).toContain('"test":123');

  // Verify the text import returns a string
  expect(stdout).toContain("Text type: string");

  // Verify they are different values
  expect(stdout).toContain("Different?: true");
});

test("import attributes should create separate module cache entries - dynamic imports", async () => {
  using dir = tempDir("import-attrs-dynamic", {
    "data.json": JSON.stringify({ dynamic: 456 }),
    "test.ts": `
      (async () => {
        const json = await import("./data.json");
        const text = await import("./data.json", { with: { type: "text" } });

        console.log("JSON default:", typeof json.default);
        console.log("JSON value:", JSON.stringify(json.default));
        console.log("Text default:", typeof text.default);
        console.log("Different?:", json.default !== text.default);
      })();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);

  // Verify the json import returns an object
  expect(stdout).toContain("JSON default: object");
  expect(stdout).toContain('"dynamic":456');

  // Verify the text import returns a string
  expect(stdout).toContain("Text default: string");

  // Verify they are different values
  expect(stdout).toContain("Different?: true");
});

test("import attributes should work in bundler - multiple loaders for same file", async () => {
  using dir = tempDir("import-attrs-bundle", {
    "data.json": JSON.stringify({ bundled: 789 }),
    "entry.ts": `
      import jsonData from "./data.json";
      import textData from "./data.json" with { type: "text" };

      export const json = jsonData;
      export const text = textData;
      export const different = jsonData !== textData;
    `,
  });

  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.ts", "--outfile=out.js", "--format=esm"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildStderr).not.toContain("error");
  expect(buildExitCode).toBe(0);

  // Now run the bundled output
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [runStdout, runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  expect(runStderr).not.toContain("error");
  expect(runExitCode).toBe(0);

  // Read the bundled output to verify both versions are included
  const bundledCode = await Bun.file(String(dir) + "/out.js").text();

  // Should contain the parsed JSON object
  expect(bundledCode).toMatch(/bundled.*789/);

  // Should also contain the raw text version
  expect(bundledCode).toContain('"bundled":789');
});

test("same file with no attributes vs with attributes should be different", async () => {
  using dir = tempDir("import-attrs-default", {
    "data.json": JSON.stringify({ value: "test" }),
    "test.ts": `
      // Default import (should use .json loader based on extension)
      import defaultImport from "./data.json";

      // Explicit text import
      import textImport from "./data.json" with { type: "text" };

      console.log("Default type:", typeof defaultImport);
      console.log("Text type:", typeof textImport);
      console.log("Are different?:", defaultImport !== textImport);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);

  // Default should be object (parsed JSON)
  expect(stdout).toContain("Default type: object");

  // Explicit text should be string
  expect(stdout).toContain("Text type: string");

  // They should be different
  expect(stdout).toContain("Are different?: true");
});
