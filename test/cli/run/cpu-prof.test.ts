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
  describe("(idle)", () => {
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

    function readMarkdown(markdown: string) {
      const milliseconds = (time: string) => {
        const [, value, unit] = time.match(/^([\d.]+)(us|ms|s)$/)!;
        return Number(value) * { us: 0.001, ms: 1, s: 1000 }[unit]!;
      };
      const [header, hotFunctions] = markdown.split("\n## ");
      const self = { idle: 0, program: 0, functions: 0 };
      const rows = hotFunctions.matchAll(/^\| [\d.]+% \| (\S+) \| \S+ \| \S+ \| `([^`]+)` \| (.*) \|$/gm);
      for (const [, time, name, location] of rows) {
        self[location ? "functions" : (name.slice(1, -1) as "idle" | "program")] += milliseconds(time);
      }
      return { duration: milliseconds(header.match(/^\| ([\d.]+(?:us|ms|s)) \|/m)![1]), ...self };
    }
    // From one second on, times are cut off after two decimals.
    const markdownPrecision = 10;

    function readJSON(json: string) {
      const { nodes, samples, timeDeltas, startTime, endTime } = JSON.parse(json);
      const [root] = nodes;
      const [idleNode, programNode] = ["(idle)", "(program)"].map(functionName => {
        const node = nodes.find((node: any) => node.callFrame.functionName === functionName && !node.callFrame.url);
        if (!node) return;
        expect(node).toEqual({
          id: expect.any(Number),
          callFrame: { functionName, scriptId: "0", url: "", lineNumber: -1, columnNumber: -1 },
          hitCount: samples.filter((id: number) => id === node.id).length,
        });
        expect(root.children).toContain(node.id);
        return node;
      });
      expect(idleNode).toBeDefined();
      expect(root.hitCount).toBe(0);
      expect(samples).not.toContain(root.id);
      expect(timeDeltas).toHaveLength(samples.length);
      expect(timeDeltas.filter((delta: number) => delta < 0)).toEqual([]);
      expect(startTime).toBeInteger();
      expect(endTime).toBeInteger();

      const untilEnd = endTime - startTime - timeDeltas.reduce((sum: number, delta: number) => sum + delta, 0);
      expect(untilEnd).toBeGreaterThanOrEqual(0);
      // DevTools' flame chart: a sample lasts until the next one.
      const byTimestamps = { idle: 0, programBeforeLastWait: 0, programAfterLastWait: 0, functions: 0 };
      const lastIdleSample = samples.lastIndexOf(idleNode.id);
      samples.forEach((id: number, i: number) => {
        const program = i < lastIdleSample ? "programBeforeLastWait" : "programAfterLastWait";
        const kind = id === idleNode.id ? "idle" : id === programNode?.id ? program : "functions";
        byTimestamps[kind] += (timeDeltas[i + 1] ?? untilEnd) / 1000;
      });

      const duration = (endTime - startTime) / 1000;
      const timePerSample = duration / samples.length;
      return {
        duration,
        timePerSample,
        byTimestamps,
        untilFirstProgramSample: timeDeltas[samples.indexOf(programNode?.id)],
        idleSamples: idleNode.hitCount,
        // DevTools' ProfileNode.self and pprof: every sample weighs the same.
        idleByCount: idleNode.hitCount * timePerSample,
      };
    }

    function expectBothFormatsToAgree(
      json: ReturnType<typeof readJSON>,
      { idle, program, functions }: ReturnType<typeof readMarkdown>,
      interval: number,
    ) {
      const precision = 3 * json.timePerSample + markdownPrecision;
      const { programBeforeLastWait, programAfterLastWait } = json.byTimestamps;
      expect(json.byTimestamps.idle).toBeWithin(idle - precision, idle + json.timePerSample + markdownPrecision);
      // The interval is the limit when the sampler happened to find functions more often than that.
      expect(Math.max(json.idleByCount, json.idleSamples * interval)).toBeWithin(idle - precision, idle + precision);
      expect(programBeforeLastWait + programAfterLastWait).toBeWithin(program - 1, program + markdownPrecision);
      expect(json.byTimestamps.functions).toBeLessThan(functions + precision);
      expect(idle + program + functions).toBeWithin(json.duration - precision, json.duration + json.timePerSample);
    }

    test.each([1000, 5000])("a wait between two calls, --cpu-prof-interval=%d", async interval => {
      const profile = await run(
        ["--cpu-prof", "--cpu-prof-md", `--cpu-prof-interval=${interval}`],
        `busy(250);
         wait(500, () => {
           busy(250);
           wait(100);
         });`,
      );
      const json = readJSON(profile.json);
      const markdown = readMarkdown(profile.markdown);

      expect(markdown.idle).toBeWithin(250, json.duration - 500);
      expectBothFormatsToAgree(json, markdown, interval / 1000);

      const time = String.raw`[\d.]+% \| [\d.]+m?s`;
      const row = expect.stringMatching(new RegExp(String.raw`^\| (${time}) \| \1 \| \x60\(idle\)\x60 \|  \|$`));
      expect(profile.markdown.split("\n").filter(line => line.includes("(idle)"))).toEqual([
        expect.stringMatching(/^\*\*Top 10:\*\* .*`\(idle\)` [\d.]+%/),
        row,
        row,
      ]);
      expect(profile.markdown).not.toContain("``");
    });

    test.each([
      { interval: 100, call: 10, wait: 10, count: 40, name: "several between two samples" },
      { interval: 10, call: 6, wait: 2, count: 100, name: "less than a sample's worth between two samples" },
    ])("waits shorter than the sampling interval: $name", async ({ interval, call, wait, count }) => {
      const profile = await run(
        ["--cpu-prof", "--cpu-prof-md", `--cpu-prof-interval=${interval * 1000}`],
        `let remaining = ${count};
         let waited = 0;
         function next(start) {
           waited += performance.now() - start;
           if (!remaining--) return console.log(waited);
           busy(${call});
           setTimeout(next, ${wait}, performance.now());
         }
         setImmediate(() => next(performance.now()));`,
      );
      const waited = Number(profile.stdout);
      const markdown = readMarkdown(profile.markdown);

      expect(markdown.idle).toBeWithin(waited / 3, waited + markdownPrecision);
      expectBothFormatsToAgree(readJSON(profile.json), markdown, interval);
    });

    test("a wait after the last call", async () => {
      const profile = await run(["--cpu-prof-md"], `busy(100); wait(500);`);
      const markdown = readMarkdown(profile.markdown);

      expect(markdown.idle).toBeWithin(250, markdown.duration - 100 + markdownPrecision);
    });

    test("the time after the last sample belongs to that sample", async () => {
      const profile = await run(["--cpu-prof-md", "--cpu-prof-interval=200000"], `busy(700);`);
      const markdown = readMarkdown(profile.markdown);

      expect(markdown.duration).toBeGreaterThanOrEqual(700);
      expect(markdown.functions + markdown.program).toBeGreaterThan(markdown.duration - 2 * markdownPrecision);
    });

    test("nothing but a wait", async () => {
      const profile = await run(["--cpu-prof"], `wait(500);`);
      const json = readJSON(profile.json);

      expect(json.byTimestamps.idle).toBeWithin(250, json.duration);
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
      const profile = await run(
        ["--cpu-prof-md"],
        `const start = performance.now();
         // Bun.build() runs the event loop until setup() has settled.
         const built = Bun.build({ entrypoints: [import.meta.path], plugins: [{ name: "slow", setup: () => Bun.sleep(400) }] });
         console.log(performance.now() - start);
         await built;
         wait(200);`,
      );
      const blocked = Number(profile.stdout);
      const markdown = readMarkdown(profile.markdown);

      expect(blocked).toBeGreaterThan(390);
      expect(markdown.idle).toBeWithin(100, markdown.duration - blocked + markdownPrecision);
    });

    // bun:jsc drives the same sampler. Keeping it from sampling makes busy() look like native code outside the VM.
    const stopSampling = `busy(250); startSamplingProfiler(undefined, 60_000_000);`;
    test.each([
      {
        name: "before the last wait",
        script: `${stopSampling} busy(400); wait(300, process.exit);`,
        position: "programBeforeLastWait",
      },
      {
        name: "after the last wait",
        script: `${stopSampling} wait(300, () => busy(400));`,
        position: "programAfterLastWait",
      },
      {
        name: "without a wait since the last sample",
        script: `wait(300, () => { ${stopSampling} busy(400); });`,
        position: "programAfterLastWait",
      },
      {
        name: "without any sample",
        script: `profile(() => {}); busy(400); wait(300);`,
        position: "programBeforeLastWait",
      },
    ] as const)("what the sampler cannot see at the end is (program): $name", async ({ name, script, position }) => {
      const profile = await run(
        ["--cpu-prof", "--cpu-prof-md"],
        `import { profile, startSamplingProfiler } from "bun:jsc"; ${script}`,
      );
      const json = readJSON(profile.json);
      const markdown = readMarkdown(profile.markdown);

      expect(json.byTimestamps[position]).toBeGreaterThan(200);
      if (name !== "after the last wait") expect(json.untilFirstProgramSample).toBeGreaterThan(0);
      expect(markdown.idle).toBeWithin(100, json.duration - 400);
      expectBothFormatsToAgree(json, markdown, 1);
      expect(profile.markdown).not.toContain("### `(program)`");
    });

    test("a wait that was not recorded is not billed to the last sample", async () => {
      const profile = await run(
        ["--cpu-prof-md"],
        `import { startSamplingProfiler } from "bun:jsc";
         import { Session } from "node:inspector";
         const session = new Session();
         session.connect();
         session.post("Profiler.enable");
         session.post("Profiler.stop", () => {});
         startSamplingProfiler();
         ${stopSampling}
         console.log(performance.now());
         setTimeout(() => {}, 400);`,
      );

      expect(readMarkdown(profile.markdown).functions).toBeWithin(1, Number(profile.stdout) + 200);
    });

    test("a wait that is much shorter than what the only sample stands for", async () => {
      const profile = await run(
        ["--cpu-prof", "--cpu-prof-md"],
        `import { profile, startSamplingProfiler } from "bun:jsc";
         profile(() => {});
         busy(500);
         startSamplingProfiler(undefined, 60_000_000);
         busy(50);
         wait(200);`,
      );
      const { idle } = readMarkdown(profile.markdown);

      expect(readJSON(profile.json).byTimestamps.idle).toBeGreaterThan(idle - markdownPrecision);
    });

    const cc = Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");
    test.skipIf(!cc || !isGlibc)("a wait of ten days does not take a sample for each millisecond", async () => {
      using dir = tempDir("cpu-prof-idle-clock", {
        "skip.c": `
          #define _GNU_SOURCE
          #include <dlfcn.h>
          #include <signal.h>
          #include <sys/epoll.h>
          #include <time.h>

          static long skipped_seconds;

          int clock_gettime(clockid_t clock, struct timespec *time) {
            static int (*next)(clockid_t, struct timespec *);
            if (!next) next = dlsym(RTLD_NEXT, "clock_gettime");
            int result = next(clock, time);
            if (clock == CLOCK_MONOTONIC) time->tv_sec += __atomic_load_n(&skipped_seconds, __ATOMIC_SEQ_CST);
            return result;
          }

          int epoll_pwait(int fd, struct epoll_event *events, int count, int timeout, const sigset_t *mask) {
            static int (*next)(int, struct epoll_event *, int, int, const sigset_t *);
            if (!next) next = dlsym(RTLD_NEXT, "epoll_pwait");
            if (timeout < 60 * 60 * 1000) return next(fd, events, count, timeout, mask);
            __atomic_fetch_add(&skipped_seconds, timeout / 1000 + 1, __ATOMIC_SEQ_CST);
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

      const tenDays = 10 * 24 * 60 * 60 * 1000;
      const spawnedAt = Date.now();
      const profile = await run(["--cpu-prof", "--cpu-prof-md"], `busy(100); setTimeout(() => {}, ${tenDays});`, {
        ...bunEnv,
        LD_PRELOAD: join(String(dir), "skip.so"),
        // epoll_pwait2() does not go through libc.
        BUN_FEATURE_FLAG_DISABLE_EPOLL_PWAIT2: "1",
        BUN_GC_TIMER_DISABLE: "1",
      });

      expect(readMarkdown(profile.markdown).idle).toBeWithin(tenDays - 60_000, tenDays + 60_000);
      // Not parsed: that takes a debug build several seconds.
      const { nodes, startTime } = JSON.parse(profile.json.slice(0, profile.json.indexOf(',"samples":[')) + "}");
      const { hitCount } = nodes.find((node: any) => node.callFrame.functionName === "(idle)");
      const timeDelta = Number(profile.json.slice(-2000).split(",")[1]);
      expect(hitCount).toBeLessThanOrEqual(1_000_000);
      expect((hitCount * timeDelta) / 1000).toBeWithin(tenDays - 60_000, tenDays + 60_000);
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
