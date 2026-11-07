import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, tempDir } from "harness";

// Scoped debug logs (`BUN_DEBUG_<scope>=1`) only exist in debug builds, and
// `/proc/thread-self/io` (the per-thread write(2) counter) only on Linux.
test.skipIf(!isDebug || !isLinux)("a scoped debug log line is one write(2)", async () => {
  const lines = 20;
  using dir = tempDir("scoped-debug-log", {
    // package.json + node_modules/ keep the resolver from trying auto-install.
    "package.json": `{"name": "test", "version": "0.0.0"}`,
    "node_modules/.keep": "",
    "index.js": `
      import { readFileSync } from "fs";
      const syscw = () => Number(readFileSync("/proc/thread-self/io", "utf8").match(/^syscw: (\\d+)$/m)[1]);
      const long = Buffer.alloc(5000, "x").toString();
      const before = syscw();
      for (let i = 0; i < ${lines}; i++) {
        // A bare specifier reaches the resolver, which logs one
        // "[importmetaresolve] source: ..., specifier: ..." line before it
        // fails. Every other line is longer than the 4 KB line buffer.
        const specifier = "not-a-real-package-" + i + (i % 2 ? long : "");
        try { import.meta.resolve(specifier); } catch {}
      }
      const after = syscw();
      console.log(JSON.stringify({ writes: after - before }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_DEBUG_importMetaResolve: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Scoped logs go to stdout, before the JSON the script prints last.
  const out = stdout.trim().split("\n");
  const logged = out.filter(line => line.startsWith("[importmetaresolve] source: "));
  expect(logged, stderr).toHaveLength(lines);
  expect(JSON.parse(out.at(-1)!)).toEqual({ writes: lines });
  expect(exitCode).toBe(0);
});
