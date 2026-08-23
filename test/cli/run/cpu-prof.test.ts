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

  test("bun test --cpu-prof-md writes a profile", async () => {
    using dir = tempDir("cpu-prof-test-runner", {
      "profile.test.ts": `
        import { expect, test } from "bun:test";

        test("profiled test", () => {
          const end = performance.now() + 100;
          let iterations = 0;
          while (performance.now() < end) iterations++;
          expect(iterations).toBeGreaterThan(0);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--cpu-prof-md", "--cpu-prof-name", "test-profile.md", "./profile.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("bun test");
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
    expect(await Bun.file(join(String(dir), "test-profile.md")).text()).toContain("# CPU Profile");
  });

  test("bun test --cpu-prof writes a JSON profile", async () => {
    using dir = tempDir("cpu-prof-test-runner-json", {
      "profile.test.ts": `
        import { test } from "bun:test";
        test("profiled test", () => {
          const end = performance.now() + 100;
          while (performance.now() < end) Math.sqrt(Math.random());
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--cpu-prof", "--cpu-prof-name", "test-profile.cpuprofile", "./profile.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("bun test");
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
    const profile = JSON.parse(await Bun.file(join(String(dir), "test-profile.cpuprofile")).text());
    expect(profile).toHaveProperty("nodes");
    expect(profile.samples.length).toBeGreaterThan(0);
  });

  test("bun test --bail writes a CPU profile", async () => {
    using dir = tempDir("cpu-prof-test-bail", {
      "profile.test.ts": `
        import { expect, test } from "bun:test";
        test("profiled failure", () => {
          const end = performance.now() + 100;
          while (performance.now() < end) Math.sqrt(Math.random());
          expect(1).toBe(2);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--bail=1", "--cpu-prof-md", "--cpu-prof-name", "bail-profile.md"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("bun test");
    expect(stderr).toContain("Bailed out after 1 failure");
    expect(exitCode).toBe(1);
    expect(await Bun.file(join(String(dir), "bail-profile.md")).text()).toContain("# CPU Profile");
  });

  test("bun repl --cpu-prof writes a profile", async () => {
    using dir = tempDir("cpu-prof-repl", {});

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "repl",
        "--cpu-prof",
        "--cpu-prof-name",
        "repl-profile.cpuprofile",
        "-e",
        "const end = performance.now() + 100; while (performance.now() < end) Math.sqrt(Math.random());",
      ],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const profile = JSON.parse(await Bun.file(join(String(dir), "repl-profile.cpuprofile")).text());
    expect(profile).toHaveProperty("nodes");
    expect(profile.samples.length).toBeGreaterThan(0);
  });

  test("bun test profiling works with --parallel=1", async () => {
    using dir = tempDir("cpu-prof-test-parallel-one", {
      "profile.test.ts": `
        import { expect, test } from "bun:test";

        test("profiled test", () => {
          const end = performance.now() + 100;
          let iterations = 0;
          while (performance.now() < end) iterations++;
          expect(iterations).toBeGreaterThan(0);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=1", "--cpu-prof-md", "--cpu-prof-name", "test-profile.md"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("1x PARALLEL");
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
    expect(await Bun.file(join(String(dir), "test-profile.md")).text()).toContain("# CPU Profile");
  });

  test("bun test rejects CPU profiling with multiple parallel workers", async () => {
    using dir = tempDir("cpu-prof-test-parallel", {
      "first.test.ts": `import { test } from "bun:test"; test("first", () => {});`,
      "second.test.ts": `import { test } from "bun:test"; test("second", () => {});`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", "--cpu-prof-md"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toBe(
      "error: profiling is not supported with multiple bun test --parallel workers\n" +
        "note: Use --parallel=1 or remove --parallel to profile the test process.\n",
    );
    expect(exitCode).toBe(1);
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
});
