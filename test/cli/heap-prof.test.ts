import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("--heap-prof generates V8 heap snapshot on exit", async () => {
  using dir = tempDir("heap-prof-v8-test", {
    "index.js": `
      const arr = [];
      for (let i = 0; i < 100; i++) {
        arr.push({ x: i, y: "hello" + i });
      }
      console.log("done");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof", "index.js"],
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

test("--heap-prof-text generates markdown heap profile on exit", async () => {
  using dir = tempDir("heap-prof-text-test", {
    "index.js": `
      const arr = [];
      for (let i = 0; i < 100; i++) {
        arr.push({ x: i, y: "hello" + i });
      }
      console.log("done");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof-text", "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("done");
  expect(stderr).toContain("Heap profile written to:");
  expect(exitCode).toBe(0);

  // Find the heap profile file (text format)
  const glob = new Bun.Glob("Heap.*.heapprof");
  const files = Array.from(glob.scanSync({ cwd: String(dir) }));
  expect(files.length).toBeGreaterThan(0);

  // Read and validate the heap profile content
  const profilePath = join(String(dir), files[0]);
  const content = await Bun.file(profilePath).text();

  // Check for markdown headers
  expect(content).toContain("# Bun Heap Profile");
  expect(content).toContain("## Summary");
  expect(content).toContain("## Top Types by Retained Size");
  expect(content).toContain("## Largest Objects");
  expect(content).toContain("## All Nodes");
  expect(content).toContain("## All Edges");
  expect(content).toContain("## GC Roots");
  expect(content).toContain("## Type Summary");

  // Check for summary bullet list
  expect(content).toContain("**Total Heap Size:**");
  expect(content).toContain("**Total Objects:**");
  expect(content).toContain("**Unique Types:**");
  expect(content).toContain("**GC Roots:**");

  // Check for table structure in types section
  expect(content).toContain("| # | Type | Count |");

  // Check for grep-friendly NODE format
  expect(content).toMatch(/NODE id=\d+ type=\S+ size=\d+ retained=\d+/);

  // Check for grep-friendly EDGE format
  expect(content).toMatch(/EDGE from=\d+ to=\d+ type=\S+/);

  // Check for grep-friendly TYPE format
  expect(content).toMatch(/TYPE name=".+" count=\d+ self=\d+ retained=\d+/);
});

test("--heap-prof-dir specifies output directory for V8 format", async () => {
  using dir = tempDir("heap-prof-dir-test", {
    "index.js": `console.log("hello");`,
    "profiles": {},
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof", "--heap-prof-dir", "profiles", "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(stderr).toContain("Heap profile written to:");
  expect(stderr).toContain("profiles/");
  expect(exitCode).toBe(0);

  // Check the profile is in the specified directory
  const glob = new Bun.Glob("Heap.*.heapsnapshot");
  const files = Array.from(glob.scanSync({ cwd: join(String(dir), "profiles") }));
  expect(files.length).toBeGreaterThan(0);
});

test("--heap-prof-dir specifies output directory for text format", async () => {
  using dir = tempDir("heap-prof-text-dir-test", {
    "index.js": `console.log("hello");`,
    "profiles": {},
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof-text", "--heap-prof-dir", "profiles", "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(stderr).toContain("Heap profile written to:");
  expect(stderr).toContain("profiles/");
  expect(exitCode).toBe(0);

  // Check the profile is in the specified directory
  const glob = new Bun.Glob("Heap.*.heapprof");
  const files = Array.from(glob.scanSync({ cwd: join(String(dir), "profiles") }));
  expect(files.length).toBeGreaterThan(0);
});

test("--heap-prof-name specifies output filename", async () => {
  using dir = tempDir("heap-prof-name-test", {
    "index.js": `console.log("hello");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof", "--heap-prof-name", "my-profile.heapsnapshot", "index.js"],
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
    "index.js": `console.log("hello");`,
    "output": {},
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof", "--heap-prof-dir", "output", "--heap-prof-name", "custom.heapsnapshot", "index.js"],
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

test("--heap-prof-name without --heap-prof or --heap-prof-text shows warning", async () => {
  using dir = tempDir("heap-prof-warn-test", {
    "index.js": `console.log("hello");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof-name", "test.heapsnapshot", "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(stderr).toContain("--heap-prof-name requires --heap-prof or --heap-prof-text to be enabled");
  expect(exitCode).toBe(0);

  // No profile should be generated
  const glob = new Bun.Glob("*.heap*");
  const files = Array.from(glob.scanSync({ cwd: String(dir) }));
  expect(files.length).toBe(0);
});
