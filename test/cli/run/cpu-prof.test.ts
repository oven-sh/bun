import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, isGlibc, isWindows, tempDir } from "harness";
import { join } from "path";

// Every workload below is time-bounded for 500ms. The sampler is a thread of its own, which on a busy machine runs a few
// times in 100ms, or not once: "No samples collected." in --cpu-prof-md output.
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
        while (now + 500 > performance.now()) {
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
          const end = Date.now() + 500;
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
          const end = Date.now() + 500;
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

  test.skipIf(isWindows)("a backslash in --cpu-prof-dir is part of the name", async () => {
    using dir = tempDir("cpu-prof-dir-backslash", {});

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--cpu-prof", "--cpu-prof-dir", "a\\b", "--cpu-prof-name", "p.cpuprofile", "-e", "1"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "" });
    expect(readdirSync(String(dir), { recursive: true }).sort()).toEqual(["a\\b", "a\\b/p.cpuprofile"]);
    expect(exitCode).toBe(0);
  });

  test("profile captures function names", async () => {
    using dir = tempDir("cpu-prof-functions", {
      "test.js": `
        function myFunction() {
          let sum = 0;
          const end = performance.now() + 500;
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
          while (now + 500 > performance.now()) {
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
          const end = Date.now() + 500;
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
          while (now + 500 > performance.now()) {
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
          const end = Date.now() + 500;
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
          const end = Date.now() + 500;
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

  describe("bun test", () => {
    const file = (name: string) => `
      import { test } from "bun:test";
      function ${name}(n) {
        return n <= 1 ? n : ${name}(n - 1) + ${name}(n - 2);
      }
      test("${name}", () => {
        const now = performance.now();
        while (now + 500 > performance.now()) Bun.inspect(${name}(20));
      });`;
    const files = { "a.test.js": file("inFileA"), "b.test.js": file("inFileB") };
    const functionNames = (dir: string, profile: string) =>
      JSON.parse(readFileSync(join(dir, profile), "utf-8")).nodes.map((node: any) => node.callFrame.functionName);

    // One process runs both files, and with --isolate each in its own global.
    test.each([[[]], [["--isolate"]], [["--parallel=1"]]])("one profile of the whole run %j", async flags => {
      using dir = tempDir("cpu-prof-test", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--cpu-prof", ...flags],
        cwd: String(dir),
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;
      const profiles = readdirSync(String(dir)).filter(name => name.endsWith(".cpuprofile"));
      expect(profiles).toHaveLength(1);
      expect(functionNames(String(dir), profiles[0])).toContain("inFileA");
      expect(functionNames(String(dir), profiles[0])).toContain("inFileB");
      expect(exitCode).toBe(0);
    });

    test("--parallel: one profile for each worker, and none for the process that only hands out files", async () => {
      using dir = tempDir("cpu-prof-test", files);
      await using proc = Bun.spawn({
        // 0: both workers start at once, so each gets a file.
        cmd: [
          bunExe(),
          "test",
          "--cpu-prof",
          "--cpu-prof-md",
          "--cpu-prof-dir=profiles",
          "--parallel=2",
          "--parallel-delay=0",
        ],
        cwd: String(dir),
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;
      const written = readdirSync(join(String(dir), "profiles"));
      const profiles = written.filter(name => name.endsWith(".cpuprofile"));
      expect(profiles).toHaveLength(2);
      expect(written.filter(name => name.endsWith(".md"))).toHaveLength(2);
      const names = profiles.flatMap(profile => functionNames(join(String(dir), "profiles"), profile));
      expect(names).toContain("inFileA");
      expect(names).toContain("inFileB");
      expect(exitCode).toBe(0);
    });
  });

  // https://github.com/oven-sh/bun/issues/44077
  // The timers in these fixtures are the waits being profiled.
  describe("time without a JavaScript frame", () => {
    async function run(flags: string[], script: string, env = bunEnv) {
      using dir = tempDir("cpu-prof-idle", {
        "test.js": `
          function busy(ms) {
            const end = performance.now() + ms;
            while (performance.now() < end);
          }
          // A timer also counts the time until the loop waits for it. On Windows, starting a thread blocks until that
          // thread has run, so on a busy machine the first collection can outlast a timer set by the main script.
          function wait(ms, then = () => {}, parts = 10) {
            if (parts) setTimeout(wait, ms / 10, ms, then, parts - 1);
            else then();
          }
          ${script}`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...flags, "--cpu-prof-dir=profiles", "test.js"],
        cwd: String(dir),
        env,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(exitCode).toBe(0);
      const read = (extension: string) => {
        const name = readdirSync(join(String(dir), "profiles")).find(name => name.endsWith(extension));
        return name && readFileSync(join(String(dir), "profiles", name), "utf-8");
      };
      return { stdout, json: read(".cpuprofile")!, markdown: read(".md")! };
    }

    const kinds = { "(idle)": "idle", "(program)": "program", "(garbage collector)": "gc" } as const;
    const nothing = () => ({ idle: 0, program: 0, gc: 0, functions: 0 });

    function readMarkdown(markdown: string) {
      const milliseconds = (time: string) => {
        const [, value, unit] = time.match(/^([\d.]+)(us|ms|s)$/)!;
        return Number(value) * { us: 0.001, ms: 1, s: 1000 }[unit]!;
      };
      const [header, hotFunctions] = markdown.split("\n## ");
      const [, duration, samples] = header.match(/^\| ([\d.]+(?:us|ms|s)) \| (\d+) \|/m)!;
      const self = nothing();
      let precision = 0.01;
      const rows = hotFunctions.matchAll(/^\| [\d.]+% \| (\S+) \| \S+ \| \S+ \| `([^`]+)` \| (.*) \|$/gm);
      for (const [, time, name, location] of rows) {
        self[location ? "functions" : kinds[name]] += milliseconds(time);
        // Times are cut off.
        precision += milliseconds(time) < 1000 ? 0.1 : 10;
      }
      return { duration: milliseconds(duration), samples: Number(samples), precision, ...self };
    }

    function readJSON(json: string) {
      const { nodes, samples, timeDeltas, startTime, endTime } = JSON.parse(json);
      const [root] = nodes;
      const kindById = new Map<number, keyof ReturnType<typeof nothing>>();
      for (const [functionName, kind] of Object.entries(kinds)) {
        const found = nodes.filter((node: any) => node.callFrame.functionName === functionName && !node.callFrame.url);
        if (!found.length) continue;
        expect(found).toEqual([
          {
            id: expect.any(Number),
            callFrame: { functionName, scriptId: "0", url: "", lineNumber: -1, columnNumber: -1 },
            hitCount: expect.any(Number),
          },
        ]);
        expect(root.children).toContain(found[0].id);
        kindById.set(found[0].id, kind);
      }
      const hitCounts = nodes.map(() => 0);
      for (const id of samples) hitCounts[id - 1]++;
      expect(nodes.map((node: any) => node.hitCount)).toEqual(hitCounts);
      expect(root.hitCount).toBe(0);
      expect(timeDeltas).toHaveLength(samples.length);
      expect(timeDeltas.filter((delta: number) => delta < 0)).toEqual([]);
      expect(startTime).toBeInteger();
      expect(endTime).toBeInteger();

      const untilEnd = endTime - startTime - timeDeltas.reduce((sum: number, delta: number) => sum + delta, 0);
      expect(untilEnd).toBeGreaterThanOrEqual(0);
      // DevTools' flame chart: a sample lasts until the next one.
      const self = nothing();
      samples.forEach((id: number, i: number) => {
        self[kindById.get(id) ?? "functions"] += (timeDeltas[i + 1] ?? untilEnd) / 1000;
      });
      return { duration: (endTime - startTime) / 1000, samples: samples.length, nodes, ...self };
    }

    async function runWithBothFormats(flags: string[], script: string) {
      const profile = await run(["--cpu-prof", "--cpu-prof-md", ...flags], script);
      const json = readJSON(profile.json);
      const markdown = readMarkdown(profile.markdown);
      for (const kind of ["idle", "program", "gc", "functions"] as const) {
        expect(markdown[kind]).toBeWithin(json[kind] - markdown.precision, json[kind] + 0.01);
      }
      expect(markdown.samples).toBe(json.samples);
      expect(profile.markdown).not.toContain("``");
      expect(profile.markdown).not.toMatch(/^### `\((idle|garbage collector)\)`$/m);
      return { ...profile, ...json };
    }

    test.each([1000, 5000])("a wait between two calls, --cpu-prof-interval=%d", async interval => {
      const profile = await runWithBothFormats(
        [`--cpu-prof-interval=${interval}`],
        `busy(250);
         wait(500, () => {
           busy(250);
           wait(100);
         });`,
      );

      expect(profile.idle).toBeWithin(250, profile.duration - 375);
      expect(profile.functions).toBeWithin(200, profile.duration - 250);

      const time = String.raw`[\d.]+% \| [\d.]+m?s`;
      const row = expect.stringMatching(new RegExp(String.raw`^\| (${time}) \| \1 \| \x60\(idle\)\x60 \|  \|$`));
      expect(profile.markdown.split("\n").filter(line => line.includes("(idle)"))).toEqual([
        expect.stringMatching(/^\*\*Top 10:\*\* .*`\(idle\)` [\d.]+%/),
        row,
        row,
      ]);
    });

    test("waits and calls that are shorter than the sampling interval", async () => {
      const profile = await runWithBothFormats(
        ["--cpu-prof-interval=8000"],
        `let remaining = 80;
         let waited = 0;
         function next(start) {
           waited += performance.now() - start;
           if (!remaining--) return console.log(waited);
           busy(5);
           setTimeout(next, 5, performance.now());
         }
         setImmediate(() => next(performance.now()));`,
      );

      expect(profile.idle).toBeGreaterThan(Number(profile.stdout) / 4);
      expect(profile.functions).toBeGreaterThan((80 * 5) / 4);
    });

    test("a wait after the last call", async () => {
      const profile = await runWithBothFormats([], `busy(100); wait(500);`);

      expect(profile.idle).toBeWithin(250, profile.duration - 100);
    });

    test("the time after the last sample belongs to that sample", async () => {
      const profile = await runWithBothFormats(["--cpu-prof-interval=60000000"], `busy(500);`);

      expect(profile.samples).toBe(1);
      expect(profile.duration).toBeGreaterThanOrEqual(500);
      expect(profile.program + profile.gc + profile.functions).toBeGreaterThan(0);
    });

    test("nothing but a wait", async () => {
      const profile = await run(["--cpu-prof"], `wait(500);`);

      expect(readJSON(profile.json).idle).toBeGreaterThan(250);
    });

    test("a wait after another thread ended the one before it", async () => {
      const profile = await run(
        ["--cpu-prof-md"],
        `await Bun.password.hash("password", { algorithm: "bcrypt", cost: 8 });
         await Bun.sleep(500);`,
      );

      expect(readMarkdown(profile.markdown).idle).toBeGreaterThan(250);
    });

    test("a wait beneath a JavaScript frame belongs to that frame", async () => {
      const profile = await runWithBothFormats(
        [],
        `const start = performance.now();
         // Bun.build() runs the event loop until setup() has settled.
         const built = Bun.build({ entrypoints: [import.meta.path], plugins: [{ name: "slow", setup: () => Bun.sleep(400) }] });
         console.log(performance.now() - start);
         await built;
         wait(200);`,
      );
      const blocked = Number(profile.stdout);

      expect(blocked).toBeGreaterThan(390);
      expect(profile.idle).toBeWithin(100, profile.duration - blocked);
    });

    const hitCount = (nodes: any[], ...names: string[]) =>
      nodes.reduce((sum, node) => sum + (names.includes(node.callFrame.functionName) ? node.hitCount : 0), 0);

    test("a C function that optimized code calls belongs to its caller", async () => {
      const { nodes } = await runWithBothFormats(
        [],
        `import { noInline } from "bun:jsc";
         function sines(sum) {
           for (let i = 0; i < 1000; i++) sum += Math.sin(i * 1e300);
           return sum;
         }
         function integers(sum) {
           for (let i = 0; i < 1000; i++) sum = (sum * 31 + i) | 0;
           return sum;
         }
         noInline(sines);
         noInline(integers);
         function repeatSines(sum) {
           for (const end = performance.now() + 5; performance.now() < end; ) sum = sines(sum);
         }
         function repeatIntegers(sum) {
           for (const end = performance.now() + 5; performance.now() < end; ) sum = integers(sum);
         }
         for (let i = 0; i < 60; i++) repeatSines(0), repeatIntegers(0);`,
      );
      const callers = nodes.filter(node => node.callFrame.functionName === "repeatSines");
      const callees = nodes.filter(node => callers.some(caller => caller.children?.includes(node.id)));

      expect({
        sines: hitCount(nodes, "sines", "sin"),
        besideSines: hitCount([...callers, ...callees], "repeatSines", "now"),
        integers: hitCount(nodes, "integers"),
      }).toSatisfy(hits => hits.sines > hits.integers / 2 && hits.sines > 4 * hits.besideSines);
    });

    test("a call that returns before its stack is read belongs to the function that was called", async () => {
      const profile = await run(
        ["--cpu-prof"],
        `function outermost() {
           JSON.stringify({ toJSON: () => busy(200) });
         }
         setImmediate(outermost);`,
        { ...bunEnv, BUN_JSC_forceSamplingProfilerToMissStacks: "1" },
      );
      const { nodes } = readJSON(profile.json);
      const byId = new Map(nodes.map(node => [node.id, node]));

      expect(nodes[0].children.flatMap(id => byId.get(id).children ?? [])).toEqual([]);
      expect(hitCount(nodes, "busy", "toJSON", "stringify")).toBe(0);
      expect(hitCount(nodes, "outermost")).toBeGreaterThan(5);
    });

    test.each([
      ["a script", `require("vm").runInThisContext(source, "script.js")`],
      ["indirect eval", `(0, eval)(source)`],
      ["direct eval", `eval(source)`],
    ])("the top level of %s is not (program)", async (_, evaluate) => {
      const { json, markdown } = await run(
        ["--cpu-prof", "--cpu-prof-md"],
        `const source = "for (const end = performance.now() + 200; performance.now() < end; );";
         (function evaluates() { ${evaluate}; })();`,
      );
      const { nodes } = readJSON(json);
      const below = (node: any): string[] =>
        (node.children ?? []).flatMap((id: number) => [nodes[id - 1].callFrame.functionName, ...below(nodes[id - 1])]);
      const names = below(nodes.find((node: any) => node.callFrame.functionName === "evaluates"));
      expect(names).toContain("");
      expect(names).not.toContain("(program)");
      expect(markdown).not.toMatch(/`\(program\)` \| `/);
    });

    test("a collection is (garbage collector)", async () => {
      const profile = await runWithBothFormats(
        [],
        `const live = Array.from({ length: 50_000 }, (_, i) => ({ i }));
         const end = performance.now() + 500;
         while (performance.now() < end) Bun.gc(true);
         console.log(live.length);`,
      );

      expect(profile.gc).toBeGreaterThan(250);
    });

    // https://github.com/nodejs/node/blob/v26.12.1/deps/v8/src/profiler/tick-sample.h#L79-L80
    test.each([
      { depth: 255, env: {} },
      { depth: 260, env: { BUN_JSC_samplingProfilerMaxStackDepth: "260" } },
      { depth: 20, env: { BUN_JSC_samplingProfilerMaxStackDepth: "20" } },
    ])("a sample has the innermost $depth frames", async ({ depth, env }) => {
      const profile = await run(
        ["--cpu-prof", "--cpu-prof-interval=50000"],
        `import { noInline } from "bun:jsc";
         function recurse(depth) {
           return depth ? recurse(depth - 1) + 1 : busy(500);
         }
         noInline(recurse);
         noInline(busy);
         recurse(400);`,
        { ...bunEnv, ...env },
      );
      const { nodes } = readJSON(profile.json);
      const depths = new Map([[1, 0]]);
      for (const { id, children = [] } of nodes) for (const child of children) depths.set(child, depths.get(id)! + 1);

      expect(nodes.map(node => node.callFrame.functionName)).toContain("busy");
      expect(Math.max(...depths.values())).toBe(depth);
    });

    // A plain timed wait lasts until the next tick of the system's clock, 15.6 ms apart.
    test.if(isWindows)("the interval is not rounded up to the system's clock", async () => {
      const profile = await runWithBothFormats(["--cpu-prof-interval=2000"], `wait(500);`);

      expect(profile.duration / profile.samples).toBeLessThan(8);
    });

    test.each([
      [249, "249us"],
      [0, "1.0ms"],
    ])("--cpu-prof-interval=%d is an interval of %s", async (interval, expected) => {
      const profile = await run(["--cpu-prof-md", `--cpu-prof-interval=${interval}`], `busy(100);`);

      expect(profile.markdown.match(/^\| \S+ \| \d+ \| (\S+) \|/m)![1]).toBe(expected);
    });

    test.each([
      ["a session that disconnects", `session.disconnect();`],
      ["Profiler.disable", `session.post("Profiler.disable");`],
      ["Profiler.stop", `session.post("Profiler.start"); session.post("Profiler.stop");`],
      ["profile()", `profile(() => {}, 60_000_000);`],
      ["startSamplingProfiler()", `startSamplingProfiler(undefined, 60_000_000); samplingProfilerStackTraces();`],
    ])("is not affected by %s", async (_, statement) => {
      const { nodes, idle } = await runWithBothFormats(
        [],
        `import { profile, samplingProfilerStackTraces, startSamplingProfiler } from "bun:jsc";
         import { Session } from "node:inspector";
         function before() { busy(100); }
         function after() { busy(100); }
         const session = new Session();
         session.connect();
         session.post("Profiler.enable");
         before();
         ${statement}
         after();
         wait(300);`,
      );

      expect(nodes.map(node => node.callFrame.functionName)).toEqual(expect.arrayContaining(["before", "after"]));
      expect(idle).toBeGreaterThan(150);
    });

    const cc = Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");
    test.skipIf(!cc || !isGlibc)("a very long wait is not written sample by sample", async () => {
      using dir = tempDir("cpu-prof-idle-clock", {
        "skip.c": `
          #define _GNU_SOURCE
          #include <dlfcn.h>
          #include <signal.h>
          #include <string.h>
          #include <sys/epoll.h>
          #include <sys/prctl.h>
          #include <time.h>

          static long skipped_milliseconds, skip_until;

          // While the loop waits, a millisecond passes whenever the sampler looks at the clock. So it never sleeps.
          int clock_gettime(clockid_t clock, struct timespec *time) {
            static int (*next)(clockid_t, struct timespec *);
            static __thread int is_sampler = -1;
            if (!next) next = dlsym(RTLD_NEXT, "clock_gettime");
            int result = next(clock, time);
            if (clock != CLOCK_MONOTONIC) return result;
            long skipped = __atomic_load_n(&skipped_milliseconds, __ATOMIC_SEQ_CST);
            if (skipped < __atomic_load_n(&skip_until, __ATOMIC_SEQ_CST)) {
              if (is_sampler < 0) {
                char name[16];
                prctl(PR_GET_NAME, name);
                is_sampler = !strcmp(name, "thread"); // What is left of "jsc.sampling-profiler.thread".
              }
              if (is_sampler) __atomic_store_n(&skipped_milliseconds, ++skipped, __ATOMIC_SEQ_CST);
            }
            time->tv_sec += skipped / 1000;
            time->tv_nsec += skipped % 1000 * 1000000;
            if (time->tv_nsec >= 1000000000) time->tv_sec++, time->tv_nsec -= 1000000000;
            return result;
          }

          int epoll_pwait(int fd, struct epoll_event *events, int count, int timeout, const sigset_t *mask) {
            static int (*next)(int, struct epoll_event *, int, int, const sigset_t *);
            if (!next) next = dlsym(RTLD_NEXT, "epoll_pwait");
            if (timeout < 60 * 1000) return next(fd, events, count, timeout, mask);
            long until = __atomic_load_n(&skipped_milliseconds, __ATOMIC_SEQ_CST) + timeout;
            __atomic_store_n(&skip_until, until, __ATOMIC_SEQ_CST);
            for (int i = 0; i < 3000 && __atomic_load_n(&skipped_milliseconds, __ATOMIC_SEQ_CST) < until; i++) {
              struct timespec delay = { 0, 10 * 1000 * 1000 };
              nanosleep(&delay, 0);
            }
            __atomic_store_n(&skipped_milliseconds, until, __ATOMIC_SEQ_CST);
            return 0;
          }`,
      });
      await using compiler = Bun.spawn({
        cmd: [cc!, "-shared", "-fPIC", "-o", "skip.so", "skip.c", "-ldl"],
        cwd: String(dir),
        stdout: "inherit",
        stderr: "inherit",
      });
      expect(await compiler.exited).toBe(0);

      const duration = 100 * 60 * 1000;
      const spawnedAt = Date.now();
      const profile = await run(["--cpu-prof", "--cpu-prof-md"], `setTimeout(() => {}, ${duration});`, {
        ...bunEnv,
        LD_PRELOAD: join(String(dir), "skip.so"),
        // epoll_pwait2() does not go through libc.
        BUN_FEATURE_FLAG_DISABLE_EPOLL_PWAIT2: "1",
        BUN_GC_TIMER_DISABLE: "1",
      });

      expect(readMarkdown(profile.markdown).idle).toBeWithin(duration - 60_000, duration + 60_000);
      // Not parsed: that takes a debug build several seconds.
      const [head, timeDeltas] = profile.json.split(/,"samples":\[[\d,]*\],"timeDeltas":/);
      const { nodes, startTime } = JSON.parse(head + "}");
      const { hitCount } = nodes.find((node: any) => node.callFrame.functionName === "(idle)");
      const timeDelta = Number(timeDeltas.substr(timeDeltas.length / 2, 100).split(",")[1]);
      expect(hitCount).toBeGreaterThan(1_000_000);
      expect((duration * 1000) / timeDelta).toBeWithin(400_000, 1_001_000);
      // The wall clock did not skip.
      expect(startTime / 1000).toBeWithin(spawnedAt - 60_000, Date.now() + 60_000);
    });
  });

  // "%80" decodes to a byte that isn't valid UTF-8. Windows decodes it to U+FFFD.
  test.skipIf(isWindows)("--cpu-prof-md prints a source's URL when the URL can't be converted to a path", async () => {
    using dir = tempDir("cpu-prof-md-source-url", {
      "test.js": `
        const loop = require("node:vm").runInThisContext(
          "(function loop() { const end = Date.now() + 300; let x = 0; while (Date.now() < end) { for (let i = 0; i < 1e4; i++) x += Math.sqrt(i); } return x; })",
          { filename: "file:///%80.js" },
        );
        loop();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--cpu-prof-md", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    const mdFiles = readdirSync(String(dir)).filter(f => f.endsWith(".md") && f.startsWith("CPU."));
    expect({ exitCode, profiles: mdFiles.length }).toEqual({ exitCode: 0, profiles: 1 });
    expect(readFileSync(join(String(dir), mdFiles[0]), "utf-8")).toContain("| `loop` | `file:///%80.js");
  });
});
