import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const testScript = `const arr = []; for (let i = 0; i < 100; i++) arr.push({ x: i, y: "hello" + i }); console.log("done");`;

test("--heap-prof generates V8 heap snapshot on exit", async () => {
  using dir = tempDir("heap-prof-v8-test", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof", "-e", testScript],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("done");
  expect(stderr).toContain("Heap profile written to:");
  expect(exitCode).toBe(0);

  // Find the heap snapshot file (V8 format)
  const glob = new Bun.Glob("Heap.*.heapsnapshot");
  const files = Array.from(glob.scanSync({ cwd: String(dir) }));
  expect(files.length).toBeGreaterThan(0);

  // Read and validate the heap snapshot content (should be valid JSON in V8 format)
  const profilePath = join(String(dir), files[0]);
  const content = await Bun.file(profilePath).text();

  // V8 heap snapshot format is JSON with specific structure
  const snapshot = JSON.parse(content);
  expect(snapshot).toHaveProperty("snapshot");
  expect(snapshot).toHaveProperty("nodes");
  expect(snapshot).toHaveProperty("edges");
  expect(snapshot).toHaveProperty("strings");
});

test("--heap-prof-md generates markdown heap profile on exit", async () => {
  using dir = tempDir("heap-prof-md-test", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof-md", "-e", testScript],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("done");
  expect(stderr).toContain("Heap profile written to:");
  expect(exitCode).toBe(0);

  // Find the heap profile file (markdown format)
  const glob = new Bun.Glob("Heap.*.md");
  const files = Array.from(glob.scanSync({ cwd: String(dir) }));
  expect(files.length).toBeGreaterThan(0);

  // Read and validate the heap profile content
  const profilePath = join(String(dir), files[0]);
  const content = await Bun.file(profilePath).text();

  // Check for markdown headers
  expect(content).toContain("# Bun Heap Profile");
  expect(content).toContain("## Summary");
  expect(content).toContain("## Top 50 Types by Retained Size");
  expect(content).toContain("## Top 50 Largest Objects");
  expect(content).toContain("## Retainer Chains");
  expect(content).toContain("## GC Roots");

  // Check for summary table structure
  expect(content).toContain("| Metric | Value |");
  expect(content).toContain("| Total Heap Size |");
  expect(content).toContain("| Total Objects |");
  expect(content).toContain("| Unique Types |");
  expect(content).toContain("| GC Roots |");

  // Check for table structure in types section
  expect(content).toContain("| Rank | Type | Count | Self Size | Retained Size |");

  // Check for collapsible sections
  expect(content).toContain("<details>");
  expect(content).toContain("<summary>");

  // Check for All Objects table format
  expect(content).toContain("## All Objects");
  expect(content).toContain("| ID | Type | Size | Retained | Flags | Label |");

  // Check for All Edges table format
  expect(content).toContain("## All Edges");
  expect(content).toContain("| From | To | Type | Name |");

  // Check for Type Statistics table format
  expect(content).toContain("## Complete Type Statistics");
  expect(content).toContain("| Type | Count | Self Size | Retained Size | Largest ID |");
});

test("--heap-prof-dir specifies output directory for V8 format", async () => {
  using dir = tempDir("heap-prof-dir-test", {
    "profiles": {},
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof", "--heap-prof-dir", "profiles", "-e", `console.log("hello");`],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(stderr).toContain("Heap profile written to:");
  // Check for "profiles" directory in path (handles both / and \ separators)
  expect(stderr).toMatch(/profiles[/\\]/);
  expect(exitCode).toBe(0);

  // Check the profile is in the specified directory
  const glob = new Bun.Glob("Heap.*.heapsnapshot");
  const files = Array.from(glob.scanSync({ cwd: join(String(dir), "profiles") }));
  expect(files.length).toBeGreaterThan(0);
});

test("--heap-prof-dir specifies output directory for markdown format", async () => {
  using dir = tempDir("heap-prof-md-dir-test", {
    "profiles": {},
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof-md", "--heap-prof-dir", "profiles", "-e", `console.log("hello");`],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(stderr).toContain("Heap profile written to:");
  // Check for "profiles" directory in path (handles both / and \ separators)
  expect(stderr).toMatch(/profiles[/\\]/);
  expect(exitCode).toBe(0);

  // Check the profile is in the specified directory
  const glob = new Bun.Glob("Heap.*.md");
  const files = Array.from(glob.scanSync({ cwd: join(String(dir), "profiles") }));
  expect(files.length).toBeGreaterThan(0);
});

test("--heap-prof-name specifies output filename", async () => {
  using dir = tempDir("heap-prof-name-test", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof", "--heap-prof-name", "my-profile.heapsnapshot", "-e", `console.log("hello");`],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(stderr).toContain("Heap profile written to:");
  expect(stderr).toContain("my-profile.heapsnapshot");
  expect(exitCode).toBe(0);

  // Check the profile exists with the specified name
  const profilePath = join(String(dir), "my-profile.heapsnapshot");
  expect(Bun.file(profilePath).size).toBeGreaterThan(0);
});

test("--heap-prof-name and --heap-prof-dir work together", async () => {
  using dir = tempDir("heap-prof-both-test", {
    "output": {},
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--heap-prof",
      "--heap-prof-dir",
      "output",
      "--heap-prof-name",
      "custom.heapsnapshot",
      "-e",
      `console.log("hello");`,
    ],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(stderr).toContain("Heap profile written to:");
  expect(exitCode).toBe(0);

  // Check the profile exists in the specified location
  const profilePath = join(String(dir), "output", "custom.heapsnapshot");
  expect(Bun.file(profilePath).size).toBeGreaterThan(0);
});

test("--heap-prof-name without --heap-prof or --heap-prof-md shows warning", async () => {
  using dir = tempDir("heap-prof-warn-test", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof-name", "test.heapsnapshot", "-e", `console.log("hello");`],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(stderr).toContain("--heap-prof-name requires --heap-prof or --heap-prof-md to be enabled");
  expect(exitCode).toBe(0);

  // No profile should be generated
  const glob = new Bun.Glob("*.heap*");
  const files = Array.from(glob.scanSync({ cwd: String(dir) }));
  expect(files.length).toBe(0);
});
