import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("--cpu-prof", () => {
  test("generates CPU profile with default name", async () => {
    using dir = tempDir("cpu-prof", {
      "test.js": `
        // Simple CPU-intensive task
        function fibonacci(n) {
          if (n <= 1) return n;
          return fibonacci(n - 1) + fibonacci(n - 2);
        }

        console.log(fibonacci(20));
      `,
    });

    const { exitCode } = await Bun.spawn({
      cmd: [bunExe(), "--cpu-prof", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    }).exited;

    expect(exitCode).toBe(0);

    // Check that a .cpuprofile file was created
    const files = readdirSync(String(dir));
    const profileFiles = files.filter(f => f.endsWith(".cpuprofile"));

    expect(profileFiles.length).toBeGreaterThan(0);

    // Read and validate the profile
    const profilePath = join(String(dir), profileFiles[0]);
    const profileContent = readFileSync(profilePath, "utf-8");
    const profile = JSON.parse(profileContent);

    // Validate Chrome CPU Profiler format
    expect(profile).toHaveProperty("nodes");
    expect(profile).toHaveProperty("startTime");
    expect(profile).toHaveProperty("endTime");
    expect(profile).toHaveProperty("samples");
    expect(profile).toHaveProperty("timeDeltas");

    expect(Array.isArray(profile.nodes)).toBe(true);
    expect(Array.isArray(profile.samples)).toBe(true);
    expect(Array.isArray(profile.timeDeltas)).toBe(true);

    // Validate root node
    expect(profile.nodes.length).toBeGreaterThan(0);
    const rootNode = profile.nodes[0];
    expect(rootNode.id).toBe(1);
    expect(rootNode.callFrame.functionName).toBe("(root)");

    // Validate node structure
    profile.nodes.forEach((node: any) => {
      expect(node).toHaveProperty("id");
      expect(node).toHaveProperty("callFrame");
      expect(node).toHaveProperty("hitCount");
      expect(node.callFrame).toHaveProperty("functionName");
      expect(node.callFrame).toHaveProperty("scriptId");
      expect(node.callFrame).toHaveProperty("url");
      expect(node.callFrame).toHaveProperty("lineNumber");
      expect(node.callFrame).toHaveProperty("columnNumber");
    });

    // Validate samples point to valid nodes
    const nodeIds = new Set(profile.nodes.map((n: any) => n.id));
    profile.samples.forEach((sample: number) => {
      expect(nodeIds.has(sample)).toBe(true);
    });

    // Validate time deltas
    expect(profile.timeDeltas.length).toBe(profile.samples.length);
    expect(profile.startTime).toBeLessThan(profile.endTime);
  });

  test("--cpu-prof-name sets custom filename", async () => {
    using dir = tempDir("cpu-prof-name", {
      "test.js": `console.log("test");`,
    });

    const customName = "my-profile.cpuprofile";

    const { exitCode } = await Bun.spawn({
      cmd: [bunExe(), "--cpu-prof", "--cpu-prof-name", customName, "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    }).exited;

    expect(exitCode).toBe(0);

    const files = readdirSync(String(dir));
    expect(files).toContain(customName);
  });

  test("--cpu-prof-dir sets custom directory", async () => {
    using dir = tempDir("cpu-prof-dir", {
      "test.js": `console.log("test");`,
      "profiles": {},
    });

    const { exitCode } = await Bun.spawn({
      cmd: [bunExe(), "--cpu-prof", "--cpu-prof-dir", "profiles", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    }).exited;

    expect(exitCode).toBe(0);

    const profilesDir = join(String(dir), "profiles");
    const files = readdirSync(profilesDir);
    const profileFiles = files.filter(f => f.endsWith(".cpuprofile"));

    expect(profileFiles.length).toBeGreaterThan(0);
  });

  test("profile captures function names", async () => {
    using dir = tempDir("cpu-prof-functions", {
      "test.js": `
        function myFunction() {
          let sum = 0;
          for (let i = 0; i < 1000000; i++) {
            sum += i;
          }
          return sum;
        }

        myFunction();
      `,
    });

    const { exitCode } = await Bun.spawn({
      cmd: [bunExe(), "--cpu-prof", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    }).exited;

    expect(exitCode).toBe(0);

    const files = readdirSync(String(dir));
    const profileFiles = files.filter(f => f.endsWith(".cpuprofile"));
    const profilePath = join(String(dir), profileFiles[0]);
    const profile = JSON.parse(readFileSync(profilePath, "utf-8"));

    // Check that we captured some meaningful function names
    const functionNames = profile.nodes.map((n: any) => n.callFrame.functionName);
    expect(functionNames.some((name: string) => name !== "(root)" && name !== "(program)")).toBe(true);
  });
});
