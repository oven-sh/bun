import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const testScript = `const arr = []; for (let i = 0; i < 100; i++) arr.push({ x: i, y: "hello" + i }); console.log("done");`;

// Node's DiagnosticFilename format: Heap.<yyyymmdd>.<hhmmss>.<pid>.<tid>.<seq>.heapprofile
const nodeFilenameRe = /^Heap\.\d{8}\.\d{6}\.\d+\.0\.\d{3}\.heapprofile$/;

async function readProfile(dir: string, file: string) {
  const content = await Bun.file(join(dir, file)).text();
  return JSON.parse(content);
}

function expectV8SamplingProfileShape(profile: any) {
  // V8 sampling heap profile: { head: { callFrame, selfSize, id, children }, samples }
  expect(profile).toHaveProperty("head");
  expect(profile).toHaveProperty("samples");
  expect(profile.head.callFrame).toEqual({
    functionName: "(root)",
    scriptId: "0",
    url: "",
    lineNumber: -1,
    columnNumber: -1,
  });
  expect(typeof profile.head.selfSize).toBe("number");
  expect(Array.isArray(profile.head.children)).toBe(true);
  expect(Array.isArray(profile.samples)).toBe(true);
}

test("--heap-prof writes a .heapprofile with node's filename format on exit", async () => {
  using dir = tempDir("heap-prof-v8-test", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof", "-e", testScript],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("done");
  expect(exitCode).toBe(0);

  const glob = new Bun.Glob("*.heapprofile");
  const files = Array.from(glob.scanSync({ cwd: String(dir) }));
  expect(files.length).toBe(1);
  expect(files[0]).toMatch(nodeFilenameRe);

  const profile = await readProfile(String(dir), files[0]);
  expectV8SamplingProfileShape(profile);
  // The live-heap size is real, so it is never zero.
  expect(profile.head.selfSize).toBeGreaterThan(0);
});

test("--heap-prof writes the profile when the script calls process.exit", async () => {
  using dir = tempDir("heap-prof-exit-test", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof", "-e", `process.exit(55);`],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode).toBe(55);

  const glob = new Bun.Glob("*.heapprofile");
  const files = Array.from(glob.scanSync({ cwd: String(dir) }));
  expect(files.length).toBe(1);
  const profile = await readProfile(String(dir), files[0]);
  expectV8SamplingProfileShape(profile);
});

test.skipIf(process.platform === "win32")(
  "--heap-prof writes the profile on a self-directed SIGINT with no JS handler",
  async () => {
    using dir = tempDir("heap-prof-sigint-test", {});

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--heap-prof", "-e", `process.kill(process.pid, "SIGINT");`],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(proc.signalCode).toBe("SIGINT");
    expect(exitCode).not.toBe(0);

    const glob = new Bun.Glob("*.heapprofile");
    const files = Array.from(glob.scanSync({ cwd: String(dir) }));
    expect(files.length).toBe(1);
    const profile = await readProfile(String(dir), files[0]);
    expectV8SamplingProfileShape(profile);
  },
);

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

test("--heap-prof-dir specifies the output directory", async () => {
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

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(exitCode).toBe(0);

  const glob = new Bun.Glob("*.heapprofile");
  const files = Array.from(glob.scanSync({ cwd: join(String(dir), "profiles") }));
  expect(files.length).toBe(1);
  expect(files[0]).toMatch(nodeFilenameRe);
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
    cmd: [bunExe(), "--heap-prof", "--heap-prof-name", "my-profile.heapprofile", "-e", `console.log("hello");`],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(exitCode).toBe(0);

  const profile = await readProfile(String(dir), "my-profile.heapprofile");
  expectV8SamplingProfileShape(profile);
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
      "custom.heapprofile",
      "-e",
      `console.log("hello");`,
    ],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(exitCode).toBe(0);

  const profile = await readProfile(join(String(dir), "output"), "custom.heapprofile");
  expectV8SamplingProfileShape(profile);
});

// Node parity: heap-profiler-scoped flags without --heap-prof exit 9 with
// "<execPath>: <flag> must be used with --heap-prof" on stderr.
for (const [flag, value] of [
  ["--heap-prof-name", "test.heapprofile"],
  ["--heap-prof-dir", "prof"],
  ["--heap-prof-interval", "128"],
] as const) {
  test(`${flag} without --heap-prof exits 9 with node's message`, async () => {
    using dir = tempDir("heap-prof-invalid-test", {});

    await using proc = Bun.spawn({
      cmd: [bunExe(), flag, value, "-e", `console.log("hello");`],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr.trim()).toBe(`${bunExe()}: ${flag} must be used with --heap-prof`);
    expect(exitCode).toBe(9);

    // No profile should be generated
    const glob = new Bun.Glob("*.heap*");
    const files = Array.from(glob.scanSync({ cwd: String(dir) }));
    expect(files.length).toBe(0);
  });
}

test("--heap-prof-interval equal to the default is a noop without --heap-prof, like node", async () => {
  using dir = tempDir("heap-prof-interval-noop-test", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof-interval", "524288", "-e", `console.log("hello");`],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(exitCode).toBe(0);
});

test("--heap-prof --heap-prof-interval is accepted", async () => {
  using dir = tempDir("heap-prof-interval-test", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof", "--heap-prof-interval", "128", "-e", `console.log("hello");`],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(exitCode).toBe(0);

  const glob = new Bun.Glob("*.heapprofile");
  const files = Array.from(glob.scanSync({ cwd: String(dir) }));
  expect(files.length).toBe(1);
});
