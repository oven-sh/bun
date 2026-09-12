import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// Every workload below is time-bounded for 100ms. On Windows JSC's
// SamplingProfiler effectively ticks at the ~15.6ms default timer quantum, and
// the entry module evaluates via an async fetch/link/evaluate chain — so
// shorter windows (the previous 32/50ms) can elapse before a single sample is
// taken, leaving "No samples collected." in --cpu-prof-md output.
describe.concurrent("--cpu-prof", () => {
  test("generates CPU profile with default name", async () => {
    using dir = tempDir("cpu-prof", {
      "test.js": `
        // CPU-intensive task
        function fibonacci(n) {
          if (n <= 1) return n;
          return fibonacci(n - 1) + fibonacci(n - 2);
        }

        const now = performance.now();
        while (now + 100 > performance.now()) {
            Bun.inspect(fibonacci(20));
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--cpu-prof", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;

    // Check that a .cpuprofile file was created
    const files = readdirSync(String(dir));
    const profileFiles = files.filter(f => f.endsWith(".cpuprofile"));

    expect(profileFiles.length).toBeGreaterThan(0);
    expect(exitCode).toBe(0);

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
    // For very fast programs, start and end times might be equal or very close
    expect(profile.startTime).toBeLessThanOrEqual(profile.endTime);

    // CRITICAL: Validate timestamps are positive and in microseconds
    // Chrome DevTools requires timestamps in microseconds since Unix epoch
    // A valid timestamp should be > 1000000000000000 (around year 2001)
    // and < 3000000000000000 (around year 2065)
    expect(profile.startTime).toBeGreaterThan(1000000000000000);
    expect(profile.startTime).toBeLessThan(3000000000000000);
    expect(profile.endTime).toBeGreaterThan(1000000000000000);
    expect(profile.endTime).toBeLessThan(3000000000000000);
  });

  test("--cpu-prof-name sets custom filename", async () => {
    using dir = tempDir("cpu-prof-name", {
      "test.js": `
        function loop() {
          const end = Date.now() + 100;
          while (Date.now() < end) {}
        }
        loop();
      `,
    });

    const customName = "my-profile.cpuprofile";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--cpu-prof", "--cpu-prof-name", customName, "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;

    const files = readdirSync(String(dir));
    expect(files).toContain(customName);
    expect(exitCode).toBe(0);
  });

  // On Windows the path buffer is ~98 KB and the CreateProcess command-line
  // limit is ~32 KB, so an overflowing CLI argument cannot be delivered. On
  // POSIX 5000 bytes exceeds the fixed path buffer (Linux 4096, macOS 1024);
  // 2500 + 2500 exercises the combined bound with components that fit
  // individually on Linux.
  test.skipIf(isWindows).each([
    ["--cpu-prof-dir", ["--cpu-prof-dir", Buffer.alloc(5000, "d").toString()]],
    ["--cpu-prof-name", ["--cpu-prof-name", Buffer.alloc(5000, "n").toString()]],
    [
      "--cpu-prof-dir + --cpu-prof-name combined",
      ["--cpu-prof-dir", Buffer.alloc(2500, "d").toString(), "--cpu-prof-name", Buffer.alloc(2500, "n").toString()],
    ],
  ] as const)("%s longer than PATH_MAX reports an error instead of panicking", async (_label, args) => {
    using dir = tempDir("cpu-prof-pathmax", {
      "test.js": `const end = Date.now() + 60; while (Date.now() < end) {}`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--cpu-prof", ...args, "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("FilenameTooLong");
    expect(stderr).toContain("Failed to write CPU profile");
    expect(exitCode).toBe(0);
    expect(proc.signalCode).toBeNull();
  });

  test("--cpu-prof-dir sets custom directory", async () => {
    using dir = tempDir("cpu-prof-dir", {
      "test.js": `
        function loop() {
          const end = Date.now() + 100;
          while (Date.now() < end) {}
        }
        loop();
      `,
      "profiles": {},
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--cpu-prof", "--cpu-prof-dir", "profiles", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;

    const profilesDir = join(String(dir), "profiles");
    const files = readdirSync(profilesDir);
    const profileFiles = files.filter(f => f.endsWith(".cpuprofile"));

    expect(profileFiles.length).toBeGreaterThan(0);
    expect(exitCode).toBe(0);
  });

  test("profile captures function names", async () => {
    using dir = tempDir("cpu-prof-functions", {
      "test.js": `
        function myFunction() {
          let sum = 0;
          const end = performance.now() + 100;
          while (performance.now() < end) {
            for (let i = 0; i < 1000; i++) sum += i;
          }
          return sum;
        }

        myFunction();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--cpu-prof", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;

    const files = readdirSync(String(dir));
    const profileFiles = files.filter(f => f.endsWith(".cpuprofile"));
    expect(profileFiles.length).toBeGreaterThan(0);

    const profilePath = join(String(dir), profileFiles[0]);
    const profile = JSON.parse(readFileSync(profilePath, "utf-8"));

    // Check that we captured some meaningful function names
    const functionNames = profile.nodes.map((n: any) => n.callFrame.functionName);
    expect(functionNames.some((name: string) => name !== "(root)" && name !== "(program)")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("--cpu-prof-md generates markdown format profile", async () => {
    using dir = tempDir("cpu-prof-md", {
      "test.js": `
        // CPU-intensive task for text profile
        function fibonacci(n) {
          if (n <= 1) return n;
          return fibonacci(n - 1) + fibonacci(n - 2);
        }

        function main() {
          const now = performance.now();
          while (now + 100 > performance.now()) {
            Bun.inspect(fibonacci(20));
          }
        }

        main();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--cpu-prof", "--cpu-prof-md", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;

    // Check that a .md file was created (not .cpuprofile)
    const files = readdirSync(String(dir));
    const mdFiles = files.filter(f => f.endsWith(".md") && f.startsWith("CPU."));

    expect(mdFiles.length).toBeGreaterThan(0);
    expect(exitCode).toBe(0);

    // Read and validate the markdown profile format
    const profilePath = join(String(dir), mdFiles[0]);
    const profileContent = readFileSync(profilePath, "utf-8");

    // Validate the markdown format has expected sections
    expect(profileContent).toContain("# CPU Profile");
    expect(profileContent).toContain("## Hot Functions (Self Time)");
    expect(profileContent).toContain("## Call Tree (Total Time)");
    expect(profileContent).toContain("## Function Details");
    expect(profileContent).toContain("## Files");

    // Validate header contains summary info in markdown table
    expect(profileContent).toMatch(/\| Duration \| Samples \| Interval \| Functions \|/);

    // Validate function details have caller/callee info
    expect(profileContent).toContain("**Called by:**");
    expect(profileContent).toContain("**Calls:**");
  });

  test("--cpu-prof-md with custom name", async () => {
    using dir = tempDir("cpu-prof-md-name", {
      "test.js": `
        function loop() {
          const end = Date.now() + 100;
          while (Date.now() < end) {}
        }
        loop();
      `,
    });

    const customName = "my-profile.md";

    // --cpu-prof-md works standalone, no need for --cpu-prof
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--cpu-prof-md", "--cpu-prof-name", customName, "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;

    const files = readdirSync(String(dir));
    expect(files).toContain(customName);
    expect(exitCode).toBe(0);

    // Validate it's markdown format
    const profileContent = readFileSync(join(String(dir), customName), "utf-8");
    expect(profileContent).toContain("# CPU Profile");
  });

  test("--cpu-prof-md shows function details with relationships", async () => {
    using dir = tempDir("cpu-prof-md-details", {
      "test.js": `
        function workA() {
          let sum = 0;
          for (let i = 0; i < 500000; i++) sum += i;
          return sum;
        }
        function workB() {
          let sum = 0;
          for (let i = 0; i < 500000; i++) sum += i;
          return sum;
        }
        function main() {
          const now = performance.now();
          while (now + 100 > performance.now()) {
            workA();
            workB();
          }
        }
        main();
      `,
    });

    // --cpu-prof-md works standalone
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--cpu-prof-md", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    const files = readdirSync(String(dir));
    const mdFiles = files.filter(f => f.endsWith(".md") && f.startsWith("CPU."));
    expect(mdFiles.length).toBeGreaterThan(0);

    const profileContent = readFileSync(join(String(dir), mdFiles[0]), "utf-8");

    // Check markdown sections
    expect(profileContent).toMatch(/## Hot Functions \(Self Time\)/);
    expect(profileContent).toMatch(/## Call Tree \(Total Time\)/);
    expect(profileContent).toMatch(/## Function Details/);
    expect(profileContent).toMatch(/## Files/);

    // Check function detail headers (### `functionName`)
    expect(profileContent).toMatch(/^### `/m);
  });

  test("--cpu-prof-md works standalone without --cpu-prof", async () => {
    using dir = tempDir("cpu-prof-md-standalone", {
      "test.js": `
        function loop() {
          const end = Date.now() + 100;
          while (Date.now() < end) {}
        }
        loop();
      `,
    });

    // Use ONLY --cpu-prof-md without --cpu-prof
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--cpu-prof-md", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;

    // Check that a .md file was created
    const files = readdirSync(String(dir));
    const mdFiles = files.filter(f => f.endsWith(".md") && f.startsWith("CPU."));

    expect(mdFiles.length).toBeGreaterThan(0);
    expect(exitCode).toBe(0);

    // Validate it's the markdown format
    const profileContent = readFileSync(join(String(dir), mdFiles[0]), "utf-8");
    expect(profileContent).toContain("# CPU Profile");
  });

  test("--cpu-prof and --cpu-prof-md together creates both files", async () => {
    using dir = tempDir("cpu-prof-both-formats", {
      "test.js": `
        function loop() {
          const end = Date.now() + 100;
          while (Date.now() < end) {}
        }
        loop();
      `,
    });

    // Use both flags together
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--cpu-prof", "--cpu-prof-md", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;

    // Check that both .cpuprofile and .md files were created
    const files = readdirSync(String(dir));
    const jsonFiles = files.filter(f => f.endsWith(".cpuprofile"));
    const mdFiles = files.filter(f => f.endsWith(".md") && f.startsWith("CPU."));

    expect(jsonFiles.length).toBeGreaterThan(0);
    expect(mdFiles.length).toBeGreaterThan(0);
    expect(exitCode).toBe(0);

    // Validate JSON file
    const jsonContent = readFileSync(join(String(dir), jsonFiles[0]), "utf-8");
    const profile = JSON.parse(jsonContent);
    expect(profile).toHaveProperty("nodes");
    expect(profile).toHaveProperty("samples");

    // Validate markdown file
    const mdContent = readFileSync(join(String(dir), mdFiles[0]), "utf-8");
    expect(mdContent).toContain("# CPU Profile");
  });

  // https://github.com/oven-sh/bun/issues/42377
  // The sampling profiler marks every sampled callee as a GC root until its
  // samples are released. Bun only released them at exit, so a per-frame bound
  // function (React's scheduler makes one per render) kept every frame's data
  // alive for the whole run. The event loop now drains the profiler while it
  // runs, so a full GC frees the frames.
  test("sampled callees are released while profiling runs", async () => {
    using dir = tempDir("cpu-prof-gc-roots", {
      "test.mjs": `
        let sink = 0;
        const frames = [];
        function work(frame) {
          let s = 0;
          for (const op of frame.operations) s += op.x;
          return s;
        }
        function renderFrame(n) {
          const frame = { operations: [], cells: new Array(50000).fill(n) };
          for (let i = 0; i < 2000; i++) frame.operations.push({ x: i });
          frames.push(new WeakRef(frame));
          const callee = work.bind(null, frame);
          for (let k = 0; k < 100; k++) sink += callee();
        }
        const aliveFrames = () => {
          Bun.gc(true);
          return frames.filter(ref => ref.deref() !== undefined).length;
        };
        for (let n = 0; n < 150; n++) {
          renderFrame(n);
          if (n % 10 === 9) await Bun.sleep(1);
        }
        // The profiler drains on an event loop tick at most once per 100ms.
        // Poll until the drained samples let the GC free the frames.
        const deadline = performance.now() + 1000;
        let alive = aliveFrames();
        while (alive > 0 && performance.now() < deadline) {
          await Bun.sleep(20);
          alive = aliveFrames();
        }
        console.log(JSON.stringify({ alive, sink: sink > 0 }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--cpu-prof", "test.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    expect(result.sink).toBe(true);
    // Without the fix, every frame that was sampled through its bound function
    // stays alive: about 60 of 150.
    expect(result.alive).toBe(0);
    expect(exitCode).toBe(0);

    // Draining must not lose samples: the profile still covers the workload.
    const profileFiles = readdirSync(String(dir)).filter(f => f.endsWith(".cpuprofile"));
    expect(profileFiles.length).toBe(1);
    const profile = JSON.parse(readFileSync(join(String(dir), profileFiles[0]), "utf-8"));
    expect(profile.samples.length).toBeGreaterThan(0);
    expect(profile.samples.length).toBe(profile.timeDeltas.length);
    const functionNames = profile.nodes.map((n: any) => n.callFrame.functionName);
    expect(functionNames).toContain("renderFrame");
    expect(functionNames).toContain("work");
  });
});
