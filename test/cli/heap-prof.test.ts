import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";

const testScript = `const arr = []; for (let i = 0; i < 100; i++) arr.push({ x: i, y: "hello" + i }); console.log("done");`;

// Node's DiagnosticFilename format: Heap.<yyyymmdd>.<hhmmss>.<pid>.<tid>.<seq>.heapprofile
const nodeFilenameRe = /^Heap\.\d{8}\.\d{6}\.\d+\.0\.\d{3}\.heapprofile$/;

async function readProfile(dir: string, file: string) {
  const content = await Bun.file(join(dir, file)).text();
  return JSON.parse(content);
}

function expectV8HeapSnapshotShape(profile: any) {
  // V8 heap snapshot: { snapshot: { meta, node_count, edge_count }, nodes, edges, strings }
  expect(profile).toHaveProperty("snapshot");
  expect(profile.snapshot).toHaveProperty("meta");
  expect(typeof profile.snapshot.node_count).toBe("number");
  expect(profile.snapshot.node_count).toBeGreaterThan(0);
  expect(Array.isArray(profile.nodes)).toBe(true);
  expect(Array.isArray(profile.edges)).toBe(true);
  expect(Array.isArray(profile.strings)).toBe(true);
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
  expectV8HeapSnapshotShape(profile);
  // The snapshot is real, so it always carries node data.
  expect(profile.nodes.length).toBeGreaterThan(0);
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
  expectV8HeapSnapshotShape(profile);
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
    expectV8HeapSnapshotShape(profile);
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
  expectV8HeapSnapshotShape(profile);
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
  expectV8HeapSnapshotShape(profile);
});

// A default-named profile takes its sequence number when the profiler starts,
// as in node, so a default-named snapshot written while the program runs gets
// a later number. The snapshots are "{}": only their names matter here.
// Sequential on a debug build: six debug children at once can exceed the 5 s of `bun bd test`.
test.concurrentIf(!isDebug).each([
  {
    flags: ["--cpu-prof"],
    snapshots: 2,
    files: ["CPU.<now>.0.001.cpuprofile", "Heap.<now>.0.002.heapsnapshot", "Heap.<now>.0.003.heapsnapshot"],
  },
  {
    flags: ["--cpu-prof", "--cpu-prof-md"],
    snapshots: 2,
    files: [
      "CPU.<now>.0.001.cpuprofile",
      "CPU.<now>.0.002.md",
      "Heap.<now>.0.003.heapsnapshot",
      "Heap.<now>.0.004.heapsnapshot",
    ],
  },
  {
    flags: ["--heap-prof"],
    snapshots: 2,
    files: ["Heap.<now>.0.001.heapprofile", "Heap.<now>.0.002.heapsnapshot", "Heap.<now>.0.003.heapsnapshot"],
  },
  {
    flags: ["--cpu-prof", "--cpu-prof-md", "--heap-prof"],
    snapshots: 0,
    files: ["CPU.<now>.0.001.cpuprofile", "CPU.<now>.0.002.md", "Heap.<now>.0.003.heapprofile"],
  },
  {
    flags: ["--cpu-prof", "--cpu-prof-name", "cpu.cpuprofile"],
    snapshots: 2,
    files: ["Heap.<now>.0.001.heapsnapshot", "Heap.<now>.0.002.heapsnapshot", "cpu.cpuprofile"],
  },
  {
    flags: ["--heap-prof", "--heap-prof-name", "heap.heapprofile"],
    snapshots: 2,
    files: ["Heap.<now>.0.001.heapsnapshot", "Heap.<now>.0.002.heapsnapshot", "heap.heapprofile"],
  },
])("$flags numbers its profiles before $snapshots snapshots of the run", async ({ flags, snapshots, files }) => {
  using dir = tempDir("heap-prof-sequence-test", {});

  const before = Date.now();
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      ...flags,
      "-e",
      `Bun.generateHeapSnapshot = () => "{}";
       const v8 = require("node:v8");
       for (let i = 0; i < ${snapshots}; i++) v8.writeHeapSnapshot();`,
    ],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const after = Date.now();

  // `<yyyymmdd>.<hhmmss>.<pid>` in a name becomes `<now>` when it is a second of this run. The
  // child runs in UTC. On Windows a profile is stamped by GetLocalTime, which does not read TZ,
  // so there the date only has to be within a day of this run.
  const utc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", ".").replace(/[-:]/g, "");
  const seconds: string[] = [];
  for (let ms = before - (before % 1000); ms <= after; ms += 1000) seconds.push(utc(ms));
  const days = [before - 86_400_000, before, after, after + 86_400_000].map(ms => utc(ms).slice(0, 8));
  const sinceSpawn = (name: string) =>
    name.replace(/\.(\d{8})\.(\d{6})\.\d+\./, (stamp, day, time) =>
      seconds.includes(`${day}.${time}`) || (isWindows && days.includes(day)) ? ".<now>." : stamp,
    );

  expect({
    stdout,
    stderr,
    files: Array.from(new Bun.Glob("*").scanSync({ cwd: String(dir) }))
      .map(sinceSpawn)
      .sort(),
    exitCode,
  }).toEqual({ stdout: "", stderr: "", files: [...files], exitCode: 0 });
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

// On Windows the path buffer is ~98 KB and the CreateProcess command-line
// limit is ~32 KB, so an overflowing CLI argument cannot be delivered. On
// POSIX 5000 bytes exceeds the fixed path buffer (Linux 4096, macOS 1024);
// 2500 + 2500 exercises the combined bound with components that fit
// individually on Linux.
test.skipIf(isWindows).each([
  ["--heap-prof-dir", ["--heap-prof-dir", Buffer.alloc(5000, "d").toString()]],
  ["--heap-prof-name", ["--heap-prof-name", Buffer.alloc(5000, "n").toString()]],
  [
    "--heap-prof-dir + --heap-prof-name combined",
    ["--heap-prof-dir", Buffer.alloc(2500, "d").toString(), "--heap-prof-name", Buffer.alloc(2500, "n").toString()],
  ],
] as const)("%s longer than PATH_MAX reports an error instead of panicking", async (_label, args) => {
  using dir = tempDir("heap-prof-pathmax", {});

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--heap-prof", ...args, "-e", `console.log("done");`],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("done");
  expect(stderr).toContain("MaxPathExceeded");
  expect(stderr).toContain("Failed to write heap profile");
  expect(exitCode).toBe(0);
  expect(proc.signalCode).toBeNull();
});

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
